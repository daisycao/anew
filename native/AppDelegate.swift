import Cocoa
import WebKit
import UniformTypeIdentifiers
import ImageIO

/// 顶部这条透明视图专门用来拖窗口。
/// WKWebView 会吃掉所有鼠标事件，而 `-webkit-app-region: drag` 只有 Electron 支持，
/// 所以必须在原生层盖一条视图。
///
/// 只靠 mouseDownCanMoveWindow 不保险：那条路径要 AppKit 自己去判定"这次点击算不算
/// 拖窗口"，中间有一堆条件（图层化、命中测试、窗口样式）都可能让它失效。
/// 这里直接接管 mouseDown，自己调 performDrag(with:)——这是 AppKit 公开的
/// "从现在开始拖这个窗口"接口，不依赖任何判定，按下就拖。
private final class WindowDragStrip: NSView {
    override var mouseDownCanMoveWindow: Bool { true }

    /// 命中测试必须返回自己，否则事件会穿到下面的 WKWebView 上去。
    override func hitTest(_ point: NSPoint) -> NSView? {
        return frame.contains(point) ? self : nil
    }

    override func mouseDown(with event: NSEvent) {
        guard let window = window else { return }
        // 双击标题栏 = 按系统偏好里的设置（放大或最小化），和原生标题栏行为一致
        if event.clickCount == 2 {
            window.performZoom(nil)
            return
        }
        window.performDrag(with: event)
    }

    /// 光标停在拖动条上时显示普通箭头，不要变成 WebView 的文本光标
    override func resetCursorRects() {
        addCursorRect(bounds, cursor: .arrow)
    }
}

private struct ChangeLog: Codable {
    let time: String
    let summary: String
}

private struct RecentLibrary: Codable {
    let path: String
    let name: String
    let lastOpened: Date
}

private enum ImageFailure: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}

/// Disk operations are shared by preview and clipboard export. Originals are never modified.
private enum DocumentImages {
    static func localURL(_ relative: String, document: URL) throws -> URL {
        let decoded = relative.removingPercentEncoding ?? relative
        guard !decoded.hasPrefix("/"), !decoded.contains(":"), !decoded.contains("\\"),
              !decoded.split(separator: "/").contains("..") else {
            throw ImageFailure.message(L("图片必须使用稿件目录内的相对路径", "Images must use a path relative to the document folder"))
        }
        let base = document.deletingLastPathComponent().resolvingSymlinksInPath().standardizedFileURL
        // Resolve each ancestor, including when the final file does not yet exist.
        let file = decoded.split(separator: "/").reduce(base) { parent, component in
            parent.appendingPathComponent(String(component)).resolvingSymlinksInPath().standardizedFileURL
        }
        guard file.path.hasPrefix(base.path + "/") else { throw ImageFailure.message(L("图片路径超出稿件目录", "Image path is outside the document folder")) }
        return file
    }

    static func imageType(_ data: Data) throws -> UTType {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              CGImageSourceGetCount(source) > 0,
              let identifier = CGImageSourceGetType(source),
              let type = UTType(identifier as String), type.conforms(to: .image) else {
            throw ImageFailure.message(L("无法读取图片，请使用 PNG、JPEG、GIF、WebP 或 HEIC 等图片格式", "Can't read the image. Use PNG, JPEG, GIF, WebP or HEIC"))
        }
        return type
    }

    static func save(_ data: Data, document: URL) throws -> String {
        let type = try imageType(data)
        let ext = type.preferredFilenameExtension ?? "png"
        let directory = try localURL("images", document: document)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        // Exclusive creation protects existing files, including a collision in the same second.
        let first = Int.random(in: 0...999)
        for offset in 0..<1000 {
            let name = "img-\(formatter.string(from: Date()))-\(String(format: "%03d", (first + offset) % 1000)).\(ext)"
            do {
                try data.write(to: directory.appendingPathComponent(name), options: .withoutOverwriting)
                return name
            } catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileWriteFileExistsError { continue }
        }
        throw ImageFailure.message(L("这一秒插入的图片过多，请稍后重试", "Too many images at once, try again in a moment"))
    }

    static func clipboardData(_ data: Data) throws -> (Data, String) {
        let type = try imageType(data)
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let info = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let pixelWidth = info[kCGImagePropertyPixelWidth] as? Int,
              let pixelHeight = info[kCGImagePropertyPixelHeight] as? Int else {
            throw ImageFailure.message(L("无法读取图片尺寸", "Can't read the image size"))
        }
        let rotated = [5, 6, 7, 8].contains(info[kCGImagePropertyOrientation] as? Int ?? 1)
        let width = rotated ? pixelHeight : pixelWidth
        let height = rotated ? pixelWidth : pixelHeight
        let limit = 2 * 1024 * 1024
        let portable = [UTType.png.identifier, UTType.jpeg.identifier, UTType.gif.identifier, "org.webmproject.webp"].contains(type.identifier)
        if width <= 1600 && data.count <= limit && portable { return (data, type.preferredMIMEType ?? "image/png") }
        var maxPixel = max(1, Int(Double(max(width, height)) * min(1, 1600.0 / Double(max(1, width)))))
        for _ in 0..<24 {
            let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: maxPixel]
            guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
                throw ImageFailure.message(L("图片缩放失败", "Couldn't resize the image"))
            }
            let alpha = ![CGImageAlphaInfo.none, .noneSkipFirst, .noneSkipLast].contains(image.alphaInfo)
            let outputType: UTType = alpha ? .png : .jpeg
            let output = NSMutableData()
            guard let destination = CGImageDestinationCreateWithData(output, outputType.identifier as CFString, 1, nil) else {
                throw ImageFailure.message(L("图片编码失败", "Couldn't encode the image"))
            }
            CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
            guard CGImageDestinationFinalize(destination) else { throw ImageFailure.message(L("图片编码失败", "Couldn't encode the image")) }
            if output.length <= limit { return (output as Data, outputType.preferredMIMEType!) }
            maxPixel = max(1, Int(Double(maxPixel) * 0.8))
        }
        throw ImageFailure.message(L("图片过大，无法生成适合粘贴的版本", "Image too large to prepare for pasting"))
    }

    static func embed(html: String, images: [[String: String]], document: URL) async throws -> String {
        var result = html
        var cache: [String: String] = [:]
        for image in images {
            guard let source = image["source"], let token = image["token"] else { continue }
            let uri: String
            if let cached = cache[source] { uri = cached } else {
                let data: Data
                if let url = URL(string: source), ["https", "http"].contains(url.scheme?.lowercased() ?? "") {
                    var request = URLRequest(url: url)
                    request.timeoutInterval = 20
                    let (download, response) = try await URLSession.shared.data(for: request)
                    guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                        throw ImageFailure.message(L("网络图片读取失败", "Couldn't load the web image"))
                    }
                    data = download
                } else {
                    data = try Data(contentsOf: localURL(source, document: document))
                }
                let (encoded, mime) = try clipboardData(data)
                uri = "data:\(mime);base64,\(encoded.base64EncodedString())"
                cache[source] = uri
            }
            result = result.replacingOccurrences(of: "src=\"\(token)\"", with: "src=\"\(uri)\"")
        }
        return result
    }
}

private final class DocumentImageSchemeHandler: NSObject, WKURLSchemeHandler {
    var document: URL?
    var scope = ""
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        do {
            guard let url = urlSchemeTask.request.url, url.host == scope, let document else {
                throw ImageFailure.message(L("图片所属稿件已经切换", "The document changed before the image was inserted"))
            }
            let file = try DocumentImages.localURL(String(url.path.dropFirst()), document: document)
            let data = try Data(contentsOf: file)
            let type = try DocumentImages.imageType(data)
            urlSchemeTask.didReceive(URLResponse(url: url, mimeType: type.preferredMIMEType,
                expectedContentLength: data.count, textEncodingName: nil))
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch { urlSchemeTask.didFailWithError(error) }
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) { }
}

@MainActor

