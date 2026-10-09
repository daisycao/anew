const content = document.querySelector('#content');
const editor = document.querySelector('#editor');
const editorPanel = document.querySelector('#editor-panel');
const title = document.querySelector('#document-name');
const libraryTitle = document.querySelector('#library-title');
const fileTree = document.querySelector('#file-tree');
const searchWrap = document.querySelector('#search-wrap');
const searchInput = document.querySelector('#library-search');
const tagSection = document.querySelector('#tag-section');
const tagList = document.querySelector('#tag-list');
const bookMeta = document.querySelector('#book-meta');
const crumb = document.querySelector('#crumb');
const wordCount = document.querySelector('#word-count');
const inspectorTitle = document.querySelector('#inspector-title');
const documentInfo = document.querySelector('#document-info');
const tagsSection = document.querySelector('#document-tags-section');
const documentTags = document.querySelector('#document-tags');
const linksSection = document.querySelector('#links-section');
const pageLinks = document.querySelector('#page-links');
const logsSection = document.querySelector('#logs-section');
const changeLogs = document.querySelector('#change-logs');
const editButton = document.querySelector('#edit');
const saveButton = document.querySelector('#save');
const saveState = document.querySelector('#save-state');

let fontScale = Number(localStorage.fontScale) || 1;
let hasDocument = false;
let isEditing = false;
let dirty = false;
let activeDocument = null;
let libraryDocuments = [];
let activeTag = '';
let recentLibraries = [];

const message = name => window.webkit.messageHandlers[name].postMessage({});
function confirmLeavingDocument(action) {
  if (importingImages) { showNotice(L('图片正在插入，请稍候', 'Inserting images, one moment')); return false; }
  if (notesSaving) { showNotice(L('回响正在保存，请稍候', 'Saving annotations, one moment')); return false; }
  return !(dirty || notesDirty || commentInput.value.trim() || noteInput.value.trim()) || confirm(L(`当前内容尚未保存，仍要${action}吗？`, `You have unsaved changes. ${action} anyway?`));
}
const openFile = () => { if (confirmLeavingDocument(L('打开另一个文件', 'Open another file'))) message('openFile'); };
const openFolder = () => { if (confirmLeavingDocument(L('打开新的书库', 'Open another library'))) message('openFolder'); };

/* ── 刷新：重新从磁盘读一遍当前书库和当前文件，保留滚动位置 ── */
let pendingScroll = null;
function hasUnsavedWork() {
  return !!(importingImages || dirty || notesDirty || notesSaving || commentInput.value.trim() || noteInput.value.trim());
}
function reloadCurrent(silent) {
  if (!hasDocument && !libraryDocuments.length) return;
  if (!silent && !confirmLeavingDocument(L('重新读取', 'Reload'))) return;
  pendingScroll = window.scrollY;
  window.webkit.messageHandlers.reloadCurrent.postMessage({});
}
// 原生在窗口重新激活时问一句：现在能不能悄悄刷新
window.__paperCanAutoReload = () => hasDocument && !isEditing && !blockEditing && !hasUnsavedWork();
window.__paperAutoReload = () => { pendingScroll = window.scrollY; window.webkit.messageHandlers.reloadCurrent.postMessage({ silent: true }); };
window.__paperReload = () => reloadCurrent(false);

/* ── 书架：左边最上面那一层，列着用户自己挑进来的几本书；
      回到书架时，中间也换成一面真正的书架，一本本封面立在木板上 ── */
let shelfBooks = [];
let currentLibraryPath = '';
let titleBeforeShelf = '';
const shelfPanel = document.querySelector('#shelf');
const shelfList = document.querySelector('#shelf-list');
const backToShelf = document.querySelector('#back-to-shelf');
const bookshelfView = document.querySelector('#bookshelf-view');
const bookThumb = document.querySelector('#book-thumb');

const COVER_COLORS = ['#4a6670', '#7a3b3b', '#3d4f6b', '#8a6a3a', '#4e6a53', '#5c4a6b', '#6b5a48', '#2f5a5a'];
function coverColor(book) {
  if (book.color) return book.color;
  let hash = 0;
  for (const ch of String(book.name || '')) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return COVER_COLORS[hash % COVER_COLORS.length];
}
function chineseNumber(n) {
  const digits = '零一二三四五六七八九';
  if (n < 10) return digits[n];
  if (n < 20) return '十' + (n % 10 ? digits[n % 10] : '');
  if (n < 100) return digits[Math.floor(n / 10)] + '十' + (n % 10 ? digits[n % 10] : '');
  return String(n);
}
function bookSize(book) {
  if (!book.exists) return L('文件夹找不到了', 'Folder not found');
  return book.volumes ? L(`${chineseNumber(book.volumes)}卷`, `${book.volumes} volumes`) : L(`${book.count} 篇`, `${book.count} docs`);
}
function isOpenBook(book) { return book.path === currentLibraryPath && libraryDocuments.length > 0; }

function showShelf() {
  shelfPanel.hidden = false;
  backToShelf.hidden = true;
  if (bookThumb) bookThumb.hidden = true;
  document.querySelector('#search-wrap').hidden = true;
  document.querySelector('#file-tree').hidden = true;
  document.querySelector('#tag-section').hidden = true;
  document.querySelector('#recent-libraries').hidden = true;
  document.querySelector('.library-actions').hidden = shelfBooks.length > 0;
  libraryTitle.textContent = L('书架', 'Shelf');
  if (!document.body.classList.contains('shelf-mode')) titleBeforeShelf = title.textContent;
  document.body.classList.add('shelf-mode');
  bookshelfView.hidden = false;
  title.textContent = L('书架', 'Shelf');
  paintBookshelf();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function showTree() {
  shelfPanel.hidden = true;
  backToShelf.hidden = !shelfBooks.length;
  document.querySelector('#search-wrap').hidden = false;
  document.querySelector('#file-tree').hidden = false;
  document.querySelector('.library-actions').hidden = true;
  if (document.body.classList.contains('shelf-mode')) {
    document.body.classList.remove('shelf-mode');
    bookshelfView.hidden = true;
    if (titleBeforeShelf) title.textContent = titleBeforeShelf;
  }
  paintBookThumb();
  renderTagList();
}
function openBook(path) {
  const book = shelfBooks.find(item => item.path === path);
  if (book && isOpenBook(book)) {           // 就是正在读的这本：直接回去，不重新加载
    libraryTitle.textContent = book.name;
    showTree();
    return;
  }
  if (!confirmLeavingDocument(L('打开另一本书', 'Open another book'))) return;
  window.webkit.messageHandlers.shelfOpen.postMessage({ path });
}
function changeCover(path) { window.webkit.messageHandlers.shelfSetCover.postMessage({ path }); }
function changeCoverWithFile(path, file) {
  const reader = new FileReader();
  reader.onload = () => {
    const base64 = String(reader.result || '').split(',')[1] || '';
    const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || file.type.split('/')[1] || 'png').toLowerCase();
    window.webkit.messageHandlers.shelfSetCover.postMessage({ path, data: base64, ext });
  };
  reader.onerror = () => showNotice(L('这张图读不出来，换一张试试', 'Can\'t read this image, try another'));
  reader.readAsDataURL(file);
}
function removeBook(path) { window.webkit.messageHandlers.shelfRemove.postMessage({ path }); }

function paintShelf() {
  if (!shelfList) return;
  if (!shelfBooks.length) {
    shelfList.innerHTML = `<div class="shelf-empty">${L('书架还是空的。把一本书所在的文件夹加进来，以后就在这里点开——它记的是文件夹，书放在硬盘哪儿都行。', 'The shelf is empty. Add a folder and open it from here later — it remembers the folder, wherever it lives.')}</div>`;
    return;
  }
  shelfList.innerHTML = shelfBooks.map(book => `
    <button class="shelf-item${book.exists ? '' : ' missing'}${isOpenBook(book) ? ' current' : ''}" data-path="${escapeHTML(book.path)}" title="${escapeHTML(book.folderName || '')}">
      <span class="shelf-spine" style="--cover:${escapeHTML(coverColor(book))}"></span>
      <span class="shelf-copy">
        <strong>${escapeHTML(book.name)}</strong>
        <small>${escapeHTML(bookSize(book))}${book.exists && book.updated ? ' · ' + escapeHTML(book.updated) + L('改过', ' edited') : ''}</small>
      </span>
      <span class="shelf-drop" role="button" title="${L('从书架拿走（不动硬盘上的文件）', 'Remove from shelf (files stay on disk)')}" data-remove="${escapeHTML(book.path)}">×</span>
    </button>`).join('');
  shelfList.querySelectorAll('.shelf-item').forEach(item => {
    item.onclick = event => {
      const removePath = event.target?.dataset?.remove;
      if (removePath) { event.stopPropagation(); removeBook(removePath); return; }
      openBook(item.dataset.path);
    };
  });
}
function coverHTML(book) {
  const name = String(book.name || '');
  const sizeClass = name.length > 8 ? ' tiny' : name.length > 5 ? ' small' : '';
  const image = book.coverImage ? ` has-image" style="--cover:${escapeHTML(coverColor(book))};background-image:url('${book.coverImage}')` : `" style="--cover:${escapeHTML(coverColor(book))}`;
  return `
    <span class="cover${book.exists ? '' : ' missing'}${image}">
      ${book.coverImage ? '' : `<span class="cover-label${sizeClass}">${escapeHTML(name)}</span>`}
      <span class="cover-foot">${escapeHTML(bookSize(book))}</span>
      ${isOpenBook(book) ? `<span class="cover-ribbon" title="${L('正在读', 'Reading')}"></span>` : ''}
      <span class="cover-drop" role="button" title="${L('从书架拿走（不动硬盘上的文件）', 'Remove from shelf (files stay on disk)')}" data-remove="${escapeHTML(book.path)}">×</span>
      ${book.exists ? `<span class="cover-change" role="button" title="${L('选一张图做封面，也可以直接把图拖到封面上', 'Pick a cover image, or drop one on the cover')}" data-cover="${escapeHTML(book.path)}">${L('换封面', 'Change cover')}</span>` : ''}
    </span>`;
}
function paintBookshelf() {
  if (!bookshelfView) return;
  const books = shelfBooks.map(book => `
    <button class="shelf-book${isOpenBook(book) ? ' current' : ''}" data-path="${escapeHTML(book.path)}" title="${escapeHTML(book.folderName || book.name)}">
      ${coverHTML(book)}
      <span class="shelf-book-caption">${book.exists ? (isOpenBook(book) ? L('正在读', 'Reading') : (book.updated ? escapeHTML(book.updated) + L('改过', ' edited') : '')) : L('文件夹找不到了', 'Folder not found')}</span>
    </button>`).join('');
  bookshelfView.innerHTML = `
    <header class="bookshelf-head">
      <h1>${L('书架', 'Shelf')}</h1>
      <p>${shelfBooks.length ? L(`${shelfBooks.length} 本书 · 点一本打开`, `${shelfBooks.length} books · click one to open`) : L('还没有书。把一本书所在的文件夹放上来。', 'No books yet. Add a folder.')}</p>
    </header>
    <div class="bookshelf-rows">
      ${books}
      <button class="shelf-book shelf-book-add" id="bookshelf-add">
        <span class="cover cover-empty"><span>＋</span><small>${L('放一本书上来', 'Add a book')}</small></span>
        <span class="shelf-book-caption">&nbsp;</span>
      </button>
    </div>`;
  bookshelfView.querySelectorAll('.shelf-book[data-path]').forEach(item => {
    item.onclick = event => {
      const removePath = event.target?.dataset?.remove;
      if (removePath) { event.stopPropagation(); removeBook(removePath); return; }
      const coverPath = event.target?.dataset?.cover;
      if (coverPath) { event.stopPropagation(); changeCover(coverPath); return; }
      openBook(item.dataset.path);
    };
    // 把图片直接拖到封面上也能换
    item.addEventListener('dragover', event => {
      if (![...(event.dataTransfer?.items || [])].some(i => i.kind === 'file')) return;
      event.preventDefault(); event.stopPropagation(); item.classList.add('drop-target');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drop-target'));
    item.addEventListener('drop', event => {
      event.preventDefault(); event.stopPropagation(); item.classList.remove('drop-target');
      const file = [...(event.dataTransfer?.files || [])].find(f => f.type.startsWith('image/'));
      if (!file) { showNotice(L('拖进来的不是图片', 'That\'s not an image')); return; }
      changeCoverWithFile(item.dataset.path, file);
    });
  });
  bookshelfView.querySelector('#bookshelf-add').onclick = () => { if (confirmLeavingDocument(L('加一本新书', 'Add a book'))) window.webkit.messageHandlers.shelfAdd.postMessage({}); };
}
/* 书库左上角：书名前面一枚小封面 */
function paintBookThumb() {
  if (!bookThumb) return;
  const book = shelfBooks.find(item => item.path === currentLibraryPath);
  if (!currentLibraryPath || !libraryDocuments.length) { bookThumb.hidden = true; return; }
  const color = coverColor(book || { name: libraryTitle.textContent, color: currentLibraryColor });
  bookThumb.style.setProperty('--cover', color);
  const image = book?.coverImage || currentLibraryCover;
  bookThumb.classList.toggle('has-image', Boolean(image));
  bookThumb.style.backgroundImage = image ? `url('${image}')` : '';
  document.querySelector('.library').style.setProperty('--book', color);
  bookThumb.hidden = false;
}
if (bookThumb) {
  bookThumb.title = L('换封面', 'Change cover');
  bookThumb.onclick = () => { if (currentLibraryPath) changeCover(currentLibraryPath); };
}
let currentLibraryColor = '';
let currentLibraryCover = '';
window.renderShelf = books => {
  shelfBooks = Array.isArray(books) ? books : [];
  paintShelf();
  if (!hasDocument && !libraryDocuments.length) showShelf();
  else {
    backToShelf.hidden = document.body.classList.contains('shelf-mode') || !shelfBooks.length;
    if (document.body.classList.contains('shelf-mode')) paintBookshelf(); else paintBookThumb();
  }
};
document.querySelector('#shelf-add').onclick = () => { if (confirmLeavingDocument(L('加一本新书', 'Add a book'))) window.webkit.messageHandlers.shelfAdd.postMessage({}); };
backToShelf.onclick = () => showShelf();
for (const id of ['open-folder', 'choose-folder', 'choose-folder-main']) document.querySelector(`#${id}`).onclick = openFolder;
for (const id of ['open-file', 'choose-file', 'choose-file-main']) document.querySelector(`#${id}`).onclick = openFile;
document.querySelector('#refresh').onclick = () => reloadCurrent(false);
document.querySelector('#small').onclick = () => setScale(fontScale - .05);
document.querySelector('#large').onclick = () => setScale(fontScale + .05);
document.querySelector('#theme').onclick = () => { document.documentElement.classList.toggle('night'); localStorage.night = document.documentElement.classList.contains('night') ? '1' : '0'; };
editButton.onclick = () => toggleEditor();
saveButton.onclick = saveDocument;
searchInput.addEventListener('input', renderTree);
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); openFile(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveDocument(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'e') { event.preventDefault(); toggleEditor(); }
});
if (localStorage.night === '1') document.documentElement.classList.add('night');
function setScale(value) { fontScale = Math.max(.85, Math.min(1.25, +value.toFixed(2))); document.documentElement.style.setProperty('--font-scale', fontScale); localStorage.fontScale = fontScale; }
setScale(fontScale);

function toggleEditor() {
  if (!hasDocument) return;
  if (importingImages) { showNotice(L('图片正在插入，请稍候', 'Inserting images, one moment')); return; }
  // 两个锚点都必须在切模式之前量：
  // 切过去以后另一边就 display:none 了，隐藏元素的 scrollTop 会被浏览器清零，
  // 量到的永远是 0，于是回阅读模式就跳回文章开头。
  const anchor = isEditing ? null : previewAnchor();   // 阅读 → 编辑
  const back   = isEditing ? editorAnchor()  : null;   // 编辑 → 阅读
  isEditing = !isEditing;
  document.body.classList.toggle('edit-mode', isEditing);
  editButton.textContent = isEditing ? L('阅读', 'Read') : L('编辑', 'Edit');
  editButton.classList.toggle('active', isEditing);
  saveButton.disabled = !dirty;
  documentInfo.innerHTML = `<div><dt>${L('模式', 'Mode')}</dt><dd>${isEditing ? L('编辑中', 'Editing') : L('阅读', 'Reading')}</dd></div><div><dt>${L('状态', 'Status')}</dt><dd>${dirty ? L('未保存', 'Unsaved') : L('已保存', 'Saved')}</dd></div>`;
  if (isEditing) {
    editor.focus();
    const offset = charOffsetOfLine(editor.value, anchor ? anchor.line : 0);
    editor.setSelectionRange(offset, offset);   // 光标落在你刚才在看的那一行
    scrollEditorToLine(anchor ? anchor.line : 0, anchor ? anchor.gap : 0);
  } else {
    renderPreview(editor.value);
    if (back) scrollPreviewToLine(back.line, back.gap);
  }
}

/* ── 阅读 ⇄ 编辑：保住你正在看的位置 ──
   两边各自滚各自的（阅读时滚 window，编辑时滚 textarea 自己），
   所以用「原文第几行」当中间量：正文每个块级元素都带 data-line，
   编辑器那边用一个同样字体宽度的镜像 div 量出每一行的高度。            */

function chromeTop() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--chrome-h');
  return parseFloat(value) || 90;
}

/** 阅读模式：视口顶部第一个还看得见的块，以及它离顶部还差多少 */
function previewAnchor() {
  const top = chromeTop();
  for (const el of content.querySelectorAll('[data-line]')) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom > top + 4) return { line: Number(el.dataset.line) || 0, gap: rect.top - top };
  }
  return null;
}

function charOffsetOfLine(text, line) {
  const lines = String(text).split('\n');
  let offset = 0;
  for (let n = 0; n < Math.min(line, lines.length); n++) offset += lines[n].length + 1;
  return offset;
}

/* 镜像 div：和 textarea 同字体、同宽、同 padding，用来量每一行的 offsetTop */
let editorMirrorEl = null;
function editorMirror() {
  if (!editorMirrorEl) {
    editorMirrorEl = document.createElement('div');
    editorMirrorEl.setAttribute('aria-hidden', 'true');
    editorMirrorEl.style.cssText =
      'position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;' +
      'white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;box-sizing:border-box;';
    document.body.appendChild(editorMirrorEl);
  }
  const style = getComputedStyle(editor);
  ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
   'wordSpacing', 'textIndent', 'tabSize',
   'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].forEach(key => { editorMirrorEl.style[key] = style[key]; });
  editorMirrorEl.style.width = `${editor.clientWidth}px`;   // clientWidth 已经刨掉滚动条
  return editorMirrorEl;
}

/** 每一行在 textarea 里的纵向位置（考虑软换行） */
function editorLineTops() {
  const mirror = editorMirror();
  mirror.textContent = '';
  const fragment = document.createDocumentFragment();
  for (const line of editor.value.split('\n')) {
    const span = document.createElement('span');
    span.textContent = line.length ? line : '\u200b';   // 空行也得占一行高
    fragment.appendChild(span);
    fragment.appendChild(document.createTextNode('\n'));
  }
  mirror.appendChild(fragment);
  return Array.from(mirror.children, span => span.offsetTop);
}

function scrollEditorToLine(line, gap) {
  const tops = editorLineTops();
  if (!tops.length) return;
  const target = tops[Math.min(Math.max(line, 0), tops.length - 1)] || 0;
  editor.scrollTop = Math.max(0, target - Math.max(0, gap || 0));
}

/** 编辑模式：textarea 顶部露出来的是第几行 */
function editorAnchor() {
  const tops = editorLineTops();
  const position = editor.scrollTop;
  let line = 0;
  for (let n = 0; n < tops.length; n++) { if (tops[n] <= position + 1) line = n; else break; }
  return { line, gap: position - (tops[line] || 0) };
}

function scrollPreviewToLine(line, gap) {
  let target = null;
  for (const el of content.querySelectorAll('[data-line]')) {
    if ((Number(el.dataset.line) || 0) <= line) target = el; else break;
  }
  if (!target) { window.scrollTo({ top: 0, behavior: 'instant' }); return; }
  const top = window.scrollY + target.getBoundingClientRect().top - chromeTop() + Math.max(0, gap || 0);
  window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
}

editor.addEventListener('input', () => {
  dirty = editor.value !== (activeDocument?.content || '');
  saveButton.disabled = !dirty;
  saveState.textContent = dirty ? L('未保存', 'Unsaved') : L('已保存', 'Saved');
  saveState.className = dirty ? 'unsaved' : 'saved';
  documentInfo.innerHTML = `<div><dt>${L('模式', 'Mode')}</dt><dd>${isEditing ? L('编辑中', 'Editing') : L('阅读', 'Reading')}</dd></div><div><dt>${L('状态', 'Status')}</dt><dd>${dirty ? L('未保存', 'Unsaved') : L('已保存', 'Saved')}</dd></div>`;
});

function saveDocument() {
  if (importingImages) { showNotice(L('图片正在插入，请稍候再保存', 'Inserting images — save in a moment')); return; }
  if (!hasDocument || !dirty) return;
  window.webkit.messageHandlers.saveDocument.postMessage({ content: editor.value });
  saveState.textContent = L('正在保存…', 'Saving…'); saveState.className = 'saving'; saveButton.disabled = true;
}

window.saveStatus = ({ state, message, logs }) => {
  saveState.textContent = message; saveState.className = state;
  if (state === 'saved') {
    dirty = false;
    activeDocument.content = editor.value;
    activeDocument.logs = logs || activeDocument.logs || [];
    renderLogs(activeDocument.logs);
  }
  saveButton.disabled = !dirty;
  documentInfo.innerHTML = `<div><dt>${L('模式', 'Mode')}</dt><dd>${isEditing ? L('编辑中', 'Editing') : L('阅读', 'Reading')}</dd></div><div><dt>${L('状态', 'Status')}</dt><dd>${state === 'saved' ? L('已保存', 'Saved') : message}</dd></div>`;
};

