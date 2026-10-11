#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT_DIR/outputs/知新 Anew.app"
CONTENTS="$APP_DIR/Contents"

mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources"
# 通用版：Apple 芯片和 Intel 的 Mac 都能跑，最低 macOS 13
BIN_TMP="$(mktemp -d)"
for arch in arm64 x86_64; do
  xcrun swiftc "$ROOT_DIR/native/AppDelegate.swift" -target "$arch-apple-macos13.0" -O -o "$BIN_TMP/Anew-$arch" -framework Cocoa -framework WebKit
done
lipo -create "$BIN_TMP/Anew-arm64" "$BIN_TMP/Anew-x86_64" -output "$CONTENTS/MacOS/Anew"
rm -rf "$BIN_TMP"
cp "$ROOT_DIR/native/Info.plist" "$CONTENTS/Info.plist"
# App 名按系统语言：英文「Anew」，中文「知新 Anew」（菜单栏、Dock、关于、访达）
rm -rf "$CONTENTS/Resources/en.lproj" "$CONTENTS/Resources/zh-Hans.lproj"
cp -R "$ROOT_DIR/native/en.lproj" "$ROOT_DIR/native/zh-Hans.lproj" "$CONTENTS/Resources/"
cp "$ROOT_DIR/native/index.html" "$ROOT_DIR/native/i18n.js" "$ROOT_DIR/native/app.js" "$ROOT_DIR/native/style.css" "$CONTENTS/Resources/"
# 示例库：第一次打开、~/Documents/Anew Notes 还没有时拷过去
rm -rf "$CONTENTS/Resources/example-library"
cp -R "$ROOT_DIR/example-library" "$CONTENTS/Resources/example-library"
# 图标：native/Anew.iconset 是从 media/brand 的图标出的（824 见方，四周留 100，和系统图标一样大；16、32 用简化版）
iconutil -c icns "$ROOT_DIR/native/Anew.iconset" -o "$CONTENTS/Resources/Anew.icns"
codesign --force --deep --sign - "$APP_DIR"
echo "Built: $APP_DIR"
