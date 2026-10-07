#!/bin/zsh
# 分段渲染：每 4 秒开一个新的无头 Chrome（无头 Chrome 偶尔会卡住不回话），哪段失败就重来那段，最后无损拼接。
# 用法：FFMPEG=/path/to/ffmpeg zsh render-all.sh ../out/anew-promo.mp4 47.5
set -e
out=$1; total=$2; here=${0:A:h}; tmp=$(mktemp -d)
FF=${FFMPEG:-ffmpeg}
a=0; i=0
while (( a < total )); do
  b=$(( a + 4 > total ? total : a + 4 ))
  for try in 1 2 3 4; do
    pkill -f anew-cdp- 2>/dev/null || true
    if node "$here/render.mjs" "$tmp/part$i.mp4" 30 $a $b 2>/dev/null | grep saved; then break; fi
    echo "retry $a-$b ($try)"
    (( try < 4 )) || { echo "failed $a-$b"; exit 1; }
  done
  echo "file '$tmp/part$i.mp4'" >> "$tmp/list.txt"
  a=$b; i=$((i+1))
done
"$FF" -y -loglevel error -f concat -safe 0 -i "$tmp/list.txt" -c copy -movflags +faststart "$out"
rm -rf "$tmp"
echo "saved $out"