const escapeHTML = value => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function titleFor(doc) { return (doc.frontmatter?.title || doc.name || '').replace(/\.(md|markdown|mdown|mkdn)$/i, ''); }
function parseDocument(raw) {
  const document = { ...raw, content: raw.content || '', tags: [], links: [], frontmatter: {} };
  const header = document.content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (header) {
    header[1].split('\n').forEach(line => { const match = line.match(/^([\w-]+):\s*(.+)$/); if (match) document.frontmatter[match[1]] = match[2].trim(); });
    document.body = document.content.slice(header[0].length);
    const tagValue = document.frontmatter.tags || '';
    document.tags.push(...tagValue.replace(/[\[\]]/g, '').split(',').map(tag => tag.trim().replace(/^#/, '')).filter(Boolean));
  } else document.body = document.content;
  document.tags.push(...[...document.body.matchAll(/(^|\s)#([\p{L}\p{N}_/-]+)/gu)].map(match => match[2]));
  document.tags = [...new Set(document.tags)];
  document.links = [...new Set([...document.body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map(match => match[1].trim()))];
  return document;
}
function internalTarget(label) {
  let decoded = label; try { decoded = decodeURIComponent(label); } catch {}
  const normalized = decoded.replace(/\.md$/i, '').toLowerCase();
  return libraryDocuments.find(doc => titleFor(doc).toLowerCase() === normalized || (doc.relativePath || '').replace(/\.md$/i, '').toLowerCase().endsWith(normalized));
}
function openNativeDocument(doc) { if (!confirmLeavingDocument(L('切换文件', 'Switch file'))) return; window.webkit.messageHandlers.openDocument.postMessage({ path: doc.path }); }
function inline(text) {
  // Protect code and generated tags from subsequent Markdown substitutions.
  const tokens = [];
  const token = html => { tokens.push(html); return `\u0000${tokens.length - 1}\u0000`; };
  let value = String(text).replace(/`([^`]+)`/g, (_match, code) => token(`<code>${escapeHTML(code)}</code>`));
  value = value.replace(/!\[([^\]]*)\]\(([^\s)]+)\)/g, (match, alt, source) => {
    const src = imageSource(source);
    return src ? token(`<img src="${escapeHTML(src)}" data-image-source="${escapeHTML(source)}" alt="${escapeHTML(alt)}">`) : match;
  });
  value = escapeHTML(value);
  value = value.replace(/&lt;br\s*\/?&gt;/gi, '<br>');   // 表格格子里用 <br> 换行（和 Obsidian 一样）
  value = value.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (_match, label, href) => token(`<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`));
  // 裸网址也能点（中文标点、右括号不算进网址）
  value = value.replace(/https?:\/\/(?:(?!&quot;|&#39;|&lt;|&gt;)[^\s<>"'）】」，。；！？、])+/g, match => { const href = match.replace(/[.,;:!?)]+$/, ''); return token(`<a href="${href}" target="_blank" rel="noopener noreferrer">${href}</a>`) + match.slice(href.length); });
  value = value.replace(/\[([^\]]+)\]\(([^)]+?\.(?:md|markdown))\)/gi, (_match, label, href) => `<button class="wikilink" data-target="${href.replace(/^\.\//, '')}">${label}</button>`);
  value = value.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target, label) => `<button class="wikilink" data-target="${target}">${label || target}</button>`);
  value = value.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  value = value.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  value = value.replace(/(^|\s)#([\p{L}\p{N}_/-]+)/gu, (_match, space, tag) => `${space}<button class="tag-inline" data-tag="${tag}">#${tag}</button>`);
  value = value.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>').replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>');
  return value.replace(/\u0000(\d+)\u0000/g, (_match, index) => tokens[Number(index)]);
}
/* 块级解析：标题 1–6 级、代码块、分隔线、表格、引用（可嵌套）、列表（可嵌套、带续行）、段落。
   顶层每个块带 data-line（原文第几行），阅读 ⇄ 编辑定位和批注都靠它；嵌套在里面的块不带。 */
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
function splitRow(line) {
  const cells = []; let cell = ''; const text = line.trim().replace(/^\|/, '').replace(/(^|[^\\])\|$/, '$1');
  for (let k = 0; k < text.length; k++) {
    if (text[k] === '\\' && text[k + 1] === '|') { cell += '|'; k++; }
    else if (text[k] === '|') { cells.push(cell.trim()); cell = ''; }
    else cell += text[k];
  }
  cells.push(cell.trim()); return cells;
}
function startsBlock(lines, i) {
  const line = lines[i];
  return /^\s{0,3}(#{1,6}\s|```|~~~|>)/.test(line) || LIST_ITEM.test(line) || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)
    || (line.includes('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]) && lines[i + 1].includes('-'));
}
function indentOf(line) { return line.match(/^\s*/)[0].replace(/\t/g, '    ').length; }
function stripIndent(line, n) { let k = 0, w = 0; while (k < line.length && w < n && (line[k] === ' ' || line[k] === '\t')) { w += line[k] === '\t' ? 4 : 1; k++; } return line.slice(k); }
function parseBlocks(lines, base, top) {
  let html = ''; let i = 0;
  const mark = at => top ? ` data-line="${base + at}"` : '';
  const paragraph = (values, at) => `<p${mark(at)}>${inline(values.map(v => v.trim()).join('\n'))}</p>`;
  while (i < lines.length) {
    const line = lines[i]; if (!line.trim()) { i++; continue; }
    const at = i;
    const fence = line.match(/^\s*(```|~~~)(.*)$/);
    if (fence) { const block = []; i++; while (i < lines.length && !lines[i].trim().startsWith(fence[1])) block.push(lines[i++]); i++; html += `<pre${mark(at)}><code class="language-${escapeHTML(fence[2].trim())}">${escapeHTML(block.join('\n'))}</code></pre>`; continue; }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) { const level = heading[1].length; html += `<h${level}${mark(at)}>${inline(heading[2])}</h${level}>`; i++; continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { html += `<hr${mark(at)}>`; i++; continue; }
    if (line.includes('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = splitRow(line); const align = splitRow(lines[i + 1]).map(c => /^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : '');
      i += 2; const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i++]));
      // 整列都短（≤ 8 个字，比如「和我有关」「★★★」）的列不折行，免得被长列挤成一个字一行
      const shown = v => Math.max(0, ...(v || '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*`]/g, '').split(/<br\s*\/?>/i).map(s => s.trim().length));
      const short = head.map((c, k) => [c, ...rows.map(r => r[k])].every(v => shown(v) <= 8));
      const cell = (tag, value, k) => `<${tag}${(k === 0 && (value || '').length <= 12) || short[k] ? ' class="nowrap"' : ''}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(value || '')}</${tag}>`;   // 第一列短的（日期、标签）不折行
      const thead = head.some(Boolean) ? `<thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead>` : '';
      html += `<table${mark(at)}>${thead}<tbody>${rows.map(r => `<tr>${head.map((_, k) => cell('td', r[k], k)).join('')}</tr>`).join('')}</tbody></table>`;
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      const block = [];
      while (i < lines.length && lines[i].trim() && (/^\s{0,3}>/.test(lines[i]) || !startsBlock(lines, i))) block.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
      // > [!claude] 标题 —— 批注卡片（Obsidian / GitHub 的 callout 写法），别的软件里退化成普通引用
      const callout = block[0].match(/^\[!([\w\u4e00-\u9fa5-]+)\]\s*(.*)$/);
      if (callout) {
        const type = callout[1].toLowerCase();
        const label = callout[2] || ({ claude: 'Claude', note: L('注', 'Note'), tip: L('提示', 'Tip'), warning: L('注意', 'Warning') }[type] || callout[1]);
        html += `<aside class="callout callout-${escapeHTML(type)}"${mark(at)}><div class="callout-title">${inline(label)}</div>${parseBlocks(block.slice(1), 0, false)}</aside>`; continue;
      }
      html += `<blockquote${mark(at)}>${parseBlocks(block, 0, false).replace(/<p>(——|—\s)/g, '<p class="source">$1')}</blockquote>`; continue;   // 「—— 出处」那一段靠右
    }
    const first = line.match(LIST_ITEM);
    if (first) {
      const baseIndent = indentOf(line); const ordered = /\d/.test(first[2]); const items = []; let loose = false; let item = null;
      while (i < lines.length) {
        const current = lines[i]; const m = current.match(LIST_ITEM);
        if (m && indentOf(current) <= baseIndent + 1 && /\d/.test(m[2]) === ordered) {
          item = { lines: [m[3]], indent: indentOf(current) + m[2].length + 1 }; items.push(item); i++; continue;
        }
        if (m && indentOf(current) <= baseIndent + 1) break;           // 换了一种列表
        if (!current.trim()) {
          let next = i + 1; while (next < lines.length && !lines[next].trim()) next++;
          if (next < lines.length && (indentOf(lines[next]) > baseIndent + 1 || (LIST_ITEM.test(lines[next]) && indentOf(lines[next]) <= baseIndent + 1 && /\d/.test(lines[next].match(LIST_ITEM)[2]) === ordered))) {
            if (indentOf(lines[next]) <= baseIndent + 1) loose = true;
            for (; i < next; i++) item.lines.push(''); continue;
          }
          break;
        }
        if (indentOf(current) > baseIndent + 1) { item.lines.push(stripIndent(current, Math.min(item.indent, indentOf(current)))); i++; continue; }
        if (item.lines[item.lines.length - 1].trim() && !startsBlock(lines, i)) { item.lines.push(current.trim()); i++; continue; }   // 懒续行
        break;
      }
      const start = ordered && parseInt(first[2], 10) !== 1 ? ` start="${parseInt(first[2], 10)}"` : '';
      const body = items.map(entry => {
        let text = entry.lines.join('\n');
        let box = '';
        text = text.replace(/^\[([ xX])\]\s+/, (_m, x) => { box = `<input type="checkbox"${x === ' ' ? '' : ' checked'} disabled> `; return ''; });
        let inner = parseBlocks(text.split('\n'), 0, false);
        if (!loose) inner = inner.replace(/^<p>([\s\S]*?)<\/p>/, '$1');
        return `<li>${box}${inner}</li>`;
      }).join('');
      html += `<${ordered ? 'ol' : 'ul'}${mark(at)}${start}>${body}</${ordered ? 'ol' : 'ul'}>`; continue;
    }
    const block = [line]; i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) block.push(lines[i++]);
    html += paragraph(block, at);
  }
  return html;
}
function markdownToHTML(markdown) {
  return parseBlocks(String(markdown).replace(/\r\n?/g, '\n').split('\n'), 0, true);
}
/** 正文（去掉 frontmatter 之后）在整份原文里从第几行开始 */
function bodyLineOffset(markdown) {
  const header = String(markdown || '').match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  return header ? header[0].split('\n').length - 1 : 0;
}
function renderPreview(markdown) {
  content.innerHTML = markdownToHTML(parseDocument({ content: markdown }).body);
  const lineShift = bodyLineOffset(markdown);
  if (lineShift) content.querySelectorAll('[data-line]').forEach(el => { el.dataset.line = String(Number(el.dataset.line) + lineShift); });
  content.className = 'content';
  content.querySelectorAll('img').forEach(img => { img.onerror = () => { img.classList.add('image-error'); img.title = L(`图片读取失败：${img.dataset.imageSource}`, `Couldn't load image: ${img.dataset.imageSource}`); showNotice(img.title); }; });
  content.querySelectorAll('.wikilink').forEach(button => button.onclick = () => { const target = internalTarget(button.dataset.target); if (target) openNativeDocument(target); });
  requestAnimationFrame(() => alignTables(content));
  document.fonts?.ready.then(() => alignTables(content));
}
/** 表头一样的几张表（比如按地区拆开的书单）用同一套列宽，上下好对着看。
 *  每列按整组里最宽的那格量：短列（★★、✅中）给够不折行，剩下的宽度按内容多少分给长列，长列之间拉平一点 */
let measureCanvas, alignedWidth = 0;
new ResizeObserver(() => { if (content.clientWidth && content.clientWidth !== alignedWidth) alignTables(content); }).observe(content);   // 窗口、右栏开合变宽窄时重排
function alignTables(root) {
  if (root === content) alignedWidth = content.clientWidth;
  const groups = new Map();
  root.querySelectorAll('table').forEach(table => {
    const head = table.tHead?.rows[0]; if (!head || head.cells.length < 2) return;
    const key = [...head.cells].map(c => c.textContent.trim()).join('\u0001');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(table);
  });
  measureCanvas ||= document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  for (const tables of groups.values()) {
    if (tables.length < 2) continue;
    const sample = tables[0].querySelector('td') || tables[0].querySelector('th');
    const style = getComputedStyle(sample);
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const pad = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 2;
    const n = tables[0].tHead.rows[0].cells.length;
    const avail = tables[0].clientWidth; if (!avail) continue;
    const need = Array(n).fill(0), sizes = need.map(() => []);
    tables.forEach(t => [...t.rows].forEach(r => [...r.cells].forEach((c, k) => {
      const text = c.textContent.trim(); if (k >= n) return;
      const lines = c.querySelector('br') ? (c.innerText || text).split('\n') : [text];   // 格子里用 <br> 分了行的，按最长那行量
      const w = Math.max(...lines.map(s => ctx.measureText(s.trim()).width)) * (c.tagName === 'TH' ? 1.06 : 1) + pad;
      need[k] = Math.max(need[k], w);
      if (text && c.tagName === 'TD') sizes[k].push(Math.min(w, avail * 0.45));
    })));
    const typical = sizes.map((list, k) => list.length ? list.reduce((a, b) => a + b, 0) / list.length : need[k]);   // 平常一格多宽，偶尔一格特别长的折行就好
    const SHORT = Math.min(120, avail * 0.18);
    const short = need.map(w => w <= SHORT);
    const fixed = need.reduce((s, w, k) => s + (short[k] ? w : 0), 0);
    const width = need.slice();
    const longs = need.map((_, k) => k).filter(k => !short[k]);
    if (need.reduce((a, b) => a + b, 0) <= avail || !longs.length) {
      // 都放得下：多出来的宽度主要给长列，短列也稍微松一点
      const extra = avail - need.reduce((a, b) => a + b, 0);
      const weight = need.map((w, k) => short[k] ? w * 0.25 : w);
      const total = weight.reduce((a, b) => a + b, 0);
      need.forEach((w, k) => { width[k] = w + Math.max(0, extra) * weight[k] / total; });
    } else {
      // 放不下：短列给够，长列按平常一格多宽分剩下的
      const rest = Math.max(avail - fixed, longs.length * 80);
      const weight = longs.map(k => typical[k]);
      const total = weight.reduce((a, b) => a + b, 0);
      longs.forEach((k, i) => { width[k] = Math.min(need[k], rest * weight[i] / total); });
      const left = rest - longs.reduce((s, k) => s + width[k], 0);
      if (left > 1) longs.forEach((k, i) => { width[k] += left * weight[i] / total; });
    }
    const sum = width.reduce((a, b) => a + b, 0);
    tables.forEach(t => {
      t.querySelector(':scope > colgroup')?.remove();
      const cols = document.createElement('colgroup');
      width.forEach(w => { const col = document.createElement('col'); col.style.width = `${(w / sum * 100).toFixed(2)}%`; cols.appendChild(col); });
      t.prepend(cols);
      t.style.tableLayout = 'fixed';
      [...t.rows].forEach(r => [...r.cells].forEach((c, k) => { if (!short[k]) c.classList.remove('nowrap'); }));   // 长列宽度定死了，得能折行
    });
  }
}
function renderLogs(logs = []) {
  logsSection.hidden = !logs.length;
  changeLogs.innerHTML = logs.slice(0, 6).map(log => `<div class="log-item"><span class="log-time">${escapeHTML(log.time)}</span><span class="log-summary">${escapeHTML(log.summary)}</span></div>`).join('');
}
function renderInspector(doc) {
  inspectorTitle.innerHTML = `${escapeHTML(titleFor(doc))}<span class="inspector-chars">${L('字数：', 'Characters: ')}${doc.body.replace(/\s/g, '').length.toLocaleString()}</span>`;
  tagsSection.hidden = !doc.tags.length;
  documentTags.innerHTML = doc.tags.map(tag => `<button class="tag-pill" data-tag="${escapeHTML(tag)}">#${escapeHTML(tag)}</button>`).join('');
  documentTags.querySelectorAll('.tag-pill').forEach(button => button.onclick = () => filterTag(button.dataset.tag));
  linksSection.hidden = !doc.links.length;
  pageLinks.innerHTML = doc.links.map(link => `<button class="page-link" data-target="${escapeHTML(link)}">↗ ${escapeHTML(link)}</button>`).join('');
  pageLinks.querySelectorAll('.page-link').forEach(button => button.onclick = () => { const target = internalTarget(button.dataset.target); if (target) openNativeDocument(target); });
  renderLogs(doc.logs || []);
}
function selectDocument(doc) {
  // 同一篇重画（外面改了文件、批注存盘后监视器刷新）：原地不动，别跳回开头
  const sameDoc = activeDocument && activeDocument.path === doc.path ? window.scrollY : null;
  closeNotePopover();
  noteHint.hidden = true;
  commentInput.value = ''; commentInput.dispatchEvent(new Event('input'));
  notesDirty = false;
  activeDocument = doc; hasDocument = true; dirty = false; isEditing = false; document.body.classList.remove('edit-mode'); editButton.textContent = L('编辑', 'Edit'); editButton.classList.remove('active'); saveButton.disabled = true; saveState.textContent = '';
  editor.value = doc.content;
  renderPreview(doc.content);
  title.textContent = titleFor(doc); document.title = `${titleFor(doc)} · ${L('知新 Anew', 'Anew')}`;
  bookMeta.hidden = false; crumb.textContent = doc.relativePath || doc.name; wordCount.textContent = L(`${doc.body.replace(/\s/g, '').length.toLocaleString()} 字`, `${doc.body.replace(/\s/g, '').length.toLocaleString()} chars`);
  renderInspector(doc); renderTree();
  const restore = pendingScroll ?? sameDoc; pendingScroll = null;
  // 同一篇：renderPreview 已经按「看到第几段」对回去了（见文末），这里再按像素跳反而会错
  if (sameDoc == null) window.scrollTo({ top: restore == null ? 0 : restore, behavior: 'instant' });
}
/* 归档类文件夹（历史版本 / 快照 / 备份…）：稿子一个都不删，但书库里默认折叠、
   排在最后，开书时也不会跳进去。搜索或按标签筛的时候例外——有条件就全展开，
   否则收起来的分支里那些命中项根本看不见。 */
const ARCHIVE_FOLDER = /历史版本|历史稿|旧版|归档|备份|快照|archive|backup|old versions?/i;
function isArchiveFolder(name) { return ARCHIVE_FOLDER.test(name || ''); }
function isArchivedDoc(doc) {
  return (doc.relativePath || doc.name || '').split('/').slice(0, -1).some(isArchiveFolder);
}
function countFiles(branch) {
  return branch.files.length + Object.values(branch.folders).reduce((sum, child) => sum + countFiles(child), 0);
}
function buildTree(documents) {
  const root = { folders: {}, files: [] };
  documents.forEach(doc => { let cursor = root; const parts = (doc.relativePath || doc.name).split('/'); parts.slice(0, -1).forEach(part => cursor = cursor.folders[part] ||= { folders: {}, files: [] }); cursor.files.push(doc); });
  return root;
}
function renderBranch(branch, target, opts = {}) {
  const folders = Object.entries(branch.folders).sort(([a], [b]) => {
    const x = isArchiveFolder(a) ? 1 : 0, y = isArchiveFolder(b) ? 1 : 0;
    return x - y || a.localeCompare(b, 'zh-CN');
  });
  folders.forEach(([name, child]) => {
    const archived = opts.inArchive || isArchiveFolder(name);
    const details = document.createElement('details');
    details.open = opts.forceOpen === true || !archived;
    const summary = document.createElement('summary');
    summary.className = archived ? 'tree-folder tree-folder-archive' : 'tree-folder';
    const count = archived && !opts.inArchive ? countFiles(child) : 0;
    summary.innerHTML = `<span class="tree-icon">⌄</span>${escapeHTML(name)}${count ? `<span class="tree-size">${L(`${count} 篇`, `${count}`)}</span>` : ''}`;
    details.append(summary);
    const nested = document.createElement('div');
    nested.className = 'tree-children';
    renderBranch(child, nested, { ...opts, inArchive: archived });
    details.append(nested);
    target.append(details);
  });
  const sorted = branch.files.slice().sort((a, b) => {
    const x = docOrder(a), y = docOrder(b);
    return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2], 'zh-CN');
  });
  sorted.forEach((doc, index) => {
    const isAux = docOrder(doc)[0] === 1;
    if (isAux && index > 0 && docOrder(sorted[index - 1])[0] === 0) {
      const divider = document.createElement('div');
      divider.className = 'tree-divider';
      divider.textContent = L('其他文档', 'Other documents');
      target.append(divider);
    }
    const button = document.createElement('button');
    const size = doc.size == null ? '' : `<span class="tree-size">${formatSize(doc.size)}</span>`;
    const volume = !opts.inArchive && volumeParts(doc);
    if (volume) {
      // 一卷一卷：左边一道书脊，卷号小字在上，卷名在下
      button.className = `tree-file tree-volume${activeDocument?.path === doc.path ? ' active' : ''}`;
      button.innerHTML = `<span class="vol-spine"></span><span class="vol-copy"><span class="vol-no">${escapeHTML(volume.no)}</span><span class="vol-name">${escapeHTML(volume.name || volume.no)}</span></span>${size}`;
    } else {
      button.className = `tree-file${activeDocument?.path === doc.path ? ' active' : ''}${isAux ? ' aux' : ''}`;
      button.innerHTML = `<span class="tree-icon">◇</span><span class="tree-title">${escapeHTML(titleFor(doc))}</span>${size}`;
    }
    button.onclick = () => openNativeDocument(doc);
    target.append(button);
  });
}
function volumeParts(doc) {
  const match = titleFor(doc).match(/^(卷\s*[零〇一二三四五六七八九十百\d]+)(?:[_\-.·、\s]+(.*))?$/);
  return match ? { no: match[1].replace(/\s+/g, ''), name: (match[2] || '').trim() } : null;
}
function formatSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function renderTree() {
  fileTree.innerHTML = '';
  const query = searchInput.value.trim().toLowerCase(); const filtered = libraryDocuments.filter(doc => anewViewMatch(doc)).filter(doc => !activeTag || doc.tags.includes(activeTag)).filter(doc => !query || `${doc.relativePath || ''} ${titleFor(doc)} ${doc.tags.join(' ')} ${Object.values(doc.meta || {}).join(' ')}`.toLowerCase().includes(query));
  if (!filtered.length) { fileTree.innerHTML = `<div class="tree-empty">${L('打开一个文件夹后，章节、笔记和资料会在这里出现。', 'Open a folder and its notes and sources show up here.')}</div>`; return; }
  if (!query && !activeTag && !window.anewView && window.anewGroupedTree) { window.anewGroupedTree(filtered); return; }
  renderBranch(buildTree(filtered), fileTree, { forceOpen: Boolean(query || activeTag || window.anewView) });
}
function filterTag(tag) { activeTag = activeTag === tag ? '' : tag; tagList.querySelectorAll('.tag-pill').forEach(button => button.classList.toggle('active', button.dataset.tag === activeTag)); renderTree(); }
function renderTagList() { const tags = [...new Set(libraryDocuments.flatMap(doc => doc.tags))].sort((a,b) => a.localeCompare(b, 'zh-CN')); tagSection.hidden = !tags.length; tagList.innerHTML = tags.map(tag => `<button class="tag-pill" data-tag="${escapeHTML(tag)}">#${escapeHTML(tag)}</button>`).join(''); tagList.querySelectorAll('.tag-pill').forEach(button => button.onclick = () => filterTag(button.dataset.tag)); }
function paintRecentLibraries() {
  const section = document.querySelector('#recent-libraries');
  const list = document.querySelector('#recent-list');
  if (!section || !list) return;
  section.hidden = !recentLibraries.length;
  list.innerHTML = recentLibraries.map(item => `<button class="recent-item" data-path="${escapeHTML(item.path)}"><span class="recent-book">◇</span><span class="recent-copy"><strong>${escapeHTML(item.name)}</strong><small>${escapeHTML(item.path)}</small></span><span class="recent-arrow">↗</span></button>`).join('');
  list.querySelectorAll('.recent-item').forEach(button => button.onclick = () => { if (confirmLeavingDocument(L('打开新的书库', 'Open another library'))) window.webkit.messageHandlers.openRecentFolder.postMessage({ path: button.dataset.path }); });
}
window.renderRecentLibraries = entries => { recentLibraries = Array.isArray(entries) ? entries : []; paintRecentLibraries(); };
window.renderLibrary = library => {
  closeNotePopover(); noteHint.hidden = true;
  libraryDocuments = library.documents.map(parseDocument);
  currentLibraryPath = library.path || '';
  currentLibraryColor = library.color || '';
  currentLibraryCover = library.coverImage || '';
  if (!document.body.classList.contains('shelf-mode') || !library.keepingDocument) libraryTitle.textContent = library.name;
  searchWrap.hidden = false;
  document.querySelector('.library-actions').hidden = true;
  const archivedCount = libraryDocuments.filter(isArchivedDoc).length;
  document.querySelector('#library-footer').textContent = archivedCount
    ? L(`${libraryDocuments.length - archivedCount} 篇 Markdown · 另有 ${archivedCount} 篇历史版本`, `${libraryDocuments.length - archivedCount} Markdown files · ${archivedCount} old versions`)
    : L(`${libraryDocuments.length} 篇 Markdown · 按需打开`, `${libraryDocuments.length} Markdown files`);
  // 刷新的时候只更新左边的书库列表：不清空正在读的这一篇，也不跳回第一篇，
  // 正文由紧接着到达的 renderDocument 重画（滚动位置在 selectDocument 里还原）。
  if (library.keepingDocument) { renderTagList(); renderTree(); if (document.body.classList.contains('shelf-mode')) paintBookshelf(); return; }
  showTree();
  commentInput.value = ''; notesDirty = false;
  activeTag = '';
  activeDocument = null;
  hasDocument = false;
  dirty = false;
  isEditing = false;
  document.body.classList.remove('edit-mode');
  editButton.textContent = L('编辑', 'Edit');
  editButton.classList.remove('active');
  saveButton.disabled = true;
  saveState.textContent = '';
  editor.value = '';
  bookMeta.hidden = true;
  content.className = 'content empty-state';
  content.textContent = libraryDocuments.length ? L('正在打开章节…', 'Opening…') : L('这个书库还没有 Markdown 文件。', 'No Markdown files in this library yet.');
  title.textContent = library.name;
  inspectorTitle.textContent = library.name;
  documentInfo.innerHTML = '';
  tagsSection.hidden = true; linksSection.hidden = true; logsSection.hidden = true;
  renderNotes(null);
  searchInput.value = '';
  renderTagList();
  renderTree();
  // Anew：先回到上次看的那篇
  const lastPath = (recentDocs()[0] || {}).path;
  const firstDoc = libraryDocuments.find(doc => doc.path === lastPath) || libraryDocuments.find(doc => !isArchivedDoc(doc)) || libraryDocuments[0];
  if (firstDoc) openNativeDocument(firstDoc);
};
window.renderDocument = payload => { if (payload.reveal && document.body.classList.contains('shelf-mode')) { titleBeforeShelf = ''; showTree(); if (!libraryDocuments.length) libraryTitle.textContent = (payload.path || '').split('/').slice(-2, -1)[0] || L('单篇', 'Single file'); } const existing = libraryDocuments.findIndex(item => item.path === payload.path); const doc = parseDocument({ ...(libraryDocuments[existing] || {}), ...payload }); if (existing >= 0) libraryDocuments[existing] = doc; else if (!libraryDocuments.length) libraryDocuments = [doc]; selectDocument(doc); renderTagList(); };

/* ══════════════ 0.3.0 追加：批注 · 复制给模型 · 菜单钩子 ══════════════ */

const notePopover = document.querySelector('#note-popover');
const noteInput = document.querySelector('#note-input');
const noteQuote = document.querySelector('#note-quote');
const notesSection = document.querySelector('#notes-section');
const notesList = document.querySelector('#notes-list');
const notesCount = document.querySelector('#notes-count');
const notesDoneWrap = document.querySelector('#notes-done-wrap');
const notesDoneToggle = document.querySelector('#notes-done-toggle');
const notesDoneCount = document.querySelector('#notes-done-count');
const notesDoneList = document.querySelector('#notes-done-list');
let notesDoneOpen = false;
const copyButton = document.querySelector('#copy-model');

let pendingQuote = '';
let notesSaving = false;
let notesDirty = false;
let noticeTimer;
function showNotice(message) {
  const notice = document.querySelector('#app-notice');
  notice.textContent = message;
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 4500);
}
window.showNotice = showNotice;
window.notesStatus = ({ path, success, message }) => {
  if (path !== activeDocument?.path) return;
  notesSaving = false;
  notesDirty = !success;
  showNotice(message);
};

const notesOf = doc => (doc && Array.isArray(doc.notes)) ? doc.notes : [];

function persistNotes() {
  if (!activeDocument) return;
  notesDirty = true;
  notesSaving = true;
  window.webkit.messageHandlers.saveNotes.postMessage({ path: activeDocument.path, notes: notesOf(activeDocument) });
}

/** 取当前选中的文字：阅读模式取 DOM 选区，编辑模式取 textarea 选区 */
function currentSelectionText() {
  if (isEditing) return editor.value.slice(editor.selectionStart, editor.selectionEnd).trim();
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return '';
  if (!content.contains(selection.anchorNode) || !content.contains(selection.focusNode)) return '';
  return String(selection).trim();
}

let noteAnchorRect = null;

/**
 * 摆放批注浮层。
 * 之前是按写死的 210px 高度算位置，浮层实际比这高（引文长、textarea 可以拉大），
 * 于是"加批注/取消"两个按钮被挤到窗口外面，而且没有任何办法把它拉回来。
 * 现在改成先渲染、量到真实高度，再决定放上面还是下面，最后夹回可视区里。
 */
function placeNotePopover(anchorRect) {
  const M = 12;                                   // 离窗口边缘留的空
  const vw = window.innerWidth, vh = window.innerHeight;
  notePopover.style.maxHeight = `${vh - M * 2}px`; // 极端情况下浮层自己滚动
  const box = notePopover.getBoundingClientRect();
  const h = box.height, w = box.width;

  let top;
  if (anchorRect) {
    const below = anchorRect.bottom + 10;
    const above = anchorRect.top - 10 - h;
    // 下面放得下就放下面；放不下但上面放得下就翻到上面；都放不下就贴着可视区顶
    if (below + h <= vh - M) top = below;
    else if (above >= M) top = above;
    else top = M;
  } else {
    top = Math.max(M, (vh - h) / 2);
  }
  let left = anchorRect ? anchorRect.left : (vw - w) / 2;

  // 最后统一夹一次，保证四条边都在窗口里
  top = Math.min(Math.max(top, M), Math.max(M, vh - h - M));
  left = Math.min(Math.max(left, M), Math.max(M, vw - w - M));

  notePopover.style.top = `${top}px`;
  notePopover.style.left = `${left}px`;
}

function openNotePopover(quote, anchorRect) {
  pendingQuote = quote;
  noteQuote.textContent = quote.length > 120 ? quote.slice(0, 120) + '…' : quote;
  noteInput.value = '';
  noteInput.style.height = '';        // 清掉上次手动拉高的尺寸，免得越用越高
  noteAnchorRect = anchorRect || null;
  notePopover.hidden = false;
  noteHint.hidden = true;
  placeNotePopover(noteAnchorRect);
  noteInput.focus();
}

function closeNotePopover() { notePopover.hidden = true; pendingQuote = ''; noteInput.value = ''; noteAnchorRect = null; }

/**
 * 选区的位置。以前编辑模式直接拿整个编辑框的矩形，
 * 选区一长，「＋ 批注」就被甩到编辑框左下角，离选中的字很远。
 * 现在：阅读模式取选区最后一行的矩形；编辑模式用一个镜像 div 量出光标所在行。
 * 返回 { top, bottom, left, right }，top/bottom 是选区整体的上下沿（夹在可视区内），
 * endTop/endBottom/endX 是选区结尾那一行的位置。
 */
function textareaCaretRect(pos) {
  const cs = window.getComputedStyle(editor);
  const mirror = document.createElement('div');
  const props = ['boxSizing','width','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','fontFamily','fontSize','fontWeight','fontStyle','letterSpacing','lineHeight','textIndent','textTransform','wordSpacing','tabSize','fontFeatureSettings','fontVariantLigatures'];
  props.forEach(k => { mirror.style[k] = cs[k]; });
  Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: cs.wordBreak, overflow: 'hidden' });
  mirror.textContent = editor.value.slice(0, pos);
  const marker = document.createElement('span');
  marker.textContent = editor.value.slice(pos, pos + 1) || '.';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const box = editor.getBoundingClientRect();
  const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.6;
  const top = box.top + marker.offsetTop - editor.scrollTop;
  const left = box.left + marker.offsetLeft - editor.scrollLeft;
  document.body.removeChild(mirror);
  return { top, bottom: top + lineHeight, left };
}

function selectionAnchorRect() {
  const vh = window.innerHeight;
  if (isEditing) {
    const box = editor.getBoundingClientRect();
    const a = textareaCaretRect(editor.selectionStart);
    const b = textareaCaretRect(editor.selectionEnd);
    const clampY = y => Math.min(Math.max(y, box.top, 0), box.bottom, vh);
    return { top: clampY(a.top), bottom: clampY(b.bottom), left: Math.max(a.left, box.left),
             endTop: clampY(b.top), endBottom: clampY(b.bottom), endX: Math.min(Math.max(b.left, box.left), box.right) };
  }
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const whole = range.getBoundingClientRect();
  const rects = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0);
  const last = rects.length ? rects[rects.length - 1] : whole;
  const clampY = y => Math.min(Math.max(y, 0), vh);
  return { top: clampY(whole.top), bottom: clampY(whole.bottom), left: whole.left,
           endTop: clampY(last.top), endBottom: clampY(last.bottom), endX: last.right };
}

function addNoteFromSelection() {
  if (!hasDocument) return;
  const quote = currentSelectionText();
  if (!quote) { alert(L('先选中一段文字，再划线。', 'Select some text first.')); return; }
  const sel = selectionAnchorRect();
  // 浮层贴着选区结尾那一行出现，而不是整段选区或整个编辑框
  const rect = sel ? { top: sel.endTop, bottom: sel.endBottom, left: sel.endX - 20 } : null;
  openNotePopover(quote, rect);
}

function commitNote() {
  if (!activeDocument || notesSaving) return;
  const body = noteInput.value.trim();
  if (!body) { closeNotePopover(); return; }
  if (!activeDocument.notes) activeDocument.notes = [];
  activeDocument.notes.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    quote: pendingQuote,
    note: body,
    created: nowText(), tz: 'local'      // 以前写的是 UTC（toISOString），差 8 小时；tz 标出新旧
  });
  closeNotePopover();
  persistNotes();
  renderNotes(activeDocument);
  if (!isEditing) renderPreview(editor.value);
}

function removeNote(id) {
  if (!activeDocument || notesSaving) return;
  activeDocument.notes = notesOf(activeDocument).filter(item => item.id !== id);
  persistNotes();
  renderNotes(activeDocument);
  if (!isEditing) renderPreview(editor.value);
}

const isNoteDone = item => !!item.done;

/** 标记已处理 / 退回未处理。已处理的批注从主列表移到底部折叠区，正文高亮变淡。 */
function toggleNoteDone(id) {
  if (!activeDocument || notesSaving) return;
  const item = notesOf(activeDocument).find(entry => entry.id === id);
  if (!item) return;
  if (item.done) { delete item.done; delete item.resolved; }
  else { item.done = true; item.resolved = nowText(); item.resolvedTz = 'local'; }
  persistNotes();
  renderNotes(activeDocument);
  if (!isEditing) renderPreview(editor.value);
}

function noteItemHTML(item, index, done) {
  const quote = item.quote || '';
  const quoteHTML = quote
    ? `<blockquote class="note-quote">${escapeHTML(quote.length > 60 ? quote.slice(0, 60) + '…' : quote)}</blockquote>`
    : '';
  const toggle = done
    ? `<button class="note-done on" title="${L('退回未处理', 'Mark as open')}">↩</button>`
    : `<button class="note-done" title="${L('标记为已处理', 'Mark as handled')}">✓</button>`;
  const time = done ? (item.resolved || item.created || '') : (item.created || '');
  return `
    <div class="note-item${quote ? '' : ' standalone'}${done ? ' done' : ''}" data-id="${escapeHTML(item.id)}">
      <div class="note-head"><span class="note-index">${index}</span><span class="note-time">${escapeHTML(time)}</span><button class="note-done${done ? ' on' : ''}" title="${done ? L('退回未处理', 'Mark as open') : L('标记为已处理', 'Mark as handled')}">${done ? '↩' : '✓'}</button><button class="note-remove" title="${L('删除', 'Delete')}">×</button></div>
      ${quoteHTML}
      <p class="note-body">${escapeHTML(item.note)}</p>
    </div>`;
}

function bindNoteItems(root) {
  root.querySelectorAll('.note-item').forEach(node => {
    node.querySelector('.note-remove').onclick = event => { event.stopPropagation(); removeNote(node.dataset.id); };
    node.querySelector('.note-done').onclick = event => { event.stopPropagation(); toggleNoteDone(node.dataset.id); };
    node.onclick = () => {
      if (isEditing) toggleEditor();
      const mark = [...content.querySelectorAll('mark.noted')].find(mark => mark.dataset.id === node.dataset.id);
      if (mark) { mark.scrollIntoView({ block: 'center', behavior: 'smooth' }); mark.classList.add('flash'); setTimeout(() => mark.classList.remove('flash'), 900); }
    };
  });
}

function renderNotes(doc) {
  const notes = notesOf(doc);
  const open = notes.filter(item => !isNoteDone(item));
  const done = notes.filter(isNoteDone);
  notesSection.hidden = !notes.length;
  notesCount.textContent = open.length
    ? `${L('划线和读后感', 'Highlights & thoughts')} · ${open.length}`
    : (notes.length ? L('划线和读后感 · 全部已处理', 'Highlights & thoughts · all handled') : L('划线和读后感', 'Highlights & thoughts'));
  // 新加的在上面；编号还按先后（1 是最早的那条）
  const newestFirst = (list, done) => list.map((item, index) => noteItemHTML(item, index + 1, done)).reverse().join('');
  notesList.innerHTML = newestFirst(open, false);
  bindNoteItems(notesList);

  if (notesDoneWrap) {
    notesDoneWrap.hidden = !done.length;
    notesDoneCount.textContent = done.length;
    notesDoneToggle.classList.toggle('open', notesDoneOpen);
    notesDoneList.hidden = !notesDoneOpen;
    notesDoneList.innerHTML = notesDoneOpen ? newestFirst(done, true) : '';
    if (notesDoneOpen) bindNoteItems(notesDoneList);
  }
}

if (notesDoneToggle) notesDoneToggle.onclick = () => {
  notesDoneOpen = !notesDoneOpen;
  if (activeDocument) renderNotes(activeDocument);
};