/// 中英双语：系统首选语言是中文就显示中文，否则英文 / Chinese if the system prefers Chinese, English otherwise
let anewIsChinese = (Locale.preferredLanguages.first ?? "en").hasPrefix("zh")
func L(_ zh: String, _ en: String) -> String { anewIsChinese ? zh : en }

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private let imageHandler = DocumentImageSchemeHandler()
    private var copyingImages = false
    private var pendingURL: URL?
    private var pendingFolderURL: URL?
    private var currentURL: URL?
    private var currentFolderURL: URL?
    private var currentMarkdown = ""
    private var currentModificationDate: Date?
    private var isPageReady = false
    private let markdownExtensions = Set(["md", "markdown", "mdown", "mkdn"])
    /// 和 style.css 里的 --titlebar-h 必须一致
    fileprivate static let dragStripHeight: CGFloat = 44
    private let recentLibrariesKey = "paper-md.recent-libraries"
    private let shelfKey = "paper-md.shelf"
    /// 库在哪：~/.anew/library 里记着上次打开的库（Chrome 插件本机那头也读它）；
    /// 没有就用 ~/Documents/Anew Notes，第一次打开时放进 App 里带的示例库（中文系统放中文的，否则英文的）。
    private static let libraryConfigURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".anew/library")
    private lazy var defaultLibraryURL: URL = {
        if let saved = try? String(contentsOf: Self.libraryConfigURL, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines), !saved.isEmpty,
           FileManager.default.fileExists(atPath: saved) {
            return URL(fileURLWithPath: saved, isDirectory: true)
        }
        let url = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Documents/Anew Notes", isDirectory: true)
        if !FileManager.default.fileExists(atPath: url.path),
           let example = Bundle.main.resourceURL?.appendingPathComponent("example-library/\(anewIsChinese ? "zh" : "en")", isDirectory: true),
           FileManager.default.fileExists(atPath: example.path) {
            try? FileManager.default.copyItem(at: example, to: url)
        }
        return url
    }()

    /// 记下当前的库，下次打开、Chrome 插件存来源都用它
    private func rememberLibrary(_ url: URL) {
        let dir = Self.libraryConfigURL.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? url.standardizedFileURL.path.write(to: Self.libraryConfigURL, atomically: true, encoding: .utf8)
    }
    private var watchTimer: Timer?
    private var currentNotesModificationDate: Date?
    /// 书库里所有批注文件的「最后改动」：别的篇被 Claude 回了，左边的小标也要跟上
    private var libraryNotesStamp: Date?

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMainMenu()
        let contentController = WKUserContentController()
        // 界面语言跟系统走 / UI language follows the system
        contentController.addUserScript(WKUserScript(source: "window.ANEW_LANG = '\(anewIsChinese ? "zh" : "en")';", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        contentController.add(self, name: "openFile")
        contentController.add(self, name: "openFolder")
        contentController.add(self, name: "openRecentFolder")
        contentController.add(self, name: "openDocument")
        contentController.add(self, name: "saveDocument")
        contentController.add(self, name: "saveNotes")
        contentController.add(self, name: "copyText")
        contentController.add(self, name: "saveImage")
        contentController.add(self, name: "copyForModel")
        contentController.add(self, name: "reloadCurrent")
        contentController.add(self, name: "shelfAdd")
        contentController.add(self, name: "shelfOpen")
        contentController.add(self, name: "shelfRemove")
        contentController.add(self, name: "shelfSetCover")
        contentController.add(self, name: "openExternal")
        contentController.add(self, name: "saveBaseline")
        contentController.add(self, name: "renameDocument")
        contentController.add(self, name: "trashDocument")
        contentController.add(self, name: "newDocument")
        contentController.add(self, name: "setProperty")
        contentController.add(self, name: "moveDocument")
        contentController.add(self, name: "revealDocument")
        contentController.add(self, name: "openDiem")
        contentController.add(self, name: "loadTimeline")
        contentController.add(self, name: "loadGraph")
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController
        configuration.setURLSchemeHandler(imageHandler, forURLScheme: "papermd-img")

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.setValue(false, forKey: "drawsBackground")
        webView.navigationDelegate = self
        webView.uiDelegate = self

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1180, height: 780),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = L("知新 Anew", "Anew")
        window.minSize = NSSize(width: 760, height: 540)
        window.titlebarAppearsTransparent = true
        // 原生标题和页面顶栏里的文档名重复了，隐掉，只留红绿灯
        window.titleVisibility = .hidden
        window.isMovableByWindowBackground = true
        window.backgroundColor = NSColor(srgbRed: 0.945, green: 0.953, blue: 0.965, alpha: 1)  // 和 --paper 一致

        let container = NSView(frame: NSRect(x: 0, y: 0, width: 1180, height: 780))
        container.autoresizingMask = [.width, .height]
        webView.frame = container.bounds
        webView.autoresizingMask = [.width, .height]
        container.addSubview(webView)

        // 顶部 44pt 留给拖动。页面把这条做成只放文档名、不放任何按钮的区域，
        // 文字透过这层透明视图正常显示，点住哪里都能拖窗。
        let dragStrip = WindowDragStrip(frame: NSRect(x: 0, y: container.bounds.height - Self.dragStripHeight, width: container.bounds.width, height: Self.dragStripHeight))
        dragStrip.autoresizingMask = [.width, .minYMargin]
        // 显式指定盖在 webView 上面，不依赖 subviews 的添加顺序
        container.addSubview(dragStrip, positioned: .above, relativeTo: webView)

        window.contentView = container
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        window.delegate = self

        guard let indexURL = Bundle.main.url(forResource: "index", withExtension: "html") else { return }
        webView.loadFileURL(indexURL, allowingReadAccessTo: indexURL.deletingLastPathComponent())
    }

    func application(_ application: NSApplication, openFiles filenames: [String]) {
        guard let path = filenames.first else { return }
        let url = URL(fileURLWithPath: path)
        if url.hasDirectoryPath {
            pendingFolderURL = url
            if isPageReady { openFolder(url) }
            application.reply(toOpenOrPrint: .success)
            return
        }
        guard let markdownURL = validMarkdownURL(url) else { return }
        pendingURL = markdownURL
        if isPageReady {
            // 手上有没保存的改动时先问一句，别被外面双击的文件直接盖掉
            webView.evaluateJavaScript("typeof confirmLeavingDocument === 'function' ? confirmLeavingDocument(L('打开另一个文件', 'open another file')) : true") { [weak self] result, _ in
                if (result as? Bool) != false { self?.openFromOutside(markdownURL) }
            }
        }
        application.reply(toOpenOrPrint: .success)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window.makeKeyAndOrderFront(nil) }
        NSApp.activate(ignoringOtherApps: true)
        return true
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isPageReady = true
        sendRecentLibraries()
        sendShelf()
        if let pendingFolderURL { openFolder(pendingFolderURL) }
        else if let pendingURL { openFromOutside(pendingURL) }
        else if FileManager.default.fileExists(atPath: defaultLibraryURL.path) { openFolder(defaultLibraryURL) }
        startWatching()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "openFile" { chooseMarkdownFile() }
        if message.name == "openFolder" { chooseMarkdownFolder() }
        if message.name == "openRecentFolder" { openRecentFolder(message.body) }
        if message.name == "openDocument" { openDocument(message.body) }
        if message.name == "saveDocument" { saveMarkdown(message.body) }
        if message.name == "saveNotes" { saveNotes(message.body) }
        if message.name == "copyText" { copyText(message.body) }
        if message.name == "saveImage" { saveImage(message.body) }
        if message.name == "copyForModel" { copyForModel(message.body) }
        if message.name == "reloadCurrent" { reloadCurrent(silent: ((message.body as? [String: Any])?["silent"] as? Bool) ?? false) }
        if message.name == "shelfAdd" { shelfAdd() }
        if message.name == "shelfOpen" { openRecentFolder(message.body) }
        if message.name == "shelfRemove" { shelfRemove(message.body) }
        if message.name == "shelfSetCover" { shelfSetCover(message.body) }
        if message.name == "saveBaseline" { saveBaseline(message.body) }
        if message.name == "renameDocument" { renameDocument(message.body) }
        if message.name == "trashDocument" { trashDocument(message.body) }
        if message.name == "newDocument" { newDocument(message.body) }
        if message.name == "setProperty" { setProperty(message.body) }
        if message.name == "moveDocument" { moveDocument(message.body) }
        if message.name == "revealDocument" { revealDocument(message.body) }
        if message.name == "openDiem" { openDiem(message.body) }
        if message.name == "loadTimeline" { loadTimeline(message.body) }
        if message.name == "loadGraph" { loadGraph(message.body) }
        if message.name == "openExternal",
           let text = (message.body as? [String: Any])?["url"] as? String { openExternal(text) }
    }

    /// 正文里的网址（原文 ↗、[文字](https://…)、裸网址）交给默认浏览器；不在 App 里跳走
    private func openExternal(_ text: String) {
        guard let url = URL(string: text), let scheme = url.scheme?.lowercased(),
              ["http", "https", "mailto"].contains(scheme) else { return }
        NSWorkspace.shared.open(url)
    }

    // 兜底：万一有链接没被页面拦下（target=_blank 或直接跳转），也送去浏览器
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { openExternal(url.absoluteString) }
        return nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        if navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url,
           let scheme = url.scheme?.lowercased(), ["http", "https", "mailto"].contains(scheme) {
            openExternal(url.absoluteString)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    /// 从 Diem 或 Finder 打开一篇：在 notes/ 里的，先把库摆上（不跳去第一篇），再显示这一篇
    private func openFromOutside(_ url: URL) {
        let libPath = defaultLibraryURL.standardizedFileURL.path
        let inDefault = url.standardizedFileURL.path.hasPrefix(libPath + "/")
        if inDefault, currentFolderURL?.standardizedFileURL.path != libPath {
            openFolder(defaultLibraryURL, keepingDocument: true)
        }
        display(url)
    }

    /// AI 在 Claude Code 里改了正文或批注，这边 1.5 秒内跟上（没有没存的东西时才刷）
    private func startWatching() {
        watchTimer?.invalidate()
        // 定时器挂在主线程的 run loop 上，回调本来就在主线程
        watchTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.checkOutsideChanges() }
        }
    }

    private func checkOutsideChanges() {
        // 别的篇的批注变了（Claude 处理完），只刷左边的列表，不动正在读的这篇
        if let folder = currentFolderURL, let stamp = notesStamp(in: folder), stamp != libraryNotesStamp {
            libraryNotesStamp = stamp
            webView.evaluateJavaScript("window.__paperCanAutoReload ? window.__paperCanAutoReload() : false") { [weak self] result, _ in
                guard let self, (result as? Bool) == true else { return }
                self.openFolder(folder, keepingDocument: true)
            }
        }
        guard let url = currentURL else { return }
        let docChanged: Bool = {
            guard let expected = currentModificationDate, let disk = modificationDate(of: url) else { return false }
            return disk > expected
        }()
        let notesDisk = modificationDate(of: notesURL(for: url))
        let notesChanged: Bool = {
            guard let disk = notesDisk else { return false }
            guard let expected = currentNotesModificationDate else { return true }
            return disk > expected
        }()
        guard docChanged || notesChanged else { return }
        webView.evaluateJavaScript("window.__paperCanAutoReload ? window.__paperCanAutoReload() : false") { [weak self] result, _ in
            guard let self, (result as? Bool) == true else { return }
            self.currentNotesModificationDate = notesDisk
            self.reloadCurrent(silent: true)
        }
    }

    private func copyText(_ body: Any) {
        let text = ((body as? [String: Any])?["text"] as? String) ?? ""
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(text, forType: .string)
    }

    private func chooseMarkdownFile() {
        let panel = NSOpenPanel()
        panel.title = L("打开 Markdown 文件", "Open Markdown File")
        panel.prompt = L("打开", "Open")
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.init(filenameExtension: "md")!, .init(filenameExtension: "markdown")!]
        if panel.runModal() == .OK, let url = panel.url { display(url) }
    }

    private func chooseMarkdownFolder() {
        let panel = NSOpenPanel()
        panel.title = L("打开 Markdown 书库", "Open Markdown Library")
        panel.prompt = L("打开书库", "Open Library")
        panel.allowsMultipleSelection = false
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        if panel.runModal() == .OK, let url = panel.url { openFolder(url) }
    }

    private func openRecentFolder(_ body: Any) {
        guard let payload = body as? [String: Any], let path = payload["path"] as? String else { return }
        let url = URL(fileURLWithPath: path)
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            sendRecentLibraries()
            return
        }
        openFolder(url)
    }

    /// 只读开头那段 YAML 属性里的一层 key: value（type / stage / topic / from …），给左边的视图用
    private func yamlMeta(of url: URL) -> [String: String] {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return [:] }
        defer { try? handle.close() }
        let data = (try? handle.read(upToCount: 4096)) ?? Data()
        // 4096 字节可能正好切在一个中文字中间（一个字 3 字节），整段就解不开、属性全丢。
        // 从尾巴上最多退 3 个字节，退到一个完整的字为止。
        var text: String?
        for cut in 0...3 where data.count >= cut {
            if let decoded = String(data: data.prefix(data.count - cut), encoding: .utf8) { text = decoded; break }
        }
        guard let text else { return [:] }
        var meta: [String: String] = [:]
        // 正文第一个 # 标题：左边搜索用（文件名和标题对不上时也搜得到）
        var inFront = text.hasPrefix("---\n")
        for (i, line) in text.split(separator: "\n", omittingEmptySubsequences: false).enumerated() {
            if inFront { if i > 0 && line == "---" { inFront = false }; continue }
            if line.hasPrefix("# ") { meta["_heading"] = line.dropFirst(2).trimmingCharacters(in: .whitespaces); break }
        }
        guard text.hasPrefix("---\n") else { return meta }
        for line in text.dropFirst(4).split(separator: "\n", omittingEmptySubsequences: false) {
            if line == "---" { break }
            guard let colon = line.firstIndex(of: ":") else { continue }
            let key = line[..<colon].trimmingCharacters(in: .whitespaces)
            var value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            if value.count >= 2, value.hasPrefix("\""), value.hasSuffix("\"") { value = String(value.dropFirst().dropLast()) }
            if !key.isEmpty, !key.contains(" ") { meta[key] = value }
        }
        return meta
    }

    /// 正文有多少字：去掉开头的 YAML 属性，不算空格和换行。左边列表标「15K」用
    private func charCount(of url: URL) -> Int {
        guard var text = try? String(contentsOf: url, encoding: .utf8) else { return 0 }
        if text.hasPrefix("---\n"), let end = text.range(of: "\n---", range: text.index(text.startIndex, offsetBy: 4)..<text.endIndex) {
            text = String(text[end.upperBound...])
        }
        return text.unicodeScalars.reduce(0) { $0 + (CharacterSet.whitespacesAndNewlines.contains($1) ? 0 : 1) }
    }

    private func openFolder(_ url: URL, keepingDocument: Bool = false) {
        currentFolderURL = url
        rememberLibrary(url)
        let keys: Set<URLResourceKey> = [.isRegularFileKey, .isDirectoryKey, .isHiddenKey, .fileSizeKey, .contentModificationDateKey]
        let options: FileManager.DirectoryEnumerationOptions = [.skipsHiddenFiles, .skipsPackageDescendants]
        guard let enumerator = FileManager.default.enumerator(at: url, includingPropertiesForKeys: Array(keys), options: options) else { return }
        var documents: [[String: Any]] = []
        while let fileURL = enumerator.nextObject() as? URL {
            guard validMarkdownURL(fileURL) != nil,
                  let values = try? fileURL.resourceValues(forKeys: keys), values.isRegularFile == true else { continue }
            let relativePath = fileURL.path.replacingOccurrences(of: url.path + "/", with: "")
            var entry: [String: Any] = [
                "name": fileURL.lastPathComponent,
                "path": fileURL.path,
                "relativePath": relativePath,
                "size": values.fileSize ?? 0,
                "modified": (values.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000,
                "meta": yamlMeta(of: fileURL),
                "chars": charCount(of: fileURL),
                "noteBrief": noteBrief(for: fileURL)
            ]
            if let pending = unconfirmedChange(for: fileURL) { entry["baseline"] = pending.baseline; entry["current"] = pending.current }
            documents.append(entry)
        }
        documents.sort { ($0["relativePath"] as? String ?? "") < ($1["relativePath"] as? String ?? "") }
        libraryNotesStamp = notesStamp(in: url)
        do {
            recordRecentLibrary(url)
            if !keepingDocument, !shelfPaths().contains(url.path) {
                setShelfPaths(shelfPaths() + [url.path])
            }
            if !keepingDocument {
                currentURL = nil
                imageHandler.document = nil
                imageHandler.scope = ""
                currentMarkdown = ""
                currentModificationDate = nil
            }
            let book = bookInfo(for: url)
            var payload: [String: Any] = ["name": book.title, "folderName": url.lastPathComponent, "path": url.path, "documents": documents, "keepingDocument": keepingDocument]
            if let color = book.color { payload["color"] = color }
            if let cover = book.cover { payload["coverImage"] = cover }
            let data = try JSONSerialization.data(withJSONObject: payload)
            guard let json = String(data: data, encoding: .utf8) else { return }
            webView.evaluateJavaScript("window.renderLibrary(\(json));")
            sendRecentLibraries()
            if !keepingDocument { sendShelf() }
            if !keepingDocument {
                window.title = book.title + L(" · 知新 Anew", " · Anew")
                window.makeKeyAndOrderFront(nil)
            }
        } catch {
            let alert = NSAlert(error: error)
            alert.messageText = L("无法打开这个文件夹", "Can't open this folder")
            alert.runModal()
        }
    }

    /// 重新从磁盘读一遍：先刷书库（会带出新增/改名的文件），再刷当前这一篇。
    private func reloadCurrent(silent: Bool) {
        let folder = currentFolderURL
        let doc = currentURL
        if let folder { openFolder(folder, keepingDocument: true) }
        if let doc, FileManager.default.fileExists(atPath: doc.path) {
            currentModificationDate = nil          // 强制按磁盘上的内容重画
            display(doc, reveal: false)            // 刷新不把人从书架上拽走
        }
        if folder != nil || doc != nil {
            let text = silent ? L("文件在外面改过了，已经刷新", "File changed on disk — refreshed") : L("已经重新读取", "Reloaded")
            webView.evaluateJavaScript("window.showNotice && window.showNotice('\(text)');")
        }
    }

    /// 窗口重新回到前台时，如果磁盘上的这一篇比内存里的新，而且没有未保存的东西，就悄悄刷新。
    func windowDidBecomeKey(_ notification: Notification) {
        guard let url = currentURL,
              let expected = currentModificationDate,
              let disk = modificationDate(of: url),
              disk > expected else { return }
        webView.evaluateJavaScript("window.__paperCanAutoReload ? window.__paperCanAutoReload() : false") { [weak self] result, _ in
            guard let self, (result as? Bool) == true else { return }
            self.reloadCurrent(silent: true)
        }
    }

    private func openDocument(_ body: Any) {
        let path = (body as? String) ?? ((body as? [String: Any])?["path"] as? String)
        guard let path else { return }
        let url = URL(fileURLWithPath: path)
        guard validMarkdownURL(url) != nil else { return }
        // 「最近的文档」里的那篇可能已经改名、挪走了：不弹错误框，让页面把它从列表里拿掉
        guard FileManager.default.fileExists(atPath: url.path) else {
            if let data = try? JSONSerialization.data(withJSONObject: [path]), let json = String(data: data, encoding: .utf8) {
                webView.evaluateJavaScript("window.__docMissing && window.__docMissing(\(json)[0]);")
            }
            return
        }
        display(url)
    }

    private func validMarkdownURL(_ url: URL) -> URL? {
        markdownExtensions.contains(url.pathExtension.lowercased()) ? url : nil
    }

    private func display(_ url: URL, reveal: Bool = true) {
        guard let markdownURL = validMarkdownURL(url) else { return }
        do {
            let markdown = try String(contentsOf: markdownURL, encoding: .utf8)
            currentURL = markdownURL
            imageHandler.document = markdownURL
            imageHandler.scope = UUID().uuidString.lowercased()
            currentMarkdown = markdown
            currentModificationDate = modificationDate(of: markdownURL)
            currentNotesModificationDate = modificationDate(of: notesURL(for: markdownURL))
            let payload: [String: Any] = ["imageScope": imageHandler.scope, "name": markdownURL.lastPathComponent, "path": markdownURL.path, "content": markdown, "logs": loadHistory(for: markdownURL), "notes": loadNotes(for: markdownURL), "reveal": reveal, "baseline": loadBaseline(for: markdownURL, current: markdown), "backlinks": backlinkPayload(for: markdownURL)]
            let data = try JSONSerialization.data(withJSONObject: payload)
            let json = String(data: data, encoding: .utf8) ?? "{}"
            webView.evaluateJavaScript("window.renderDocument(\(json));")
            window.title = markdownURL.lastPathComponent + L(" · 知新 Anew", " · Anew")
            window.makeKeyAndOrderFront(nil)
        } catch {
            let alert = NSAlert(error: error)
            alert.messageText = L("无法打开这个文件", "Can't open this file")
            alert.informativeText = L("请确认它是可读取的 UTF-8 Markdown 文件。", "Make sure it is a readable UTF-8 Markdown file.")
            alert.runModal()
        }
    }

    // ────────── 管库：新建、改属性、改名、移动、移到废纸篓、谁链着这篇 ──────────
    // 改名 / 移动：文件、批注、修改记录、库里别的笔记的链接、这篇自己的相对链接和图、Diem 纸上挂着它的块，一起跟着走。
    // 删：只挪进废纸篓（能放回去），批注和修改记录留在原处，放回来还在。
    // 库是 Diem 的 notes/ 时，Anew 动过的文件都在 Diem 同步本里记一行（agent: me），Diem 就不标「没报备」。

    /// Diem 工作目录（库是 Diem 的 notes/ 时才有）
    private func diemRoot(for folder: URL?) -> URL? {
        guard let folder, folder.lastPathComponent == "notes" else { return nil }
        let root = folder.deletingLastPathComponent()
        return FileManager.default.fileExists(atPath: root.appendingPathComponent("ideas").path) ? root : nil
    }

    private var lastSyncLog: [String: Date] = [:]

    /// 在 Diem 同步本里记一行：是你在 Anew 里动的。同一个文件 15 秒内只记一次（Diem 按 25 秒窗口对）
    private func syncLog(_ urls: [URL], _ what: String, throttle: Bool = false) {
        guard let root = diemRoot(for: currentFolderURL) else { return }
        let base = root.standardizedFileURL.path + "/"
        let now = Date()
        let files = urls.map { $0.standardizedFileURL.path }.filter { $0.hasPrefix(base) }.map { String($0.dropFirst(base.count)) }
            .filter { !throttle || now.timeIntervalSince(lastSyncLog[$0] ?? .distantPast) > 15 }
        guard !files.isEmpty else { return }
        files.forEach { lastSyncLog[$0] = now }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ssxxx"
        let t = f.string(from: now)
        let line: [String: Any] = ["t": t, "agent": "me", "tool": "Anew", "files": files, "cmd": what]
        guard let data = try? JSONSerialization.data(withJSONObject: line, options: [.withoutEscapingSlashes]),
              let text = String(data: data, encoding: .utf8) else { return }
        let dir = root.appendingPathComponent("sync", isDirectory: true)
        let file = dir.appendingPathComponent(String(t.prefix(10)) + ".jsonl")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if let handle = try? FileHandle(forWritingTo: file) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: Data((text + "\n").utf8))
        } else {
            try? (text + "\n").write(to: file, atomically: true, encoding: .utf8)
        }
    }

    private func libraryMarkdownFiles() -> [URL] {
        guard let folder = currentFolderURL,
              let e = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return [] }
        return e.compactMap { $0 as? URL }.filter { validMarkdownURL($0) != nil }
    }

    private func libraryRelative(_ url: URL) -> String? {
        guard let folder = currentFolderURL else { return nil }
        let base = folder.standardizedFileURL.path + "/"
        let path = url.standardizedFileURL.path
        return path.hasPrefix(base) ? String(path.dropFirst(base.count)) : nil
    }

    private func inLibrary(_ path: String) -> URL? {
        let url = URL(fileURLWithPath: path)
        guard validMarkdownURL(url) != nil, libraryRelative(url) != nil,
              FileManager.default.fileExists(atPath: url.path) else { return nil }
        return url
    }

    /// 从 dir 走到 to 的相对路径（会用 ../）
    private func relPath(fromDir dir: URL, to: URL) -> String {
        let a = dir.standardizedFileURL.pathComponents, b = to.standardizedFileURL.pathComponents
        var i = 0
        while i < a.count, i < b.count, a[i] == b[i] { i += 1 }
        return (Array(repeating: "..", count: a.count - i) + b[i...]).joined(separator: "/")
    }

    private func encoded(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? s }

    /// 一篇笔记里链向 target 的写法：[[名字]]、[[库里的路径]]、[文字](相对路径)
    private func linkForms(in file: URL, to target: URL) -> (wiki: [String], md: [String]) {
        var wiki = [target.deletingPathExtension().lastPathComponent]
        if let rel = libraryRelative(target) { wiki.append((rel as NSString).deletingPathExtension) }
        let r = relPath(fromDir: file.deletingLastPathComponent(), to: target)
        return (Array(Set(wiki)), Array(Set([r, encoded(r), "./" + r])))
    }

    private func linksTo(_ text: String, file: URL, target: URL) -> Bool {
        let forms = linkForms(in: file, to: target)
        return forms.wiki.contains { w in ["]]", "|", "#"].contains { text.contains("[[\(w)\($0)") } }
            || forms.md.contains { text.contains("](\($0))") }
    }

    /// 谁在链着这一篇：库里的笔记、Diem 纸上挂着它的块
    private func backlinks(to url: URL) -> (notes: [URL], blocks: [(paper: URL, id: String, text: String)]) {
        var notes: [URL] = []
        for file in libraryMarkdownFiles() where file.standardizedFileURL != url.standardizedFileURL {
            if let text = try? String(contentsOf: file, encoding: .utf8), linksTo(text, file: file, target: url) { notes.append(file) }
        }
        var blocks: [(URL, String, String)] = []
        if let root = diemRoot(for: currentFolderURL), let rel = libraryRelative(url),
           let papers = try? FileManager.default.contentsOfDirectory(at: root.appendingPathComponent("ideas"), includingPropertiesForKeys: nil) {
            for paper in papers.sorted(by: { $0.lastPathComponent > $1.lastPathComponent }) where paper.pathExtension == "json" {
                guard let data = try? Data(contentsOf: paper),
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let list = json["blocks"] as? [[String: Any]] else { continue }
                for b in list where (b["doc"] as? String) == "notes/" + rel {
                    blocks.append((paper, b["id"] as? String ?? "", ((b["text"] as? String) ?? "").components(separatedBy: "\n").first ?? ""))
                }
            }
        }
        return (notes, blocks)
    }

    private func backlinkPayload(for url: URL) -> [[String: Any]] {
        let links = backlinks(to: url)
        return diemPayload(for: url) + links.notes.map { ["kind": "note", "path": $0.path, "title": $0.deletingPathExtension().lastPathComponent] }
    }

    /// Diem 那边挂着这篇的，一件事只说一处（旧纸上誊过来的同一块不重复）：
    /// 池塘里的事排上了今天以后的时间轴 → 只说「时间轴」；还在池塘里 → 只说「池塘」（纸上肯定也有）；
    /// 都没有 → 说当前那张纸上的块（ui.json 的 cur，没有就是最新一张没进纸箱的）。
    private func diemPayload(for url: URL) -> [[String: Any]] {
        guard let root = diemRoot(for: currentFolderURL), let rel = libraryRelative(url) else { return [] }
        let doc = "notes/" + rel
        func json(_ u: URL) -> [String: Any]? {
            guard let data = try? Data(contentsOf: u) else { return nil }
            return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        }
        let papers = ((try? FileManager.default.contentsOfDirectory(at: root.appendingPathComponent("ideas"), includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.pathExtension == "json" }
            .sorted { $0.lastPathComponent > $1.lastPathComponent }
            .compactMap { u in json(u).map { (name: u.deletingPathExtension().lastPathComponent, json: $0) } }
        let cur = json(root.appendingPathComponent(".diem/ui.json"))?["cur"] as? String
        let current = papers.first { $0.name == cur } ?? papers.first { $0.json["archived"] == nil }
        var blockIDs = Set<String>(), itemIDs = Set<String>()
        var here: [(id: String, text: String)] = []
        for p in papers {
            for b in (p.json["blocks"] as? [[String: Any]] ?? []) where (b["doc"] as? String) == doc {
                let id = b["id"] as? String ?? ""
                blockIDs.insert(id)
                (b["links"] as? [String] ?? []).forEach { itemIDs.insert($0) }
                if p.name == current?.name { here.append((id, ((b["text"] as? String) ?? "").components(separatedBy: "\n").first ?? "")) }
            }
        }
        let items = (json(root.appendingPathComponent("lists/backup.json"))?["items"] as? [[String: Any]] ?? []).filter { it in
            guard (it["done"] as? Bool) != true else { return false }
            let source = it["source"] as? [String: Any]
            return itemIDs.contains(it["id"] as? String ?? "") || blockIDs.contains(source?["block"] as? String ?? "\u{0}") || (it["doc"] as? String) == doc
        }
        // 点了回到纸上哪一块：当前那张纸上有就去那，没有就去这件事来的那张纸
        func target(_ it: [String: Any]) -> [String: Any] {
            let source = it["source"] as? [String: Any]
            if let current, let b = here.first { return ["paper": current.name, "block": b.id] }
            return ["paper": source?["paper"] as? String ?? current?.name ?? "", "block": source?["block"] as? String ?? ""]
        }
        let day = today()
        let timed = items.filter { (($0["plan"] as? [String: Any])?["date"] as? String ?? "") >= day }
        if !timed.isEmpty {
            return timed.map { it in
                let plan = it["plan"] as? [String: Any] ?? [:]
                let date = (plan["date"] as? String ?? "").split(separator: "-").suffix(2).map { String(Int($0) ?? 0) }.joined(separator: "/")
                var when = date
                if let start = plan["start"] as? Int { when += String(format: " %d:%02d", start / 60, start % 60) }
                return target(it).merging(["kind": "time", "text": it["title"] as? String ?? "", "when": when]) { $1 }
            }
        }
        if !items.isEmpty { return items.map { target($0).merging(["kind": "pond", "text": $0["title"] as? String ?? ""]) { $1 } } }
        guard let current else { return [] }
        return here.map { ["kind": "block", "paper": current.name, "block": $0.id, "text": $0.text] }
    }

    /// 从 Anew 跳回 Diem 纸上那一块
    private func openDiem(_ body: Any) {
        guard let payload = body as? [String: Any], let paper = payload["paper"] as? String, !paper.isEmpty else { return }
        var c = URLComponents()
        c.scheme = "diem"; c.host = "focus"
        c.queryItems = [URLQueryItem(name: "paper", value: paper), URLQueryItem(name: "block", value: payload["block"] as? String ?? "")]
        guard let url = c.url else { return }
        if !NSWorkspace.shared.open(url) { notice("没打开「这一天」：重装一下这一天（0.9.4 起才认从 Anew 跳过去）") }
    }

    private func today() -> String { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.string(from: Date()) }

    private func yamlValue(_ v: String) -> String {
        if v.isEmpty { return "\"\"" }
        if v.hasPrefix("[") || v.hasPrefix("\"") { return v }
        if v.contains(":") || v.contains("#") || v.hasPrefix("{") || v.hasPrefix("'") || v.hasPrefix("-") || v.hasPrefix("*") || v.hasPrefix("&") {
            return "\"" + v.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
        }
        return v
    }

    /// 改 / 加开头 YAML 里的一行；没有 YAML 就加一段
    private func settingFrontmatter(_ text: String, _ key: String, _ value: String) -> String {
        let line = "\(key): \(yamlValue(value))"
        var lines = text.components(separatedBy: "\n")
        if lines.first == "---", let end = lines.dropFirst().firstIndex(of: "---") {
            if let i = lines[1..<end].firstIndex(where: { $0.hasPrefix(key + ":") }) { lines[i] = line }
            else { lines.insert(line, at: end) }
            return lines.joined(separator: "\n")
        }
        return "---\n\(line)\n---\n\n" + text
    }

    private func setProperty(_ body: Any) {
        guard let payload = body as? [String: Any], let path = payload["path"] as? String,
              let key = payload["key"] as? String, let value = payload["value"] as? String,
              key.range(of: "^[a-z_]+$", options: .regularExpression) != nil,
              let url = inLibrary(path), let text = try? String(contentsOf: url, encoding: .utf8) else { return }
        let next = settingFrontmatter(text, key, value)
        guard next != text else { return }
        do { try next.write(to: url, atomically: true, encoding: .utf8) } catch { notice(L("没改成：", "Couldn't change: ") + error.localizedDescription); return }
        _ = recordChange(from: text, to: next, for: url)
        // 「上次确认过的版本」也改同一行：自己改的属性不算「外面的改动」
        let baseURL = baselineURL(for: url)
        if let base = try? String(contentsOf: baseURL, encoding: .utf8) {
            try? settingFrontmatter(base, key, value).write(to: baseURL, atomically: true, encoding: .utf8)
        }
        syncLog([url], "改属性 \(key): \(value)")
        refreshAfterChange(current: url.standardizedFileURL == currentURL?.standardizedFileURL ? url : nil)
    }

    /// 动完文件：刷左边；正在看的这篇（或它的新位置）重画
    private func refreshAfterChange(current: URL?) {
        if let folder = currentFolderURL { openFolder(folder, keepingDocument: true) }
        if let current {
            currentModificationDate = nil
            display(current, reveal: false)
        }
    }

    private func safeName(_ raw: String) -> String {
        var name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "/", with: "／").replacingOccurrences(of: ":", with: "：")
        while name.hasPrefix(".") { name.removeFirst() }
        if name.lowercased().hasSuffix(".md") { name = String(name.dropLast(3)) }
        return name
    }

    private func textField(_ value: String, placeholder: String) -> NSTextField {
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 340, height: 24))
        field.stringValue = value
        field.placeholderString = placeholder
        return field
    }

    private func askName(title: String, info: String, suggestion: String, button: String = L("改名", "Rename")) -> String? {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = info
        let field = textField(suggestion, placeholder: L("名字", "Name"))
        alert.accessoryView = field
        alert.addButton(withTitle: button)
        alert.addButton(withTitle: L("取消", "Cancel"))
        alert.window.initialFirstResponder = field
        guard alert.runModal() == .alertFirstButtonReturn else { return nil }
        let name = safeName(field.stringValue)
        return name.isEmpty ? nil : name
    }

    /// 把 url 挪到 newURL（改名或换文件夹），能跟着改的都跟着改
    private func relocate(_ url: URL, to newURL: URL, what: String) {
        let fm = FileManager.default
        let sameFile = newURL.path.lowercased() == url.path.lowercased()
        guard !fm.fileExists(atPath: newURL.path) || sameFile else {
            notice(L("那里已经有一篇「\(newURL.deletingPathExtension().lastPathComponent)」了", "\"\(newURL.deletingPathExtension().lastPathComponent)\" already exists there")); return
        }
        let wasCurrent = url.standardizedFileURL == currentURL?.standardizedFileURL
        let links = backlinks(to: url)
        // 别的笔记里链着它的写法，先按旧位置算好
        var linkers: [(URL, (wiki: [String], md: [String]))] = links.notes.map { ($0, linkForms(in: $0, to: url)) }
        let sidecars = [(notesURL(for: url), notesURL(for: newURL)),
                        (historyURL(for: url), historyURL(for: newURL)),
                        (baselineURL(for: url), baselineURL(for: newURL))]
        let oldRel = libraryRelative(url)
        do {
            try fm.createDirectory(at: newURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try fm.moveItem(at: url, to: newURL)
        } catch { notice(L("没挪成：", "Couldn't move: ") + error.localizedDescription); return }
        for (from, to) in sidecars where fm.fileExists(atPath: from.path) && !fm.fileExists(atPath: to.path) {
            try? fm.createDirectory(at: to.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? fm.moveItem(at: from, to: to)
        }
        var touched: [URL] = [url, newURL]
        // 换了文件夹：这篇自己的相对链接和图，按新位置重算
        let oldDir = url.deletingLastPathComponent(), newDir = newURL.deletingLastPathComponent()
        if oldDir.standardizedFileURL != newDir.standardizedFileURL, var text = try? String(contentsOf: newURL, encoding: .utf8) {
            let regex = try! NSRegularExpression(pattern: "\\]\\(([^)\\s]+)\\)")
            let ns = text as NSString
            for m in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)).reversed() {
                let link = ns.substring(with: m.range(at: 1))
                if link.contains(":") || link.hasPrefix("#") || link.hasPrefix("/") { continue }
                let decoded = link.removingPercentEncoding ?? link
                let target = oldDir.appendingPathComponent(decoded).standardizedFileURL
                guard fm.fileExists(atPath: target.path) else { continue }
                let r = relPath(fromDir: newDir, to: target)
                text = (text as NSString).replacingCharacters(in: m.range(at: 1), with: link.contains("%") ? encoded(r) : r)
            }
            try? text.write(to: newURL, atomically: true, encoding: .utf8)
            // 链向自己的也在里面：自己的新位置再按新规则算一次
            linkers = linkers.map { $0.0.standardizedFileURL == url.standardizedFileURL ? (newURL, $0.1) : $0 }
        }
        // 别的笔记里的链接
        var fixedNotes = 0
        for (file, old) in linkers {
            guard var text = try? String(contentsOf: file, encoding: .utf8) else { continue }
            let before = text
            let now = linkForms(in: file, to: newURL)
            let newBase = newURL.deletingPathExtension().lastPathComponent
            let newRelNoExt = libraryRelative(newURL).map { ($0 as NSString).deletingPathExtension } ?? newBase
            for w in old.wiki {
                let n = w.contains("/") ? newRelNoExt : newBase
                for tail in ["]]", "|", "#"] { text = text.replacingOccurrences(of: "[[\(w)\(tail)", with: "[[\(n)\(tail)") }
            }
            let plain = now.md.first { !$0.hasPrefix("./") && !$0.contains("%") } ?? now.md[0]
            for o in old.md { text = text.replacingOccurrences(of: "](\(o))", with: "](\(o.contains("%") ? encoded(plain) : plain))") }
            if text != before, (try? text.write(to: file, atomically: true, encoding: .utf8)) != nil { fixedNotes += 1; touched.append(file) }
        }
        // Diem 纸上挂着它的块：只改 doc 这一个字段，改前给纸存一版
        var fixedBlocks = 0
        if let root = diemRoot(for: currentFolderURL), let oldRel, let newRel = libraryRelative(newURL) {
            let stamp: String = { let f = DateFormatter(); f.dateFormat = "yyyyMMdd-HHmmss"; return f.string(from: Date()) }()
            for paper in Set(links.blocks.map { $0.paper }) {
                guard let data = try? Data(contentsOf: paper),
                      var json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      var list = json["blocks"] as? [[String: Any]] else { continue }
                let versions = root.appendingPathComponent("ideas/.versions/\(paper.deletingPathExtension().lastPathComponent)", isDirectory: true)
                try? fm.createDirectory(at: versions, withIntermediateDirectories: true)
                try? data.write(to: versions.appendingPathComponent("\(stamp)-Anew\(what)前.json"))
                for i in list.indices where (list[i]["doc"] as? String) == "notes/" + oldRel {
                    list[i]["doc"] = "notes/" + newRel; fixedBlocks += 1
                }
                json["blocks"] = list
                if let out = try? JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted, .withoutEscapingSlashes]) {
                    try? out.write(to: paper, options: .atomic)
                    touched.append(paper)
                }
            }
        }
        syncLog(touched, "\(what)：\(oldRel ?? url.lastPathComponent) → \(libraryRelative(newURL) ?? newURL.lastPathComponent)")
        if wasCurrent { renamedInPage(from: url.path, to: newURL.path) }
        refreshAfterChange(current: wasCurrent ? newURL : nil)
        var bits: [String] = []
        if fixedNotes > 0 { bits.append(L("\(fixedNotes) 篇笔记里的链接", "links in \(fixedNotes) notes")) }
        if fixedBlocks > 0 { bits.append(L("Diem 纸上 \(fixedBlocks) 块", "\(fixedBlocks) Diem blocks")) }
        let newName = newURL.deletingPathExtension().lastPathComponent
        let dest = libraryRelative(newDir.appendingPathComponent("x")).map { ($0 as NSString).deletingLastPathComponent }.flatMap { $0.isEmpty ? nil : $0 } ?? L("库根上", "the library root")
        let place = what == "改名" ? L("改成「\(newName)」了", "Renamed to \"\(newName)\"") : L("挪到「\(dest)」了", "Moved to \"\(dest)\"")
        notice(place + (bits.isEmpty ? "" : L("，", "; ") + bits.joined(separator: L("、", ", ")) + L("也跟着改了", " updated too")))
    }

    private func renameDocument(_ body: Any) {
        guard let payload = body as? [String: Any], let path = payload["path"] as? String, let url = inLibrary(path) else { return }
        let oldBase = url.deletingPathExtension().lastPathComponent
        var name = safeName(payload["name"] as? String ?? "")
        if payload["ask"] as? Bool == true {
            guard let asked = askName(title: L("给这篇改个文件名", "Rename this file"), info: L("现在叫「\(oldBase)」。回响、修改记录、别的笔记里的链接、Diem 纸上挂的这篇会一起改过去。", "Currently \"\(oldBase)\". Annotations, history and links from other notes follow the new name."), suggestion: name.isEmpty ? oldBase : name) else { return }
            name = asked
        }
        guard !name.isEmpty, name != oldBase else { return }
        relocate(url, to: url.deletingLastPathComponent().appendingPathComponent(name).appendingPathExtension(url.pathExtension), what: "改名")
    }

    private func moveDocument(_ body: Any) {
        guard let payload = body as? [String: Any], let path = payload["path"] as? String, let url = inLibrary(path),
              let library = currentFolderURL else { return }
        var folder = (payload["folder"] as? String ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        if payload["ask"] as? Bool == true {
            guard let asked = askName(title: L("新建一个文件夹，把这篇放进去", "Move into a new folder"), info: L("在库的最外层建。一个主题一个文件夹。", "Created at the library root. One folder per topic."), suggestion: "", button: L("建好并挪进去", "Create & Move")) else { return }
            folder = asked
        }
        let parts = folder.split(separator: "/").map(String.init)
        guard !parts.contains(where: { $0.isEmpty || $0.hasPrefix(".") || $0 == ".." }) else { return }
        let dir = parts.reduce(library) { $0.appendingPathComponent($1, isDirectory: true) }
        guard dir.standardizedFileURL != url.deletingLastPathComponent().standardizedFileURL else { return }
        relocate(url, to: dir.appendingPathComponent(url.lastPathComponent), what: "移动")
    }

    private func renamedInPage(from: String, to: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: [from, to]), let json = String(data: data, encoding: .utf8) else { return }
        runJS("window.__docRenamed && window.__docRenamed(...\(json));")
    }

    private func revealDocument(_ body: Any) {
        guard let path = (body as? [String: Any])?["path"] as? String, let url = inLibrary(path) else { return }
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }

    private func trashDocument(_ body: Any) {
        guard let path = (body as? [String: Any])?["path"] as? String, let url = inLibrary(path) else { return }
        let links = backlinks(to: url)
        let alert = NSAlert()
        alert.messageText = L("把「\(url.deletingPathExtension().lastPathComponent)」移到废纸篓？", "Move \"\(url.deletingPathExtension().lastPathComponent)\" to the Trash?")
        var info: [String] = []
        if !links.blocks.isEmpty { info.append("Diem 纸上挂着它：" + links.blocks.map { "「\($0.text)」" }.joined(separator: "、") + "，删了那块就打不开了。") }
        if !links.notes.isEmpty { info.append(L("还有 \(links.notes.count) 篇链着它：", "\(links.notes.count) notes link to it: ") + links.notes.prefix(4).map { $0.deletingPathExtension().lastPathComponent }.joined(separator: L("、", ", ")) + (links.notes.count > 4 ? L(" 等", "…") : "") + L("。", ".")) }
        info.append(L("能从废纸篓放回来，回响和修改记录留着，放回来还在。", "You can put it back from the Trash; annotations and history are kept."))
        alert.informativeText = info.joined(separator: "\n")
        alert.alertStyle = links.blocks.isEmpty && links.notes.isEmpty ? .informational : .warning
        alert.addButton(withTitle: L("移到废纸篓", "Move to Trash"))
        alert.addButton(withTitle: L("取消", "Cancel"))
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        do { try FileManager.default.trashItem(at: url, resultingItemURL: nil) } catch {
            notice(L("没删成：", "Couldn't delete: ") + error.localizedDescription); return
        }
        syncLog([url], "移到废纸篓：\(libraryRelative(url) ?? url.lastPathComponent)")
        let json = (try? JSONSerialization.data(withJSONObject: [path])).flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
        runJS("window.__docTrashed && window.__docTrashed(\(json)[0]);")
        if url.standardizedFileURL == currentURL?.standardizedFileURL {
            currentURL = nil
            currentMarkdown = ""
            currentModificationDate = nil
            imageHandler.document = nil
            // 不留着这篇：书库重开，回到上一篇看过的
            if let folder = currentFolderURL { openFolder(folder) }
        } else if let folder = currentFolderURL { openFolder(folder, keepingDocument: true) }
        notice(L("已移到废纸篓，想要回来去废纸篓里「放回原处」", "Moved to Trash — use Put Back in the Trash to restore"))
    }

    /// 新建：笔记 / 要接着想 / 来源（贴网址）。放进 folder（相对库），写好属性，建完就打开
    private func newDocument(_ body: Any) {
        guard let payload = body as? [String: Any], let library = currentFolderURL else { notice(L("先打开一个库", "Open a library first")); return }
        let kind = payload["kind"] as? String ?? "笔记"
        let folder = (payload["folder"] as? String ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        let alert = NSAlert()
        let where_ = folder.isEmpty ? L("库的最外层", "the library root") : L("「\(folder)」", "\"\(folder)\"")
        alert.messageText = kind == "来源" ? L("存一篇来源", "Save a source") : kind == "要接着想" ? L("记一个要接着想的", "New keep-thinking note") : L("新建一篇笔记", "New note")
        alert.informativeText = L("放在\(where_)。", "Goes in \(where_). ") + (kind == "来源" ? L("建好后会复制一句话，贴进你的 AI（如 Claude Code），它去把原文存下来。", "A one-line prompt will be copied — paste it into your AI agent (e.g. Claude Code) to save the original.") : "")
        let titleField = textField("", placeholder: kind == "来源" ? L("说明（比如 2013BP）", "Label (e.g. 2013 pitch deck)") : L("标题", "Title"))
        let urlField = textField("", placeholder: L("网址 https://…", "URL https://…"))
        let stack = NSStackView(frame: NSRect(x: 0, y: 0, width: 340, height: kind == "来源" ? 56 : 24))
        stack.orientation = .vertical; stack.spacing = 8; stack.alignment = .leading
        if kind == "来源" { stack.addArrangedSubview(urlField) }
        stack.addArrangedSubview(titleField)
        alert.accessoryView = stack
        alert.addButton(withTitle: L("建好", "Create"))
        alert.addButton(withTitle: L("取消", "Cancel"))
        alert.window.initialFirstResponder = kind == "来源" ? urlField : titleField
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let title = safeName(titleField.stringValue)
        let link = urlField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty || !link.isEmpty else { return }
        let parts = folder.split(separator: "/").map(String.init)
        guard !parts.contains(where: { $0.hasPrefix(".") }) else { return }
        let dir = parts.reduce(library) { $0.appendingPathComponent($1, isDirectory: true) }
        let mmdd: String = { let f = DateFormatter(); f.dateFormat = "MMdd"; return f.string(from: Date()) }()
        let label = title.isEmpty ? (URL(string: link)?.host ?? L("网页", "web")) : title
        var base = kind == "来源" ? L("来源-", "source-") + "\(label)-\(mmdd)" : label
        var url = dir.appendingPathComponent(base + ".md")
        var n = 2
        while FileManager.default.fileExists(atPath: url.path) { url = dir.appendingPathComponent("\(base) \(n).md"); n += 1 }
        base = url.deletingPathExtension().lastPathComponent
        let topic = parts.first ?? ""
        var yaml = ["---", "type: \(anewIsChinese ? kind : (["来源": "source", "笔记": "note", "要接着想": "keep-thinking"][kind] ?? kind))", "stage: \(kind == "要接着想" ? "idea" : "working")"]
        if !topic.isEmpty { yaml.append("topic: \(yamlValue(topic))") }
        yaml.append("created: \(today())")
        if kind == "来源" {
            if !link.isEmpty { yaml.append("source: \(yamlValue(link))") }
            yaml += anewIsChinese ? ["keep: 摘要", "from: 网页"] : ["keep: summary", "from: web"]
        }
        if kind == "要接着想" { yaml += ["idea: \(yamlValue(label))", "idea_from: \(L("我", "me"))"] }
        yaml.append("---")
        var bodyText = "\n# \(label)\n\n"
        if kind == "来源" { bodyText += link.isEmpty ? L("（还没存原文）\n", "(Original not saved yet)\n") : L("原文：<\(link)>\n\n（还没存原文：回你的 AI（如 Claude Code）让它存下来）\n", "Original: <\(link)>\n\n(Not saved yet — ask Claude Code to save it)\n") }
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try (yaml.joined(separator: "\n") + "\n" + bodyText).write(to: url, atomically: true, encoding: .utf8)
        } catch { notice(L("没建成：", "Couldn't create: ") + error.localizedDescription); return }
        syncLog([url], "新建\(kind)：\(libraryRelative(url) ?? base)")
        openFolder(library, keepingDocument: true)
        display(url)
        if kind == "来源", !link.isEmpty {
            let pb = NSPasteboard.general
            pb.clearContents()
            pb.setString(L("存一下这篇来源：\(url.path)（原文 \(link)）", "Save this source: \(url.path) (original: \(link))"), forType: .string)
            notice(L("建好了。已复制一句话，贴进你的 AI（如 Claude Code），它去把原文存下来", "Created. Prompt copied — paste it into your AI agent (e.g. Claude Code) to save the original"))
        } else {
            notice(L("建好了：", "Created: ") + base)
        }
    }

    // ── 书架：用户自己挑进来的几本书，跟"最近打开"不一样，不会被挤掉 ──

    private func shelfPaths() -> [String] {
        UserDefaults.standard.array(forKey: shelfKey) as? [String] ?? []
    }

    private func setShelfPaths(_ paths: [String]) {
        UserDefaults.standard.set(paths, forKey: shelfKey)
    }

    private func shelfAdd() {
        let panel = NSOpenPanel()
        panel.title = L("把一本书加进书架", "Add a book to the shelf")
        panel.message = L("选一个文件夹。这个文件夹（含子文件夹）里的 Markdown 就是这本书。", "Pick a folder. All Markdown inside it (including subfolders) makes up the book.")
        panel.prompt = L("加进书架", "Add to Shelf")
        panel.allowsMultipleSelection = false
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        guard panel.runModal() == .OK, let url = panel.url else { return }
        var paths = shelfPaths().filter { $0 != url.path }
        paths.append(url.path)
        setShelfPaths(paths)
        sendShelf()
        openFolder(url)
    }

    private func shelfRemove(_ body: Any) {
        guard let path = (body as? [String: Any])?["path"] as? String else { return }
        setShelfPaths(shelfPaths().filter { $0 != path })
        sendShelf()
    }

    // ── 书名：封面和标题写书名，不写文件夹名（「【当前】20260822_十卷」这种是版本文件夹）──
    // 优先读书的文件夹里的 .paper-md-book.json：{"title": "南方无雪", "color": "#4a6670"}
    // 没有这个文件就猜：文件夹名像版本号，就往上一层取书名，并去掉「03-」这类序号。
    private struct BookInfo { let title: String; let color: String?; let cover: String? }

    private func bookInfo(for url: URL) -> BookInfo {
        let metaURL = url.appendingPathComponent(".paper-md-book.json")
        if let data = try? Data(contentsOf: metaURL),
           let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
            let title = ((object["title"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let color = object["color"] as? String
            let coverName = (object["cover"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let coverURL = (coverName?.isEmpty == false) ? url.appendingPathComponent(coverName!) : findCoverFile(in: url)
            return BookInfo(title: title.isEmpty ? guessBookTitle(url) : title, color: color, cover: coverURL.flatMap(coverDataURL))
        }
        return BookInfo(title: guessBookTitle(url), color: nil, cover: findCoverFile(in: url).flatMap(coverDataURL))
    }

    // ── 在 App 里换封面：选图（或把图拖到封面上）→ 复制成书文件夹里的「封面.xxx」，
    //    旧封面挪进 .paper-md-history/封面/ 留底，.paper-md-book.json 的 cover 指向新图 ──
    private func shelfSetCover(_ body: Any) {
        guard let payload = body as? [String: Any], let path = payload["path"] as? String else { return }
        let bookURL = URL(fileURLWithPath: path)
        var imageData: Data?
        var ext = "png"
        if let base64 = payload["data"] as? String, let data = Data(base64Encoded: base64) {
            imageData = data
            ext = ((payload["ext"] as? String) ?? "png").lowercased()
        } else {
            let panel = NSOpenPanel()
            panel.title = L("换封面", "Change Cover")
            panel.message = L("选一张图做这本书的封面。会复制一份放进书的文件夹，原图不动。", "Pick an image for the cover. A copy goes into the book folder; the original is untouched.")
            panel.prompt = L("用这张", "Use This")
            panel.allowsMultipleSelection = false
            panel.canChooseDirectories = false
            panel.allowedContentTypes = [.image]
            guard panel.runModal() == .OK, let url = panel.url, let data = try? Data(contentsOf: url) else { return }
            imageData = data
            if !url.pathExtension.isEmpty { ext = url.pathExtension.lowercased() }
        }
        guard let data = imageData, NSImage(data: data) != nil else { notice(L("这张图读不出来，换一张试试", "Can't read this image, try another")); return }
        if !["png", "jpg", "jpeg", "webp", "heic", "gif", "tif", "tiff"].contains(ext) { ext = "png" }

        let fm = FileManager.default
        let stamp: String = { let f = DateFormatter(); f.dateFormat = "yyyyMMdd-HHmmss"; return f.string(from: Date()) }()
        let oldDir = bookURL.appendingPathComponent(".paper-md-history/封面", isDirectory: true)
        for base in ["封面", "cover", "Cover"] {
            for oldExt in ["png", "jpg", "jpeg", "webp", "heic", "gif", "tif", "tiff"] {
                let old = bookURL.appendingPathComponent("\(base).\(oldExt)")
                guard fm.fileExists(atPath: old.path) else { continue }
                try? fm.createDirectory(at: oldDir, withIntermediateDirectories: true)
                try? fm.moveItem(at: old, to: oldDir.appendingPathComponent("\(base)_\(stamp).\(oldExt)"))
            }
        }
        let fileName = "封面.\(ext)"
        do {
            try data.write(to: bookURL.appendingPathComponent(fileName), options: .atomic)
            let metaURL = bookURL.appendingPathComponent(".paper-md-book.json")
            var meta: [String: Any] = [:]
            if let old = try? Data(contentsOf: metaURL),
               let object = (try? JSONSerialization.jsonObject(with: old)) as? [String: Any] { meta = object }
            meta["cover"] = fileName
            let json = try JSONSerialization.data(withJSONObject: meta, options: [.prettyPrinted, .sortedKeys])
            try json.write(to: metaURL, options: .atomic)
        } catch {
            notice(L("封面没换成：", "Couldn't change the cover: ") + error.localizedDescription)
            return
        }
        sendShelf()
        notice(L("封面换好了，旧的收在书文件夹的 .paper-md-history/封面 里", "Cover changed; the old one is in .paper-md-history/封面"))
    }

    // ── 封面图：书的文件夹里放一张「封面.png / cover.jpg」，或在 .paper-md-book.json 里写 "cover": "文件名" ──
    private func findCoverFile(in url: URL) -> URL? {
        for base in ["封面", "cover", "Cover"] {
            for ext in ["png", "jpg", "jpeg", "webp", "heic"] {
                let candidate = url.appendingPathComponent("\(base).\(ext)")
                if FileManager.default.fileExists(atPath: candidate.path) { return candidate }
            }
        }
        return nil
    }

    private var coverCache: [String: (modified: Date, dataURL: String)] = [:]

    /// 缩到 360px 宽的 JPEG，塞成 data URL 给页面用；原图不动。按修改时间缓存，换了图自动重做。
    private func coverDataURL(_ fileURL: URL) -> String? {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: fileURL.path),
              let modified = attributes[.modificationDate] as? Date else { return nil }
        if let cached = coverCache[fileURL.path], cached.modified == modified { return cached.dataURL }
        guard let image = NSImage(contentsOf: fileURL),
              let source = image.representations.first else { return nil }
        let pixelWidth = CGFloat(max(source.pixelsWide, 1))
        let pixelHeight = CGFloat(max(source.pixelsHigh, 1))
        let targetWidth = min(360, pixelWidth)
        let targetHeight = (targetWidth * pixelHeight / pixelWidth).rounded()
        guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(targetWidth), pixelsHigh: Int(targetHeight),
                                            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        NSGraphicsContext.current?.imageInterpolation = .high
        image.draw(in: NSRect(x: 0, y: 0, width: targetWidth, height: targetHeight), from: .zero, operation: .copy, fraction: 1)
        NSGraphicsContext.restoreGraphicsState()
        guard let jpeg = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.86]) else { return nil }
        let dataURL = "data:image/jpeg;base64," + jpeg.base64EncodedString()
        coverCache[fileURL.path] = (modified, dataURL)
        return dataURL
    }

    private func cleanBookName(_ name: String) -> String {
        var s = name.replacingOccurrences(of: "【[^】]*】", with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: "^[0-9]+[-_.、 ]+", with: "", options: .regularExpression)
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func looksLikeVersionFolder(_ name: String) -> Bool {
        if name.range(of: "【[^】]*】", options: .regularExpression) != nil { return true }
        let bare = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if bare.range(of: "^(19|20)[0-9]{6}", options: .regularExpression) != nil { return true }
        let cleaned = cleanBookName(name)
        if cleaned.isEmpty { return true }
        if cleaned.range(of: "^(当前|最新|定稿|草稿|draft|current|v[0-9])", options: [.regularExpression, .caseInsensitive]) != nil { return true }
        if cleaned.range(of: "^[零〇一二三四五六七八九十百0-9]+卷$", options: .regularExpression) != nil { return true }
        return false
    }

    private func guessBookTitle(_ url: URL) -> String {
        let name = url.lastPathComponent
        if looksLikeVersionFolder(name) {
            let parentName = url.deletingLastPathComponent().lastPathComponent
            let parent = cleanBookName(parentName)
            if !parent.isEmpty, !looksLikeVersionFolder(parentName) { return parent }
        }
        let cleaned = cleanBookName(name)
        return cleaned.isEmpty ? name : cleaned
    }

    private func isArchiveFolderName(_ name: String) -> Bool {
        name.range(of: "历史版本|历史稿|旧版|归档|备份|快照|archive|backup", options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// 数一本书：正文有几篇、其中几卷（「卷X_…」），最后改动时间。历史版本、快照这些不算。
    private func shelfStats(_ url: URL) -> (count: Int, volumes: Int, updated: Date?) {
        let keys: Set<URLResourceKey> = [.isRegularFileKey, .isDirectoryKey, .contentModificationDateKey]
        let options: FileManager.DirectoryEnumerationOptions = [.skipsHiddenFiles, .skipsPackageDescendants]
        guard let enumerator = FileManager.default.enumerator(at: url, includingPropertiesForKeys: Array(keys), options: options) else { return (0, 0, nil) }
        var count = 0
        var volumes = 0
        var latest: Date?
        while let fileURL = enumerator.nextObject() as? URL {
            guard let values = try? fileURL.resourceValues(forKeys: keys) else { continue }
            if values.isDirectory == true {
                if isArchiveFolderName(fileURL.lastPathComponent) { enumerator.skipDescendants() }
                continue
            }
            guard validMarkdownURL(fileURL) != nil, values.isRegularFile == true else { continue }
            count += 1
            if fileURL.lastPathComponent.range(of: "^卷 *[零〇一二三四五六七八九十百0-9]+(?=[_\\-.·、 ]|\\.(md|markdown|mdown|mkdn)$)", options: .regularExpression) != nil { volumes += 1 }
            if let date = values.contentModificationDate, latest == nil || date > latest! { latest = date }
        }
        return (count, volumes, latest)
    }

    private func sendShelf() {
        // 第一次用：把"最近打开"过的文件夹搬进书架，免得一进来是空的
        if shelfPaths().isEmpty {
            let seeds = recentLibraries().map { $0.path }.filter { FileManager.default.fileExists(atPath: $0) }
            if !seeds.isEmpty { setShelfPaths(seeds.reversed()) }
        }
        let formatter = DateFormatter()
        formatter.dateFormat = L("M月d日", "MMM d")
        var books: [[String: Any]] = []
        for path in shelfPaths() {
            let url = URL(fileURLWithPath: path)
            var isDirectory: ObjCBool = false
            let exists = FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory) && isDirectory.boolValue
            var count = 0
            var volumes = 0
            var updated: Date? = nil
            if exists {
                let stats = shelfStats(url)
                count = stats.count
                volumes = stats.volumes
                updated = stats.updated
            }
            let book = bookInfo(for: url)
            var entry: [String: Any] = [
                "name": book.title,
                "folderName": url.lastPathComponent,
                "path": path,
                "exists": exists,
                "count": count,
                "volumes": volumes,
                "updated": updated.map { formatter.string(from: $0) } ?? ""
            ]
            if let color = book.color { entry["color"] = color }
            if exists, let cover = book.cover { entry["coverImage"] = cover }
            books.append(entry)
        }
        guard let data = try? JSONSerialization.data(withJSONObject: books),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.renderShelf(\(json));")
    }

    private func recentLibraries() -> [RecentLibrary] {
        guard let data = UserDefaults.standard.data(forKey: recentLibrariesKey),
              let entries = try? JSONDecoder().decode([RecentLibrary].self, from: data) else { return [] }
        return entries.filter { entry in
            var isDirectory: ObjCBool = false
            return FileManager.default.fileExists(atPath: entry.path, isDirectory: &isDirectory) && isDirectory.boolValue
        }
    }

    private func recordRecentLibrary(_ url: URL) {
        let path = url.standardizedFileURL.path
        var entries = recentLibraries().filter { $0.path != path }
        entries.insert(RecentLibrary(path: path, name: url.lastPathComponent, lastOpened: Date()), at: 0)
        if let data = try? JSONEncoder().encode(Array(entries.prefix(8))) {
            UserDefaults.standard.set(data, forKey: recentLibrariesKey)
        }
    }

    private func sendRecentLibraries() {
        let formatter = ISO8601DateFormatter()
        let entries = recentLibraries().map { ["path": $0.path, "name": $0.name, "lastOpened": formatter.string(from: $0.lastOpened)] }
        guard let data = try? JSONSerialization.data(withJSONObject: entries),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.renderRecentLibraries(\(json));")
    }

    private func modificationDate(of url: URL) -> Date? {
        (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
    }

    /// 文件在本次打开之后是否被外部程序改过。
    /// 只看修改时间不够可靠（有些写法会重置 mtime），所以时间对不上时再比一次内容。
    private func externalChange(at url: URL) -> (date: Date, text: String)? {
        guard let expected = currentModificationDate, let disk = modificationDate(of: url) else { return nil }
        guard abs(disk.timeIntervalSince(expected)) > 1 else { return nil }
        guard let text = try? String(contentsOf: url, encoding: .utf8), text != currentMarkdown else { return nil }
        return (disk, text)
    }

    private func saveMarkdown(_ body: Any) {
        guard let document = body as? [String: Any], let markdown = document["content"] as? String else { return }
        guard let url = currentURL else {
            sendSaveStatus("error", message: L("请先打开一个 Markdown 文件", "Open a Markdown file first"))
            return
        }

        if let change = externalChange(at: url) {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "zh_CN")
            formatter.dateFormat = L("MM 月 dd 日 HH:mm:ss", "MMM d HH:mm:ss")
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = L("这个文件在外面被改过了", "This file was changed outside Anew")
            alert.informativeText = L("\(url.lastPathComponent) 在你打开它之后，被别的程序修改过（\(formatter.string(from: change.date))）。\n\n直接保存会把那些改动覆盖掉。",
                                      "\(url.lastPathComponent) was modified by another app after you opened it (\(formatter.string(from: change.date))).\n\nSaving now will overwrite those changes.")
            alert.addButton(withTitle: L("覆盖并保存", "Overwrite & Save"))
            alert.addButton(withTitle: L("放弃我的修改，重新载入", "Discard My Changes & Reload"))
            alert.addButton(withTitle: L("取消", "Cancel"))
            switch alert.runModal() {
            case .alertFirstButtonReturn:
                break
            case .alertSecondButtonReturn:
                display(url)
                sendSaveStatus("error", message: L("已重新载入磁盘上的版本", "Reloaded the version on disk"))
                return
            default:
                sendSaveStatus("error", message: L("已取消保存", "Save cancelled"))
                return
            }
        }

        do {
            try markdown.write(to: url, atomically: true, encoding: .utf8)
            let logs = recordChange(from: currentMarkdown, to: markdown, for: url)
            currentMarkdown = markdown
            currentModificationDate = modificationDate(of: url)
            syncLog([url], "改了正文", throttle: true)
            sendSaveStatus("saved", message: L("已保存", "Saved"), logs: logs)
        } catch {
            sendSaveStatus("error", message: L("保存失败，请检查文件权限", "Save failed — check file permissions"))
        }
    }

    /// 历史存在哪一层：文件在当前书库里就存书库根，否则存文件自己的目录。
    /// （旧版一律用 currentFolderURL，会把"单独打开的文件"的历史写进上一个书库里。）
    private func historyBase(for url: URL) -> URL {
        if let folder = currentFolderURL {
            let folderPath = folder.standardizedFileURL.path
            if url.standardizedFileURL.path.hasPrefix(folderPath + "/") { return folder }
        }
        return url.deletingLastPathComponent()
    }

    /// key 用「相对 base 的路径」而不是绝对路径——这样整个书库改名或搬家，历史都跟着走。
    private func historyKey(for url: URL, base: URL) -> String {
        let basePath = base.standardizedFileURL.path
        let filePath = url.standardizedFileURL.path
        let relative = filePath.hasPrefix(basePath + "/")
            ? String(filePath.dropFirst(basePath.count + 1))
            : url.lastPathComponent
        return Data(relative.utf8).base64EncodedString().replacingOccurrences(of: "/", with: "_")
    }

    private func historyURL(for url: URL) -> URL {
        let base = historyBase(for: url)
        let directory = base.appendingPathComponent(".paper-md-history", isDirectory: true)
        return directory.appendingPathComponent(historyKey(for: url, base: base) + ".json")
    }

    /// 0.2 及以前：文件名 = 绝对路径的 base64。留着用来迁移。
    private func legacyHistoryURL(for url: URL) -> URL {
        let base = currentFolderURL ?? url.deletingLastPathComponent()
        let directory = base.appendingPathComponent(".paper-md-history", isDirectory: true)
        let name = Data(url.standardizedFileURL.path.utf8).base64EncodedString().replacingOccurrences(of: "/", with: "_")
        return directory.appendingPathComponent(name + ".json")
    }

    /// 第一次用新版打开旧文件时，把旧历史改名成新 key，不丢记录。
    private func migrateHistoryIfNeeded(for url: URL) {
        let newURL = historyURL(for: url)
        let manager = FileManager.default
        guard !manager.fileExists(atPath: newURL.path) else { return }
        let oldURL = legacyHistoryURL(for: url)
        guard oldURL != newURL, manager.fileExists(atPath: oldURL.path) else { return }
        do {
            try manager.createDirectory(at: newURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try manager.moveItem(at: oldURL, to: newURL)
        } catch { }
    }

    private func loadHistory(for url: URL) -> [[String: String]] {
        migrateHistoryIfNeeded(for: url)
        let fileURL = historyURL(for: url)
        guard let data = try? Data(contentsOf: fileURL), let logs = try? JSONDecoder().decode([ChangeLog].self, from: data) else { return [] }
        return logs.map { ["time": $0.time, "summary": $0.summary] }
    }

    private func recordChange(from oldValue: String, to newValue: String, for url: URL) -> [[String: String]] {
        guard oldValue != newValue else { return loadHistory(for: url) }
        let oldLines = oldValue.components(separatedBy: .newlines)
        let newLines = newValue.components(separatedBy: .newlines)
        var prefix = 0
        while prefix < min(oldLines.count, newLines.count), oldLines[prefix] == newLines[prefix] { prefix += 1 }
        var suffix = 0
        while suffix < oldLines.count - prefix, suffix < newLines.count - prefix,
              oldLines[oldLines.count - 1 - suffix] == newLines[newLines.count - 1 - suffix] { suffix += 1 }
        let removed = oldLines.count - prefix - suffix
        let added = newLines.count - prefix - suffix
        let location = prefix + 1
        let summary: String
        if removed == 0 { summary = L("第 \(location) 行起新增 \(added) 行", "Added \(added) lines at line \(location)") }
        else if added == 0 { summary = L("第 \(location) 行起删除 \(removed) 行", "Removed \(removed) lines at line \(location)") }
        else { summary = L("第 \(location) 行起修改（\(removed) 行 → \(added) 行）", "Changed at line \(location) (\(removed) → \(added) lines)") }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        var entries: [ChangeLog] = []
        let fileURL = historyURL(for: url)
        if let data = try? Data(contentsOf: fileURL), let decoded = try? JSONDecoder().decode([ChangeLog].self, from: data) { entries = decoded }
        entries.insert(ChangeLog(time: formatter.string(from: Date()), summary: summary), at: 0)
        entries = Array(entries.prefix(100))
        do {
            try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(entries).write(to: fileURL, options: .atomic)
        } catch { }
        return entries.map { ["time": $0.time, "summary": $0.summary] }
    }

    // ────────── 看改动：「上次确认过的版本」 ──────────
    // 和修改记录放同一个目录，文件名 = 同一个 key + .base.md。
    // 页面拿它和磁盘上的现稿比，比出来的就是「外面（AI）改了、用户还没确认」的地方。

    private func baselineURL(for url: URL) -> URL {
        let base = historyBase(for: url)
        let directory = base.appendingPathComponent(".paper-md-history", isDirectory: true)
        return directory.appendingPathComponent(historyKey(for: url, base: base) + ".base.md")
    }

    /// 第一次打开（还没有基准）：把现稿当成已确认的版本存一份
    private func loadBaseline(for url: URL, current: String) -> String {
        let fileURL = baselineURL(for: url)
        if let text = try? String(contentsOf: fileURL, encoding: .utf8) { return text }
        try? FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? current.write(to: fileURL, atomically: true, encoding: .utf8)
        return current
    }

    /// 左边小标用：有基准、且现稿和它不一样（AI 改了、用户还没确认）才把两份都带上，页面数改了几块
    private func unconfirmedChange(for url: URL) -> (baseline: String, current: String)? {
        guard let baseline = try? String(contentsOf: baselineURL(for: url), encoding: .utf8),
              let current = try? String(contentsOf: url, encoding: .utf8), baseline != current else { return nil }
        return (baseline, current)
    }

    private func saveBaseline(_ body: Any) {
        guard let payload = body as? [String: Any], let path = payload["path"] as? String,
              let content = payload["content"] as? String, let url = currentURL, url.path == path else { return }
        let fileURL = baselineURL(for: url)
        try? FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? content.write(to: fileURL, atomically: true, encoding: .utf8)
    }

    // ────────── 备注（批注） ──────────

    /// 批注和修改记录用同一套 key，只是换一个目录。正文里不留任何痕迹。
    private func notesURL(for url: URL) -> URL {
        let base = historyBase(for: url)
        let directory = base.appendingPathComponent(".paper-md-notes", isDirectory: true)
        return directory.appendingPathComponent(historyKey(for: url, base: base) + ".json")
    }

    /// 左边小标用：每条批注只带 id、处理没、Claude 写的处理说明、最后一句是谁说的
    private func noteBrief(for url: URL) -> [[String: Any]] {
        loadNotes(for: url).map { item in
            let replies = item["replies"] as? [[String: Any]] ?? []
            var brief: [String: Any] = ["id": item["id"] as? String ?? "", "done": (item["done"] as? Bool) ?? false, "replies": replies.count]
            if let resolved = item["resolved"] as? String { brief["resolved"] = resolved }
            if let last = replies.last?["by"] as? String { brief["lastBy"] = last }
            return brief
        }
    }

    /// 书库里所有 .paper-md-notes 目录下 json 的最新改动时间
    private func notesStamp(in folder: URL) -> Date? {
        let fm = FileManager.default
        var dirs = [folder.appendingPathComponent(".paper-md-notes", isDirectory: true)]
        if let subs = try? fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]) {
            dirs += subs.filter { (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true }
                .map { $0.appendingPathComponent(".paper-md-notes", isDirectory: true) }
        }
        var latest: Date?
        for dir in dirs {
            guard let files = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey], options: []) else { continue }
            for file in files where file.pathExtension == "json" {
                if let date = try? file.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate, latest == nil || date > latest! { latest = date }
            }
        }
        return latest
    }

    private func loadNotes(for url: URL) -> [[String: Any]] {
        guard let data = try? Data(contentsOf: notesURL(for: url)),
              let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return list
    }

    private func saveNotes(_ body: Any) {
        guard let url = currentURL,
              let payload = body as? [String: Any],
              let path = payload["path"] as? String,
              let list = payload["notes"] as? [[String: Any]] else { return }
        guard path == url.path else {
            sendNotesStatus(path: path, success: false)
            return
        }
        let fileURL = notesURL(for: url)
        // AI 可能刚在 Claude Code 里往同一个文件写了回复：按 id 合并，谁的回复多留谁的，不互相盖掉
        var merged = list
        var keptTheirs = false
        if let data = try? Data(contentsOf: fileURL),
           let disk = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            let byID = Dictionary(disk.compactMap { item -> (String, [String: Any])? in
                guard let id = item["id"] as? String else { return nil }
                return (id, item)
            }, uniquingKeysWith: { a, _ in a })
            merged = list.map { item in
                guard let id = item["id"] as? String, let old = byID[id] else { return item }
                var next = item
                let mine = (item["replies"] as? [Any])?.count ?? 0
                let theirs = (old["replies"] as? [Any])?.count ?? 0
                if theirs > mine { next["replies"] = old["replies"]; keptTheirs = true }
                return next
            }
        }
        do {
            try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: merged, options: [.prettyPrinted])
            try data.write(to: fileURL, options: .atomic)
            // 留了 AI 的回复，页面上还是旧的：让监视器下一轮刷新一次
            currentNotesModificationDate = keptTheirs ? nil : modificationDate(of: fileURL)
            sendNotesStatus(path: path, success: true)
        } catch {
            sendNotesStatus(path: path, success: false)
        }
    }

    private func sendNotesStatus(path: String, success: Bool) {
        let payload: [String: Any] = ["path": path, "success": success,
            "message": success ? L("回响已保存", "Annotations saved") : L("回响保存失败，请按 ⌘S 重试", "Couldn't save annotations — press ⌘S to retry")]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        runJS("window.notesStatus(\(json));")
    }

    private func saveImage(_ body: Any) {
        let payload = body as? [String: Any] ?? [:]
        var reply: [String: Any] = ["requestID": payload["requestID"] as? String ?? "", "docPath": payload["docPath"] as? String ?? ""]
        do {
            guard let document = currentURL, payload["docPath"] as? String == document.path else {
                throw ImageFailure.message(L("当前稿件已切换，请重新插入图片", "The document changed — insert the image again"))
            }
            guard let base64 = payload["dataBase64"] as? String, let data = Data(base64Encoded: base64) else {
                throw ImageFailure.message(L("图片数据不完整，请重试", "Image data incomplete, try again"))
            }
            reply["filename"] = try DocumentImages.save(data, document: document)
            reply["success"] = true
        } catch {
            reply["success"] = false
            reply["error"] = error.localizedDescription
        }
        if let data = try? JSONSerialization.data(withJSONObject: reply), let json = String(data: data, encoding: .utf8) {
            runJS("window.imageSaved(\(json));")
        }
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.beginSheetModal(for: window) { response in completionHandler(response == .OK ? panel.urls : nil) }
    }

    private func notice(_ text: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: [text]), let json = String(data: data, encoding: .utf8) else { return }
        runJS("window.showNotice(\(json)[0]);")
    }

    private func htmlEscape(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }

    /// 保留原有纯文本格式，同时写入含内嵌图片的 HTML；原图不参与修改。
    private func copyForModel(_ body: Any) {
        guard let payload = body as? [String: Any], let document = currentURL else { return }
        guard !copyingImages else { notice(L("正在准备图片，请稍候", "Preparing images, one moment")); return }
        guard payload["docPath"] as? String == document.path else { notice(L("稿件已切换，请重新复制", "The document changed — copy again")); return }
        let text = payload["content"] as? String ?? currentMarkdown
        let notes = payload["notes"] as? [[String: Any]] ?? []
        let name = currentURL?.lastPathComponent ?? L("未命名", "Untitled")

        var out = "《\(name)》\n\n" + text
        if !notes.isEmpty {
            out += "\n\n\n————————————————\n" + L("回响 \(notes.count) 条", "\(notes.count) annotations") + "\n————————————————\n"
            for (index, note) in notes.enumerated() {
                let quote = (note["quote"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                let body = (note["note"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                if quote.isEmpty {
                    out += "\n[\(index + 1)] " + L("备注：", "Note: ") + "\(body)\n"
                } else {
                    out += "\n[\(index + 1)] " + L("原文：", "Quote: ") + "\(quote)\n　　" + L("回响：", "Note: ") + "\(body)\n"
                }
            }
        }
        var html = "<!doctype html><html><head><meta charset=\"utf-8\"></head><body>"
        html += "<p>《\(htmlEscape(name))》</p>" + (payload["html"] as? String ?? "<pre>\(htmlEscape(text))</pre>")
        if !notes.isEmpty {
            html += "<hr><h2>" + L("回响 \(notes.count) 条", "\(notes.count) annotations") + "</h2>"
            for (index, note) in notes.enumerated() {
                let quote = (note["quote"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                let body = htmlEscape(note["note"] as? String ?? "").replacingOccurrences(of: "\n", with: "<br>")
                html += quote.isEmpty ? "<p>[\(index + 1)] " + L("备注：", "Note: ") + "\(body)</p>" : "<p>[\(index + 1)] " + L("原文：", "Quote: ") + "\(htmlEscape(quote))<br>" + L("回响：", "Note: ") + "\(body)</p>"
            }
        }
        html += "</body></html>"
        let images = payload["images"] as? [[String: String]] ?? []
        copyingImages = true
        if !images.isEmpty { notice(L("正在准备带图内容…", "Preparing content with images…")) }
        Task {
            defer { copyingImages = false }
            do {
                let prepared = try await Task.detached {
                    try await DocumentImages.embed(html: html, images: images, document: document)
                }.value
                let board = NSPasteboard.general
                board.declareTypes([.html, .string], owner: nil)
                let richCopied = board.setString(prepared, forType: .html)
                let textCopied = board.setString(out, forType: .string)
                let count = notes.isEmpty ? "" : L("，含 \(notes.count) 条回响", ", with \(notes.count) annotations")
                notice(richCopied && textCopied ? L("已复制到剪贴板", "Copied") + count : L("复制失败，请重试", "Copy failed, try again"))
            } catch { notice(L("复制失败：", "Copy failed: ") + error.localizedDescription) }
        }
    }

    // ────────── 主菜单 ──────────
    // 之前整个 app 没有 NSMenu。macOS 的剪切/拷贝/粘贴/撤销/全选
    // 全靠「编辑」菜单的快捷键沿响应链派发，没有菜单 = 这些操作全部失效。

    private func buildMainMenu() {
        let mainMenu = NSMenu()

        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: L("关于 知新 Anew", "About Anew"), action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: L("隐藏 知新 Anew", "Hide Anew"), action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = NSMenuItem(title: L("隐藏其他", "Hide Others"), action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(hideOthers)
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: L("退出 知新 Anew", "Quit Anew"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let fileItem = NSMenuItem()
        mainMenu.addItem(fileItem)
        let fileMenu = NSMenu(title: L("文件", "File"))
        fileMenu.addItem(withTitle: L("打开文件…", "Open File…"), action: #selector(menuOpenFile), keyEquivalent: "o")
        let openFolderItem = NSMenuItem(title: L("打开书库…", "Open Library…"), action: #selector(menuOpenFolder), keyEquivalent: "o")
        openFolderItem.keyEquivalentModifierMask = [.command, .shift]
        fileMenu.addItem(openFolderItem)
        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: L("刷新", "Reload"), action: #selector(menuReload), keyEquivalent: "r")
        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: L("保存", "Save"), action: #selector(menuSave), keyEquivalent: "s")
        let copyItem = NSMenuItem(title: L("复制正文与回响", "Copy Text with Annotations"), action: #selector(menuCopyForModel), keyEquivalent: "c")
        copyItem.keyEquivalentModifierMask = [.command, .shift]
        fileMenu.addItem(copyItem)
        fileItem.submenu = fileMenu

        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: L("编辑", "Edit"))
        editMenu.addItem(withTitle: L("撤销", "Undo"), action: Selector(("undo:")), keyEquivalent: "z")
        let redoItem = NSMenuItem(title: L("重做", "Redo"), action: Selector(("redo:")), keyEquivalent: "z")
        redoItem.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(redoItem)
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: L("剪切", "Cut"), action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: L("拷贝", "Copy"), action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: L("粘贴", "Paste"), action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        let pasteMatch = NSMenuItem(title: L("粘贴为纯文本", "Paste as Plain Text"), action: #selector(NSTextView.pasteAsPlainText(_:)), keyEquivalent: "v")
        pasteMatch.keyEquivalentModifierMask = [.command, .shift, .option]
        editMenu.addItem(pasteMatch)
        editMenu.addItem(withTitle: L("删除", "Delete"), action: #selector(NSText.delete(_:)), keyEquivalent: "")
        editMenu.addItem(withTitle: L("全选", "Select All"), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: L("写回响…", "Annotate…"), action: #selector(menuAddNote), keyEquivalent: "j")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: L("在这篇里找…", "Find…"), action: #selector(menuFind), keyEquivalent: "f")
        editMenu.addItem(withTitle: L("找下一处", "Find Next"), action: #selector(menuFindNext), keyEquivalent: "g")
        let findPrevious = NSMenuItem(title: L("找上一处", "Find Previous"), action: #selector(menuFindPrevious), keyEquivalent: "g")
        findPrevious.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(findPrevious)
        editItem.submenu = editMenu

        let viewItem = NSMenuItem()
        mainMenu.addItem(viewItem)
        let viewMenu = NSMenu(title: L("显示", "View"))
        viewMenu.addItem(withTitle: L("编辑 / 阅读", "Edit / Read"), action: #selector(menuToggleEdit), keyEquivalent: "e")
        viewMenu.addItem(.separator())
        viewMenu.addItem(withTitle: L("放大文字", "Larger Text"), action: #selector(menuZoomIn), keyEquivalent: "=")
        viewMenu.addItem(withTitle: L("缩小文字", "Smaller Text"), action: #selector(menuZoomOut), keyEquivalent: "-")
        viewMenu.addItem(.separator())
        viewMenu.addItem(withTitle: L("切换夜间", "Toggle Dark Mode"), action: #selector(menuToggleTheme), keyEquivalent: "d")
        viewItem.submenu = viewMenu

        let windowItem = NSMenuItem()
        mainMenu.addItem(windowItem)
        let windowMenu = NSMenu(title: L("窗口", "Window"))
        windowMenu.addItem(withTitle: L("最小化", "Minimize"), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: L("缩放", "Zoom"), action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowItem.submenu = windowMenu

        NSApp.mainMenu = mainMenu
        NSApp.windowsMenu = windowMenu
    }

    // ────────── 学习时间轴（0.6）──────────
    // 读了多久：Diem 记录器的 usage/<日期>.json（前台是「知新 Anew」时，窗口标题就是文档名），s / e 是当天第几秒。
    // 批注：库里所有 .paper-md-notes/*.json 的 created / replies。都是现成的，不另外记。

    private func loadTimeline(_ body: Any) {
        guard let date = (body as? [String: Any])?["date"] as? String else { return }
        let library = currentFolderURL
        let root = diemRoot(for: library)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var segments: [[String: Any]] = []
            var hasUsage = false
            if let root {
                for dir in ["usage", "archive/usage"] {
                    let url = root.appendingPathComponent(dir).appendingPathComponent("\(date).json")
                    guard let data = try? Data(contentsOf: url),
                          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                    hasUsage = true
                    for seg in object["segments"] as? [[String: Any]] ?? [] where ["知新 Anew", "Anew"].contains(seg["app"] as? String ?? "") {
                        segments.append(["s": seg["s"] ?? 0, "e": seg["e"] ?? 0, "title": seg["title"] ?? ""])
                    }
                    break
                }
            }
            var notes: [[String: Any]] = []
            if let library, let walker = FileManager.default.enumerator(at: library, includingPropertiesForKeys: nil) {
                while let url = walker.nextObject() as? URL {
                    let name = url.lastPathComponent
                    if name.hasPrefix(".") && name != ".paper-md-notes" { walker.skipDescendants(); continue }
                    guard url.pathExtension == "json", url.deletingLastPathComponent().lastPathComponent == ".paper-md-notes" else { continue }
                    let base = url.deletingLastPathComponent().deletingLastPathComponent()
                    let key = url.deletingPathExtension().lastPathComponent.replacingOccurrences(of: "_", with: "/")
                    guard let keyData = Data(base64Encoded: key), let docName = String(data: keyData, encoding: .utf8),
                          let data = try? Data(contentsOf: url),
                          let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { continue }
                    let prefix = base.path == library.path ? "" : base.path.replacingOccurrences(of: library.path + "/", with: "") + "/"
                    let items: [[String: Any]] = list.map { item in
                        var out: [String: Any] = [:]
                        for k in ["created", "tz", "kind", "note"] { if let v = item[k] { out[k] = v } }
                        out["replies"] = (item["replies"] as? [[String: Any]] ?? []).map { ["by": $0["by"] ?? "", "at": $0["at"] ?? ""] }
                        return out
                    }
                    notes.append(["rel": prefix + docName, "items": items])
                }
            }
            let payload: [String: Any] = ["date": date, "hasUsage": hasUsage, "segments": segments, "notes": notes]
            DispatchQueue.main.async {
                guard let self, let data = try? JSONSerialization.data(withJSONObject: [payload]),
                      let json = String(data: data, encoding: .utf8) else { return }
                self.runJS("window.__timelineData && window.__timelineData(\(json)[0]);")
            }
        }
    }

    // ────────── 图谱（0.6）：读几篇的全文给页面拆观点（每一版的 ## 1. 2. 3.），只读库里的 ──────────
    private func loadGraph(_ body: Any) {
        guard let payload = body as? [String: Any], let paths = payload["paths"] as? [String],
              let library = currentFolderURL else { return }
        let token = payload["token"] ?? 0
        let root = library.standardizedFileURL.path + "/"
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var files: [String: String] = [:]
            for path in paths.prefix(400) {
                let url = URL(fileURLWithPath: path).standardizedFileURL
                guard url.path.hasPrefix(root), let text = try? String(contentsOf: url, encoding: .utf8) else { continue }
                files[path] = text
            }
            DispatchQueue.main.async {
                guard let self, let data = try? JSONSerialization.data(withJSONObject: [["token": token, "files": files]]),
                      let json = String(data: data, encoding: .utf8) else { return }
                self.runJS("window.__graphData && window.__graphData(\(json)[0]);")
            }
        }
    }

    private func runJS(_ script: String) {
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    @objc private func menuOpenFile() { runJS("window.__paperOpenFile();") }
    @objc private func menuOpenFolder() { runJS("window.__paperOpenFolder();") }
    @objc private func menuSave() { runJS("window.__paperSave && window.__paperSave();") }
    @objc private func menuReload() { runJS("window.__paperReload && window.__paperReload();") }
    @objc private func menuFind() { runJS("window.__anewFind && window.__anewFind();") }
    @objc private func menuFindNext() { runJS("window.__anewFindStep && window.__anewFindStep(1);") }
    @objc private func menuFindPrevious() { runJS("window.__anewFindStep && window.__anewFindStep(-1);") }
    @objc private func menuToggleEdit() { runJS("window.__paperToggleEdit && window.__paperToggleEdit();") }
    @objc private func menuZoomIn() { runJS("window.__paperZoom && window.__paperZoom(1);") }
    @objc private func menuZoomOut() { runJS("window.__paperZoom && window.__paperZoom(-1);") }
    @objc private func menuToggleTheme() { runJS("window.__paperTheme && window.__paperTheme();") }
    @objc private func menuAddNote() { runJS("window.__paperAddNote && window.__paperAddNote();") }
    @objc private func menuCopyForModel() { runJS("window.__paperCopyForModel && window.__paperCopyForModel();") }

    private func sendSaveStatus(_ state: String, message: String, logs: [[String: String]] = []) {
        let payload: [String: Any] = ["state": state, "message": message, "logs": logs]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.saveStatus(\(json));")
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: L("继续", "Continue"))
        alert.addButton(withTitle: L("取消", "Cancel"))
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = prompt
        let field = textField(defaultText ?? "", placeholder: "")
        alert.accessoryView = field
        alert.addButton(withTitle: L("好", "OK"))
        alert.addButton(withTitle: L("取消", "Cancel"))
        alert.window.initialFirstResponder = field
        completionHandler(alert.runModal() == .alertFirstButtonReturn ? field.stringValue : nil)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: L("好", "OK"))
        alert.runModal()
        completionHandler()
    }
}

let application = NSApplication.shared
application.setActivationPolicy(.regular)
let delegate = MainActor.assumeIsolated { AppDelegate() }
application.delegate = delegate
application.run()
