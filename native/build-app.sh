#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT_DIR/outputs/知新 Anew.app"
CONTENTS="$APP_DIR/Contents"

mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources"
xcrun swiftc "$ROOT_DIR/native/AppDelegate.swift" -o "$CONTENTS/MacOS/Anew" -framework Cocoa -framework WebKit
cp "$ROOT_DIR/native/Info.plist" "$CONTENTS/Info.plist"
# App 名按系统语言：英文「Anew」，中文「知新 Anew」（菜单栏、Dock、关于、访达）
rm -rf "$CONTENTS/Resources/en.lproj" "$CONTENTS/Resources/zh-Hans.lproj"
cp -R "$ROOT_DIR/native/en.lproj" "$ROOT_DIR/native/zh-Hans.lproj" "$CONTENTS/Resources/"
cp "$ROOT_DIR/native/index.html" "$ROOT_DIR/native/i18n.js" "$ROOT_DIR/native/app.js" "$ROOT_DIR/native/style.css" "$CONTENTS/Resources/"
# 示例库：第一次打开、~/Documents/Anew Notes 还没有时拷过去
rm -rf "$CONTENTS/Resources/example-library"
cp -R "$ROOT_DIR/example-library" "$CONTENTS/Resources/example-library"
ICONSET_DIR="$ROOT_DIR/outputs/.Anew.iconset"
mkdir -p "$ICONSET_DIR"
sips -s format png -z 1024 1024 "$ROOT_DIR/native/Anew.svg" --out "$ICONSET_DIR/icon_512x512@2x.png" >/dev/null
sips -z 512 512 "$ICONSET_DIR/icon_512x512@2x.png" --out "$ICONSET_DIR/icon_512x512.png" >/dev/null
sips -z 512 512 "$ICONSET_DIR/icon_512x512@2x.png" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null
sips -z 256 256 "$ICONSET_DIR/icon_512x512@2x.png" --out "$ICONSET_DIR/icon_256x256.png" >/dev/null
sips -z 256 256 "$ICONSET_DIR/icon_512x512@2x.png" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null
sips -z 128 128 "$ICONSET_DIR/icon_512x512@2x.png" --out "$ICONSET_DIR/icon_128x128.png" >/dev/null
sips -z 64 64 "$ICONSET_DIR/icon_512x512@2x.png" --out "$ICONSET_DIR/icon_32x32@2x.png" >/dev/null
sips -z 32 32 "$ICONSET_DIR/icon_512x512@2x.png" --out "$ICONSET_DIR/icon_32x32.png" >/dev/null
sips -z 32 32 "$ICONSET_DIR/icon_512x512@2x.png" --out "$ICONSET_DIR/icon_16x16@2x.png" >/dev/null
sips -z 16 16 "$ICONSET_DIR/icon_512x512@2x.png" --out "$ICONSET_DIR/icon_16x16.png" >/dev/null
iconutil -c icns "$ICONSET_DIR" -o "$CONTENTS/Resources/Anew.icns"
codesign --force --deep --sign - "$APP_DIR"
echo "Built: $APP_DIR"