/** 把有批注的引文在正文里标出来 */
function highlightNotes(doc) {
  const notes = notesOf(doc).filter(item => item.quote);
  if (!notes.length) return;
  for (const item of notes) {
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    const nodes = []; let text = ''; let node;
    while ((node = walker.nextNode())) { nodes.push({ node, start: text.length }); text += node.nodeValue; }
    let quote = item.quote;
    let index = text.indexOf(quote);
    if (index < 0) {
      const rendered = document.createElement('div');
      rendered.innerHTML = markdownToHTML(quote);
      quote = rendered.textContent.trim();
      index = quote ? text.indexOf(quote) : -1;
    }
    if (index < 0) continue;
    for (const entry of nodes.reverse()) {
      const start = Math.max(0, index - entry.start);
      const end = Math.min(entry.node.length, index + quote.length - entry.start);
      if (start >= end) continue;
      const range = document.createRange();
      range.setStart(entry.node, start);
      range.setEnd(entry.node, end);
      const mark = document.createElement('mark');
      mark.className = item.done ? 'noted resolved' : 'noted';
      mark.dataset.id = item.id;
      range.surroundContents(mark);
    }
  }
}

/* ── 复制正文与批注（走原生剪贴板） ── */
function copyForModel() {
  if (!activeDocument) return;
  if (importingImages) { showNotice(L('图片正在插入，请稍候再复制', 'Inserting images — copy in a moment')); return; }
  const rendered = document.createElement('div');
  rendered.innerHTML = markdownToHTML(parseDocument({ content: editor.value }).body);
  const images = [];
  rendered.querySelectorAll('img').forEach(img => {
    const token = `papermd-copy-${crypto.randomUUID()}`;
    images.push({ token, source: img.dataset.imageSource });
    img.setAttribute('src', token);
    img.removeAttribute('data-image-source');
    img.setAttribute('style', 'max-width:100%;height:auto;');
  });
  rendered.querySelectorAll('[data-line]').forEach(node => node.removeAttribute('data-line'));
  window.webkit.messageHandlers.copyForModel.postMessage({
    docPath: activeDocument.path, html: rendered.innerHTML, images,
    content: editor.value,
    notes: notesOf(activeDocument).filter(item => !item.done)
  });
}
if (copyButton) copyButton.onclick = copyForModel;

/* ── 挂到已有的渲染流程上 ── */
const basePaperRenderInspector = renderInspector;
renderInspector = function (doc) { basePaperRenderInspector(doc); renderNotes(doc); };

const basePaperRenderPreview = renderPreview;
renderPreview = function (markdown) { basePaperRenderPreview(markdown); if (activeDocument) highlightNotes(activeDocument); };

/* ── 选中文字后浮出「＋ 批注」 ── */
const noteHint = document.querySelector('#note-hint');
function refreshNoteHint() {
  if (!hasDocument || notePopover.hidden === false) { noteHint.hidden = true; return; }
  const quote = currentSelectionText();
  if (!quote) { noteHint.hidden = true; return; }
  const sel = selectionAnchorRect();
  if (!sel) { noteHint.hidden = true; return; }
  noteHint.hidden = false;                       // 先显示才量得到尺寸
  const hintBox = noteHint.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight, M = 12;
  // 按钮放在选区结尾那一行的正下方、靠着结尾的字；下面放不下就放到结尾那一行上方
  let hintTop = sel.endBottom + 6;
  if (hintTop + hintBox.height > vh - M) hintTop = sel.endTop - hintBox.height - 6;
  hintTop = Math.min(Math.max(hintTop, M), vh - hintBox.height - M);
  let hintLeft = sel.endX - hintBox.width / 2;
  const hintLeftClamped = Math.min(Math.max(hintLeft, M), Math.max(M, vw - hintBox.width - M));
  const hintLeftFinal = hintLeftClamped;
  noteHint.style.top = `${hintTop}px`;
  noteHint.style.left = `${hintLeftFinal}px`;
}
document.addEventListener('mouseup', () => setTimeout(refreshNoteHint, 10));
document.addEventListener('scroll', () => { noteHint.hidden = true; }, true);
noteHint.onclick = addNoteFromSelection;
noteHint.onmousedown = event => event.preventDefault();
document.querySelector('#note-save').onclick = commitNote;
document.querySelector('#note-cancel').onclick = closeNotePopover;
noteInput.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); closeNotePopover(); }
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); commitNote(); }
});
// 窗口大小变了、或者 textarea 被拉高了，重新摆一次，别让按钮跑出去
window.addEventListener('resize', () => { if (!notePopover.hidden) placeNotePopover(noteAnchorRect); });
if (window.ResizeObserver) {
  new ResizeObserver(() => { if (!notePopover.hidden) placeNotePopover(noteAnchorRect); }).observe(notePopover);
}
// 点浮层外面 = 取消（Esc 之外多一条退路）
document.addEventListener('mousedown', event => {
  if (notePopover.hidden) return;
  if (notePopover.contains(event.target) || event.target === noteHint) return;
  closeNotePopover();
}, true);
// 浮层开着的时候，全局 Esc 也能关掉（焦点不在输入框里也管用）
document.addEventListener('keydown', event => {
  if (!notePopover.hidden && event.key === 'Escape') { event.preventDefault(); closeNotePopover(); }
});

/* ── 常驻输入框：独立备注（autoGLM 语音直接打进来就行） ── */
const commentInput = document.querySelector('#comment-input');
const commentAdd = document.querySelector('#comment-add');

function addStandaloneComment() {
  if (notesSaving) return;
  const body = commentInput.value.trim();
  if (!body) return;
  if (!activeDocument) { alert(L('先打开一个文件。', 'Open a file first.')); return; }
  if (!activeDocument.notes) activeDocument.notes = [];
  activeDocument.notes.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    quote: '',
    note: body,
    ...(window.anewCommentKind ? { kind: window.anewCommentKind } : {}),
    created: nowText(), tz: 'local'
  });
  commentInput.value = '';
  if (window.anewCommentKind) setRetell(false);
  commentInput.dispatchEvent(new Event('input'));
  persistNotes();
  renderNotes(activeDocument);
}
commentAdd.onclick = addStandaloneComment;
commentInput.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); addStandaloneComment(); }
});

/* ── 给原生菜单用的钩子 ── */
window.__paperSave = () => { if (notesDirty && !notesSaving) persistNotes(); saveDocument(); };
window.__paperOpenFile = openFile;
window.__paperOpenFolder = openFolder;
window.__paperToggleEdit = () => toggleEditor();
window.__paperZoom = direction => setScale(fontScale + direction * 0.05);
window.__paperTheme = () => { document.documentElement.classList.toggle('night'); localStorage.night = document.documentElement.classList.contains('night') ? '1' : '0'; };
window.__paperAddNote = () => addNoteFromSelection();
window.__paperCopyForModel = () => copyForModel();


/* ── 书库排序：认中文数字，正文在前，说明文档在后 ── */
function cnNumber(text) {
  if (!text) return null;
  if (/^\d+$/.test(text)) return parseInt(text, 10);
  const digit = ch => '〇一二三四五六七八九'.indexOf(ch === '零' ? '〇' : ch);
  if (!/[十百]/.test(text)) {                       // 位值写法：一 / 一〇五
    const parts = [...text].map(digit);
    if (parts.some(value => value < 0)) return null;
    return parseInt(parts.join(''), 10);
  }
  let total = 0, current = 0;                       // 十 / 十一 / 九十五 / 一百零三
  for (const ch of text) {
    if (ch === '百') { total += (current || 1) * 100; current = 0; continue; }
    if (ch === '十') { current = (current || 1) * 10; continue; }
    const value = digit(ch);
    if (value < 0) return null;
    current += value;
  }
  return total + current;
}

/** 返回 [组, 序号, 名字]：组 0 = 正文，组 1 = 说明/附件之类 */
function docOrder(doc) {
  const name = (doc.relativePath || doc.name || '').replace(/\.(md|markdown|mdown|mkdn)$/i, '');
  const CN = '[零〇一二三四五六七八九十百]+|\\d+';
  let match = name.match(new RegExp(`^卷\\s*(${CN})(?=[_\\-.·、\\s]|$)`));
  if (match) { const n = cnNumber(match[1]); if (n != null) return [0, n, name]; }
  match = name.match(new RegExp(`^第\\s*(${CN})\\s*[章回卷篇部]`));
  if (match) { const n = cnNumber(match[1]); if (n != null) return [0, n, name]; }
  match = name.match(/^(\d+)[-_.\s]/);              // 00-卷首 这种
  if (match) return [0, parseInt(match[1], 10), name];
  return [1, 0, name];
}

/* 图片导入：三个入口共享同一条读取、落盘、回执链路。 */
const insertImageButton = document.querySelector('#insert-image');
const imageInput = document.querySelector('#image-input');
const imageRequests = new Map();
let importingImages = false;
window.imageSaved = reply => {
  const pending = imageRequests.get(reply.requestID);
  if (!pending) return;
  imageRequests.delete(reply.requestID);
  if (reply.success && reply.docPath === pending.docPath) pending.resolve(reply.filename);
  else pending.reject(new Error(reply.error || L('图片保存失败，请重试', 'Couldn\'t save the image, try again')));
};
function saveImageFile(file, docPath, pasted) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(L('无法读取这张图片', 'Can\'t read this image')));
    reader.onabort = () => reject(new Error(L('图片读取已取消', 'Image read cancelled')));
    reader.onload = () => {
      const requestID = crypto.randomUUID();
      imageRequests.set(requestID, { resolve, reject, docPath });
      try {
        window.webkit.messageHandlers.saveImage.postMessage({
          requestID, docPath, suggestedName: pasted ? '' : file.name,
          dataBase64: String(reader.result).split(',')[1]
        });
      } catch (error) { imageRequests.delete(requestID); reject(error); }
    };
    reader.readAsDataURL(file);
  });
}
async function insertImageFiles(files, pasted = false) {
  const images = Array.from(files).filter(file => file && file.type.startsWith('image/'));
  if (!images.length) return;
  if (!activeDocument) { showNotice(L('请先打开一篇稿件', 'Open a document first')); return; }
  if (importingImages) { showNotice(L('图片正在插入，请稍候', 'Inserting images, one moment')); return; }
  if (!isEditing) toggleEditor();
  const documentAtStart = activeDocument;
  const start = editor.selectionStart, end = editor.selectionEnd;
  const filenames = [], failures = [];
  importingImages = true;
  editor.readOnly = true;
  insertImageButton.disabled = true;
  showNotice(L('正在保存图片…', 'Saving images…'));
  try {
    for (const file of images) {
      if (activeDocument !== documentAtStart) break;
      try { filenames.push(await saveImageFile(file, documentAtStart.path, pasted)); }
      catch (error) { failures.push(error.message); }
    }
    if (activeDocument !== documentAtStart) { showNotice(L('稿件已切换，图片未插入正文', 'The document changed — images not inserted')); return; }
    if (filenames.length) {
      const before = start > 0 && editor.value[start - 1] !== '\n' ? '\n' : '';
      const after = end < editor.value.length && editor.value[end] !== '\n' ? '\n' : '';
      const markdown = before + filenames.map(name => `![](images/${name})`).join('\n') + after;
      editor.readOnly = false;
      editor.focus();
      editor.setSelectionRange(start, end);
      // WebKit's editing command preserves the native undo stack.
      if (!document.execCommand('insertText', false, markdown)) editor.setRangeText(markdown, start, end, 'end');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
    showNotice(failures.length ? L(`图片插入失败：${failures.join('；')}${filenames.length ? `（已插入 ${filenames.length} 张）` : ''}`, `Some images failed: ${failures.join('; ')}${filenames.length ? ` (${filenames.length} inserted)` : ''}`) : L(`已插入 ${filenames.length} 张图片，⌘S 保存稿件`, `Inserted ${filenames.length} images`));
  } finally {
    importingImages = false;
    editor.readOnly = false;
    insertImageButton.disabled = false;
  }
}
insertImageButton.onclick = () => {
  if (!activeDocument) { showNotice(L('请先打开一篇稿件', 'Open a document first')); return; }
  if (!isEditing) toggleEditor();
  imageInput.click();
};
imageInput.addEventListener('change', () => {
  const files = Array.from(imageInput.files);
  imageInput.value = '';
  void insertImageFiles(files);
});
editor.addEventListener('dragover', event => {
  if (Array.from(event.dataTransfer?.items || []).some(item => item.kind === 'file' && item.type.startsWith('image/'))) {
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
  }
});
editor.addEventListener('drop', event => {
  const images = Array.from(event.dataTransfer?.files || []).filter(file => file.type.startsWith('image/'));
  if (!images.length) return;
  event.preventDefault();
  void insertImageFiles(images);
});
editor.addEventListener('paste', event => {
  const images = Array.from(event.clipboardData?.items || [])
    .filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean);
  if (!images.length) return;
  event.preventDefault();
  void insertImageFiles(images, true);
});

function imageSource(source) {
  if (/^https?:\/\//i.test(source)) return source;
  if (!source || /^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(source)) return null;
  let decoded;
  try { decoded = decodeURIComponent(source); } catch { decoded = source; }
  if (decoded.split('/').includes('..') || decoded.includes('\\') || decoded.includes(':')) return null;
  return `papermd-img://${activeDocument?.imageScope || 'unopened'}/${decoded.split('/').map(encodeURIComponent).join('/')}`;
}

/* ══════════════ 0.9.0：阅读模式里点哪块改哪块 ══════════════
   正文顶层每个块都带 data-line（原文第几行）。点一下，那一块就地换成它的 Markdown 原文；
   表格换成一格一格的输入框。改完（点别处 / ⌘↩）只把这几行写回 editor.value，
   没点过的部分一个字节都不动。Esc 放弃。改完没存，⌘S 或「保存」存盘；⌘Z 撤回上一次块修改。 */

let blockEditing = null;           // { el, start, end, isTable, box, original }
let pendingBlockClick = 0;
const blockUndo = [];

function topBlocks() { return [...content.children].filter(el => el.dataset && el.dataset.line != null); }

/** 这个块在原文里占第几行到第几行（含），去掉尾部空行 */
function blockRange(el) {
  const lines = editor.value.split('\n');
  const blocks = topBlocks();
  const index = blocks.indexOf(el);
  const start = Number(el.dataset.line);
  let end = (index >= 0 && index + 1 < blocks.length ? Number(blocks[index + 1].dataset.line) : lines.length) - 1;
  while (end > start && !lines[end].trim()) end--;
  return { start, end, lines };
}

function replaceLines(start, end, replacement) {
  const lines = editor.value.split('\n');
  const before = editor.value;
  lines.splice(start, end - start + 1, ...replacement);
  const next = lines.join('\n');
  if (next === before) return false;
  blockUndo.push(before); if (blockUndo.length > 50) blockUndo.shift();
  editor.value = next;
  editor.dispatchEvent(new Event('input'));     // 走原来那条「未保存」链路
  return true;
}

function rerenderKeepingScroll() {
  const y = window.scrollY;
  renderPreview(editor.value);
  window.scrollTo({ top: y, behavior: 'instant' });
}

/* ── 表格 ⇄ 格子 ── */
function tableSource(lines) {
  const head = splitRow(lines[0]);
  const rule = lines[1];
  const rows = lines.slice(2).filter(line => line.trim()).map(splitRow);
  return { head, rule, rows };
}
/** 写回表格。没改过的那一行原样保留（连空格都不动），只有改过的行按标准格式重写 */
function serializeTable(head, rows, original) {
  const width = head.length;
  const same = (a, b) => a.length === b.length && a.every((v, k) => v === b[k]);
  const row = (cells, source) => {
    const full = Array.from({ length: width }, (_, k) => (cells[k] || '').replace(/\n/g, ' ').trim());
    if (source != null && same(full, splitRow(source))) return source;
    return '|' + full.map(c => c ? ` ${c.replace(/\|/g, '\\|')} ` : ' ').join('|') + '|';
  };
  const oldRule = splitRow(original[1]);
  const ruleLine = oldRule.length === width ? original[1] : '|' + Array.from({ length: width }, (_, k) => ` ${oldRule[k] && /^:?-+:?$/.test(oldRule[k]) ? oldRule[k] : '---'} `).join('|') + '|';
  const bodyLines = original.slice(2).filter(line => line.trim());
  return [row(head, original[0]), ruleLine, ...rows.map((cells, k) => row(cells, bodyLines[k]))];
}
function buildTableEditor(box, source) {
  const grid = document.createElement('table');
  grid.className = 'block-table';
  const cell = (tag, value) => { const c = document.createElement(tag); c.contentEditable = 'plaintext-only'; c.spellcheck = false; c.textContent = value; return c; };
  const thead = grid.createTHead().insertRow();
  source.head.forEach(v => thead.appendChild(cell('th', v)));
  const tbody = grid.createTBody();
  source.rows.forEach(r => { const tr = tbody.insertRow(); source.head.forEach((_, k) => tr.appendChild(cell('td', r[k] || ''))); });
  let focused = null;
  grid.addEventListener('focusin', e => { if (e.target.isContentEditable) focused = e.target; });
  grid.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {        // 格子里不换行：↩ 跳到下一行同一列
      e.preventDefault();
      const td = e.target.closest('td,th'); if (!td) return;
      const col = td.cellIndex; const tr = td.parentElement;
      const nextRow = tr.parentElement.tagName === 'THEAD' ? tbody.rows[0] : tr.nextElementSibling;
      if (nextRow) nextRow.cells[col].focus(); else { addRow(); tbody.rows[tbody.rows.length - 1].cells[col].focus(); }
    }
  });
  const addRow = () => { const tr = tbody.insertRow(); for (let k = 0; k < thead.cells.length; k++) tr.appendChild(cell('td', '')); return tr; };
  const addCol = () => { thead.appendChild(cell('th', '')); [...tbody.rows].forEach(tr => tr.appendChild(cell('td', ''))); };
  const delRow = () => { const tr = focused?.closest('tbody tr'); if (tr && tbody.rows.length > 1) { tr.remove(); focused = null; } };
  const delCol = () => { const td = focused?.closest('td,th'); if (!td || thead.cells.length < 2) return; const k = td.cellIndex; thead.cells[k].remove(); [...tbody.rows].forEach(tr => tr.cells[k]?.remove()); focused = null; };
  const tools = document.createElement('div');
  tools.className = 'block-tools';
  for (const [label, fn] of [[L('＋ 行', '＋ Row'), addRow], [L('＋ 列', '＋ Column'), addCol], [L('删这一行', 'Delete row'), delRow], [L('删这一列', 'Delete column'), delCol]]) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
    b.onmousedown = e => e.preventDefault();       // 不抢焦点，不触发「点别处 = 完成」
    b.onclick = fn; tools.appendChild(b);
  }
  box.append(grid, tools);
  box.readTable = () => ({ head: [...thead.cells].map(c => c.textContent), rows: [...tbody.rows].map(tr => [...tr.cells].map(c => c.textContent)) });
  return grid.querySelector('th,td');
}

function autoGrow(area) { area.style.height = 'auto'; area.style.height = `${area.scrollHeight + 2}px`; }

function startBlockEdit(el, caretX, caretY, target) {
  if (blockEditing || isEditing || !hasDocument || importingImages) return;
  const { start, end, lines } = blockRange(el);
  const original = lines.slice(start, end + 1);
  const box = document.createElement('div');
  box.className = 'block-editor';
  const isTable = el.tagName === 'TABLE' && original.length >= 2 && TABLE_RULE.test(original[1]);
  let focusTarget;
  if (isTable) {
    focusTarget = buildTableEditor(box, tableSource(original));
    const clicked = target?.closest?.('td,th');
    if (clicked && el.contains(clicked)) {   // 光标落在点的那一格
      const row = clicked.parentElement.rowIndex + (el.tHead ? 0 : 1);
      focusTarget = box.querySelector('table').rows[row]?.cells[clicked.cellIndex] || focusTarget;
    }
  } else {
    const area = document.createElement('textarea');
    area.className = `block-source block-${el.tagName.toLowerCase()}`;
    area.spellcheck = false;
    area.value = original.join('\n');
    area.addEventListener('input', () => autoGrow(area));
    box.appendChild(area);
    focusTarget = area;
  }
  const hint = document.createElement('div');
  hint.className = 'block-hint';
  hint.textContent = isTable ? L('点别处完成 · ↩ 下一行 · Tab 下一格 · Esc 放弃', 'Click outside to finish · ↩ next row · Tab next cell · Esc discard') : L('点别处或 ⌘↩ 完成 · Esc 放弃', 'Click outside or ⌘↩ to finish · Esc discard');
  box.appendChild(hint);
  box.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endBlockEdit(false); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); endBlockEdit(true); }
  });
  box.addEventListener('focusout', () => setTimeout(() => { if (blockEditing?.box === box && !box.contains(document.activeElement)) endBlockEdit(true); }, 0));
  blockEditing = { el, start, end, isTable, box, original };
  noteHint.hidden = true;
  el.replaceWith(box);
  if (!isTable) autoGrow(focusTarget);
  focusTarget?.focus({ preventScroll: true });
  if (isTable && focusTarget) { const range = document.createRange(); range.selectNodeContents(focusTarget); range.collapse(false); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); }
  if (!isTable) {
    // 光标尽量落在点下去的那一处附近：按点击位置在块里的比例估一个字符位置
    const rect = box.getBoundingClientRect();
    const ratio = rect.height ? Math.min(1, Math.max(0, (caretY - rect.top) / rect.height)) : 1;
    const pos = Math.round(focusTarget.value.length * ratio);
    focusTarget.setSelectionRange(pos, pos);
  }
}

function endBlockEdit(commit) {
  const state = blockEditing; if (!state) return;
  blockEditing = null;
  let replacement = state.original;
  if (commit) {
    if (state.isTable) {
      const { head, rows } = state.box.readTable();
      replacement = serializeTable(head, rows, state.original);
    } else {
      replacement = state.box.querySelector('textarea').value.replace(/\s+$/, '').split('\n');
    }
  }
  if (!commit || !replaceLines(state.start, state.end, replacement)) { state.box.replaceWith(state.el); return; }
  rerenderKeepingScroll();
}

content.addEventListener('click', event => {
  if (isEditing || blockEditing || !hasDocument) return;
  if (document.body.classList.contains('shelf-mode')) return;
  if (event.target.closest('a,button,input,mark.noted,.block-editor')) return;
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && String(selection).trim()) return;   // 在选字（要加批注），不打扰
  let el = event.target;
  while (el && el.parentElement !== content) el = el.parentElement;
  if (!el || el.dataset.line == null) return;
  // 双击 / 三击是在选字，等一下看还有没有第二下
  clearTimeout(pendingBlockClick);
  if (event.detail > 1) return;
  const x = event.clientX, y = event.clientY, target = event.target;
  pendingBlockClick = setTimeout(() => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && String(sel).trim()) return;
    if (el.isConnected) startBlockEdit(el, x, y, target);
  }, 260);
});
content.addEventListener('dblclick', () => clearTimeout(pendingBlockClick));

// 离开这一篇（切文件、切模式、刷新）之前，先把正在改的那块收好
const baseConfirmLeaving = confirmLeavingDocument;
confirmLeavingDocument = action => { endBlockEdit(true); return baseConfirmLeaving(action); };
const baseToggleEditor = toggleEditor;
toggleEditor = () => { endBlockEdit(true); baseToggleEditor(); };
editButton.onclick = toggleEditor;
const baseSaveDocument = saveDocument;
saveDocument = () => { endBlockEdit(true); baseSaveDocument(); };
saveButton.onclick = saveDocument;
const baseSelectDocument = selectDocument;
selectDocument = doc => { if (blockEditing) { blockEditing.box.remove(); blockEditing = null; } blockUndo.length = 0; baseSelectDocument(doc); };

// 阅读模式里 ⌘Z：撤回上一次块修改（在某个输入框里时交给输入框自己）
document.addEventListener('keydown', event => {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z' || event.shiftKey) return;
  if (isEditing || blockEditing || !blockUndo.length) return;
  const active = document.activeElement;
  if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.isContentEditable)) return;
  event.preventDefault();
  editor.value = blockUndo.pop();
  editor.dispatchEvent(new Event('input'));
  rerenderKeepingScroll();
});

/* ══════════════ 0.9.1：书 / 笔记 两种排版，按书库（没有书库就按文件夹）记住 ══════════════ */
const typesetButton = document.querySelector('#typeset');
function typesetKey() {
  const folder = (activeDocument?.path || '').split('/').slice(0, -1).join('/');
  return 'typeset:' + (currentLibraryPath || folder);
}
function applyTypeset() {
  let mode = null;
  try { mode = localStorage.getItem(typesetKey()); } catch {}
  // 没选过：一卷一卷的书用书排版，其余（笔记、单篇）用笔记排版
  if (!mode) mode = libraryDocuments.some(doc => volumeParts(doc)) ? 'book' : 'notes';
  document.body.classList.toggle('notes-style', mode === 'notes');
  typesetButton.textContent = mode === 'notes' ? L('笔', 'N') : L('书', 'B');
  typesetButton.title = mode === 'notes' ? L('现在是笔记排版，点一下换成书排版', 'Notes layout — click for book layout') : L('现在是书排版，点一下换成笔记排版', 'Book layout — click for notes layout');
}
typesetButton.onclick = () => {
  const next = document.body.classList.contains('notes-style') ? 'book' : 'notes';
  try { localStorage.setItem(typesetKey(), next); } catch {}
  const y = window.scrollY; applyTypeset(); window.scrollTo({ top: y, behavior: 'instant' });
};
const baseSelectDocumentTypeset = selectDocument;
selectDocument = doc => { baseSelectDocumentTypeset(doc); applyTypeset(); };

/* ══════════════ 0.9.2：正文里的 #标签 —— 点一下只看带这个标签的那几块 ══════════════
   「一块」= 从一个二级标题到下一个二级 / 一级标题。一级标题（一、产品…）只在它下面有命中时留着。 */
let blockTagFilter = '';
const tagFilterBar = document.createElement('div');
tagFilterBar.className = 'tag-filter-bar'; tagFilterBar.hidden = true;
content.before(tagFilterBar);
function applyBlockTagFilter() {
  const blocks = [...content.children];
  blocks.forEach(el => { el.hidden = false; });
  tagFilterBar.hidden = !blockTagFilter;
  if (!blockTagFilter) return;
  const sections = []; let current = null; let part = null;
  for (const el of blocks) {
    if (el.tagName === 'H1') { part = { head: el, hit: false }; current = null; el.__part = part; continue; }
    if (el.tagName === 'H2') { current = { els: [el], part, hit: false }; sections.push(current); continue; }
    if (current) current.els.push(el); else el.hidden = true;     // 一级标题下、第一个二级标题前的导语
  }
  let count = 0;
  for (const section of sections) {
    section.hit = !!section.els[0].querySelector(`.tag-inline[data-tag="${CSS.escape(blockTagFilter)}"]`);   // 标签写在这一块的二级标题上才算
    section.els.forEach(el => { el.hidden = !section.hit; });
    if (section.hit) { count++; if (section.part) section.part.hit = true; }
  }
  blocks.filter(el => el.tagName === 'H1').forEach((el, index) => { el.hidden = !(el.__part?.hit) && !(index === 0 && el === blocks[0]); });
  tagFilterBar.innerHTML = L(`只看 <b>#${escapeHTML(blockTagFilter)}</b> · ${count} 块 <button type="button">全部显示</button>`, `Only <b>#${escapeHTML(blockTagFilter)}</b> · ${count} sections <button type="button">Show all</button>`);
  tagFilterBar.querySelector('button').onclick = () => setBlockTagFilter('');
}
function setBlockTagFilter(tag) {
  blockTagFilter = blockTagFilter === tag ? '' : tag;
  applyBlockTagFilter();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
content.addEventListener('click', event => {
  const pill = event.target.closest('.tag-inline');
  if (!pill) return;
  event.stopPropagation();
  setBlockTagFilter(pill.dataset.tag);
}, true);
const baseRenderPreviewTags = renderPreview;
renderPreview = markdown => { baseRenderPreviewTags(markdown); applyBlockTagFilter(); };
const baseSelectDocumentTags = selectDocument;
selectDocument = doc => { blockTagFilter = ''; baseSelectDocumentTags(doc); };

/* ══════════════ 0.9.2：书架下面「最近的文档」—— 打开过、改过的，点一下直接回去 ══════════════ */
function recentDocs() { try { return JSON.parse(localStorage.getItem('recentDocs') || '[]'); } catch { return []; } }
function rememberDoc(doc, edited) {
  if (!doc?.path) return;
  const list = recentDocs();
  const old = list.find(item => item.path === doc.path);
  const entry = { path: doc.path, name: titleFor(doc), folder: doc.path.split('/').slice(-2, -1)[0] || '', opened: Date.now(), edited: edited ? Date.now() : (old?.edited || 0) };
  const next = [entry, ...list.filter(item => item.path !== doc.path)].slice(0, 12);
  try { localStorage.setItem('recentDocs', JSON.stringify(next)); } catch {}
}
function whenText(ms) {
  if (!ms) return '';
  const d = new Date(ms), now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 86400000);
  return days === 0 ? L(`今天 ${hm}`, `Today ${hm}`) : days === 1 ? L(`昨天 ${hm}`, `Yesterday ${hm}`) : L(`${d.getMonth() + 1}月${d.getDate()}日`, d.toLocaleDateString('en', { month: 'short', day: 'numeric' }));
}
const baseSelectDocumentRecent = selectDocument;
selectDocument = doc => { baseSelectDocumentRecent(doc); rememberDoc(doc, false); };
const baseSaveStatusRecent = window.saveStatus;
window.saveStatus = payload => { baseSaveStatusRecent(payload); if (payload.state === 'saved') rememberDoc(activeDocument, true); };
const basePaintBookshelfRecent = paintBookshelf;
paintBookshelf = () => {
  basePaintBookshelfRecent();
  if (!bookshelfView) return;
  const list = recentDocs();
  if (!list.length) return;
  const section = document.createElement('section');
  section.className = 'recent-docs';
  section.innerHTML = `<h2>${L('最近的文档', 'Recent documents')}</h2>` + list.map(item => `
    <button class="recent-doc" data-path="${escapeHTML(item.path)}" title="${escapeHTML(item.path)}">
      <span class="recent-doc-name">${escapeHTML(item.name)}</span>
      <span class="recent-doc-folder">${escapeHTML(item.folder)}</span>
      <span class="recent-doc-time">${item.edited ? L(`${whenText(item.edited)} 改过`, `edited ${whenText(item.edited)}`) : L(`${whenText(item.opened)} 看过`, `opened ${whenText(item.opened)}`)}</span>
    </button>`).join('');
  section.querySelectorAll('.recent-doc').forEach(button => button.onclick = () => {
    if (activeDocument?.path === button.dataset.path && hasDocument) { titleBeforeShelf = titleFor(activeDocument); showTree(); return; }   // 就是手上这篇：直接回去，没存的改动还在
    if (!confirmLeavingDocument(L('打开这篇', 'Open this document'))) return;
    window.webkit.messageHandlers.openDocument.postMessage({ path: button.dataset.path });
  });
  bookshelfView.appendChild(section);
};
window.__docMissing = path => {
  try { localStorage.setItem('recentDocs', JSON.stringify(recentDocs().filter(item => item.path !== path))); } catch {}
  showNotice(L('这篇找不到了（可能改名或挪走了），已经从「最近的文档」里拿掉', 'Not found (renamed or moved?) — removed from Recent'));
  if (document.body.classList.contains('shelf-mode')) paintBookshelf();
};

