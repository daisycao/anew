# Anew 宣传视频（HyperFrames）

47.5 秒、1920×1080、只有英文字幕，没有配音和音乐，画面里不出现中文。画面是真 App（`native/` 的代码 + 假桥接 + `media/demo-library/` 编的书库）截出来的，字幕和镜头用 GSAP 拼。

## 重新出一遍

1. 开静态服务（`.claude/launch.json` 里的 `stage`，端口 8791）。
2. 改了 App 或书库：`node ../stage/build-data.mjs && node ../stage/capture.mjs`，重截 `shots/`。
3. 抽帧检查：`node ../stage/frames.mjs ../out/frames 5 18 30`。
4. 出视频：`FFMPEG=… zsh ../stage/render-all.sh "$PWD/../out/anew-promo.mp4" 47.5`（每 4 秒开一个新的无头 Chrome，卡住的段自动重来；或者用 `npx hyperframes render index.html -o ../out/anew-promo.mp4`）

## 分镜（和 skill 的「Process annotations」一致：Claude 直接改笔记，不在聊天里回）

| 秒 | 画面 | 字幕 |
| --- | --- | --- |
| 0–7 | Franklin 原文：划一句，批注框里打字 | Read. Argue in the margins. |
| 7–11 | Hand to AI ▾ → Process annotations (2) → 已复制 → 终端里贴进 Claude Code | Hand it to Claude. |
| 11–17.5 | 笔记 v1 → v2：Claude 改的地方标绿，👩 那行不动，查证写在 Claude 卡片里 | Claude edits the note itself. / Your words stay yours. Its checks go in cards. |
| 17.5–29 | 第二轮：在 Claude 的卡片上划一句、批注反驳 → 再交给 Claude | Disagree? Annotate Claude's card. / Hand it back. |
| 29–34 | v2 → v3：你那句成了第 4 节，Claude 补了一张卡片 | Your reply becomes part of the note. |
| 34–39.5 | 主题图谱：v1 → v2 → v3，2 个观点长到 4 个 | Every round is a new version. |
| 39.5–43.5 | 分类图谱：线流进「Reading hour」 | Your thinking, as a graph. |
| 43.5–47.5 | 图标 + Anew + 一行字 | Read with Claude in the margins. |

GIF（`../out/anew-demo.gif`）切的是：划线批注 → v2 改动 → 在 Claude 卡片上批注 → v3。
