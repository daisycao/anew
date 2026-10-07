#!/bin/zsh
# README 里的截图：用示例库（example-library/en、zh）摆出几个画面。先开 stage 服务（python3 -m http.server 8791，在仓库根目录）。
# 用法：zsh shots-readme.sh
set -e
here=${0:A:h}; out=$here/../readme
U=http://localhost:8791/media/stage/index.html
enc() { python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$1"; }
scrollTo() { echo "(() => { const h = [...document.querySelectorAll('#content h2')].find(h => h.textContent.includes('$1')); window.scrollTo({ top: scrollY + h.getBoundingClientRect().top - 90, behavior: 'instant' }); return !!h; })()"; }

node $here/build-data.mjs $here/../../example-library/en
MT=$(enc "Model T/Model T — a car for everyone.md"); FORD=$(enc "Model T/source-Ford 1922-1005.md"); TIM=$(enc "Time is money/Time is money — was Franklin right.md")
node $here/shoot.mjs $out/en-1-annotate.png "$U?doc=$FORD" 2500 "$(scrollTo 'five-dollar')"
node $here/shoot.mjs $out/en-2-note.png "$U?doc=$MT" 2500 "$(scrollTo 'stability')"
node $here/shoot.mjs $out/en-3-versions.png "$U?doc=$MT&graph=topic" 2500
node $here/shoot.mjs $out/en-4-flows.png "$U?doc=$TIM&graph=cat" 2500
node $here/shoot.mjs $out/en-5-timeline.png "$U?doc=$MT&timeline=1" 2500

node $here/build-data.mjs $here/../../example-library/zh
MT=$(enc "T 型车/T 型车：人人买得起的车.md"); FORD=$(enc "T 型车/来源-Ford 1922-1005.md"); TIM=$(enc "时间就是金钱/时间就是金钱：Franklin 说对了吗.md")
node $here/shoot.mjs $out/zh-1-annotate.png "$U?lang=zh&doc=$FORD" 2500 "$(scrollTo 'five-dollar')"
node $here/shoot.mjs $out/zh-2-note.png "$U?lang=zh&doc=$MT" 2500 "$(scrollTo '买稳定')"
node $here/shoot.mjs $out/zh-3-versions.png "$U?lang=zh&doc=$MT&graph=topic" 2500
node $here/shoot.mjs $out/zh-4-flows.png "$U?lang=zh&doc=$TIM&graph=cat" 2500
node $here/shoot.mjs $out/zh-5-timeline.png "$U?lang=zh&doc=$MT&timeline=1" 2500

# 宣传视频用的还是 demo-library
node $here/build-data.mjs