/* ══════════════ 知新 Anew 0.1 ══════════════
   从 Paper MD 复制来，去掉书架；加上：左边按属性筛的视图、来源顶上那条、
   批注下面的一来一回（AI 的回复写在同一个 json 里）、☆ 要接着想、讲一遍、交给 AI。
   库是 Diem 的 notes/；属性照 Obsidian 的写法（开头 --- 那段）。 */

// 没有书架：永远是库，永远是笔记排版
document.body.classList.add('anew');
window.renderShelf = books => { shelfBooks = Array.isArray(books) ? books : []; };
showShelf = () => showTree();
applyTypeset = () => { document.body.classList.add('notes-style'); };
applyTypeset();

// ── 属性：库列表里 Swift 读好的 meta（正在看的这篇再从正文里补） ──
const STAGE_NAMES = { idea: L('念头', 'Idea'), working: L('学习中', 'Working'), workout: L('理好了', 'Done'), archive: L('归档', 'Archived') };
function metaOf(doc) {
  const meta = { ...(doc?.meta || {}) };
  const fm = doc?.frontmatter || {};
  for (const [key, value] of Object.entries(fm)) meta[key] = String(value).replace(/^"(.*)"$/, '$1');
  if (meta.type) meta.type = normalizeType(meta.type);   // type: source 和 type: 来源 一样
  return meta;
}

// 来源跟着它那个主题的笔记走：笔记理好了，来源就算理好了（不用一篇篇去改来源的 stage）。
// 主题里有一篇笔记还在学，来源就还算学习中；主题里还没有笔记，才看来源自己的 stage。
function stageOf(doc) {
  const m = metaOf(doc);
  if (m.type !== '来源' || m.stage === 'archive' || isArchivedDoc(doc)) return m.stage;
  const folder = (doc.relativePath || '').split('/')[0];
  if (!(doc.relativePath || '').includes('/')) return m.stage;
  const notes = libraryDocuments.filter(d => {
    if (d === doc) return false;
    const dm = metaOf(d), rel = d.relativePath || d.name || '';
    if (dm.type === '来源' || dm.stage === 'archive' || isArchivedDoc(d)) return false;
    // 文件夹里的笔记，或根上「主题是这个文件夹」的那篇（比如 读书笔记 · X.md）
    return rel.split('/')[0] === folder && rel.includes('/') || !rel.includes('/') && dm.topic === folder;
  }).map(d => metaOf(d).stage);
  if (!notes.length) return m.stage;
  return notes.sort((a, b) => (STAGE_RANK[a] ?? 3) - (STAGE_RANK[b] ?? 3))[0];
}

// ── 左边的视图 ──
const VIEWS = [
  { id: '', name: L('全部', 'All'), match: (m, doc) => m.stage !== 'archive' && !isArchivedDoc(doc) },
  { id: 'working', name: L('学习中', 'Working'), match: (m, doc) => stageOf(doc) === 'working' && m.type !== '要接着想' },
  { id: 'think', name: L('要接着想', 'Keep thinking'), match: m => m.type === '要接着想' },
  { id: 'workout', name: L('理好的', 'Done'), match: (m, doc) => stageOf(doc) === 'workout' },
  { id: 'huahua', name: L('划划送来的', 'From phone'), match: (m, doc) => /划划/.test(m.from || '') || /^划划-/.test(doc.name || '') },
  { id: 'source', name: L('来源', 'Sources'), match: m => m.type === '来源' },
  { id: 'archive', name: L('归档', 'Archived'), match: (m, doc) => m.stage === 'archive' || isArchivedDoc(doc) },
];
window.anewView = '';
function anewViewMatch(doc) {
  const view = VIEWS.find(v => v.id === window.anewView);
  // 搜索时不藏旧版，别的时候「全部」也不含旧版（它们在「归档」里）
  if (!view || (!view.id && searchInput.value.trim())) return true;
  return view.match(metaOf(doc), doc);
}
// 每个状态一个手画的小图标（线条，跟着字的颜色走），比一个色点更说得清是什么
const VIEW_ICONS = {
  // 全部：一摞书
  all: '<svg viewBox="0 0 16 16"><rect x="1.8" y="11.2" width="12.4" height="2.8" rx=".6"/><rect x="3.2" y="8.4" width="10.4" height="2.8" rx=".6"/><rect x="2.4" y="5.6" width="10.6" height="2.8" rx=".6"/><path d="M4.6 11.2v2.8M6 8.4v2.8M5 5.6v2.8"/><path d="M10.6 5.6V2.4l1 .8 1-.8v3.2"/></svg>',
  // 学习中：台灯照着一本摊开的书
  working: '<svg viewBox="0 0 16 16"><path d="M1.6 14.2h3.6M3.4 14.2V9.2l2.4-4"/><path d="M5 4.6 6.6 3l4 3.2-2.6 2.6z"/><path d="M9.6 9.6l.5.7M11.4 8.4l.7.4" class="ray"/><path d="M8.2 14c1-.6 2-.6 3 0 1-.6 2-.6 3 0v-2.8c-1-.6-2-.6-3 0-1-.6-2-.6-3 0zM11.2 11.2V14"/></svg>',
  // 要接着想：一朵想法云，里面三个点，后面拖两个小泡
  think: '<svg viewBox="0 0 16 16"><path d="M5.6 10.2h5.6a2.6 2.6 0 0 0 .5-5.1 3.2 3.2 0 0 0-6-.4 2.75 2.75 0 0 0-.1 5.5z"/><circle cx="3.5" cy="12.4" r=".9"/><circle cx="1.8" cy="14.3" r=".5"/><path d="M6.6 7.6h0M8.4 7.6h0M10.2 7.6h0" class="dots"/></svg>',
  // 理好的：一个打了勾的圆章
  workout: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2"/><path d="m5.2 8.2 2 2 3.7-4.1" class="bold"/></svg>',
  // 划划送来的：一支荧光笔
  huahua: '<svg viewBox="0 0 16 16"><path d="m9.6 2.4 4 4-6.3 6.3-4-4z"/><path d="m3.3 8.7-.9 3 1.9 1.9 3-.9"/><path d="M1.6 14.6h4" class="mark"/></svg>',
  // 来源：一页原文，带折角和几行字
  source: '<svg viewBox="0 0 16 16"><path d="M3.5 2h6l3 3v9h-9z"/><path d="M9.5 2v3h3M5.6 7.8h4.8M5.6 10.2h4.8M5.6 12.4h2.8"/></svg>',
  // 归档：一个收纳盒
  archive: '<svg viewBox="0 0 16 16"><rect x="1.8" y="2.8" width="12.4" height="3.2" rx=".7"/><path d="M2.9 6v6.6a.9.9 0 0 0 .9.9h8.4a.9.9 0 0 0 .9-.9V6"/><path d="M6.3 8.6h3.4"/></svg>',
};
const viewsNav = document.querySelector('#views');
function paintViews() {
  if (!viewsNav) return;
  viewsNav.innerHTML = VIEWS.map(v => {
    const count = libraryDocuments.filter(doc => v.match(metaOf(doc), doc)).length;
    if (v.id && !count) return '';
    const row = `<button class="view-row view-row-${v.id || 'all'}${window.anewView === v.id ? ' on' : ''}" data-view="${v.id}"><span class="view-icon view-${v.id || 'all'}">${VIEW_ICONS[v.id || 'all'] || ''}</span><span class="view-name">${v.name}</span><small>${count}</small></button>`;
    // 「全部」高一层，下面的状态收在一组里；归档不算在「全部」里，单放最下面
    if (!v.id) return row + '<div class="view-group">';
    if (v.id === 'archive') return '</div>' + row;
    return row;
  }).join('');
  viewsNav.querySelectorAll('.view-row').forEach(b => b.onclick = () => { window.anewView = b.dataset.view; paintViews(); renderTree(); });
}
// 可选的「这一天（Diem）」联动：库是 Diem 的 notes/ 时，Diem 自己的记录本（清单、学习记录）不是学习笔记，Anew 里不显示
const DIEM_ONLY_TYPES = ['清单', '学习记录'];
const baseRenderLibraryAnew = window.renderLibrary;
window.renderLibrary = library => {
  library = { ...library, documents: (library.documents || []).filter(doc => !DIEM_ONLY_TYPES.includes(metaOf(doc).type)) };
  baseRenderLibraryAnew(library); paintViews();
  const old = libraryDocuments.filter(doc => metaOf(doc).stage === 'archive' || isArchivedDoc(doc)).length;
  document.querySelector('#library-footer').textContent = L(`${libraryDocuments.length - old} 篇在用${old ? ` · ${old} 篇旧版在「归档」` : ''}`, `${libraryDocuments.length - old} in use${old ? ` · ${old} old versions in Archived` : ''}`);
};

// ── 链接：点了用默认浏览器打开（WKWebView 自己不开新窗口，以前点了没反应） ──
document.addEventListener('click', event => {
  const a = event.target.closest && event.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href') || '';
  if (!/^(https?:|mailto:)/i.test(href)) return;
  event.preventDefault(); event.stopPropagation();
  const text = href.replace(/&amp;/g, '&');
  window.webkit.messageHandlers.openExternal.postMessage({ url: text });
  showNotice(L('在浏览器里打开：', 'Opening in browser: ') + (text.length > 60 ? text.slice(0, 60) + '…' : text));
}, true);

