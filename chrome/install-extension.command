#!/bin/zsh
# Register the native host so the Anew Chrome extension can write into your library (Native Messaging).
# Run once; run again if you move this folder.
# 让 Chrome 里的 Anew 插件能写进库：登记本机那一头。只要跑一次；挪了文件夹再跑一次。
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
HOST="$DIR/host/anew-clip.mjs"
NODE="$(command -v node || true)"
for n in /opt/homebrew/bin/node /usr/local/bin/node "$NODE"; do [[ -x "$n" ]] && NODE="$n" && break; done
[[ -x "$NODE" ]] || { echo "Node.js not found — install it first (brew install node). 找不到 node，先装 Node.js"; exit 1; }
# Chrome 启动它时没有 PATH，把 node 的绝对路径写进第一行
sed -i '' "1s|.*|#!$NODE|" "$HOST"
chmod +x "$HOST"
ID="dkiiopdioghnjigpkhbdnfonolchblom"
for B in "Google/Chrome" "Google/Chrome Beta" "Chromium" "Microsoft Edge" "BraveSoftware/Brave-Browser" "Arc/User Data"; do
  BASE="$HOME/Library/Application Support/$B"
  [[ -d "$BASE" ]] || continue
  mkdir -p "$BASE/NativeMessagingHosts"
  cat > "$BASE/NativeMessagingHosts/com.anew.clip.json" <<JSON
{
  "name": "com.anew.clip",
  "description": "Anew: save web highlights and annotations into your library",
  "path": "$HOST",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$ID/"]
}
JSON
  echo "Registered / 已登记: $B"
done
echo
echo "Next: open chrome://extensions → turn on Developer mode → Load unpacked → pick this folder:"
echo "下一步：chrome://extensions → 打开「开发者模式」→「加载已解压的扩展程序」→ 选这个文件夹："
echo "  $DIR"
