#!/bin/zsh
# 知新 Anew 一键重装：强制退出 → 重新编译 → 重新打开
# Build & relaunch: double-click this file. 双击即可：强制退出 → 编译 → 打开。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "1/4 强制退出旧进程…"
pkill -f "知新 Anew.app/Contents/MacOS/Anew" 2>/dev/null
sleep 1
pkill -9 -f "知新 Anew.app/Contents/MacOS/Anew" 2>/dev/null
sleep 1
if pgrep -f "知新 Anew.app/Contents/MacOS/Anew" >/dev/null; then
  echo "   !! 还有残留进程，请打开 活动监视器 手动结束 Anew"
  exit 1
fi
echo "   已退出。"

echo "2/4 重新编译…"
zsh "$ROOT/native/build-app.sh" || { echo "   !! 编译失败，把上面的报错发给我"; exit 1; }

echo "3/4 刷新图标缓存…"
# macOS 会缓存 app 图标，路径没变就一直用旧的。改了图标必须踢它一脚。
touch "$ROOT/outputs/知新 Anew.app"
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
[ -x "$LSREG" ] && "$LSREG" -f "$ROOT/outputs/知新 Anew.app" >/dev/null 2>&1
killall Dock >/dev/null 2>&1
echo "   已刷新（Dock 会闪一下，正常）。"

echo "4/4 打开…"
open "$ROOT/outputs/知新 Anew.app"
echo "完成。打开的就是刚编译的新版本。"