// ── 左边的列表：一篇一行，前面一个点是阶段，来源标一个小字；不显示文件大小 ──
// （Paper MD 按「卷几」排序，没编号的都算附件、变灰，Anew 里全是灰的，看不清）
const STAGE_RANK = { working: 0, idea: 1, workout: 2, archive: 4 };
docOrder = doc => { const m = metaOf(doc); return [0, STAGE_RANK[m.stage] ?? 3, titleFor(doc)]; };
// 标题前面那个记号：理好了 = 勾，来源写一个「来源」小标签；学习中、念头不标（分组标题已经说了阶段）
function stageMark(m) {
  if (m.type === '来源') return `<span class="src-tag">${typeLabel('来源')}</span>`;
  if (m.stage === 'workout') return '<span class="stage-check">✓</span>';
  return '';
}
// 左边显示正文的 # 标题（来源的文件名是「来源-2013BP-0927」这种，看不出是什么）；没有标题才用文件名。文件名在悬停提示里
function plainHeading(text) { return String(text || '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]|\[\[|\]\]/g, '').trim(); }
function anewTitle(doc) {
  if (doc && isArchivedDoc(doc)) return titleFor(doc);   // 旧版用文件名（「旧版-说明-日期」），不然和新版同名分不清
  const heading = plainHeading(doc?.path === activeDocument?.path ? headingOf(editor.value) : metaOf(doc)._heading);
  return heading || titleFor(doc).replace(/^(来源|source)[-_·\s]*/i, '');
}
// 字数：紧跟标题写「-15k」，3200 写「-3.2k」，不到 1000 照写；让人一眼知道这篇多大
function charsLabel(doc) {
  const n = doc?.chars;
  if (!n) return '';
  const text = n < 1000 ? String(n) : n < 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : Math.round(n / 1000) + 'k';
  return `<span class="tree-chars" title="${L(`约 ${n.toLocaleString('zh-CN')} 字`, `~${n.toLocaleString('en')} chars`)}">-${text}</span>`;
}
renderBranch = (branch, target, opts = {}) => {
  const folders = Object.entries(branch.folders).sort(([a], [b]) => (isArchiveFolder(a) - isArchiveFolder(b)) || a.localeCompare(b, 'zh-CN'));
  folders.forEach(([name, child]) => {
    const archived = opts.inArchive || isArchiveFolder(name);
    const details = document.createElement('details');
    details.open = opts.forceOpen === true || !archived;
    const summary = document.createElement('summary');
    summary.className = archived ? 'tree-folder tree-folder-archive' : 'tree-folder';
    summary.innerHTML = `<span class="tree-icon">›</span><span class="tree-title">${escapeHTML(name)}</span><span class="tree-count">${countFiles(child)}</span>`;
    summary.dataset.folder = (opts.prefix || '') + name;
    details.append(summary);
    const nested = document.createElement('div');
    nested.className = 'tree-children';
    renderBranch(child, nested, { ...opts, inArchive: archived, prefix: (opts.prefix || '') + name + '/' });
    details.append(nested);
    target.append(details);
  });
  branch.files.slice().sort((a, b) => { const x = docOrder(a), y = docOrder(b); return isFolderLead(b) - isFolderLead(a) || x[1] - y[1] || x[2].localeCompare(y[2], 'zh-CN'); }).forEach(doc => {
    const m = metaOf(doc);
    const button = document.createElement('button');
    button.className = `tree-file${activeDocument?.path === doc.path ? ' active' : ''}`;
    button.title = `${doc.relativePath || doc.name}${m.stage ? ' · ' + (STAGE_NAMES[m.stage] || m.stage) : ''}`;
    button.innerHTML = `${stageMark(m)}<span class="tree-title">${escapeHTML(anewTitle(doc))}</span>${charsLabel(doc)}`;
    button.dataset.path = doc.path;
    button.onclick = () => openNativeDocument(doc);
    target.append(button);
  });
};

// ── 来源 / 笔记顶上那一条：类型 · 阶段 · 主题 · 念头 · 出处 ──
const baseRenderPreviewAnew = renderPreview;
renderPreview = markdown => {
  baseRenderPreviewAnew(markdown);
  if (!activeDocument) return;
  const meta = metaOf({ ...activeDocument, frontmatter: parseDocument({ content: markdown }).frontmatter });
  if (!meta.type && !meta.stage) return;
  const bits = [];
  if (meta.type) bits.push(`<span class="meta-type">${escapeHTML(typeLabel(meta.type))}</span>`);
  if (meta.stage) bits.push(`<span class="meta-stage stage-${escapeHTML(meta.stage)}">${escapeHTML(STAGE_NAMES[meta.stage] || meta.stage)}</span>`);
  if (/^(true|yes|1|★)$/i.test(String(meta.star || '').trim())) bits.push(`<span class="tree-star" title="${L('重要', 'Important')}">★ ${L('重要', 'Important')}</span>`);
  if (meta.topic) bits.push(`<span>${escapeHTML(meta.topic)}</span>`);
  if (meta.published) bits.push(`<span title="${L('原文发表日期', 'Published')}">${L(`${escapeHTML(meta.published)} 发`, `published ${escapeHTML(meta.published)}`)}</span>`);
  if (meta.keep) bits.push(`<span>${escapeHTML(meta.keep)}</span>`);
  if (meta.from) bits.push(`<span>${escapeHTML(meta.from)}</span>`);
  if (meta.idea) bits.push(`<span class="meta-idea" title="${L('念头：纸上那一块', 'Idea')}">${L('念头：', 'Idea: ')}${escapeHTML(meta.idea)}${meta.idea_from && !['我', 'me'].includes(meta.idea_from) ? L(`（${escapeHTML(meta.idea_from)}递的）`, ` (from ${escapeHTML(meta.idea_from)})`) : ''}</span>`);
  if (/^https?:\/\//.test(meta.source || '')) bits.push(`<a href="${escapeHTML(meta.source)}" target="_blank" rel="noopener noreferrer">${L('原文 ↗', 'Original ↗')}</a>`);
  const bar = document.createElement('div');
  bar.className = 'meta-bar';
  bar.innerHTML = bits.join('<i>·</i>');
  content.prepend(bar);
};

// 来源只读：不进「点哪块改哪块」（笔记照常能改）
const baseStartBlockEditAnew = startBlockEdit;
startBlockEdit = (...args) => {
  if (metaOf(activeDocument).type === '来源') { showNotice(L('来源是原文，只读；选中一段就能划线', 'Sources are read-only — select text to annotate')); return; }
  baseStartBlockEditAnew(...args);
};

// ── 批注：一来一回、☆ 要接着想、讲一遍 ──
const nowText = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
noteItemHTML = (item, index, done) => {
  const quote = item.quote || '';
  const quoteHTML = quote ? `<blockquote class="note-quote">${escapeHTML(quote.length > 60 ? quote.slice(0, 60) + '…' : quote)}</blockquote>` : '';
  const time = done ? (item.resolved || item.created || '') : (item.created || '');
  const kind = (item.kind || !quote) ? `<span class="note-kind">${escapeHTML(kindLabel(item.kind || '读后感'))}</span>` : '';
  const replies = (Array.isArray(item.replies) ? item.replies : []).map(r => `
      <div class="note-reply ${r.by === 'claude' ? 'from-ai' : 'from-me'}"><span class="reply-who">${r.by === 'claude' ? 'Claude' : L('我', 'Me')}</span>${escapeHTML(r.text || '').replace(/\n/g, '<br>')}</div>`).join('');
  return `
    <div class="note-item${quote ? '' : ' standalone'}${done ? ' done' : ''}${item.follow ? ' follow' : ''}" data-id="${escapeHTML(item.id)}">
      <div class="note-head"><span class="note-index">${index}</span>${kind}<span class="note-time">${escapeHTML(time)}</span><button class="note-follow${item.follow ? ' on' : ''}" title="${item.follow ? L('取消「要接着想」', 'Stop following') : L('要接着想', 'Keep thinking')}">${item.follow ? '★' : '☆'}</button><button class="note-done${done ? ' on' : ''}" title="${done ? L('退回未处理', 'Mark as open') : L('标记为已处理', 'Mark as handled')}">${done ? '↩' : '✓'}</button><button class="note-remove" title="${L('删除', 'Delete')}">×</button></div>
      ${quoteHTML}
      <p class="note-body">${escapeHTML(item.note).replace(/\n/g, '<br>')}</p>
      ${replies ? `<div class="note-replies">${replies}</div>` : ''}
      ${done ? '' : `<textarea class="reply-input" rows="1" placeholder="${replies ? L('接着回一句… ⌘↩', 'Reply… ⌘↩') : L('补一句… ⌘↩', 'Add a line… ⌘↩')}"></textarea>`}
    </div>`;
};
const baseBindNoteItemsAnew = bindNoteItems;
bindNoteItems = root => {
  baseBindNoteItemsAnew(root);
  root.querySelectorAll('.note-item').forEach(node => {
    const find = () => notesOf(activeDocument).find(item => item.id === node.dataset.id);
    const star = node.querySelector('.note-follow');
    if (star) star.onclick = event => {
      event.stopPropagation();
      const item = find(); if (!item || notesSaving) return;
      item.follow = !item.follow; if (!item.follow) delete item.follow;
      persistNotes(); renderNotes(activeDocument);
    };
    const input = node.querySelector('.reply-input');
    if (input) {
      input.onclick = event => event.stopPropagation();
      input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${input.scrollHeight}px`; });
      input.addEventListener('keydown', event => {
        if (!((event.metaKey || event.ctrlKey) && event.key === 'Enter')) return;
        event.preventDefault();
        const text = input.value.trim(); const item = find();
        if (!text || !item || notesSaving) return;
        item.replies = [...(Array.isArray(item.replies) ? item.replies : []), { by: 'me', at: nowText(), text }];
        persistNotes(); renderNotes(activeDocument);
      });
    }
  });
};
// 有没回的回复框里打了字，也算「没存的东西」：别被自动刷新冲掉
const baseCanAutoReloadAnew = window.__paperCanAutoReload;
window.__paperCanAutoReload = () => baseCanAutoReloadAnew() && ![...document.querySelectorAll('.reply-input')].some(el => el.value.trim());

// 读后感框：有字才露出「存」；跟着字长高
const commentBox = document.querySelector('#comment-box');
commentInput.addEventListener('input', () => {
  commentBox.classList.toggle('has-text', !!commentInput.value.trim());
  commentInput.style.height = 'auto'; commentInput.style.height = `${commentInput.scrollHeight + 2}px`;
});
// 讲一遍：顶上「交给 AI」旁边那个按钮，点了右边的框变成讲一遍，存完一遍自己退回来
window.anewCommentKind = '';
const retellButton = document.querySelector('#retell');
function setRetell(on) {
  window.anewCommentKind = on ? '讲一遍' : '';
  retellButton.classList.toggle('on', on);
  commentBox.classList.toggle('retell', on);
  commentInput.placeholder = on ? L('用语音说就行：它是怎么回事、为什么、我怎么看', 'Just talk: what it is, why, what you think') : L('整篇读下来想说的……', 'Your thoughts on the whole piece…');
  commentAdd.textContent = on ? L('存下这一遍', 'Save retelling') : L('存', 'Save');
  if (on) { commentBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); commentInput.focus(); }
}
retellButton.onclick = () => {
  if (!activeDocument) { showNotice(L('先打开一篇', 'Open a document first')); return; }
  setRetell(!window.anewCommentKind);
};
document.querySelector('#retell-cancel').onclick = () => setRetell(false);

// ── 交给 AI：点开是几个选项，选一个就复制那句话，贴进 Claude Code ──
// · 这篇的回响：处理下批注 / 理一下 / 看一下这篇（原来那三句）
// · 这个主题在网页上划的、还没收的回响：收一下网页批注（Chrome 插件存的来源，回响 id 以 web- 开头），读完一批收一次
// · 笔记：重整一遍（补充阅读并进正文、重搭框架），全部读完再点
const waitingNote = item => !item.done && (() => { const r = Array.isArray(item.replies) ? item.replies : []; return typeof item.replies === 'number' ? (!item.replies || item.lastBy !== 'claude') : (!r.length || r[r.length - 1].by !== 'claude'); })();
function topicFolderOf(doc) {
  const here = folderOf(doc).split('/')[0];
  if (here) return here;
  const topic = metaOf(doc).topic;
  return topic && libraryFolders().includes(topic) ? topic : '';
}
function webPending(folder) {
  if (!folder) return { docs: 0, notes: 0 };
  let docs = 0, notes = 0;
  libraryDocuments.forEach(doc => {
    if (!(doc.relativePath || '').startsWith(folder + '/') || /(^|\/)(旧版|old-)/i.test(doc.relativePath)) return;
    const list = doc.path === activeDocument?.path && Array.isArray(activeDocument.notes) ? activeDocument.notes : (doc.noteBrief || []);
    const n = list.filter(item => String(item.id || '').startsWith('web-') && !item.done).length;
    if (n) { docs++; notes += n; }
  });
  return { docs, notes };
}
document.querySelector('#hand-ai').onclick = event => {
  if (!activeDocument) { showNotice(L('先打开一篇', 'Open a document first')); return; }
  const doc = activeDocument, path = doc.path;
  const notes = notesOf(doc);
  const open = notes.filter(item => !isNoteDone(item));
  const waiting = open.filter(waitingNote);
  const folder = topicFolderOf(doc);
  const web = webPending(folder);
  const isNote = (metaOf(doc).type || '') === '笔记';
  const hasSupplement = /^## (补充阅读|Further reading)\s*$/mi.test(doc.content || editor.value || '');
  const copy = text => { window.webkit.messageHandlers.copyText.postMessage({ text }); showNotice(L('已复制，贴进你的 AI（如 Claude Code）：', 'Copied — paste into your AI agent (e.g. Claude Code): ') + text); };
  const items = [{ header: L('复制一句话，贴进你的 AI（如 Claude Code）', 'Copy a prompt for your AI agent (e.g. Claude Code)') }];
  if (waiting.length) items.push({ label: L(`处理这篇的回响（${waiting.length} 条）`, `Process annotations (${waiting.length})`), hint: L('改进正文', 'improve the note'), action: () => copy(L(`处理下批注：${path}（${waiting.length} 条等你回）`, `Process annotations: ${path} (${waiting.length} waiting)`)) });
  else if (open.length) items.push({ label: L('理一下这篇', 'Tidy up'), hint: L('回响都回过了，理成笔记', 'all answered — turn into notes'), action: () => copy(L(`理一下：${path}（回响都回过了，理成笔记）`, `Tidy up: ${path} (all annotations answered — turn them into notes)`)) });
  if (web.notes) items.push({ label: L(`收「${folder}」的网页回响（${web.docs} 篇 ${web.notes} 条）`, `Collect web highlights in "${folder}" (${web.docs} pages, ${web.notes})`), hint: L('一批读完收一次', 'after a batch of reading'), action: () => copy(L(`收一下网页批注：${folder}（${web.docs} 篇 ${web.notes} 条）`, `Collect web annotations: ${folder} (${web.docs} pages, ${web.notes} annotations)`)) });
  if (isNote) items.push({ label: L('重整一遍', 'Rebuild'), hint: hasSupplement ? L('补充阅读并进正文、重搭框架', 'fold in further reading, rebuild the frame') : L('重搭框架、精简', 'rebuild the frame, tighten'), action: () => copy(L(`重整一遍：${path}`, `Rebuild: ${path}`)) });
  items.push({ label: L('看一下这篇', 'Look at this'), hint: L('说说讲什么、从哪入手', 'what it\'s about, where to start'), action: () => copy(L(`看一下这篇：${path}`, `Look at this: ${path}`)) });
  anewMenu(event.currentTarget, items);
};

/* ══ 自动保存：改了就存（停手 0.8 秒就写盘），⌘Z 撤回；右上角那个按钮只显示状态 ══
   以前要点「保存」才写盘，切篇、刷新、退出时容易丢。现在：
   · 编辑模式（整篇原稿）和点哪块改哪块，打字停下 0.8 秒就存；
   · 块编辑还没点别处收起来时，也会先把草稿写进文件，Esc 放弃会再存回原样；
   · 撤回：编辑模式里 ⌘Z 是输入框自己的；阅读模式里 ⌘Z 撤回上一次块修改，撤完同样自动存。 */
const saveQueue = [];          // 已发给原生、还没回话的保存：[{ path, content }]，原生按顺序一个个处理
let autosaveTimer = 0;
function paintSaveState(text, state) {
  saveButton.textContent = text;
  saveButton.dataset.state = state;
  saveButton.title = L('改了会自动保存 · ⌘Z 撤回', 'Saves automatically · ⌘Z to undo');
  if (saveState) { saveState.textContent = text; saveState.className = state; }
}
function lastQueuedContent() {
  const mine = saveQueue.filter(item => item.path === activeDocument?.path);
  return mine.length ? mine[mine.length - 1].content : (activeDocument?.content || '');
}
function flushSave() {
  clearTimeout(autosaveTimer);
  if (!hasDocument || !activeDocument) return;
  if (importingImages) { scheduleAutosave(); return; }
  if (editor.value === lastQueuedContent()) return;
  saveQueue.push({ path: activeDocument.path, content: editor.value });
  window.webkit.messageHandlers.saveDocument.postMessage({ content: editor.value });
  paintSaveState(L('保存中…', 'Saving…'), 'saving');
}
function scheduleAutosave(delay = 800) { clearTimeout(autosaveTimer); autosaveTimer = setTimeout(flushSave, delay); }

editor.addEventListener('input', () => { if (dirty) { paintSaveState(L('未保存', 'Unsaved'), 'unsaved'); scheduleAutosave(); } });

const baseSaveStatusAuto = window.saveStatus;
window.saveStatus = payload => {
  const item = saveQueue.shift();
  if (item && item.path !== activeDocument?.path) return;   // 已经切到别篇了，回话不管
  baseSaveStatusAuto(payload);
  if (payload.state === 'saved' && item) {
    activeDocument.content = item.content;                  // 存下去的是那一刻的内容，之后又打的字还算没存
    dirty = editor.value !== item.content;
  }
  saveButton.disabled = false;
  if (payload.state !== 'saved') paintSaveState(L('没存上', 'Not saved'), 'error');
  else if (dirty || saveQueue.length) { paintSaveState(saveQueue.length ? L('保存中…', 'Saving…') : L('未保存', 'Unsaved'), saveQueue.length ? 'saving' : 'unsaved'); if (!saveQueue.length) scheduleAutosave(300); }
  else paintSaveState(L('已保存', 'Saved'), 'saved');
};

saveDocument = () => { endBlockEdit(true); flushSave(); };
saveButton.onclick = saveDocument;

// 块编辑中途也存草稿：从进块之前的原稿算起，把这一块换成框里现在的内容
function syncBlockDraft() {
  const st = blockEditing; if (!st) return;
  if (st.before == null) st.before = editor.value;
  const replacement = st.isTable
    ? (({ head, rows }) => serializeTable(head, rows, st.original))(st.box.readTable())
    : st.box.querySelector('textarea').value.replace(/\s+$/, '').split('\n');
  const lines = st.before.split('\n');
  lines.splice(st.start, st.end - st.start + 1, ...replacement);
  editor.value = lines.join('\n');
  dirty = editor.value !== (activeDocument?.content || '');
  if (dirty) { paintSaveState(L('未保存', 'Unsaved'), 'unsaved'); flushSave(); }
}
let blockDraftTimer = 0;
content.addEventListener('input', event => {
  if (!blockEditing || !blockEditing.box.contains(event.target)) return;
  paintSaveState(L('未保存', 'Unsaved'), 'unsaved');
  clearTimeout(blockDraftTimer); blockDraftTimer = setTimeout(syncBlockDraft, 800);
});
const baseEndBlockEditAuto = endBlockEdit;
endBlockEdit = commit => {
  clearTimeout(blockDraftTimer);
  const st = blockEditing;
  if (st && st.before != null) editor.value = st.before;    // 先退回进块前，走原来的「收起 → 记一步撤回」
  baseEndBlockEditAuto(commit);
  if (st && st.before != null) editor.dispatchEvent(new Event('input'));   // 放弃或没改：把草稿存回去
};

// 离开这一篇之前：马上存，不再弹「尚未保存」
const baseConfirmAuto = confirmLeavingDocument;
confirmLeavingDocument = action => {
  endBlockEdit(true);
  if (hasDocument && editor.value !== lastQueuedContent()) flushSave();
  if (saveQueue.length) dirty = false;
  return baseConfirmAuto(action);
};
const baseCanAutoReloadSave = window.__paperCanAutoReload;
window.__paperCanAutoReload = () => baseCanAutoReloadSave() && !saveQueue.length;
// 切到别的 App / 窗口藏起来：马上存（块编辑不收起，只把草稿写下去）
const saveNowKeepingBlock = () => { if (blockEditing) { clearTimeout(blockDraftTimer); syncBlockDraft(); } else flushSave(); };
window.addEventListener('blur', saveNowKeepingBlock);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNowKeepingBlock(); });

const baseSelectDocumentAuto = selectDocument;
selectDocument = doc => { clearTimeout(autosaveTimer); baseSelectDocumentAuto(doc); saveButton.disabled = false; paintSaveState(L('已保存', 'Saved'), 'saved'); };

/* ══ 重画正文时不跳：按「看到第几段、离顶多少」对回去，而不是按像素 ══
   加批注、标已处理、删批注、外面改了文件，都会整篇重画。重画那一下图片要重新解码，
   高度先塌成 0 再撑开，按像素还原的话，页面一短浏览器就把你往上拽——上面图越多拽得越狠。
   现在：重画前记住视口顶上那一段，重画后跳回那一段；之后每张图加载完再对一次，
   直到你自己动了滚轮 / 键盘为止。 */
// 先挂「标改动」，再在最外层挂「对回位置」：顶上那条改动栏也算进去
const baseRenderPreviewReview = renderPreview;
renderPreview = markdown => { baseRenderPreviewReview(markdown); paintReview(); };
let renderedPath = null, renderToken = 0, userScrollAt = 0;
['wheel', 'keydown', 'touchmove'].forEach(type => window.addEventListener(type, () => { userScrollAt = Date.now(); }, { passive: true, capture: true }));
const baseRenderPreviewKeep = renderPreview;
renderPreview = markdown => {
  const same = renderedPath && renderedPath === activeDocument?.path && content.querySelector('[data-line]') && !isEditing;
  const anchor = same ? previewAnchor() : null;
  baseRenderPreviewKeep(markdown);
  renderedPath = activeDocument?.path || null;
  if (!anchor) return;
  const token = ++renderToken, at = Date.now();
  // 10/1：以前借 scrollPreviewToLine，它把 gap 夹到 ≥0——顶上那段读到一半时，重画后被拽回段首，
  // 看起来就是「加完批注页面往上跳」。这里按原样对回：那一段离顶多少（可以是负的）就还是多少。
  const restore = () => {
    if (token !== renderToken || userScrollAt >= at) return;
    let target = null;
    for (const el of content.querySelectorAll('[data-line]')) { if ((Number(el.dataset.line) || 0) <= anchor.line) target = el; else break; }
    if (!target) return;
    window.scrollTo({ top: Math.max(0, window.scrollY + target.getBoundingClientRect().top - chromeTop() - anchor.gap), behavior: 'instant' });
  };
  restore();
  content.querySelectorAll('img').forEach(img => { if (!img.complete) img.addEventListener('load', restore, { once: true }); });
};

/* ══ 图片也能批注：鼠标移到图上，右上角出「＋ 批注这张图」 ══
   批注的 quote 记成「[图] 图注（文件名）」，Claude 那边一看就知道是哪张。 */
const imgNoteBtn = document.createElement('button');
imgNoteBtn.className = 'img-note-btn'; imgNoteBtn.textContent = L('＋ 给这张图写回响', '＋ Annotate this image'); imgNoteBtn.hidden = true;
document.body.appendChild(imgNoteBtn);
let imgNoteTarget = null;
const imageFileName = img => decodeURIComponent((img.dataset.imageSource || img.getAttribute('src') || '').split('/').pop() || '');
const imageQuote = img => L(`[图] ${(img.getAttribute('alt') || '').trim()}（${imageFileName(img)}）`, `[image] ${(img.getAttribute('alt') || '').trim()} (${imageFileName(img)})`);
function placeImgNoteBtn(img) {
  const r = img.getBoundingClientRect();
  imgNoteBtn.hidden = false;
  const top = Math.max(r.top + 10, chromeTop() + 8);
  if (top > r.bottom - 30) { imgNoteBtn.hidden = true; return; }
  imgNoteBtn.style.top = `${top}px`;
  imgNoteBtn.style.left = `${Math.max(8, r.right - imgNoteBtn.offsetWidth - 10)}px`;
}
content.addEventListener('mouseover', event => {
  const img = event.target.closest && event.target.closest('img');
  if (!img || isEditing || !hasDocument) return;
  imgNoteTarget = img; placeImgNoteBtn(img);
});
content.addEventListener('mouseout', event => {
  if (!event.target.closest || !event.target.closest('img')) return;
  if (event.relatedTarget === imgNoteBtn) return;
  imgNoteBtn.hidden = true;
});
imgNoteBtn.addEventListener('mouseleave', event => { if (event.relatedTarget !== imgNoteTarget) imgNoteBtn.hidden = true; });
document.addEventListener('scroll', () => { imgNoteBtn.hidden = true; }, true);
imgNoteBtn.onmousedown = event => event.preventDefault();
imgNoteBtn.onclick = () => {
  if (!imgNoteTarget) return;
  const r = imgNoteBtn.getBoundingClientRect();
  imgNoteBtn.hidden = true;
  openNotePopover(imageQuote(imgNoteTarget), { top: r.top, bottom: r.bottom, left: r.left });
};
// 正文里标出有批注的图；右边点这条批注，跳到那张图
const baseHighlightImg = highlightNotes;
highlightNotes = doc => {
  baseHighlightImg(doc);
  notesOf(doc).filter(item => /^\[(图|image)\]/.test(item.quote || '')).forEach(item => {
    const img = [...content.querySelectorAll('img')].find(el => (item.quote || '').includes(`（${imageFileName(el)}）`));
    if (!img) return;
    img.classList.add('noted-img'); if (item.done) img.classList.add('resolved');
    img.dataset.noteId = item.id;
  });
};
document.addEventListener('click', event => {
  const node = event.target.closest && event.target.closest('.note-item');
  if (!node || event.target.closest('button,textarea')) return;
  const img = content.querySelector(`img[data-note-id="${CSS.escape(node.dataset.id)}"]`);
  if (!img) return;
  if (isEditing) toggleEditor();
  img.scrollIntoView({ block: 'center', behavior: 'smooth' });
  img.classList.add('flash'); setTimeout(() => img.classList.remove('flash'), 900);
});

/* ══ 看改动：Claude（或别处）改过、你还没确认的地方，正文里标出来 ══
   原生那边给一份「上次确认的版本」（baseline）。现稿和它逐行比，
   每一处不同标成一块：左边一道绿线，左侧有 ✓ 确认 / ↩ 还原；顶上一条「这次改了 N 处 · 全部确认」。
   · 确认：把这一处写进 baseline，标记消失，正文不动；
   · 还原：把正文这一处改回 baseline 的样子（自动保存，⌘Z 能撤回）；
   · 你自己在 Anew 里改的地方，存盘时自动算确认，不会标成改动。 */
function lineDiff(a, b) {
  // 先去掉相同的头尾，中间用 LCS；返回不同的段 [{ bStart, bEnd, cStart, cEnd }]（b = baseline 行，c = 现稿行，end 不含）
  let pre = 0; while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0; while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf), B = b.slice(pre, b.length - suf);
  const n = A.length, m = B.length, hunks = [];
  if (!n && !m) return hunks;
  if (!n || !m || n * m > 25e6) return [{ bStart: pre, bEnd: pre + n, cStart: pre, cEnd: pre + m }];
  const w = m + 1, dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i * w + j] = A[i] === B[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
  let i = 0, j = 0, open = null;
  const close = () => { if (open) { hunks.push({ bStart: pre + open.i, bEnd: pre + i, cStart: pre + open.j, cEnd: pre + j }); open = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { close(); i++; j++; }
    else { if (!open) open = { i, j }; if (j < m && (i >= n || dp[i * w + j + 1] >= dp[(i + 1) * w + j])) j++; else i++; }
  }
  close();
  return hunks;
}
function reviewHunks(baseline, current) {
  const b = baseline.split('\n'), c = current.split('\n'), body = bodyLineOffset(current);
  return lineDiff(b, c).filter(h => {
    const blank = b.slice(h.bStart, h.bEnd).every(l => !l.trim()) && c.slice(h.cStart, h.cEnd).every(l => !l.trim());
    const inHeader = h.cEnd <= body && h.cStart < body;      // 只动了开头的属性，正文里看不见，不打扰
    return !blank && !inHeader;
  });
}
function applyToBaseline(baseline, current, hunks) {
  const b = baseline.split('\n'), c = current.split('\n');
  hunks.slice().sort((x, y) => y.bStart - x.bStart).forEach(h => b.splice(h.bStart, h.bEnd - h.bStart, ...c.slice(h.cStart, h.cEnd)));
  return b.join('\n');
}
function setBaseline(text) {
  if (!activeDocument) return;
  activeDocument.baseline = text;
  window.webkit.messageHandlers.saveBaseline.postMessage({ path: activeDocument.path, content: text });
}
/* 10/1：框里具体哪几个字改了。把这一块改之前的原文也渲染一遍，和现在的字逐字比：
   新加 / 改过的字下面一道绿线（鼠标停上去看原来是什么），删掉的字划掉、小一号留在原处。 */
function charRuns(a, b) {
  let pre = 0; while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0; while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const n = a.length - pre - suf, m = b.length - pre - suf;
  if (!n && !m) return [];
  if (!n || !m || n * m > 4e6) return [{ aStart: pre, aEnd: pre + n, bStart: pre, bEnd: pre + m }];
  const A = a.slice(pre, pre + n), B = b.slice(pre, pre + m), w = m + 1, dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i * w + j] = A[i] === B[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
  const runs = []; let i = 0, j = 0, open = null;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) {
      if (open) { runs.push({ aStart: pre + open.i, aEnd: pre + i, bStart: pre + open.j, bEnd: pre + j }); open = null; }
      i++; j++;
    } else { if (!open) open = { i, j }; if (j < m && (i >= n || dp[i * w + j + 1] >= dp[(i + 1) * w + j])) j++; else i++; }
  }
  if (open) runs.push({ aStart: pre + open.i, aEnd: pre + n, bStart: pre + open.j, bEnd: pre + m });
  // 中间只隔一两个没变的字（逐字比常把「的」「了」凑巧对上），连成一段，免得碎成一粒一粒
  const merged = [];
  runs.forEach(r => {
    const last = merged[merged.length - 1];
    if (last && r.bStart - last.bEnd <= 2 && r.aStart - last.aEnd <= 2) { last.aEnd = r.aEnd; last.bEnd = r.bEnd; }
    else merged.push({ ...r });
  });
  return merged;
}
function markChangedText(els, oldMarkdown) {
  const box = document.createElement('div');
  box.innerHTML = markdownToHTML(oldMarkdown);
  const before = [...box.children].map(el => el.textContent).join('');
  const nodes = []; let after = '';
  els.forEach(el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: node => node.parentElement.closest('.chg-tools,.chg-del,.chg-cut') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    let node; while ((node = walker.nextNode())) { nodes.push({ node, start: after.length }); after += node.nodeValue; }
  });
  if (!nodes.length || before === after) return;
  charRuns(before, after).reverse().forEach(r => {
    const old = before.slice(r.aStart, r.aEnd);
    if (r.bEnd > r.bStart) {
      for (const entry of nodes.slice().reverse()) {
        const start = Math.max(0, r.bStart - entry.start), end = Math.min(entry.node.length, r.bEnd - entry.start);
        if (start >= end) continue;
        const range = document.createRange(); range.setStart(entry.node, start); range.setEnd(entry.node, end);
        const span = document.createElement('span');
        span.className = 'chg-word'; span.title = old.trim() ? L(`原来是：${old}`, `Was: ${old}`) : L('新加的', 'Added');
        range.surroundContents(span);
      }
    } else if (old.trim()) {
      // 删在两段字的交界（比如列表一项的末尾）：跟着前面那段字，别跑到下一项开头
      const entry = nodes.find(e => r.bStart > e.start && r.bStart <= e.start + e.node.length) || nodes[0];
      const cut = document.createElement('del');
      cut.className = 'chg-cut'; cut.title = L(`删掉了：${old}`, `Removed: ${old}`);
      cut.textContent = old.length > 30 ? old.slice(0, 30) + '…' : old;
      const offset = Math.min(entry.node.length, r.bStart - entry.start);
      if (offset >= entry.node.length) entry.node.after(cut); else entry.node.splitText(offset).before(cut);
    }
  });
}
let reviewList = [];
// 10/1：一个列表 / 表格 / 段落里改了好几行，以前每行一处、各挂一对 ✓ ↩，叠在同一个角上，要点好几次。
// 现在落在同一块（或挨着的几块）上的改动合成一处，一次确认 / 还原。starts = 顶层每块从原文第几行开始
function groupHunks(hunks, starts) {
  const endOf = k => k + 1 < starts.length ? starts[k + 1] : Infinity;
  const groups = [];
  hunks.forEach(h => {
    let hit = starts.map((at, k) => k).filter(k => h.cEnd > h.cStart && starts[k] < h.cEnd && endOf(k) > h.cStart);
    if (!hit.length) {                     // 纯删除：删在某一块中间（列表少了一项）就算那一块的
      const inside = starts.findIndex((at, k) => at < h.cStart && endOf(k) > h.cStart);
      if (inside >= 0) hit = [inside];
    }
    const last = groups[groups.length - 1];
    if (last && hit.length && last.blocks.length && hit[0] <= last.blocks[last.blocks.length - 1]) {
      last.hunks.push(h); hit.forEach(k => { if (!last.blocks.includes(k)) last.blocks.push(k); });
    } else groups.push({ hunks: [h], blocks: hit });
  });
  return groups;
}
/* 10/3：左边「新 N」数的是正文改了几块（和顶上「有 N 处改动还没确认」同一个数），不是处理了几条批注。
   没打开的篇：原生那边带来基准和现稿，在这里按同一套规则数；打开的这篇：顶上那条画完就更新。 */
function countChangeGroups(baseline, current) {
  if (baseline == null || current == null || baseline === current) return 0;
  const hunks = reviewHunks(baseline, current);
  if (!hunks.length) return 0;
  const shift = bodyLineOffset(current);
  const starts = [...markdownToHTML(parseDocument({ content: current }).body).matchAll(/ data-line="(\d+)"/g)].map(m => Number(m[1]) + shift);
  return groupHunks(hunks, starts).length;
}
function noteChangeCount(path, count) {
  const doc = libraryDocuments.find(d => d.path === path);
  if (!doc || doc.changeCount === count) return;
  doc.changeCount = count;
  if (typeof renderTree === 'function') renderTree();
}
function paintReview() {
  content.querySelectorAll('.chg-bar,.chg-del,.chg-tools').forEach(el => el.remove());
  content.querySelectorAll('.chg').forEach(el => { el.classList.remove('chg'); delete el.dataset.hunk; });
  content.querySelectorAll('.chg-cut').forEach(el => el.remove());
  content.querySelectorAll('.chg-word').forEach(el => el.replaceWith(...el.childNodes));
  content.normalize();
  reviewList = [];
  if (!activeDocument || activeDocument.baseline == null || isEditing) return;
  const current = editor.value;
  if (activeDocument.baseline === current) { noteChangeCount(activeDocument.path, 0); return; }
  const hunks = reviewHunks(activeDocument.baseline, current);
  if (!hunks.length) { noteChangeCount(activeDocument.path, 0); return; }
  const blocks = [...content.children].filter(el => el.dataset && el.dataset.line != null);
  const cLines = current.split('\n'), bLines = activeDocument.baseline.split('\n');
  const lineOf = el => Number(el.dataset.line);
  const endOf = k => k + 1 < blocks.length ? lineOf(blocks[k + 1]) : Infinity;
  const groups = groupHunks(hunks, blocks.map(lineOf));
  noteChangeCount(activeDocument.path, groups.length);
  groups.forEach((g, index) => {
    const hit = g.blocks.map(k => blocks[k]);
    let first = hit[0];
    if (!first) {
      // 纯删除：在删掉的位置放一条细线
      const h = g.hunks[0];
      const next = blocks.find(el => lineOf(el) >= h.cStart);
      const marker = document.createElement('div');
      marker.className = 'chg-del'; marker.dataset.hunk = index;
      marker.textContent = L(`这里删了 ${h.bEnd - h.bStart} 行`, `${h.bEnd - h.bStart} lines removed here`);
      if (next) next.before(marker); else content.appendChild(marker);
      first = marker;
    }
    hit.forEach(el => { el.classList.add('chg'); el.dataset.hunk = index; });
    if (hit.length) {
      // 这几块改之前长什么样：现稿这几行，把每处改动换回 baseline 的样子
      const from = Math.min(lineOf(hit[0]), ...g.hunks.map(h => h.cStart));
      const lastK = g.blocks[g.blocks.length - 1];
      const to = Math.max(Math.min(endOf(lastK), cLines.length), ...g.hunks.map(h => h.cEnd));
      const old = cLines.slice(from, to);
      g.hunks.slice().sort((x, y) => y.cStart - x.cStart).forEach(h => old.splice(h.cStart - from, h.cEnd - h.cStart, ...bLines.slice(h.bStart, h.bEnd)));
      markChangedText(hit, old.join('\n'));
    }
    const tools = document.createElement('span');
    tools.className = 'chg-tools';
    tools.innerHTML = `<button class="chg-ok" title="${L('确认这一处', 'Accept this change')}">✓</button><button class="chg-undo" title="${L('还原成改之前', 'Revert this change')}">↩</button>`;
    tools.querySelector('.chg-ok').onclick = event => { event.stopPropagation(); acceptHunk(index); };
    tools.querySelector('.chg-undo').onclick = event => { event.stopPropagation(); revertHunk(index); };
    first.classList.add('chg-first');
    // 表格、列表里不能直接塞 span：放进第一格 / 第一项，定位仍然相对整块
    const holder = first.tagName === 'TABLE' ? first.querySelector('th,td') : (/^(UL|OL)$/.test(first.tagName) ? first.querySelector('li') : null);
    (holder || first).appendChild(tools);
    reviewList.push({ hunks: g.hunks, el: first });
  });
  const bar = document.createElement('div');
  bar.className = 'chg-bar';
  bar.innerHTML = L(`<span>有 <b>${groups.length}</b> 处改动还没确认（绿线标出）</span><button class="chg-next">下一处 ↓</button><button class="chg-all">全部确认</button>`, `<span><b>${groups.length}</b> changes to review (marked in green)</span><button class="chg-next">Next ↓</button><button class="chg-all">Accept all</button>`);
  bar.querySelector('.chg-all').onclick = () => { setBaseline(editor.value); renderPreview(editor.value); };
  let cursor = -1;
  bar.querySelector('.chg-next').onclick = () => {
    const top = chromeTop() + 60;
    const nextIndex = reviewList.findIndex(item => item.el.getBoundingClientRect().top > top + 4);
    cursor = nextIndex >= 0 ? nextIndex : 0;
    const el = reviewList[cursor].el;
    window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - chromeTop() - 70, behavior: 'smooth' });
    el.classList.add('chg-flash'); setTimeout(() => el.classList.remove('chg-flash'), 900);
  };
  const meta = content.querySelector('.meta-bar');
  if (meta) meta.after(bar); else content.prepend(bar);
}
function acceptHunk(index) {
  const item = reviewList[index]; if (!item) return;
  setBaseline(applyToBaseline(activeDocument.baseline, editor.value, item.hunks));
  renderPreview(editor.value);
}
function revertHunk(index) {
  const item = reviewList[index]; if (!item) return;
  const b = activeDocument.baseline.split('\n'), c = editor.value.split('\n');
  const before = editor.value;
  item.hunks.slice().sort((x, y) => y.cStart - x.cStart).forEach(h => c.splice(h.cStart, h.cEnd - h.cStart, ...b.slice(h.bStart, h.bEnd)));
  blockUndo.push(before); if (blockUndo.length > 50) blockUndo.shift();
  editor.value = c.join('\n');
  editor.dispatchEvent(new Event('input'));
  renderPreview(editor.value);
}

// 你自己改、存盘的时候：碰到的那几处算确认（不然你改一个字，也会被标成改动）
const baseFlushSaveReview = flushSave;
flushSave = () => {
  if (activeDocument && activeDocument.baseline != null && hasDocument) {
    const before = lastQueuedContent(), after = editor.value;
    if (before !== after) {
      const mine = lineDiff(before.split('\n'), after.split('\n'));
      const pending = lineDiff(activeDocument.baseline.split('\n'), after.split('\n'));
      const touched = pending.filter(p => mine.some(m => p.cStart <= m.cEnd && m.cStart <= p.cEnd));
      if (touched.length) { setBaseline(applyToBaseline(activeDocument.baseline, after, touched)); if (!isEditing && !blockEditing) paintReview(); }
    }
  }
  baseFlushSaveReview();
};

/* ══ 0.3 · 文件名跟着标题走、移到废纸篓 ══
   改了 # 标题、文件名没跟着改，左边就找不到这篇。
   · 正文第一个 # 标题和文件名对不上：顶上提一句，点一下改文件名（回响、修改记录、链接、Diem 纸上挂的一起改）；
   · 右边「文件」：改名…、移到废纸篓（以前 Anew 里删不了，只能去 Diem 删）。 */
function headingOf(markdown) {
  const body = String(markdown || '').replace(/^---\n[\s\S]*?\n---\n?/, '');
  const m = body.match(/^#\s+(.+?)\s*#*\s*$/m);
  return m ? m[1].replace(/[*_`]/g, '').trim() : '';
}
const fileBase = doc => (doc?.name || '').replace(/\.(md|markdown|mdown|mkdn)$/i, '');
function waitSaved(then) {
  flushSave();
  if (saveQueue.length || dirty) { showNotice(L('还在保存，稍等一下再点', 'Still saving — try again in a moment')); return; }
  then();
}
function askRename(name, ask) {
  if (!activeDocument) return;
  waitSaved(() => window.webkit.messageHandlers.renameDocument.postMessage({ path: activeDocument.path, name, ask }));
}
const nameHintSkipKey = doc => `nameHintSkip:${doc.path}`;
const baseRenderPreviewName = renderPreview;
renderPreview = markdown => {
  baseRenderPreviewName(markdown);
  if (!activeDocument || metaOf(activeDocument).type === '来源') return;   // 来源的文件名是「来源-说明-日期」，本来就和标题不一样
  const base = fileBase(activeDocument);
  // 10/2：刚从这条提示改了名，给一次反悔的机会
  let undo = null; try { undo = JSON.parse(localStorage.getItem('nameHintUndo') || 'null'); } catch {}
  if (undo && undo.to === activeDocument.path) {
    const back = document.createElement('div');
    back.className = 'name-hint';
    back.innerHTML = L(`<span>文件名刚从「${escapeHTML(undo.base)}」改成了「${escapeHTML(base)}」</span><button class="name-hint-go">改回「${escapeHTML(undo.base)}」</button><button class="name-hint-skip">就这样</button>`, `<span>Renamed from "${escapeHTML(undo.base)}" to "${escapeHTML(base)}"</span><button class="name-hint-go">Change back</button><button class="name-hint-skip">Keep it</button>`);
    const clear = () => { try { localStorage.removeItem('nameHintUndo'); } catch {} back.remove(); };
    back.querySelector('.name-hint-go').onclick = () => { try { localStorage.setItem(nameHintSkipKey({ path: undo.from }), undo.heading); } catch {} clear(); askRename(undo.base, false); };
    back.querySelector('.name-hint-skip').onclick = clear;
    const meta = content.querySelector('.meta-bar');
    if (meta) meta.after(back); else content.prepend(back);
    return;
  }
  // 旧版、归档的文件名是「旧版-说明-日期」，和标题不一样是故意的，不提
  if (isArchivedDoc(activeDocument) || metaOf(activeDocument).stage === 'archive') return;
  const heading = headingOf(markdown).replace(/[/:]/g, '');
  let skipped = ''; try { skipped = localStorage.getItem(nameHintSkipKey(activeDocument)) || ''; } catch {}
  if (!heading || heading === base || skipped === heading) return;
  const hint = document.createElement('div');
  hint.className = 'name-hint';
  hint.innerHTML = L(`<span>标题是「<b>${escapeHTML(heading)}</b>」，文件名还叫「${escapeHTML(base)}」</span><button class="name-hint-go">文件名改成「${escapeHTML(heading)}」</button><button class="name-hint-skip" title="这篇就这样，不再提">不用</button>`, `<span>The title is "<b>${escapeHTML(heading)}</b>" but the file is "${escapeHTML(base)}"</span><button class="name-hint-go">Rename file to match</button><button class="name-hint-skip" title="Don't ask again for this one">No thanks</button>`);
  hint.querySelector('.name-hint-go').onclick = () => {
    const dir = activeDocument.path.slice(0, activeDocument.path.lastIndexOf('/') + 1), ext = activeDocument.path.match(/\.[^./]+$/)?.[0] || '.md';
    try { localStorage.setItem('nameHintUndo', JSON.stringify({ from: activeDocument.path, to: dir + heading + ext, base, heading })); } catch {}
    askRename(heading, false);
  };
  hint.querySelector('.name-hint-skip').onclick = () => { try { localStorage.setItem(nameHintSkipKey(activeDocument), heading); } catch {} hint.remove(); };
  const meta = content.querySelector('.meta-bar');
  if (meta) meta.after(hint); else content.prepend(hint);
};

// 右边「文件」一栏
const fileSection = document.createElement('section');
fileSection.id = 'file-section';
fileSection.hidden = true;
fileSection.innerHTML = `<div class="inspector-label">${L('文件', 'File')}</div><div class="file-name" id="file-name"></div><div class="file-actions"><button id="file-rename" class="file-action">${L('改名…', 'Rename…')}</button><button id="file-trash" class="file-action danger">${L('移到废纸篓', 'Move to Trash')}</button></div>`;
document.querySelector('#logs-section').after(fileSection);
fileSection.querySelector('#file-rename').onclick = () => askRename(headingOf(editor.value) || fileBase(activeDocument), true);
fileSection.querySelector('#file-trash').onclick = () => {
  if (!activeDocument) return;
  waitSaved(() => window.webkit.messageHandlers.trashDocument.postMessage({ path: activeDocument.path }));
};
const baseRenderInspectorFile = renderInspector;
renderInspector = doc => {
  baseRenderInspectorFile(doc);
  fileSection.hidden = !doc;
  if (doc) { const el = fileSection.querySelector('#file-name'); el.textContent = doc.relativePath || doc.name; el.title = doc.path; }
};
const baseRenderLibraryFile = window.renderLibrary;
window.renderLibrary = library => { baseRenderLibraryFile(library); if (!library.keepingDocument) fileSection.hidden = true; };

// 原生改完名 / 删完：「最近的文档」跟上
window.__docRenamed = (from, to) => {
  try {
    const next = recentDocs().map(item => item.path === from ? { ...item, path: to, name: to.split('/').pop().replace(/\.(md|markdown|mdown|mkdn)$/i, '') } : item);
    localStorage.setItem('recentDocs', JSON.stringify(next));
    localStorage.removeItem(`nameHintSkip:${from}`);
  } catch {}
};
window.__docTrashed = path => {
  try { localStorage.setItem('recentDocs', JSON.stringify(recentDocs().filter(item => item.path !== path))); } catch {}
  saveQueue.length = 0; clearTimeout(autosaveTimer); dirty = false;
};

/* ══ 0.4 · 管库：Anew 是笔记、知识、想法的家 ══
   新建（笔记 / 要接着想 / 来源）、顶上那条点着改属性、左边右键（改名、移动、归档、访达、废纸篓）、
   右边「谁链着这篇」、顶上「念头」点回 Diem 纸上那一块。真正动文件的都在原生那边。 */
const post = (name, body) => window.webkit.messageHandlers[name].postMessage(body);
const docByPath = path => libraryDocuments.find(doc => doc.path === path);
const folderOf = doc => ((doc?.relativePath || '').split('/').slice(0, -1).join('/'));
function libraryFolders() {
  const set = new Set();
  libraryDocuments.forEach(doc => { const parts = (doc.relativePath || '').split('/').slice(0, -1); parts.forEach((_, i) => set.add(parts.slice(0, i + 1).join('/'))); });
  return [...set].sort((a, b) => (isArchiveFolder(a) - isArchiveFolder(b)) || a.localeCompare(b, 'zh-CN'));
}
function libraryTopics() {
  const set = new Set(libraryDocuments.map(doc => metaOf(doc).topic).filter(Boolean));
  libraryFolders().filter(f => !f.includes('/') && !isArchiveFolder(f)).forEach(f => set.add(f));
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}
// 对某一篇动手：正在看的这篇先把没存的存掉
function actOn(doc, then) { if (doc && doc.path === activeDocument?.path) waitSaved(then); else then(); }

// ── 小菜单 ──
let openMenuEl = null;
function closeAnewMenu() { if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; } }
function anewMenu(at, items) {
  closeAnewMenu();
  const menu = document.createElement('div');
  menu.className = 'anew-menu';
  items.forEach(item => {
    if (item === '-') { menu.append(Object.assign(document.createElement('div'), { className: 'am-sep' })); return; }
    if (item.header) { menu.append(Object.assign(document.createElement('div'), { className: 'am-head', textContent: item.header })); return; }
    const b = document.createElement('button');
    b.className = `am-item${item.danger ? ' danger' : ''}${item.on ? ' on' : ''}`;
    b.innerHTML = `<span>${escapeHTML(item.label)}</span>${item.hint ? `<small>${escapeHTML(item.hint)}</small>` : ''}`;
    b.onclick = event => { event.stopPropagation(); closeAnewMenu(); item.action(); };
    menu.append(b);
  });
  document.body.append(menu);
  const r = at.getBoundingClientRect ? at.getBoundingClientRect() : { left: at.x, bottom: at.y, top: at.y };
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
  menu.style.top = `${r.bottom + h + 8 > innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
  openMenuEl = menu;
}
document.addEventListener('mousedown', event => { if (openMenuEl && !openMenuEl.contains(event.target)) closeAnewMenu(); }, true);
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeAnewMenu(); });
addEventListener('scroll', closeAnewMenu, true);

// ── 新建 ──
function newDocMenu(at, folder) {
  const where = folder ? L(`放在「${folder}」`, `in "${folder}"`) : L('放在库的最外层', 'at the library root');
  anewMenu(at, [
    { header: where },
    { label: L('新笔记', 'New note'), hint: L('学习中', 'working'), action: () => post('newDocument', { kind: '笔记', folder }) },
    { label: L('要接着想的', 'Keep-thinking note'), hint: L('念头', 'idea'), action: () => post('newDocument', { kind: '要接着想', folder }) },
    { label: L('存一篇来源', 'Save a source'), hint: L('贴网址', 'paste a URL'), action: () => post('newDocument', { kind: '来源', folder }) },
  ]);
}
const newButton = document.createElement('button');
newButton.id = 'new-doc'; newButton.className = 'plus-button new-doc'; newButton.title = L('新建：笔记、要接着想的、来源', 'New: note, keep-thinking, source'); newButton.textContent = L('新建', 'New');
document.querySelector('#open-file').before(newButton);
document.querySelector('#open-file').title = L('打开库外面的单个文件', 'Open a single file outside the library');
newButton.onclick = () => newDocMenu(newButton, folderOf(activeDocument));

// ── 属性 ──
const TYPES = ['笔记', '来源', '要接着想', '清单', '设计'];
const STAGES = ['idea', 'working', 'workout', 'archive'];
function setProp(doc, key, value) { if (doc) actOn(doc, () => post('setProperty', { path: doc.path, key, value })); }
function stageMenu(at, doc) {
  const cur = metaOf(doc).stage;
  anewMenu(at, [{ header: L('阶段', 'Stage') }, ...STAGES.map(s => ({ label: STAGE_NAMES[s], hint: s, on: s === cur, action: () => setProp(doc, 'stage', s) }))]);
}
function typeMenu(at, doc) {
  const cur = metaOf(doc).type;
  anewMenu(at, [{ header: L('类型', 'Type') }, ...TYPES.map(t => ({ label: typeLabel(t), on: t === cur, action: () => setProp(doc, 'type', typeValue(t)) }))]);
}
function topicMenu(at, doc) {
  const cur = metaOf(doc).topic;
  anewMenu(at, [{ header: L('主题', 'Topic') }, ...libraryTopics().map(t => ({ label: t, on: t === cur, action: () => setProp(doc, 'topic', t) })), '-',
    { label: L('新主题…', 'New topic…'), action: () => { const t = (prompt(L('新主题叫什么？', 'Name of the new topic?'), '') || '').trim(); if (t) setProp(doc, 'topic', t); } }]);
}

// ── 念头点回纸上 ──
function diemTarget(doc) {
  const m = String(metaOf(doc).diem || '').match(/^(paper-[\w-]+)(?:#(.+))?$/);
  if (m) return { paper: m[1], block: m[2] || '' };
  const b = (doc?.backlinks || []).find(x => x.paper);
  return b ? { paper: b.paper, block: b.block } : null;
}
function openInDiem(target) { if (target) { post('openDiem', target); showNotice(L('在「这一天」里打开纸上那一块', 'Opening in Diem')); } }

// 顶上那条：类型、阶段、主题点一下就能改；没有属性的也给一条
const baseRenderPreviewProps = renderPreview;
renderPreview = markdown => {
  baseRenderPreviewProps(markdown);
  const doc = activeDocument;
  if (!doc || !hasDocument) return;
  const meta = metaOf({ ...doc, frontmatter: parseDocument({ content: markdown }).frontmatter });
  let bar = content.querySelector('.meta-bar');
  if (!bar) {
    bar = document.createElement('div'); bar.className = 'meta-bar meta-bar-empty';
    bar.innerHTML = `<span class="meta-type meta-add">${L('＋ 类型', '＋ Type')}</span><i>·</i><span class="meta-stage meta-add">${L('＋ 阶段', '＋ Stage')}</span>`;
    content.prepend(bar);
  }
  const typeEl = bar.querySelector('.meta-type'), stageEl = bar.querySelector('.meta-stage');
  if (typeEl) { typeEl.classList.add('meta-click'); typeEl.title = L('点一下改类型', 'Click to change type'); typeEl.onclick = () => typeMenu(typeEl, doc); }
  if (stageEl) { stageEl.classList.add('meta-click'); stageEl.title = L('点一下改阶段', 'Click to change stage'); stageEl.onclick = () => stageMenu(stageEl, doc); }
  let topicEl = meta.topic ? [...bar.querySelectorAll('span')].find(el => !el.className && el.textContent === meta.topic) : null;
  if (!topicEl) {
    topicEl = document.createElement('span'); topicEl.className = 'meta-add'; topicEl.textContent = L('＋ 主题', '＋ Topic');
    const dot = document.createElement('i'); dot.textContent = '·';
    (stageEl || typeEl).after(dot, topicEl);
  }
  topicEl.classList.add('meta-click', 'meta-topic'); topicEl.title = L('点一下改主题', 'Click to change topic'); topicEl.onclick = () => topicMenu(topicEl, doc);
  const idea = bar.querySelector('.meta-idea'), target = diemTarget(doc);
  if (idea && target) { idea.classList.add('meta-click'); idea.title = L('回到 Diem 纸上那一块', 'Open in Diem'); idea.onclick = () => openInDiem(target); }
};

// ── 左边右键 ──
function moveMenu(at, doc) {
  const here = folderOf(doc);
  anewMenu(at, [{ header: L('挪到哪个文件夹', 'Move to folder') },
    ...(here ? [{ label: L('库的最外层', 'Library root'), action: () => actOn(doc, () => post('moveDocument', { path: doc.path, folder: '' })) }] : []),
    ...libraryFolders().filter(f => f !== here).map(f => ({ label: f, action: () => actOn(doc, () => post('moveDocument', { path: doc.path, folder: f })) })),
    '-', { label: L('新文件夹…', 'New folder…'), action: () => actOn(doc, () => post('moveDocument', { path: doc.path, ask: true })) }]);
}
function fileMenu(at, doc) {
  const archived = metaOf(doc).stage === 'archive';
  anewMenu(at, [
    { label: L('打开', 'Open'), action: () => openNativeDocument(doc) },
    { label: L('改名…', 'Rename…'), action: () => actOn(doc, () => post('renameDocument', { path: doc.path, name: doc.path === activeDocument?.path ? (headingOf(editor.value) || fileBase(doc)) : fileBase(doc), ask: true })) },
    { label: L('移动到…', 'Move to…'), action: () => moveMenu(at, doc) },
    { label: archived ? L('取消归档', 'Unarchive') : L('归档', 'Archive'), hint: archived ? L('回到学习中', 'back to working') : L('理完、不用了', 'done with it'), action: () => setProp(doc, 'stage', archived ? 'working' : 'archive') },
    { label: L('改阶段…', 'Change stage…'), action: () => stageMenu(at, doc) },
    '-',
    { label: L('在访达里显示', 'Show in Finder'), action: () => post('revealDocument', { path: doc.path }) },
    { label: L('移到废纸篓', 'Move to Trash'), danger: true, action: () => actOn(doc, () => post('trashDocument', { path: doc.path })) },
  ]);
}
document.querySelector('#file-tree').addEventListener('contextmenu', event => {
  const file = event.target.closest('.tree-file[data-path]');
  const folder = event.target.closest('[data-folder]');
  if (!file && !folder) return;
  event.preventDefault();
  const at = { x: event.clientX, y: event.clientY };
  if (file) { const doc = docByPath(file.dataset.path); if (doc) fileMenu(at, doc); }
  else newDocMenu(at, folder.dataset.folder);
});

// ── 右边：谁链着这篇 ──
const backSection = document.createElement('section');
backSection.id = 'backlinks-section'; backSection.hidden = true;
backSection.innerHTML = `<div class="inspector-label">${L('谁链着这篇', 'Linked from')}</div><div id="backlinks" class="backlinks"></div>`;
document.querySelector('#links-section').after(backSection);
const baseRenderInspectorBack = renderInspector;
renderInspector = doc => {
  baseRenderInspectorBack(doc);
  const list = doc?.backlinks || [];
  backSection.hidden = !list.length;
  const box = backSection.querySelector('#backlinks');
  // Diem 那边一件事只给一条：排上时间轴的只说时间轴，在池塘里的只说池塘，都没有才说纸上（原生那边挑好了）
  const KINDS = { time: L('时间轴', 'Timeline'), pond: L('池塘', 'Pond'), block: L('纸上', 'Paper'), note: L('笔记', 'Note') };
  box.innerHTML = list.map((b, i) => `<button class="backlink bl-${b.kind}" data-i="${i}"><span class="bl-kind">${KINDS[b.kind] || ''}</span><span class="bl-text">${escapeHTML(b.kind === 'note' ? b.title : (b.text || b.block))}${b.when ? `<small class="bl-when">${escapeHTML(b.when)}</small>` : ''}</span></button>`).join('');
  box.querySelectorAll('.backlink').forEach(btn => btn.onclick = () => {
    const b = list[+btn.dataset.i];
    if (b.paper) openInDiem({ paper: b.paper, block: b.block });
    else { const target = docByPath(b.path); if (target) openNativeDocument(target); }
  });
};

// ── 左边「全部」：一眼看出先学什么 ──
// 一个主题（文件夹）是一个学习单元：主笔记当入口，来源收在它下面（来源一般不单独看）。
// 按阶段分段：学习中 → 念头 → 其他；理好了收在最下面，默认折起来。段里按最近动过的排前面。
const SECTIONS = [
  { id: 'working', name: L('学习中', 'Working') },
  { id: 'idea', name: L('念头', 'Ideas') },
  { id: 'none', name: L('其他', 'Other') },
  { id: 'workout', name: L('理好了', 'Done'), closed: true },
];
function anewStore(key, value) {
  try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch { return null; }
}
// 文件夹的主笔记：标题里带着文件夹名的笔记（比如「X/X 是怎么长大的」「X/读书笔记 · X」），排在文件夹第一个、当入口
function isFolderLead(doc) {
  const parts = (doc.relativePath || doc.name || '').split('/');
  const folder = parts.length > 1 ? parts[parts.length - 2] : '';
  return Boolean(folder) && !isArchiveFolder(folder) && metaOf(doc).type !== '来源' && titleFor(doc).includes(folder);
}
function learningUnits(docs) {
  const units = new Map();
  docs.forEach(doc => {
    const parts = (doc.relativePath || doc.name).split('/');
    const k = parts.length > 1 ? 'd:' + parts[0] : 'f:' + doc.path;
    if (!units.has(k)) units.set(k, { folder: parts.length > 1 ? parts[0] : '', docs: [] });
    units.get(k).docs.push(doc);
  });
  // 根上的「X.md」和同名文件夹「X/」是一套（X.md 当入口）。
  // 「读书笔记 · X.md」这种标题里带着文件夹名、主题也是 X 的，也算一套。
  const twinOf = doc => {
    const title = titleFor(doc), m = metaOf(doc);
    if (m.type === '来源') return null;
    const tail = title.split('·').pop().trim();
    return units.get('d:' + title) || units.get('d:' + tail)
      || (m.topic && title.includes(m.topic) ? units.get('d:' + m.topic) : null);
  };
  for (const [k, u] of [...units]) {
    if (!k.startsWith('f:')) continue;
    const twin = twinOf(u.docs[0]);
    if (twin && !twin.lead) { twin.docs.push(...u.docs); twin.lead = u.docs[0]; units.delete(k); }
  }
  const rank = d => STAGE_RANK[metaOf(d).stage] ?? 3;
  const pick = list => list.slice().sort((a, b) => rank(a) - rank(b) || (b.modified || 0) - (a.modified || 0))[0];
  return [...units.values()].map(u => {
    // 文件夹里只有来源、还没有笔记：入口是文件夹本身，不拿一篇来源顶上去
    const lead = u.lead || pick(u.docs.filter(isFolderLead)) || pick(u.docs.filter(d => metaOf(d).type !== '来源')) || (u.folder ? null : pick(u.docs));
    const stage = metaOf(lead || pick(u.docs)).stage;
    const rest = u.docs.filter(d => d !== lead);
    return {
      ...u, lead,
      section: ['working', 'idea', 'workout'].includes(stage) ? stage : 'none',
      latest: Math.max(...u.docs.map(d => d.modified || 0)),
      notes: rest.filter(d => metaOf(d).type !== '来源').sort((a, b) => rank(a) - rank(b) || titleFor(a).localeCompare(titleFor(b), 'zh-CN')),
      // 来源按原文发表的时间排，早的在上（读一个人、一家公司，按时间顺下来就是一条线）；没写 published 的排最后
      sources: rest.filter(d => metaOf(d).type === '来源').sort((a, b) => byPublished(a, b) || titleFor(a).localeCompare(titleFor(b), 'zh-CN')),
    };
  });
}
// 来源属性里的 published: 2023-07-26（或只到月 2024-05）= 原文什么时候发的；star: true = Claude 觉得重要的
const publishedOf = doc => (String(metaOf(doc).published || '').match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/) || null);
function byPublished(a, b) {
  const key = d => { const p = publishedOf(d); return p ? [p[1], p[2] || '00', p[3] || '00'].map(x => x.padStart(2, '0')).join('-') : '9999'; };
  return key(a).localeCompare(key(b));
}
function publishedLabel(doc) {
  const p = publishedOf(doc);
  if (!p) return '';
  return `<span class="tree-date" title="${L('原文发表于 ', 'Published ')}${escapeHTML(metaOf(doc).published)}">${p[1]}${p[2] ? '.' + Number(p[2]) : ''}</span>`;
}
const isStarred = doc => /^(true|yes|1|★)$/i.test(String(metaOf(doc).star || '').trim());
function anewFileButton(doc, extra = '') {
  const m = metaOf(doc);
  const button = document.createElement('button');
  button.className = `tree-file${activeDocument?.path === doc.path ? ' active' : ''}`;
  button.title = `${doc.relativePath || doc.name}${m.stage ? ' · ' + (STAGE_NAMES[m.stage] || m.stage) : ''}`;
  const star = isStarred(doc) ? `<span class="tree-star" title="${L('重要', 'Important')}">★</span>` : '';
  button.innerHTML = `${stageMark(m)}${star}<span class="tree-title">${escapeHTML(anewTitle(doc))}</span>${charsLabel(doc)}${m.type === '来源' ? publishedLabel(doc) : ''}${extra}`;
  button.dataset.path = doc.path;
  button.onclick = () => openNativeDocument(doc);
  return button;
}
function anewUnit(u) {
  const wrap = document.createElement('div');
  wrap.className = 'unit';
  const key = 'anew.unit.' + (u.folder || u.lead.path);
  const activeInside = u.docs.some(d => d !== u.lead && d.path === activeDocument?.path);
  const hasKids = u.notes.length + u.sources.length > 0;
  const head = document.createElement('div');
  head.className = 'unit-head';
  if (u.folder) head.dataset.folder = u.folder;
  const caret = document.createElement('span');
  caret.className = 'unit-caret' + (hasKids ? '' : ' none');
  caret.textContent = hasKids ? '›' : '';
  const kids = u.sources.length ? `<span class="unit-count" title="${L('来源', 'Sources')}">${u.sources.length}</span>` : '';
  let headButton;
  if (u.lead) headButton = anewFileButton(u.lead, kids);
  else {
    // 还没有笔记的文件夹：显示文件夹名，点了展开 / 收起
    headButton = document.createElement('button');
    headButton.className = 'tree-file unit-folder';
    headButton.title = L(`${u.folder}/ · 还没有笔记，只有来源`, `${u.folder}/ · sources only, no note yet`);
    headButton.innerHTML = `<span class="src-tag">${L('文件夹', 'Folder')}</span><span class="tree-title">${escapeHTML(u.folder)}</span>${kids}`;
    headButton.onclick = () => caret.click();
  }
  head.append(caret, headButton);
  wrap.append(head);
  if (!hasKids) return wrap;
  const body = document.createElement('div');
  body.className = 'unit-body';
  u.notes.forEach(d => body.append(anewFileButton(d)));
  // 来源直接列在笔记下面（标题前有「来源」小标签），不再单独折一层「来源 ›」
  u.sources.forEach(d => body.append(anewFileButton(d)));
  wrap.append(body);
  const setOpen = open => { wrap.classList.toggle('open', open); body.hidden = !open; };
  setOpen(activeInside || anewStore(key) === '1');
  caret.onclick = event => { event.stopPropagation(); const open = !wrap.classList.contains('open'); setOpen(open); anewStore(key, open ? '1' : '0'); };
  return wrap;
}
window.anewGroupedTree = docs => {
  const units = learningUnits(docs);
  SECTIONS.forEach(sec => {
    const list = units.filter(u => u.section === sec.id).sort((a, b) => b.latest - a.latest);
    if (!list.length) return;
    const details = document.createElement('details');
    details.className = `tree-section section-${sec.id}`;
    const stored = anewStore('anew.section.' + sec.id);
    details.open = stored ? stored === '1' : !sec.closed;
    if (list.some(u => u.docs.some(d => d.path === activeDocument?.path))) details.open = true;
    details.innerHTML = `<summary><span class="section-name">${sec.name}</span><small>${list.length}</small></summary>`;
    details.ontoggle = () => anewStore('anew.section.' + sec.id, details.open ? '1' : '0');
    list.forEach(u => details.append(anewUnit(u)));
    fileTree.append(details);
  });
};

// ── 读到哪了：正文左边一条进度，标读了多少、还剩几分钟（按每分钟 400 字算）──
(() => {
  const bar = document.querySelector('#read-progress');
  const fill = bar.querySelector('.read-progress-fill');
  const label = bar.querySelector('.read-progress-label');
  const readingArea = document.querySelector('.reading-area');
  const PER_MINUTE = 400;
  let idle = 0;
  const maxScroll = () => document.documentElement.scrollHeight - innerHeight;
  function paint() {
    bar.hidden = !hasDocument;
    if (!hasDocument) return;
    bar.style.left = `${Math.max(0, readingArea.getBoundingClientRect().left)}px`;
    const max = maxScroll();
    const ratio = max <= 4 ? 1 : Math.min(1, Math.max(0, scrollY / max));
    fill.style.height = `${ratio * 100}%`;
    const total = activeDocument ? activeDocument.body.replace(/\s/g, '').length : 0;
    const left = Math.round(total * (1 - ratio) / PER_MINUTE);
    label.textContent = ratio >= 0.995 ? L('读完了', 'Finished') : `${Math.round(ratio * 100)}% · ${left < 1 ? L('不到 1 分钟', 'under a minute left') : L(`还剩约 ${left} 分钟`, `~${left} min left`)}`;
    const h = bar.clientHeight;
    label.style.top = `${Math.min(h - 14, Math.max(14, ratio * h))}px`;
  }
  addEventListener('scroll', () => {
    paint();
    bar.classList.add('active');
    clearTimeout(idle); idle = setTimeout(() => bar.classList.remove('active'), 1500);
  }, { passive: true });
  addEventListener('resize', paint);
  new ResizeObserver(paint).observe(document.querySelector('#content'));
  bar.addEventListener('click', event => {
    const box = bar.getBoundingClientRect();
    window.scrollTo({ top: (event.clientY - box.top) / box.height * maxScroll(), behavior: 'smooth' });
  });
  paint();
})();

/* ── 在这篇里找（⌘F）：只找阅读模式的正文；标黄用 CSS Highlight，不动正文的 DOM ── */
(() => {
  const bar = document.createElement('div');
  bar.id = 'find-bar'; bar.className = 'find-bar'; bar.hidden = true;
  bar.innerHTML = `<span class="find-icon">⌕</span><input id="find-input" type="text" placeholder="${L('在这篇里找', 'Find in document')}" spellcheck="false" aria-label="${L('在这篇里找', 'Find in document')}"><span class="find-count"></span><button class="find-step" data-step="-1" title="${L('上一处（⇧⌘G）', 'Previous (⇧⌘G)')}">‹</button><button class="find-step" data-step="1" title="${L('下一处（⌘G）', 'Next (⌘G)')}">›</button><button class="find-close" title="${L('关掉（Esc）', 'Close (Esc)')}">×</button>`;
  document.body.appendChild(bar);
  const input = bar.querySelector('#find-input');
  const count = bar.querySelector('.find-count');
  const canHighlight = typeof Highlight === 'function' && window.CSS && CSS.highlights;
  let matches = [], current = -1, rerun = 0;

  function place() {
    const area = document.querySelector('.reading-area').getBoundingClientRect();
    const toolbar = document.querySelector('.toolbar').getBoundingClientRect();
    bar.style.top = `${toolbar.bottom + 10}px`;
    bar.style.right = `${Math.max(12, innerWidth - area.right + 20)}px`;
  }
  // 正文里的文字节点，跳过改动标记（删掉的字、「这里删了 N 行」、✓ ↩）和按钮
  function textNodes() {
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.parentElement.closest('.chg-tools,.chg-del,.chg-cut,button') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    const nodes = []; let node;
    while ((node = walker.nextNode())) nodes.push(node);
    return nodes;
  }
  // 把文字节点接成一条长串再找：划线高亮、加粗把一个词切成两半时也找得到
  function search(keepPlace) {
    const query = input.value.trim().toLowerCase();
    const before = matches[current];
    matches = [];
    if (query && hasDocument && !isEditing) {
      const nodes = textNodes(), starts = [];
      let text = '';
      nodes.forEach(node => { starts.push(text.length); text += node.data; });
      text = text.toLowerCase();
      let n = 0;
      const locate = offset => { while (n < nodes.length - 1 && starts[n + 1] <= offset) n++; return [nodes[n], offset - starts[n]]; };
      for (let at = text.indexOf(query); at !== -1; at = text.indexOf(query, at + query.length)) {
        const range = document.createRange();
        range.setStart(...locate(at));
        const [endNode, endOffset] = locate(at + query.length - 1);
        range.setEnd(endNode, endOffset + 1);
        matches.push(range);
      }
    }
    if (!matches.length) current = -1;
    else if (keepPlace && before) {          // 重画以后接着停在原来那一处附近
      const y = before.getBoundingClientRect().top;
      const i = matches.findIndex(r => r.getBoundingClientRect().top >= y - 2);
      current = i === -1 ? matches.length - 1 : i;
    } else {                                 // 新打的字：从屏幕上能看见的第一处开始
      const top = document.querySelector('.toolbar').getBoundingClientRect().bottom;
      const i = matches.findIndex(r => r.getBoundingClientRect().bottom > top);
      current = i === -1 ? 0 : i;
    }
    paint(!keepPlace);
  }
  function paint(scroll) {
    count.textContent = !input.value.trim() ? '' : matches.length ? `${current + 1} / ${matches.length}` : L('没有', 'None');
    bar.classList.toggle('miss', !!input.value.trim() && !matches.length);
    if (canHighlight) {
      CSS.highlights.set('find-all', new Highlight(...matches));
      CSS.highlights.set('find-current', current >= 0 ? new Highlight(matches[current]) : new Highlight());
    }
    if (scroll && current >= 0) {
      const box = matches[current].getBoundingClientRect();
      if (box.top < 90 || box.bottom > innerHeight - 40) window.scrollTo({ top: scrollY + box.top - innerHeight * 0.4 });
    }
  }
  function step(direction) {
    if (bar.hidden) { open(); return; }
    if (!matches.length) return;
    current = (current + direction + matches.length) % matches.length;
    paint(true);
  }
  function open() {
    if (!hasDocument) return;
    if (isEditing) { showNotice(L('编辑模式里先不能找，⌘E 回到阅读再找', 'Find works in reading mode — press ⌘E first')); return; }
    place();
    bar.hidden = false;
    const picked = String(getSelection()).trim();
    if (picked && picked.length < 60 && !picked.includes('\n')) input.value = picked;
    input.focus(); input.select();
    search(false);
  }
  function close() {
    bar.hidden = true;
    matches = []; current = -1;
    if (canHighlight) { CSS.highlights.delete('find-all'); CSS.highlights.delete('find-current'); }
  }

  input.addEventListener('input', () => search(false));
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); step(event.shiftKey ? -1 : 1); }
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  });
  bar.querySelectorAll('.find-step').forEach(button => button.onclick = () => step(+button.dataset.step));
  bar.querySelector('.find-close').onclick = close;
  document.addEventListener('keydown', event => {
    if (!bar.hidden && event.key === 'Escape' && notePopover.hidden) close();
  });
  // 加批注、确认改动、换篇都会重画正文：重画完再找一遍，标黄不掉
  new MutationObserver(() => {
    if (bar.hidden) return;
    clearTimeout(rerun); rerun = setTimeout(() => search(true), 60);
  }).observe(content, { childList: true, subtree: true, characterData: true });
  addEventListener('resize', () => { if (!bar.hidden) place(); });
  editButton.addEventListener('click', close);

  window.__anewFind = open;
  window.__anewFindStep = step;
})();

/* ── 长文有目录：右边一栏列出这篇的 #/##/### 小标题，点了跳过去；读到哪一节就亮哪一节 ── */
(() => {
  const section = document.createElement('section');
  section.id = 'toc-section'; section.hidden = true;
  section.innerHTML = `<button class="inspector-label toc-label"><span class="toc-caret">▾</span>${L('目录', 'Contents')} · <span class="toc-count"></span></button><div class="toc-list"></div>`;
  document.querySelector('#document-tags-section').after(section);
  const list = section.querySelector('.toc-list');
  const label = section.querySelector('.toc-label');
  let heads = [], current = -1;
  const setFolded = folded => { section.classList.toggle('folded', folded); try { localStorage.setItem('anew.toc.folded', folded ? '1' : '0'); } catch {} };
  try { section.classList.toggle('folded', localStorage.getItem('anew.toc.folded') === '1'); } catch {}
  label.onclick = () => setFolded(!section.classList.contains('folded'));

  function build() {
    heads = isEditing ? [] : [...content.querySelectorAll(':scope > h1, :scope > h2, :scope > h3')];
    // 开头那个 # 标题就是这篇的名字，不算；剩下不到 2 个就不用目录
    if (heads[0] && heads[0].tagName === 'H1' && heads[0] === content.querySelector(':scope > [data-line]')) heads.shift();
    section.hidden = heads.length < 2;
    if (section.hidden) { list.innerHTML = ''; current = -1; return; }
    const top = Math.min(...heads.map(h => +h.tagName[1]));
    section.querySelector('.toc-count').textContent = heads.length;
    list.innerHTML = heads.map((h, i) => `<button class="toc-item toc-l${+h.tagName[1] - top}" data-i="${i}" title="${escapeHTML(h.textContent)}">${escapeHTML(h.textContent)}</button>`).join('');
    list.querySelectorAll('.toc-item').forEach(b => b.onclick = () => {
      const h = heads[+b.dataset.i];
      if (!h || !h.isConnected) return;
      window.scrollTo({ top: Math.max(0, scrollY + h.getBoundingClientRect().top - chromeTop() - 14), behavior: 'smooth' });
    });
    current = -1; spy();
  }
  function spy() {
    if (section.hidden) return;
    const line = chromeTop() + 40;
    let i = -1;
    heads.forEach((h, k) => { if (h.getBoundingClientRect().top <= line) i = k; });
    if (i === current) return;
    current = i;
    list.querySelectorAll('.toc-item').forEach((b, k) => b.classList.toggle('on', k === i));
    const on = list.querySelector('.toc-item.on');
    if (on) {   // 亮的那条露在目录框里
      const box = list.getBoundingClientRect(), r = on.getBoundingClientRect();
      if (r.top < box.top || r.bottom > box.bottom) list.scrollTop += r.top - box.top - box.height / 2;
    }
  }
  const baseRenderPreviewToc = renderPreview;
  renderPreview = markdown => { baseRenderPreviewToc(markdown); build(); };
  editButton.addEventListener('click', () => setTimeout(build, 0));
  addEventListener('scroll', spy, { passive: true });
})();

/* ── 图能点开放大：点正文里的图，铺满窗口看；再点一下、Esc 关 ── */
(() => {
  const box = document.createElement('div');
  box.className = 'img-zoom'; box.hidden = true;
  box.innerHTML = '<img alt=""><div class="img-zoom-cap"></div>';
  document.body.appendChild(box);
  const big = box.querySelector('img'), cap = box.querySelector('.img-zoom-cap');
  let fit = true;
  function open(img) {
    big.src = img.currentSrc || img.src;
    cap.textContent = (img.getAttribute('alt') || '').trim();
    fit = true; box.classList.remove('actual'); box.hidden = false;
    imgNoteBtn.hidden = true;
  }
  function close() { box.hidden = true; big.removeAttribute('src'); }
  // 捕获阶段先拦下：不然单击图会进「改这一块」
  content.addEventListener('click', event => {
    const img = event.target.closest && event.target.closest('img');
    if (!img || isEditing || !hasDocument || img.classList.contains('image-error')) return;
    const sel = getSelection();
    if (sel && !sel.isCollapsed && String(sel).trim()) return;
    event.preventDefault(); event.stopPropagation();
    open(img);
  }, true);
  // 点图本身：铺满 ↔ 原大（原大时可以滚着看）；点图外面关
  big.addEventListener('click', event => {
    event.stopPropagation();
    if (big.naturalWidth <= box.clientWidth && big.naturalHeight <= box.clientHeight) { close(); return; }
    fit = !fit; box.classList.toggle('actual', !fit);
  });
  box.addEventListener('click', close);
  document.addEventListener('keydown', event => {
    if (!box.hidden && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  }, true);
  content.addEventListener('mouseover', event => {
    const img = event.target.closest && event.target.closest('img');
    if (img && !isEditing) img.title = img.title || L('点一下放大', 'Click to enlarge');
  });
})();

/* ── 记住读到哪：每篇记「看到第几段、离顶多少」，下次打开停在那里 ── */
(() => {
  const keyOf = doc => 'anew.pos.' + doc.path;
  let restoring = 0, saveTimer = 0;
  function save() {
    if (!hasDocument || isEditing || !activeDocument || Date.now() < restoring) return;
    const anchor = scrollY < 40 ? null : previewAnchor();
    try {
      if (anchor) localStorage.setItem(keyOf(activeDocument), JSON.stringify({ line: anchor.line, gap: Math.round(anchor.gap), at: Date.now() }));
      else localStorage.removeItem(keyOf(activeDocument));
    } catch {}
  }
  addEventListener('scroll', () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 500); }, { passive: true });
  const baseSelectDocumentPos = selectDocument;
  selectDocument = doc => {
    const fresh = !(activeDocument && activeDocument.path === doc.path) && pendingScroll == null;
    if (activeDocument && activeDocument.path !== doc.path) { clearTimeout(saveTimer); save(); }
    baseSelectDocumentPos(doc);
    if (!fresh) return;
    let pos = null;
    try { pos = JSON.parse(localStorage.getItem(keyOf(doc)) || 'null'); } catch {}
    if (!pos) return;
    const at = Date.now();
    restoring = at + 1500;
    // 图片加载完页面会变长，每张图好了再对一次，直到你自己动了滚轮 / 键盘
    let moved = false;
    const stop = () => { moved = true; restoring = 0; };
    ['wheel', 'keydown', 'touchmove', 'mousedown'].forEach(t => addEventListener(t, stop, { once: true, passive: true, capture: true }));
    const go = () => {
      if (moved || activeDocument?.path !== doc.path) return;
      let target = null;
      for (const el of content.querySelectorAll('[data-line]')) { if ((Number(el.dataset.line) || 0) <= pos.line) target = el; else break; }
      if (target) window.scrollTo({ top: Math.max(0, scrollY + target.getBoundingClientRect().top - chromeTop() - pos.gap), behavior: 'instant' });
    };
    go();
    content.querySelectorAll('img').forEach(img => { if (!img.complete) img.addEventListener('load', go, { once: true }); });
    if (scrollY > 40) showNotice(L('停在上次读到的地方', 'Back where you left off'));
  };
  addEventListener('beforeunload', save);
  window.addEventListener('blur', save);
})();

/* ── 学习时间轴：一天里读了哪几篇、每篇多久、来回交叠成什么样；批注落在读它的那一刻 ──
   料是现成的：Diem 记录器的 usage/<日期>.json（Anew 在前台时窗口标题就是文档名），加上库里的批注。 */
(() => {
  const view = document.createElement('section');
  view.id = 'timeline-view'; view.className = 'timeline-view'; view.hidden = true;
  document.querySelector('.reading-area').prepend(view);
  // 第一篇用 App 的主色（蓝），往后几色都压暗一点，和琥珀色的批注点分得开
  const COLORS = ['var(--moss)', 'var(--clay)', '#5f8a6e', '#7a5a86', '#3f7f7a', '#8a6d3b', '#9a5468', '#6b7a99'];
  const pad = n => String(n).padStart(2, '0');
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hm = sec => `${pad(Math.floor(sec / 3600))}:${pad(Math.floor(sec % 3600 / 60))}`;
  const dur = sec => { const m = Math.round(sec / 60); return m >= 60 ? L(`${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分` : ''}`, `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`) : L(`${Math.max(1, m)} 分钟`, `${Math.max(1, m)} min`); };
  let date = dayKey(new Date());
  // 从工具栏点开、今天又什么都没有（没读也没批注，比如刚装好的示例库）：跳到最近一天有批注的
  let seekLatest = false;

  function open(d, latest = false) {
    if (d) date = d;
    seekLatest = latest;
    document.body.classList.add('timeline-mode');
    view.hidden = false;
    view.innerHTML = `<div class="tl-loading">${L('在读这天的记录…', 'Loading this day…')}</div>`;
    paintViews();
    post('loadTimeline', { date });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function close() {
    if (view.hidden) return;
    document.body.classList.remove('timeline-mode');
    view.hidden = true; view.innerHTML = '';
    paintViews();
  }
  window.__anewTimeline = { open, close };

  // 批注的时间：0.2 以前写的是 UTC，tz: local 的是本地
  const when = (text, local) => text ? new Date(text.replace(' ', 'T') + (local ? ':00' : ':00Z')) : null;
  const secOfDay = d => d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();

  window.__timelineData = data => {
    if (view.hidden || data.date !== date) return;
    const docsByName = {};
    libraryDocuments.forEach(doc => { if (!docsByName[doc.name] || isArchivedDoc(docsByName[doc.name])) docsByName[doc.name] = doc; });
    const docsByRel = Object.fromEntries(libraryDocuments.map(doc => [doc.relativePath || doc.name, doc]));
    const lanes = new Map();
    const laneOf = (key, doc, label) => {
      if (!lanes.has(key)) lanes.set(key, { key, doc, label, blocks: [], marks: [], first: Infinity });
      return lanes.get(key);
    };
    // 读：同一篇隔不到 90 秒的接成一段
    data.segments.slice().sort((a, b) => a.s - b.s).forEach(seg => {
      const name = String(seg.title || '').replace(/ · (知新 )?Anew$/, '').trim();
      if (!name || /^(知新 )?Anew$/.test(name) || !/\.(md|markdown)$/i.test(name)) return;
      const doc = docsByName[name];
      const lane = laneOf(doc ? doc.path : name, doc, doc ? anewTitle(doc) : name.replace(/\.md$/i, ''));
      const last = lane.blocks[lane.blocks.length - 1];
      if (last && seg.s - last.e <= 90) last.e = Math.max(last.e, seg.e);
      else lane.blocks.push({ s: seg.s, e: seg.e });
      lane.first = Math.min(lane.first, seg.s);
    });
    // 写：这天的批注、回复，落在那一篇的那一刻
    data.notes.forEach(file => {
      const doc = docsByRel[file.rel];
      file.items.forEach(item => {
        const events = [];
        const c = when(item.created, item.tz === 'local');
        if (c) events.push({ at: c, by: 'me', text: item.note || '', kind: item.kind || '划线' });
        (item.replies || []).forEach(r => { const t = when(r.at, true); if (t) events.push({ at: t, by: r.by === 'claude' ? 'claude' : 'me', text: '', kind: r.by === 'claude' ? L('Claude 回', 'Claude replied') : L('回复', 'Reply') }); });
        events.filter(ev => dayKey(ev.at) === date).forEach(ev => {
          const lane = laneOf(doc ? doc.path : file.rel, doc, doc ? anewTitle(doc) : file.rel.replace(/\.md$/i, ''));
          const s = secOfDay(ev.at);
          lane.marks.push({ ...ev, s });
          lane.first = Math.min(lane.first, s);
        });
      });
    });
    // Diem 自己的清单、学习记录不是学习，不画
    const all = [...lanes.values()].filter(l => !(l.doc && DIEM_ONLY_TYPES.includes(metaOf(l.doc).type))).sort((a, b) => a.first - b.first);
    all.forEach(lane => { lane.read = lane.blocks.reduce((n, b) => n + b.e - b.s, 0); });
    // 不到 2 分钟、也没写批注的，只是翻了一眼：收进最后一行，不占一条泳道
    // 库里找不到的（后来改了名、删了，或是 Diem 那边的清单）也收进最后一行
    const list = all.filter(l => l.doc && (l.read >= 120 || l.marks.length));
    const glance = all.filter(l => !list.includes(l));
    list.forEach((lane, i) => { lane.color = COLORS[i % COLORS.length]; });
    if (seekLatest && !list.length) {
      seekLatest = false;
      const days = data.notes.flatMap(file => file.items.flatMap(item => [when(item.created, item.tz === 'local'), ...(item.replies || []).map(r => when(r.at, true))]))
        .filter(d => d && !isNaN(d)).map(dayKey).filter(k => k < date).sort();
      if (days.length) { open(days[days.length - 1]); return; }
    }
    seekLatest = false;
    paint(list, data, glance);
  };

  function dayTitle() {
    const d = new Date(date + 'T12:00:00');
    const today = dayKey(new Date()), yest = dayKey(new Date(Date.now() - 864e5));
    return L(`${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${'日一二三四五六'[d.getDay()]}`, d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })) + (date === today ? L(' · 今天', ' · Today') : date === yest ? L(' · 昨天', ' · Yesterday') : '');
  }
  function shift(days) { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + days); open(dayKey(d)); }

  function paint(list, data, glance = []) {
    const read = list.reduce((n, l) => n + l.read, 0);
    const mine = list.reduce((n, l) => n + l.marks.filter(m => m.by === 'me').length, 0);
    const claude = list.reduce((n, l) => n + l.marks.filter(m => m.by === 'claude').length, 0);
    const isToday = date === dayKey(new Date());
    let html = `<div class="tl-head"><button class="tl-step" data-d="-1" title="${L('前一天', 'Previous day')}">‹</button><h1>${dayTitle()}</h1><button class="tl-step" data-d="1" title="${L('后一天', 'Next day')}"${isToday ? ' disabled' : ''}>›</button>${isToday ? '' : `<button class="tl-today">${L('回到今天', 'Today')}</button>`}<button class="tl-close" title="${L('回到正文', 'Back to document')}">×</button></div>`;
    if (!list.length) {
      view.innerHTML = html + `<div class="tl-empty">${data.hasUsage ? L('这天没在 Anew 里读东西，也没写回响。', 'Nothing read or annotated in Anew this day.') : L('这天没有回响。', 'No annotations this day.')}</div>`;
      bind(); return;
    }
    html += L(`<div class="tl-sum">${data.hasUsage ? `<b>读 ${dur(read)}</b> · ` : ''}${list.length} 篇 · 写了 ${mine} 条回响 / 回复${claude ? ` · Claude 回了 ${claude} 条` : ''}${data.hasUsage ? '' : ' · 只有回响，没有阅读时长'}</div>`, `<div class="tl-sum">${data.hasUsage ? `<b>Read ${dur(read)}</b> · ` : ''}${list.length} docs · ${mine} annotations / replies${claude ? ` · Claude answered ${claude}` : ''}${data.hasUsage ? '' : ' · annotations only, no reading time'}</div>`);
    const starts = list.flatMap(l => [...l.blocks.map(b => b.s), ...l.marks.map(m => m.s)]);
    const ends = list.flatMap(l => [...l.blocks.map(b => b.e), ...l.marks.map(m => m.s)]);
    // 时间轴不是均匀的：没在 Anew 里的空档超过 40 分钟，压成一小段「⋯」，不然半夜读了几分钟、白天再读，中间全是空白
    const GAP = 40 * 60, PADDING = 5 * 60;
    const spans = [];
    list.flatMap(l => [...l.blocks.map(b => [b.s, b.e]), ...l.marks.map(m => [m.s, m.s])]).sort((a, b) => a[0] - b[0]).forEach(([a, b]) => {
      const last = spans[spans.length - 1];
      if (last && a - last[1] <= GAP) last[1] = Math.max(last[1], b); else spans.push([a, b]);
    });
    spans.forEach(sp => { sp[0] = Math.max(0, sp[0] - PADDING); sp[1] = Math.min(86400, sp[1] + PADDING); });
    const GAP_W = 2.5;
    const active = spans.reduce((n, sp) => n + sp[1] - sp[0], 0);
    const scale = (100 - GAP_W * (spans.length - 1)) / active;
    const offsets = []; let acc = 0;
    spans.forEach((sp, i) => { offsets.push(acc); acc += (sp[1] - sp[0]) * scale + (i < spans.length - 1 ? GAP_W : 0); });
    const pos = t => {
      for (let i = 0; i < spans.length; i++) {
        if (t <= spans[i][1]) return offsets[i] + Math.max(0, t - spans[i][0]) * scale;
      }
      return 100;
    };
    const x = t => pos(t).toFixed(3) + '%';
    const w = (a, b) => Math.max(0.25, pos(b) - pos(a)).toFixed(3) + '%';
    // 刻度：每段开头标一下，段里按整点标（段太窄的不标整点，免得挤在一起）
    const ticks = [];
    spans.forEach(sp => {
      ticks.push({ t: sp[0], head: true });
      // 段里大约每 12% 宽一个刻度，取整到 5 / 10 / 15 / 30 分钟、1 / 2 小时
      const want = (sp[1] - sp[0]) / Math.max(1, (sp[1] - sp[0]) * scale / 12);
      const step = [300, 600, 900, 1800, 3600, 7200].find(v => v >= want) || 7200;
      for (let t = Math.ceil((sp[0] + step / 3) / step) * step; t < sp[1] - step / 3; t += step) ticks.push({ t });
      if (sp === spans[spans.length - 1]) ticks.push({ t: sp[1], head: true });
    });
    ticks.sort((a, b) => a.t - b.t);
    for (let i = ticks.length - 1; i > 0; i--) if (pos(ticks[i].t) - pos(ticks[i - 1].t) < 5) ticks.splice(ticks[i].head ? i - 1 : i, 1);
    const breaks = spans.slice(1).map((sp, i) => ({ at: offsets[i + 1] - GAP_W / 2, gap: sp[0] - spans[i][1] }));
    const axis = `<div class="tl-axis">${ticks.map(k => `<span class="${k.head ? 'head' : ''}" style="left:${x(k.t)}">${hm(k.t)}</span>`).join('')}</div>`;
    const grid = `<div class="tl-grid">${ticks.map(k => `<i style="left:${x(k.t)}"></i>`).join('')}${breaks.map(b => `<b class="tl-break" style="left:${b.at.toFixed(3)}%" title="${L(`这中间 ${dur(b.gap)}没在 Anew 里`, `${dur(b.gap)} away from Anew`)}"></b>`).join('')}</div>`;
    // 最上面一条：整天的顺序，颜色就是下面那一篇——看得出在哪几篇之间来回
    const all = list.flatMap(l => l.blocks.map(b => `<span class="tl-block" style="left:${x(b.s)};width:${w(b.s, b.e)};background:${l.color}" title="${escapeHTML(l.label)} · ${hm(b.s)}–${hm(b.e)}"></span>`)).join('');
    html += `<div class="tl-board"><div class="tl-row tl-all"><div class="tl-label"><span class="tl-name">${L('这一天', 'All day')}</span></div><div class="tl-track">${grid}${all}</div></div>`;
    list.forEach((l, i) => {
      const blocks = l.blocks.map(b => `<button class="tl-block" data-i="${i}" style="left:${x(b.s)};width:${w(b.s, b.e)};background:${l.color}" title="${hm(b.s)}–${hm(b.e)} · ${dur(b.e - b.s)}"></button>`).join('');
      const marks = l.marks.map(m => `<span class="tl-mark ${m.by}" style="left:${x(m.s)}" title="${hm(m.s)} · ${escapeHTML(m.kind)}${m.text ? '：' + escapeHTML(m.text.replace(/\s+/g, ' ').slice(0, 80)) : ''}"></span>`).join('');
      const nMine = l.marks.filter(m => m.by === 'me').length;
      html += `<div class="tl-row${l.doc ? '' : ' gone'}"><button class="tl-label" data-i="${i}" title="${escapeHTML(l.doc ? (l.doc.relativePath || l.doc.name) : l.label)}"><span class="tl-swatch" style="background:${l.color}"></span><span class="tl-name">${escapeHTML(l.label)}</span><span class="tl-meta">${l.read ? dur(l.read) : '—'}${nMine ? ` · ${nMine}${L(' 条', '')}` : ''}</span></button><div class="tl-track">${grid}${blocks}${marks}</div></div>`;
    });
    html += `<div class="tl-row tl-axis-row"><div class="tl-label"></div>${axis}</div></div>`;
    if (glance.length) html += `<div class="tl-glance">${L('还翻了一眼：', 'Also glanced at: ')}${glance.map((l, i) => `<button class="tl-glance-item${l.doc ? '' : ' gone'}" data-g="${i}" title="${l.doc ? '' : L('库里找不到了：后来改了名、删了，或是「这一天」的清单', 'Not in the library anymore (renamed or deleted)')}">${escapeHTML(l.label)}${l.read >= 60 ? ` <small>${dur(l.read)}</small>` : ''}</button>`).join(L('、', ', '))}</div>`;
    html += `<div class="tl-legend"><span><i class="tl-legend-block">${COLORS.slice(0, 3).map(c => `<b style="background:${c}"></b>`).join('')}</i>${L('在读（一篇一个颜色）', 'Reading (one color per doc)')}</span><span><i class="tl-mark me"></i>${L('你写的回响、回复', 'Your annotations & replies')}</span><span><i class="tl-mark claude"></i>${L('Claude 回的', 'Claude\'s replies')}</span><span>${L('隔不到 1 分半钟的算一段；点一篇打开它', 'Gaps under 90s are merged; click a doc to open it')}</span></div>`;
    view.innerHTML = html;
    const go = l => { if (l.doc) { close(); openNativeDocument(l.doc); } else showNotice(L('这篇在库里找不到了（后来改过名或删了）', 'Not in the library anymore (renamed or deleted)')); };
    view.querySelectorAll('[data-i]').forEach(el => el.onclick = () => go(list[+el.dataset.i]));
    view.querySelectorAll('[data-g]').forEach(el => el.onclick = () => go(glance[+el.dataset.g]));
    bind();
  }
  function bind() {
    view.querySelectorAll('.tl-step').forEach(b => b.onclick = () => shift(+b.dataset.d));
    const today = view.querySelector('.tl-today'); if (today) today.onclick = () => open(dayKey(new Date()));
    view.querySelector('.tl-close').onclick = close;
  }

  // 入口在右上角工具栏「时间轴」（10/2：放在左边视图里不像那一类，找不到）
  const entry = document.querySelector('#timeline');
  entry.onclick = () => (view.hidden ? open(dayKey(new Date()), true) : close());
  const basePaintViewsTl = paintViews;
  paintViews = () => { basePaintViewsTl(); entry.classList.toggle('active', !view.hidden); };
  const baseSelectDocumentTl = selectDocument;
  // 换了一篇才收起；正在看的这篇被外面改了、自动刷新时不收
  selectDocument = doc => { if (doc.path !== activeDocument?.path) close(); baseSelectDocumentTl(doc); };
  document.addEventListener('keydown', event => { if (!view.hidden && event.key === 'Escape') close(); if (!view.hidden && event.key === 'ArrowLeft' && !event.target.closest('input,textarea')) shift(-1); if (!view.hidden && event.key === 'ArrowRight' && !event.target.closest('input,textarea') && date !== dayKey(new Date())) shift(1); });
  paintViews();
})();

/* ── 图谱：一个主题一张（改了几版、观点怎么变的），一个分类一张（这一类学到的东西流到了你自己的哪件事里）──
   观点：笔记属性里的 points（10/2 起处理批注时记）；没有就拿那一版正文的 `## 1. 2. 3.` 小标题。
   哪条接哪条：相邻两版按字面像不像配对（我们自己记的只有每版的列表）；配不上的，前一版的算删了或并进了最像的那条。 */
(() => {
  const view = document.createElement('section');
  view.id = 'graph-view'; view.className = 'graph-view'; view.hidden = true;
  document.querySelector('.reading-area').prepend(view);
  const entry = document.querySelector('#graph');
  // 观点的标签（属性 points 里写的）：中英文都认，图例按界面语言显示
  const TAG_COLORS = IS_ZH
    ? { 产品: 'var(--moss)', 商业: 'var(--clay)', 团队: '#7a5a86', 对我: '#4f7a5c', 技术: '#3f7f7a', 事实: 'var(--muted)' }
    : { product: 'var(--moss)', business: 'var(--clay)', team: '#7a5a86', 'for-me': '#4f7a5c', tech: '#3f7f7a', fact: 'var(--muted)' };
  // 英文标签里打不出空格，写成 for-me；老的 for me / for_me 也认
  const TAG_ALIAS = { product: '产品', business: '商业', team: '团队', 'for-me': '对我', 'for me': '对我', for_me: '对我', tech: '技术', fact: '事实', 产品: 'product', 商业: 'business', 团队: 'team', 对我: 'for-me', 技术: 'tech', 事实: 'fact' };
  const tagColor = t => TAG_COLORS[t] || TAG_COLORS[TAG_ALIAS[t]] || TAG_COLORS[TAG_ALIAS[TAG_ALIAS[t]]];
  let mode = 'topic', topicUnit = null, tagName = '', token = 0, files = {};

  // ── 拆观点 ──
  const cleanPoint = t => String(t).replace(/⭐/g, '').replace(/〔[^〕]*〕/g, '').replace(/(^|\s)#[\p{L}\p{N}_/-]+/gu, '').replace(/\s+/g, ' ').trim();
  const tagsOf = t => [...String(t).matchAll(/#([\p{L}\p{N}_/-]+)/gu)].map(m => m[1]);
  function headingPoints(text) {
    const body = String(text || '').replace(/^---\n[\s\S]*?\n---\n?/, '');
    return [...body.matchAll(/^##\s+\d+[.、]\s*(.+)$/gm)].map(m => ({ text: cleanPoint(m[1]), full: cleanPoint(m[1]), tags: tagsOf(m[1]), star: m[1].includes('⭐') }));
  }
  function grams(t) { const s = t.replace(/[\s\p{P}\p{S}]/gu, ''); const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); if (s.length === 1) g.add(s); return g; }
  function like(a, b) { const x = grams(a), y = grams(b); if (!x.size || !y.size) return 0; let n = 0; x.forEach(g => { if (y.has(g)) n++; }); return 2 * n / (x.size + y.size); }
  function pointsOf(doc) {
    const heads = headingPoints(files[doc.path]);
    let raw = metaOf(doc).points;
    let list = null;
    if (raw) { try { list = JSON.parse(raw); } catch { list = null; } }
    if (!Array.isArray(list)) return heads;
    // 属性里记的是短句；颜色（#产品 #商业…）从正文里最像的那个小标题拿
    // 配对时用正文里那个完整的小标题（短句太短，配不上前一版）
    return list.map(t => { const best = heads.map(h => [like(t, h.text), h]).sort((a, b) => b[0] - a[0])[0]; const ok = best && best[0] > .2; return { text: String(t), full: ok ? best[1].text : String(t), tags: ok ? best[1].tags : [], star: ok ? best[1].star : false }; });
  }
  const colorOf = p => tagColor(p.tags.find(tagColor) || '') || 'var(--faint)';

  // ── 一个主题里有哪几条「笔记系列」：现在这篇 + 它的旧版（旧版的 # 标题和它一样）──
  function unitOf(doc) {
    const units = learningUnits(libraryDocuments);
    return units.find(u => u.docs.some(d => d.path === doc.path)) || null;
  }
  function seriesOf(unit) {
    const all = unit.docs.filter(d => metaOf(d).type !== '来源' && !DIEM_ONLY_TYPES.includes(metaOf(d).type));
    const live = all.filter(d => !(metaOf(d).stage === 'archive' || isArchivedDoc(d)));
    const old = all.filter(d => !live.includes(d));
    const head = d => plainHeading(metaOf(d)._heading || '') || titleFor(d);
    return live.map(doc => {
      const versions = old.filter(o => head(o) === head(doc) || like(head(o), head(doc)) > .8);
      versions.sort((a, b) => (+metaOf(a).version || 0) - (+metaOf(b).version || 0) || (a.modified || 0) - (b.modified || 0));
      return { doc, versions: [...versions, doc] };
    }).sort((a, b) => (a.doc === unit.lead ? -1 : b.doc === unit.lead ? 1 : 0) || b.versions.length - a.versions.length);
  }
  // 「旧版-晚点批注前-0930」：这一版之后做的事是「晚点批注」，日子 9/30
  function snapInfo(doc) {
    const m = (doc.name || '').replace(/\.md$/i, '').match(/^(?:旧版|old)[-_](.+?)(?:[-_](\d{2})(\d{2}))?(?:-\d+)?$/i);
    return m ? { next: m[1].replace(/前$/, ''), date: m[2] ? `${+m[2]}/${+m[3]}` : '' } : { next: '', date: '' };
  }

  // ── 观点河流 ──
  function river(series) {
    const cols = series.versions.map((doc, i) => {
      const prev = series.versions[i - 1];
      const info = snapInfo(doc);
      const m = metaOf(doc);
      const created = (m.created || '').slice(5).replace('-', '/').replace(/^0/, '').replace('/0', '/');
      let event = i === 0 ? L('初稿', 'First draft') : snapInfo(prev).next || '';
      if (i === series.versions.length - 1 && m.changed) event = m.changed.replace(/^"|"$/g, '');
      const date = i === series.versions.length - 1 ? '' : (info.date ? L(`到 ${info.date}`, `until ${info.date}`) : created);
      return { doc, points: pointsOf(doc), event, date };
    });
    // 一条线一个观点：每版的点接上前一版最像的那个
    const threads = [];
    cols.forEach((col, ci) => {
      const prev = ci ? cols[ci - 1] : null;
      const pairs = [];
      if (prev) col.points.forEach((p, pi) => prev.points.forEach((q, qi) => { const s = like(p.full, q.full); if (s >= .25) pairs.push([s, pi, qi]); }));
      pairs.sort((a, b) => b[0] - a[0]);
      const usedP = new Set(), usedQ = new Set(), link = {};
      pairs.forEach(([, pi, qi]) => { if (usedP.has(pi) || usedQ.has(qi)) return; usedP.add(pi); usedQ.add(qi); link[pi] = qi; });
      col.points.forEach((p, pi) => {
        const t = pi in link ? threads.find(th => th.cells[ci - 1] && th.cells[ci - 1].qi === link[pi]) : null;
        if (t) t.cells[ci] = { p, qi: pi, kind: 'on' };
        else { const th = { cells: [], order: pi }; th.cells[ci] = { p, qi: pi, kind: ci ? 'new' : 'first' }; threads.push(th); }
      });
      // 前一版有、这一版没接上的：删了，或者并进了这一版最像的那条
      if (prev) threads.forEach(th => {
        const c = th.cells[ci - 1];
        if (!c || th.cells[ci] || th.ended) return;
        const best = col.points.map(p => [like(c.p.full, p.full), p]).sort((a, b) => b[0] - a[0])[0];
        th.cells[ci] = best && best[0] >= .12 ? { kind: 'merge', into: best[1].text } : { kind: 'gone', p: c.p };
        th.ended = true;
      });
    });
    // 排：定稿里的按定稿顺序在上，删了的按删的先后在下
    const last = cols.length - 1;
    const rank = th => th.cells[last] && /on|new|first/.test(th.cells[last].kind) ? th.cells[last].qi : 1000 + th.cells.findIndex(Boolean);
    threads.sort((a, b) => rank(a) - rank(b));
    const n = cols.length;
    const shown = cols.map((c, i) => i);
    let html = `<div class="gr-river" style="grid-template-columns:repeat(${n},minmax(0,1fr))">`;
    shown.forEach(i => { const c = cols[i]; html += `<div class="gr-vh${i === last ? ' final' : ''}"><button class="gr-v" data-path="${escapeHTML(c.doc.path)}" title="${L('打开这一版', 'Open this version')}">${L(`第 ${i + 1} 版`, `v${i + 1}`)}${i === last ? L(' · 现在', ' · now') : ''}</button><div class="gr-d">${escapeHTML(c.date || '')}</div><div class="gr-e" title="${escapeHTML(c.event)}">${escapeHTML(c.event)}</div></div>`; });
    if (!threads.length) html += `<div class="gr-none" style="grid-column:1/-1">${L('这几版都还没拆观点（没有 points，正文也没有 ## 1. 2. 3.）。下次处理回响时会记上。', 'No points recorded yet (no points in front matter, no ## 1. 2. 3. headings). Claude records them the next time it processes annotations.')}</div>`;
    threads.forEach(th => shown.forEach(i => {
      const c = th.cells[i];
      if (!c) { html += '<div class="gr-cell empty"></div>'; return; }
      if (c.kind === 'gone') { html += `<div class="gr-cell gone" title="${escapeHTML(c.p.text)}">${escapeHTML(c.p.text)} · ${L('删了', 'dropped')}</div>`; return; }
      if (c.kind === 'merge') { html += `<div class="gr-cell merge" title="${L('并进', 'merged into')} ${escapeHTML(c.into)}">↘ ${L(`并进「${escapeHTML(c.into)}」`, `merged into "${escapeHTML(c.into)}"`)}</div>`; return; }
      const linked = i > 0 && th.cells[i - 1] && /on|new|first/.test(th.cells[i - 1].kind);
      html += `<div class="gr-cell on${c.kind === 'new' ? ' new' : ''}${linked ? ' linked' : ''}" style="--c:${colorOf(c.p)}" title="${escapeHTML(c.p.text)}${c.p.tags.length ? ' · #' + c.p.tags.join(' #') : ''}">${c.p.star ? '<span class="gr-star">⭐</span>' : ''}${escapeHTML(c.p.text)}</div>`;
    }));
    const max = Math.max(1, ...cols.map(c => c.points.length));
    shown.forEach(i => { const k = cols[i].points.length; html += `<div class="gr-count"><b>${k}</b>${L(' 个观点', ' points')}<i style="width:${k / max * 100}%"></i></div>`; });
    return html + '</div>';
  }

  function paintTopic() {
    const unit = topicUnit;
    if (!unit) { view.innerHTML = head('') + `<div class="gr-none">${L('先打开一篇笔记，图谱画它所在的那个主题。', 'Open a note first — the graph shows its topic.')}</div>`; bind(); return; }
    const name = unit.folder || (unit.lead ? titleFor(unit.lead) : '');
    const lead = unit.lead || unit.docs[0];
    const m = metaOf(lead);
    const series = seriesOf(unit);
    const main = series.filter(s => s.versions.length > 1 || pointsOf(s.doc).length);
    const rest = series.filter(s => !main.includes(s));
    let html = head(name);
    const tags = (m.tags || '').replace(/[\[\]]/g, '').split(',').map(t => t.trim()).filter(Boolean);
    html += `<div class="gr-sub">${tags.map(t => `<button class="gr-tag" data-tag="${escapeHTML(t)}">${escapeHTML(t)}</button>`).join(' · ')}${tags.length ? ' · ' : ''}${STAGE_NAMES[stageOf(lead)] || ''}</div>`;
    if (unit.sources.length) html += `<div class="gr-chips">${unit.sources.map(d => `<button class="gr-chip" data-path="${escapeHTML(d.path)}">${L('来源', 'Source')} <b>${escapeHTML(anewTitle(d).slice(0, 26))}</b>${charsLabel(d)}</button>`).join('')}</div>`;
    main.forEach(s => {
      if (main.length > 1) html += `<h2 class="gr-h2"><button data-path="${escapeHTML(s.doc.path)}">${escapeHTML(anewTitle(s.doc))}</button><small>${L(`${s.versions.length} 版`, `${s.versions.length} versions`)}</small></h2>`;
      html += river(s);
    });
    if (!main.length) html += `<div class="gr-none">${L('这个主题的笔记还没拆观点、也没有旧版。下次处理回响时会记上。', 'No points or old versions in this topic yet. Claude records them the next time it processes annotations.')}</div>`;
    if (rest.length) html += `<div class="gr-rest">${L('还有：', 'Also: ')}${rest.map(s => `<button data-path="${escapeHTML(s.doc.path)}">${escapeHTML(anewTitle(s.doc))}</button>`).join(L('、', ', '))}<span>${L('（一版、还没拆观点）', ' (one version, no points yet)')}</span></div>`;
    html += '<div class="gr-legend">' + Object.entries(TAG_COLORS).slice(0, 5).map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join('') + `<span><b class="gr-newmark">${L('新', 'new')}</b>${L('这一版冒出来的', ' in this version')}</span><span><s>${L('删了', 'dropped')}</s></span><span><em>↘ ${L('并进', 'merged')}</em>${L('了别的', ' into another')}</span><span>${L('哪条接哪条是按字面配的，不一定准', 'Matching across versions is by wording — not always right')}</span></div>`;
    view.innerHTML = html; bind();
  }

  // ── 分类图 ──
  function unitsWithTag(tag) {
    return learningUnits(libraryDocuments).filter(u => u.docs.some(d => !(metaOf(d).stage === 'archive' || isArchivedDoc(d)) && d.tags.includes(tag) || (metaOf(d).tags || '').includes(tag)) && (u.lead || u.folder));
  }
  function allTags() {
    const count = {};
    learningUnits(libraryDocuments).forEach(u => { const set = new Set(); u.docs.forEach(d => (metaOf(d).tags || '').replace(/[\[\]]/g, '').split(',').map(t => t.trim()).filter(Boolean).forEach(t => set.add(t))); set.forEach(t => count[t] = (count[t] || 0) + 1); });
    return Object.entries(count).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }
  function ownProjects() {
    const set = new Set();
    libraryDocuments.forEach(d => { const m = metaOf(d); if (['要接着想', '设计'].includes(m.type) && m.topic && !(m.stage === 'archive' || isArchivedDoc(d))) set.add(m.topic); });
    return [...set];
  }
  function paintCategory() {
    const units = unitsWithTag(tagName);
    const own = ownProjects().filter(o => o !== tagName);
    const nodes = units.map(u => {
      const lead = u.lead;
      const pts = lead ? pointsOf(lead) : [];
      const versions = lead ? (seriesOf(u).find(s => s.doc === lead)?.versions.length || 1) : 0;
      const name = u.folder || (lead ? anewTitle(lead).split(/[：:]/)[0] : '');
      const done = lead && stageOf(lead) === 'workout';
      // 流向：观点里提到你自己的事（type 是「要接着想」「设计」的主题），或者这篇本来就是给它找参照的
      const flows = [];
      own.forEach(o => {
        if (name === o) return;
        pts.filter(p => p.text.includes(o) || p.tags.some(t => TAG_ALIAS[t] === '对我' || t === '对我') && p.text.includes(o)).forEach(p => flows.push({ to: o, label: p.text }));
        const title = lead ? anewTitle(lead) : '';
        if (!flows.some(f => f.to === o) && lead && (metaOf(lead).topic === o || title.includes(`「${o}」`))) flows.push({ to: o, label: (title.split(/[：:]/)[1] || title).split(/[，,]/)[0] });
      });
      return { u, lead, name, pts, versions, done, flows };
    });
    const targets = own.filter(o => nodes.some(n => n.flows.some(f => f.to === o)));
    let html = head(tagName);
    const tags = allTags();
    html += `<div class="gr-sub">${L(`${nodes.length} 个主题 · ${nodes.filter(n => n.done).length} 个理好了`, `${nodes.length} topics · ${nodes.filter(n => n.done).length} done`)}${targets.length ? L(` · 学到的东西流进了 ${targets.join('、')}`, ` · flows into ${targets.join(', ')}`) : ''}<span class="gr-tagpick">${L('换一类：', 'Category: ')}${tags.map(t => `<button class="gr-tag${t === tagName ? ' on' : ''}" data-tag="${escapeHTML(t)}">${escapeHTML(t)}</button>`).join('')}</span></div>`;
    // 一列排：理好的在上、还在学的在下；同一个去处的挨在一起，线少交叉
    const firstTarget = n => { const i = targets.indexOf(n.flows[0]?.to); return i < 0 ? 99 : i; };
    const done = nodes.filter(n => n.done).sort((a, b) => firstTarget(a) - firstTarget(b));
    const wip = nodes.filter(n => !n.done).sort((a, b) => firstTarget(a) - firstTarget(b));
    const W = Math.max(720, view.clientWidth || 900), rowH = 56, gapH = wip.length && done.length ? 36 : 0;
    const H = (done.length + wip.length) * rowH + gapH + 70;
    const xL = 210, xR = W - 90;
    const rOf = n => Math.max(10, Math.min(26, 8 + n.pts.length * 1.4));
    done.forEach((n, i) => { n.x = xL; n.y = 70 + i * rowH; });
    wip.forEach((n, i) => { n.x = xL; n.y = 70 + done.length * rowH + gapH + i * rowH; });
    // 去处摆在流向它的那几个主题中间，上下至少隔 70
    const T = {};
    targets.forEach(t => { const ys = nodes.filter(n => n.flows.some(f => f.to === t)).map(n => n.y); T[t] = { x: xR, y: ys.reduce((a, b) => a + b, 0) / ys.length }; });
    targets.slice().sort((a, b) => T[a].y - T[b].y).forEach((t, i, arr) => { if (i && T[t].y - T[arr[i - 1]].y < 70) T[t].y = T[arr[i - 1]].y + 70; });
    let svg = `<svg class="gr-svg" viewBox="0 0 ${W} ${H}" width="100%">`;
    svg += `${done.length ? `<text class="gr-col" x="${xL}" y="34" text-anchor="middle">✓ ${L('理好了', 'Done')}</text>` : ''}${wip.length ? `<text class="gr-col" x="${xL}" y="${70 + done.length * rowH + gapH - 32}" text-anchor="middle">● ${L('还在学', 'Working')}</text>` : ''}${targets.length ? `<text class="gr-col" x="${xR}" y="34" text-anchor="middle">${L('你自己的事', 'Your own projects')}</text>` : ''}`;
    nodes.forEach(n => n.flows.forEach((f, k) => {
      const t = T[f.to]; if (!t) return;
      const x1 = n.x + rOf(n) + 4, y1 = n.y + (k - (n.flows.length - 1) / 2) * 16, x2 = t.x - 64, y2 = t.y + (k - (n.flows.length - 1) / 2) * 6;
      const bend = x1 + 190;
      svg += `<path class="gr-flow" d="M${x1},${y1} L${bend - 40},${y1} C${bend + (x2 - bend) * .5},${y1} ${x2 - (x2 - bend) * .4},${y2} ${x2},${y2}"><title>${escapeHTML(n.name)} → ${escapeHTML(f.to)}：${escapeHTML(f.label)}</title></path>`;
      svg += `<text class="gr-flow-label" x="${x1 + 8}" y="${y1 - 5}">${escapeHTML(f.label.length > 18 ? f.label.slice(0, 17) + '…' : f.label)}</text>`;
    }));
    nodes.forEach((n, i) => {
      const r = rOf(n);
      svg += `<g class="gr-node${n.done ? ' done' : ''}" data-n="${i}"><circle cx="${n.x}" cy="${n.y}" r="${r}"/><text class="gr-name" x="${n.x - r - 10}" y="${n.y - 2}" text-anchor="end">${escapeHTML(n.name.length > 14 ? n.name.slice(0, 13) + '…' : n.name)}</text><text class="gr-meta" x="${n.x - r - 10}" y="${n.y + 14}" text-anchor="end">${n.pts.length ? `${n.versions > 1 ? L(`${n.versions} 版 · `, `${n.versions} versions · `) : ''}${n.pts.length}${L(' 个观点', ' points')}` : STAGE_NAMES[n.lead ? stageOf(n.lead) : ''] || L('只有来源', 'sources only')}</text><title>${L('点开看这个主题的图', 'Open this topic\'s graph')}</title></g>`;
    });
    targets.forEach(t => { const p = T[t]; svg += `<g class="gr-own" data-own="${escapeHTML(t)}"><rect x="${p.x - 64}" y="${p.y - 24}" width="128" height="48" rx="10"/><text x="${p.x}" y="${p.y + 5}" text-anchor="middle">${escapeHTML(t)}</text></g>`; });
    svg += '</svg>';
    html += svg;
    if (!targets.length) html += `<div class="gr-none">${L('这一类的观点里还没提到你自己的事（「要接着想」「设计」类笔记的主题），所以没有往右流的线。', 'None of these points mention your own projects yet (topics of keep-thinking or design notes), so there are no lines to the right.')}</div>`;
    html += `<div class="gr-legend"><span><i style="background:var(--moss)"></i>${L('理好了', 'Done')}</span><span><i style="background:var(--paper-bright);border:1.5px solid var(--moss)"></i>${L('还在学', 'Working')}</span><span>${L('圆大小 = 观点多少', 'Circle size = number of points')}</span><span>${L('线 = 哪条观点提到了你自己的事；点圆看那个主题', 'Line = a point that mentions your own project; click a circle to open the topic')}</span></div>`;
    view.innerHTML = html; bind();
    view.querySelectorAll('.gr-node').forEach(g => g.onclick = () => { topicUnit = nodes[+g.dataset.n].u; mode = 'topic'; load(); });
    view.querySelectorAll('.gr-own').forEach(g => g.onclick = () => { const u = learningUnits(libraryDocuments).find(x => x.folder === g.dataset.own || (x.lead && metaOf(x.lead).topic === g.dataset.own)); if (u) { topicUnit = u; mode = 'topic'; load(); } });
  }

  function head(name) {
    const tagLabel = tagName || L('分类', 'Category');
    return `<div class="gr-head"><div class="gr-tabs"><button class="gr-tab${mode === 'topic' ? ' on' : ''}" data-mode="topic">${L('主题', 'Topic')}${topicUnit ? ' · ' + escapeHTML(topicUnit.folder || (topicUnit.lead ? anewTitle(topicUnit.lead).split(/[：:]/)[0] : '')) : ''}</button><button class="gr-tab${mode === 'cat' ? ' on' : ''}" data-mode="cat">${L('分类', 'Category')} · ${escapeHTML(tagLabel)}</button></div><button class="tl-close" title="${L('回到正文（Esc）', 'Back to document (Esc)')}">×</button></div>${name ? `<h1 class="gr-title">${escapeHTML(name)}</h1>` : ''}`;
  }
  function bind() {
    view.querySelector('.tl-close').onclick = close;
    view.querySelectorAll('.gr-tab').forEach(b => b.onclick = () => { mode = b.dataset.mode; load(); });
    view.querySelectorAll('.gr-tag').forEach(b => b.onclick = () => { tagName = b.dataset.tag; mode = 'cat'; load(); });
    view.querySelectorAll('[data-path]').forEach(b => b.onclick = () => { const d = libraryDocuments.find(x => x.path === b.dataset.path); if (d) { close(); openNativeDocument(d); } });
  }
  // 要哪几篇的全文：主题图 = 这个主题的笔记和旧版；分类图 = 每个主题的主笔记
  function load() {
    let docs = [];
    if (mode === 'topic' && topicUnit) docs = topicUnit.docs.filter(d => metaOf(d).type !== '来源');
    if (mode === 'cat') docs = unitsWithTag(tagName).map(u => u.lead).filter(Boolean);
    const need = docs.map(d => d.path).filter(p => !(p in files));
    view.hidden = false;
    if (!need.length) { paint(); return; }
    view.innerHTML = `<div class="tl-loading">${L('在读这几篇…', 'Loading…')}</div>`;
    post('loadGraph', { paths: need, token: ++token });
  }
  window.__graphData = data => { if (data.token !== token) return; Object.assign(files, data.files); if (!view.hidden) paint(); };
  function paint() { if (mode === 'cat') paintCategory(); else paintTopic(); window.scrollTo({ top: 0, behavior: 'instant' }); }

  function open() {
    window.__anewTimeline && window.__anewTimeline.close();
    files = {};    // 每次打开都重读，拿到最新改过的
    const doc = activeDocument;
    topicUnit = doc ? unitOf(doc) : null;
    const tags = allTags();
    const own = doc ? (metaOf(topicUnit?.lead || doc).tags || '').replace(/[\[\]]/g, '').split(',').map(t => t.trim()).find(t => tags.includes(t)) : '';
    tagName = own || tags[0] || '';
    mode = topicUnit ? 'topic' : 'cat';
    document.body.classList.add('graph-mode');
    entry.classList.add('active');
    load();
  }
  function close() {
    if (view.hidden) return;
    view.hidden = true; view.innerHTML = '';
    document.body.classList.remove('graph-mode');
    entry.classList.remove('active');
  }
  entry.onclick = () => (view.hidden ? open() : close());
  document.querySelector('#timeline').addEventListener('click', close, true);
  const baseSelectDocumentGr = selectDocument;
  selectDocument = doc => { if (doc.path !== activeDocument?.path) close(); baseSelectDocumentGr(doc); };
  document.addEventListener('keydown', event => { if (!view.hidden && event.key === 'Escape') close(); });
})();

/* ══ 0.7.0 · 看得见谁在等谁（A1）、批注里点得开（A4） ══
   · 左边每篇后面一个小标：「3 等」= 3 条等 Claude；「新 2」= Claude 新回了 2 条（回复，或直接改了正文、标了已处理）
   · 打开那篇：新回的那几条高亮，左边的小标就消了；点过的、下次再打开就灰了
   · 右边「新回复 2 · 下一条 ↓」挨条跳过去
   · 批注、回复、Claude 的处理说明里的网址、[[笔记]]、[文字](路径)、`xx.md` 能点 */
(() => {
  const isTime = s => /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s || '');
  // Claude 碰过这条没有：最后一句是 Claude 的，或者标已处理时写的是说明（用户自己点 ✓ 只记时间）
  const claudeSig = item => {
    const n = typeof item.replies === 'number' ? item.replies : (Array.isArray(item.replies) ? item.replies.length : 0);
    const lastBy = item.lastBy || (Array.isArray(item.replies) && item.replies.length ? item.replies[item.replies.length - 1].by : '');
    if (n && lastBy === 'claude') return 'r' + n;
    if (item.done && item.resolved && !isTime(item.resolved)) return 'd:' + item.resolved;
    return '';
  };
  const waitingClaude = item => {
    if (item.done) return false;
    const n = typeof item.replies === 'number' ? item.replies : (Array.isArray(item.replies) ? item.replies.length : 0);
    const lastBy = item.lastBy || (Array.isArray(item.replies) && item.replies.length ? item.replies[item.replies.length - 1].by : '');
    return !n || lastBy !== 'claude';
  };
  let seen = null;
  const loadSeen = () => { if (seen) return seen; try { seen = JSON.parse(localStorage.getItem('anew.seen') || 'null'); } catch { seen = null; } return seen; };
  const saveSeen = () => { try { localStorage.setItem('anew.seen', JSON.stringify(seen)); } catch {} };
  // 头一回用：以前回过的都算看过，不然一打开满屏都是「新」
  function baseline() {
    if (loadSeen()) return;
    seen = {};
    libraryDocuments.forEach(doc => (doc.noteBrief || []).forEach(item => { const s = claudeSig(item); if (s) seen[item.id] = s; }));
    saveSeen();
  }
  const listOf = doc => (doc?.path === activeDocument?.path && Array.isArray(activeDocument.notes)) ? activeDocument.notes : (doc?.noteBrief || []);
  function stateOf(doc) {
    const list = listOf(doc); const s = loadSeen() || {};
    return {
      wait: list.filter(waitingClaude).length,
      fresh: list.filter(item => { const sig = claudeSig(item); return sig && s[item.id] !== sig; }).length,
      changes: doc?.changeCount || 0,
    };
  }
  window.anewNoteState = stateOf;
  function badgeHTML(st, cls = '') {
    let html = '';
    // 正文有没确认的改动：数块（和打开后顶上那条一样）；只在批注里回了话、没动正文：数条
    if (st.changes) html += `<span class="nb nb-new${cls}" title="${L(`Claude 改了 ${st.changes} 处正文，还没确认`, `Claude changed ${st.changes} places — not reviewed yet`)}">${L('新', 'new')} ${st.changes}</span>`;
    else if (st.fresh) html += `<span class="nb nb-new${cls}" title="${L(`Claude 新回了 ${st.fresh} 条，还没看`, `${st.fresh} new replies from Claude`)}">${L('新', 'new')} ${st.fresh}</span>`;
    if (st.wait) html += `<span class="nb nb-wait${cls}" title="${L(`${st.wait} 条等 Claude 处理`, `${st.wait} waiting for Claude`)}">${st.wait} ${L('等', 'waiting')}</span>`;
    return html;
  }

  const baseRenderLibrary = window.renderLibrary;
  window.renderLibrary = library => {
    seen = null;
    // 先在原始数据上数好改了几块，下面那层重新 parseDocument 时会带过去；两份全文用完就扔
    (library.documents || []).forEach(raw => { raw.changeCount = countChangeGroups(raw.baseline, raw.current); delete raw.baseline; delete raw.current; });
    libraryDocuments = (library.documents || []).map(parseDocument);
    baseline(); baseRenderLibrary(library);
  };

  const baseFileButton = anewFileButton;
  anewFileButton = (doc, extra = '') => {
    const button = baseFileButton(doc, extra);
    const html = badgeHTML(stateOf(doc));
    if (html) {
      const wrap = document.createElement('span'); wrap.className = 'nb-wrap'; wrap.innerHTML = html;
      const tail = button.querySelector('.unit-count'); tail ? button.insertBefore(wrap, tail) : button.append(wrap);
    }
    return button;
  };
  // 收起来的主题：下面几篇的小标合到这一行上（展开了就各标各的）
  const baseUnit = anewUnit;
  anewUnit = u => {
    const wrap = baseUnit(u);
    const kids = [...u.notes, ...u.sources].map(stateOf).reduce((a, b) => ({ wait: a.wait + b.wait, fresh: a.fresh + b.fresh, changes: a.changes + b.changes }), { wait: 0, fresh: 0, changes: 0 });
    const head = wrap.querySelector('.unit-head > .tree-file');
    const html = badgeHTML(kids, ' nb-kids');
    if (head && html) {
      // 点主题那一行打开的是主题那篇，新改动在下面几篇里，「新」在那一行上点不掉。
      // 这个小标是下面几篇合起来的：前面一个 ↓，鼠标停上去列出是哪几篇，点它就展开、跳到第一篇
      const which = [...u.notes, ...u.sources].map(d => [d, stateOf(d)])
        .filter(([, s]) => s.changes || s.fresh || s.wait)
        .map(([d, s]) => `${anewTitle(d)}: ${[s.changes ? L(`改了 ${s.changes} 处`, `${s.changes} changes`) : s.fresh ? L(`新回 ${s.fresh} 条`, `${s.fresh} new replies`) : '', s.wait ? L(`${s.wait} 条等`, `${s.wait} waiting`) : ''].filter(Boolean).join(', ')}`);
      const span = document.createElement('span'); span.className = 'nb-wrap nb-kids-wrap'; span.innerHTML = '<span class="nb-kids-arrow">↓</span>' + html;
      span.title = L('在下面几篇里（点一下展开）：', 'In these documents (click to expand):') + `\n${which.join('\n')}`;
      span.querySelectorAll('[title]').forEach(el => el.removeAttribute('title'));
      span.onclick = event => {
        event.stopPropagation();
        if (!wrap.classList.contains('open')) wrap.querySelector('.unit-caret')?.click();
        const first = [...wrap.querySelectorAll('.unit-body .tree-file')].find(b => b.querySelector('.nb-new,.nb-wait'));
        if (first) { first.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); first.classList.add('chg-flash'); setTimeout(() => first.classList.remove('chg-flash'), 900); }
      };
      const tail = head.querySelector('.unit-count'); tail ? head.insertBefore(span, tail) : head.append(span);
    }
    return wrap;
  };

  // ── 右边：新回的高亮，「下一条 ↓」 ──
  // freshNow：这次打开时还没看过的；点了那条、或者用「下一条」跳过去，就挪进 lookedNow（变灰）
  let freshNow = new Set(), lookedNow = new Set(), freshPath = '';
  const pending = () => [...freshNow].filter(id => !lookedNow.has(id));
  noteItemHTML = (item, index, done) => {
    const quote = item.quote || '';
    const quoteHTML = quote ? `<blockquote class="note-quote">${escapeHTML(quote.length > 60 ? quote.slice(0, 60) + '…' : quote)}</blockquote>` : '';
    const byAI = done && item.resolved && !isTime(item.resolved);
    const time = done && !byAI ? (item.resolved || item.created || '') : (item.created || '');
    const kind = (item.kind || !quote) ? `<span class="note-kind">${escapeHTML(kindLabel(item.kind || '读后感'))}</span>` : '';
    let replies = (Array.isArray(item.replies) ? item.replies : []).map(r => `
        <div class="note-reply ${r.by === 'claude' ? 'from-ai' : 'from-me'}"><span class="reply-who">${r.by === 'claude' ? 'Claude' : L('我', 'Me')}</span>${linkify(r.text)}</div>`).join('');
    // Claude 直接改了正文、只写了处理说明：当成 Claude 的一句回话
    if (byAI) replies += `
        <div class="note-reply from-ai resolved-by-ai"><span class="reply-who">Claude</span>${linkify(item.resolved)}</div>`;
    const fresh = freshNow.has(item.id) ? (lookedNow.has(item.id) ? ' fresh seen' : ' fresh') : '';
    return `
    <div class="note-item${quote ? '' : ' standalone'}${done ? ' done' : ''}${item.follow ? ' follow' : ''}${fresh}" data-id="${escapeHTML(item.id)}">
      <div class="note-head"><span class="note-index">${index}</span>${kind}<span class="note-time">${escapeHTML(time)}</span><button class="note-follow${item.follow ? ' on' : ''}" title="${item.follow ? L('取消「要接着想」', 'Stop following') : L('要接着想', 'Keep thinking')}">${item.follow ? '★' : '☆'}</button><button class="note-done${done ? ' on' : ''}" title="${done ? L('退回未处理', 'Mark as open') : L('标记为已处理', 'Mark as handled')}">${done ? '↩' : '✓'}</button><button class="note-remove" title="${L('删除', 'Delete')}">×</button></div>
      ${quoteHTML}
      <p class="note-body">${linkify(item.note)}</p>
      ${replies ? `<div class="note-replies">${replies}</div>` : ''}
      ${done ? '' : `<textarea class="reply-input" rows="1" placeholder="${replies ? L('接着回一句… ⌘↩', 'Reply… ⌘↩') : L('补一句… ⌘↩', 'Add a line… ⌘↩')}"></textarea>`}
    </div>`;
  };

  const baseRenderNotes = renderNotes;
  renderNotes = doc => {
    if (!doc || doc.path !== freshPath) { freshNow = new Set(); lookedNow = new Set(); freshPath = doc?.path || ''; }
    let marked = false;
    if (doc) {
      const s = loadSeen() || (seen = {});
      notesOf(doc).forEach(item => { const sig = claudeSig(item); if (sig && s[item.id] !== sig) { freshNow.add(item.id); lookedNow.delete(item.id); s[item.id] = sig; marked = true; } });
      if (marked) { saveSeen(); if (notesOf(doc).some(item => item.done && freshNow.has(item.id))) notesDoneOpen = true; }
    }
    baseRenderNotes(doc);
    paintNext();
    if (marked) renderTree();
  };

  function look(id) {
    lookedNow.add(id);
    const node = document.querySelector(`#notes-section .note-item[data-id="${CSS.escape(id)}"]`);
    if (node) node.classList.add('seen');
    paintNext();
  }
  function paintNext() {
    let bar = document.querySelector('#notes-next');
    const ids = pending();
    if (!ids.length) { if (bar) bar.hidden = true; return; }
    if (!bar) {
      bar = document.createElement('button'); bar.id = 'notes-next'; bar.className = 'notes-next';
      notesCount.after(bar);
      bar.onclick = () => {
        const id = pending()[0]; if (!id) return;
        const item = notesOf(activeDocument).find(i => i.id === id);
        if (item?.done && !notesDoneOpen) { notesDoneOpen = true; renderNotes(activeDocument); }
        const node = document.querySelector(`#notes-section .note-item[data-id="${CSS.escape(id)}"]`);
        if (node) { node.scrollIntoView({ block: 'center', behavior: 'smooth' }); node.classList.add('flash'); setTimeout(() => node.classList.remove('flash'), 900); }
        const mark = [...content.querySelectorAll('mark.noted')].find(m => m.dataset.id === id);
        if (mark) mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
        look(id);
      };
    }
    bar.hidden = false;
    bar.innerHTML = `<span class="nb nb-new">${L(`新回复 ${ids.length}`, `${ids.length} new replies`)}</span><span>${L('下一条 ↓', 'Next ↓')}</span>`;
  }
  // 点了一条，就算看过了：变灰
  document.addEventListener('click', event => {
    const node = event.target.closest && event.target.closest('#notes-section .note-item.fresh');
    if (node && !event.target.closest('#notes-next')) look(node.dataset.id);
  });

  // ── A4：批注里的链接 ──
  function linkify(text) {
    const tokens = [];
    const keep = html => { tokens.push(html); return `\u0000${tokens.length - 1}\u0000`; };
    const docLink = (target, label) => {
      const doc = internalTarget(String(target).replace(/^\.\//, '').replace(/^notes\//, ''));
      return doc ? keep(`<a class="note-link" href="#" data-doc="${escapeHTML(doc.path)}" title="${L('打开', 'Open')} ${escapeHTML(titleFor(doc))}">${escapeHTML(label)}</a>`) : null;
    };
    let v = String(text || '');
    v = v.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, target, label) => docLink(target.trim(), label || target) || m);
    v = v.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => /^(https?:|mailto:)/i.test(href)
      ? keep(`<a class="note-link ext" href="${escapeHTML(href)}">${escapeHTML(label)}</a>`)
      : (docLink(decodeURI(href), label) || m));
    v = v.replace(/https?:\/\/[^\s<>"'，。；、）)」】]+/g, m => keep(`<a class="note-link ext" href="${escapeHTML(m)}">${escapeHTML(m)}</a>`));
    v = v.replace(/`([^`\n]+?\.md)`|((?:[^\s`「」（）()，。：:、"]+\/)*[^\s`「」（）()，。：:、"\/]+\.md)\b/g, (m, a, b) => docLink(a || b, a || b) || m);
    // 「标题」：只认和某篇标题一字不差的，免得「计划」这种短词被当成链接
    v = v.replace(/「([^「」\n]{2,40})」/g, (m, name) => {
      const doc = libraryDocuments.find(d => !isArchivedDoc(d) && (anewTitle(d) === name || titleFor(d) === name));
      return doc ? `「${keep(`<a class="note-link" href="#" data-doc="${escapeHTML(doc.path)}">${escapeHTML(name)}</a>`)}」` : m;
    });
    v = escapeHTML(v).replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[+i]);
    return v.replace(/\n/g, '<br>');
  }
  window.anewLinkify = linkify;
  document.addEventListener('click', event => {
    const a = event.target.closest && event.target.closest('a.note-link[data-doc]');
    if (!a) return;
    event.preventDefault(); event.stopPropagation();
    const doc = libraryDocuments.find(d => d.path === a.dataset.doc);
    if (doc) openNativeDocument(doc);
  }, true);
})();

/* ══ 0.8.0 · 盘一盘（D1）：右上角一个键，你按了才发起，不定时推 ══
   Anew 自己不调 AI，所以「惊喜」那格得 Claude 想：
   · 按键 → 复制一句「盘一盘：…」，贴进 Claude Code；
   · Claude 拿最近 3 天在想的当线索，去翻库里很早以前的笔记和存过的东西，写一篇 notes/盘一盘/盘一盘-MMDD.md（type: 盘一盘），分「相关 / 惊喜 / 随机」三格，每条带出处；
   · 那篇一出现（库 1.5 秒刷新一次），键上亮一个点、底下提示一句，点键就打开它。在上面写回响，照常交给 AI。 */
(() => {
  const entry = document.querySelector('#panyipan');
  if (!entry) return;
  const isPan = doc => metaOf(doc).type === '盘一盘' || /^盘一盘\//.test(doc.relativePath || '');
  const pans = () => libraryDocuments.filter(isPan).sort((a, b) => (b.modified || 0) - (a.modified || 0));
  const seenKey = 'anew.panSeen', askedKey = 'anew.panAsked';
  const seenPath = () => anewStore(seenKey) || '';
  const asked = () => +(anewStore(askedKey) || 0);
  const md = d => `${d.getMonth() + 1}/${d.getDate()}`;
  // 最新那篇没打开过、又是按键之后才出来的（或改过的）：算新
  const freshOne = () => { const p = pans()[0]; return p && p.path !== seenPath() && (p.modified || 0) >= asked() - 60e3 ? p : null; };
  let told = '';
  function paint() {
    const f = freshOne();
    entry.classList.toggle('has-new', Boolean(f));
    entry.title = f ? L(`盘好了：${anewTitle(f)}，点开看`, `Ready: ${anewTitle(f)} — click to open`) : L('盘一盘：拿你最近 3 天在想的，去翻很早以前的想法和存过的东西（相关 / 惊喜 / 随机）', 'Look back: use what you\'ve been thinking about these 3 days to dig up older ideas (related / surprise / random)');
    if (f && told !== f.path + f.modified && asked()) { told = f.path + f.modified; showNotice(L('盘好了，点右上角「◐ 盘一盘」看', 'Look-back ready — click ◐ Look back')); }
  }
  function openPan(doc) { anewStore(seenKey, doc.path); paint(); openNativeDocument(doc); }
  entry.onclick = event => {
    const f = freshOne();
    if (f) { openPan(f); return; }
    const now = new Date(), from = new Date(now.getTime() - 2 * 864e5);
    const text = L(`盘一盘：拿我最近 3 天（${md(from)}–${md(now)}）在想的，翻很早以前的想法和存过的东西，推几条回来（相关 / 惊喜 / 随机）`, `Look back: use what I've been thinking about in the last 3 days (${md(from)}–${md(now)}) to dig up older ideas and saved things, and bring back a few (related / surprise / random)`);
    const items = [{ header: L('复制一句话，贴进你的 AI（如 Claude Code）', 'Copy a prompt for your AI agent (e.g. Claude Code)') }, {
      label: L('盘一盘', 'Look back'), hint: L('拿最近 3 天在想的，翻很早以前的', 'use the last 3 days to dig up older ideas'),
      action: () => { anewStore(askedKey, String(Date.now())); window.webkit.messageHandlers.copyText.postMessage({ text }); showNotice(L('已复制，贴进你的 AI（如 Claude Code）：', 'Copied — paste into your AI agent (e.g. Claude Code): ') + text + L('。盘好了键上会亮一个点', '. The button lights up when it\'s ready')); },
    }];
    const list = pans().slice(0, 5);
    if (list.length) {
      items.push('-', { header: L('以前盘过的', 'Earlier look-backs') });
      list.forEach(doc => items.push({ label: anewTitle(doc), hint: doc.path === seenPath() ? '' : L('没看过', 'unread'), action: () => openPan(doc) }));
    }
    anewMenu(event.currentTarget, items);
  };
  const baseRender = window.renderLibrary;
  window.renderLibrary = library => { baseRender(library); paint(); };
  const baseSelect = selectDocument;
  selectDocument = doc => { if (isPan(doc)) anewStore(seenKey, doc.path); baseSelect(doc); paint(); };
  paint();
})();

/* ══ 0.8.1 · 手机截图别撑满整栏 ══
   竖的图（高比宽大 1.3 倍以上，多半是手机截图）最宽 340px；
   一段里只有几张图（Markdown 里图挨着写、中间不空行）就并排放。 */
(() => {
  function fitImages() {
    content.querySelectorAll('p, li').forEach(el => {
      const imgs = [...el.children].filter(c => c.tagName === 'IMG');
      const onlyImgs = imgs.length >= 2 && [...el.childNodes].every(n => n.tagName === 'IMG' || n.tagName === 'BR' || (n.nodeType === 3 && !n.textContent.trim()));
      el.classList.toggle('img-row', onlyImgs);
    });
    content.querySelectorAll('img').forEach(img => {
      const mark = () => { if (img.naturalWidth) img.classList.toggle('img-tall', img.naturalHeight / img.naturalWidth > 1.3); };
      if (img.complete) mark(); else img.addEventListener('load', mark, { once: true });
    });
  }
  const base = renderPreview;
  renderPreview = function (markdown) { base(markdown); fitImages(); };
})();
