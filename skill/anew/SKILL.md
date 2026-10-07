---
name: anew
description: The AI side of Anew (知新), a Mac reader where the user reads sources, highlights and annotates them, then hands the work to Claude Code. Use when the user pastes or says "Process annotations: <path>" / "处理下批注", "Tidy up: <path>" / "理一下", "Look at this: <path>" / "看一下这篇", "Collect web annotations: <topic>" / "收一下网页批注", "Rebuild: <path>" / "重整一遍", "Save this source: <path>" / "存一下这篇来源", "Find sources on …" / "去找来源", "Put me in their shoes" / "换位", "Compare" / "对照", "Look back: …" / "盘一盘", "Health check" / "体检一下", or otherwise talks about their Anew library.
---

# Anew: the AI side

Anew is a Markdown reader. The user reads and annotates in the app; you read and write the **same files** on disk. The app re-reads the library every 1.5 seconds, so whatever you write shows up for them on its own. There is no API between you — everything goes through files.

Reply in the user's language. The app is bilingual (it follows the macOS language), and so are the files.

**Match the library's language.** Look at a few existing files first. If they use English values (`type: source`, `source-…md`, `## My highlights`), write English; if Chinese (`type: 来源`, `来源-…md`, `## 我划的`), write Chinese. An empty library: use the language of the prompt the user pasted. The app reads both.

| | 中文 | English |
| --- | --- | --- |
| type | 来源 / 笔记 / 要接着想 / 设计 / 盘一盘 | source / note / keep-thinking / design / lookback |
| keep / from | 全文 · 摘要 / 网页 · PDF · 截图 | full · summary / web · PDF · screenshot |
| source file | `来源-<what>-<MMDD>.md` | `source-<what>-<MMDD>.md` |
| old version | `旧版-<what>-<MMDD>.md` | `old-<what>-<MMDD>.md` |
| headings | `## 我划的` · `## 原文` · `## 补充阅读` | `## My highlights` · `## Full text` · `## Further reading` |
| web inbox folder | `网页划线/` | `Web highlights/` |
| your words / Claude | 👩 · `> [!claude]` | same |

Examples below use the Chinese values; swap in the English column as needed.

## Where the library is

```bash
cat ~/.anew/library        # the folder the user last opened in Anew
```

If that file doesn't exist, the library is `~/Documents/Anew Notes/`. All paths below are relative to the library root. Write in place — don't generate elsewhere and copy in.

## Properties (YAML front matter, Obsidian-compatible)

```yaml
---
type: 来源            # 来源 source / 笔记 note / 要接着想 keep-thinking / 设计 design
stage: working        # idea / working / workout (done) / archive
topic: 时间就是金钱     # the topic folder
created: 2026-10-05
source: "https://…"   # sources only; quote values containing : or #
published: 1748-07-21 # sources only: original publication date (YYYY-MM is fine). Anew sorts sources by it
star: true            # optional: the 2–3 sources most worth reading in a topic
keep: 全文            # 全文 full text / 摘要 summary
from: 网页            # 网页 web / PDF / 截图 screenshot
sources: ["[[来源-Franklin 1748-1005]]"]   # which sources a note draws on
tags: [economics]
---
```

- Lowercase English keys; dates `YYYY-MM-DD`; links to other notes as `"[[name]]"`.
- Every new file gets front matter. To change stage, edit only that line.
- Sources have no stage of their own; they follow their topic's note. Don't change a source's stage. The user sets a note's stage; you don't.
- Always fill `published` for sources — check the original page (some sites show today's date). If you can't find it, leave it empty and say so.
- Wherever a note lists sources, order them by publication date, oldest first.

### Points (for the graph view)

A note (not a source) records the main points of its current version. Anew's graph draws which version introduced, dropped or merged each point.

```yaml
version: 3
points: ["闲着也是花钱", "钱会生钱"]    # one short phrase each (≤20 chars), in body order
changed: "merged A into B; dropped C"   # one line: what this version changed
```

Each time you rewrite a note, update `points`, bump `version`, write `changed`. Only record points the user holds — your own additions don't count unless they asked to keep them. A first draft without points: `points: []`.

### Files

- One folder per topic: `<topic>/来源-<what>-<MMDD>.md` for sources, `<topic>/<title>.md` for the topic's main note. Images go in a subfolder of the topic.
- Old versions go to `<topic>/旧版-<what>-<MMDD>.md` with `stage: archive`.

## Annotations

Stored next to the library, never inside the Markdown:

```
.paper-md-notes/<key>.json
key = base64(path relative to the library root), then "/" → "_", keep trailing "="
```

```bash
python3 -c "import base64,sys;print(base64.b64encode(sys.argv[1].encode()).decode().replace('/','_'))" "时间就是金钱/来源-Franklin 1748-1005.md"
```

(If the user once opened a subfolder as the library, annotations may also be in `<subfolder>/.paper-md-notes/` keyed by the file name alone. Check both.)

```jsonc
{
  "id": "…", "created": "2026-10-05 09:12",
  "quote": "the selected text (empty for whole-document thoughts)",
  "note": "what the user wrote — often dictated, expect typos",
  "kind": "讲一遍",                // optional: a spoken walkthrough of the whole piece
  "follow": true,                 // optional: ☆ keep thinking about this
  "done": true, "resolved": "…",  // handled
  "replies": [ { "by": "claude", "at": "…", "text": "…" }, { "by": "me", "at": "…", "text": "…" } ]
}
```

Annotations with an id starting `web-` came from the Chrome extension.

**Writing back**: read the whole array → only append to `replies` and set `done` / `resolved` → write it back (pretty JSON, UTF-8, don't escape non-ASCII). Never delete the user's entries or edit `note` / `quote`. Back the file up first. The app merges by id when it saves, so it won't overwrite your replies.

## Main sources vs. further reading

- **Main sources** build the frame (long interviews, primary documents). Annotations on them change the note's body directly.
- **Further reading** comes after the frame stands (short pieces, mostly from the Chrome extension). Don't weave it into the body; collect it under `## 补充阅读` at the end of the note, and fold it in later with 重整一遍.
- Default: once a note has non-empty `points`, new web sources count as further reading. Sources listed in `sources:` are main. If the user says a source is main, treat it as main.

## What the user says → what you do

Prompts arrive in either language — the app copies them in its UI language. Treat each pair the same: 处理下批注 = Process annotations, 理一下 = Tidy up, 看一下这篇 = Look at this, 收一下网页批注 = Collect web annotations, 重整一遍 = Rebuild, 存一下这篇来源 = Save this source, 盘一盘 = Look back.

| User says | You do |
| --- | --- |
| 处理下批注 / process annotations: `<path>` | **Default: improve the note's body, don't write long replies in the margin.** If the annotations are on a note you wrote: move the old version to `旧版-…` first, then rewrite. The user's own words go under 👩; your fact-checks, additions and pushback go in `> [!claude]` callouts — if they were right, say so in the card. If the annotations are on a source: leave the source untouched, work them into the topic's note. Mark each annotation `done: true` with `resolved: "已改进正文：<which section>"`. Only reply in `replies` when the user asks you to answer in the margin. If an annotation asks you to do something outside the library, list it in chat and ask first. Finish by saying which sections changed. |
| 收一下网页批注 / collect web annotations: `<topic>` | Find every undone `web-` annotation in that topic folder. Move misfiled sources (and their annotation files — the key changes with the path; update `topic`), including anything in `网页划线/`. Further reading: add to `## 补充阅读`, one `### <outlet>｜<title> (<date>)` per source with link, `[[source]]`, quotes, 👩, and a short `> [!claude]` card — read the surrounding context in the original first, highlights are often half a sentence. Body, `version`, `points` stay unchanged. Main sources: handle like 处理下批注. |
| 重整一遍 / rebuild: `<path>` | Further reading is done. Move the old version to `旧版-重整前-<MMDD>.md`; rebuild the frame around the user's current view (repeated judgments in their annotations may be the new spine); fold what holds up into the body, drop duplicates, compress mere evidence to a line with a citation; clear `## 补充阅读`; update `points`, `version`, `changed`. Tell them how the frame changed. |
| 理一下 / tidy up: `<path>` | Turn the piece's annotations (and its topic's sources') into reading notes: quotes (`>` + `—— source`), **my thoughts (only from the user's notes and replies)**, and objective additions in `> [!claude]` cards. Mark used annotations done. |
| 看一下这篇 / look at this: `<path>` | No annotations yet: say what it's about and ask where they want to start (换位? 对照?). |
| 存一下这篇来源：`<path>`（原文 `<url>`） | The user created an empty source in the app. Fill it: full text for important pieces, a summary otherwise; set `keep`, `published`, and the title line. Don't create a new file. |
| 去找来源 / find sources on `<x>` | Save important ones in full (if the original is images, one image per page with the transcription below), others as summaries; write properties; create the topic's main note if it has none. When recommending reading, split into **main (read first)** and **further reading**. |
| 换位 / put me in their shoes | In the topic's note, write a `> [!claude] 换位：你是 <who>，<when>` card: give only what they could have known then, and ask for a decision (invest? build? which?). Don't reveal what happened until the user has answered in an annotation. |
| 对照 / compare | Write a comparison table (A / B / what changed / what didn't), one line per row, for the user to annotate. |
| 盘一盘 / look back (copied from the ◐ button) | Use the last 3 days as **clues, not the subject**: notes changed (`points`, `changed`) and annotations created in those days. Then dig for **older** material in the library that connects. Write `盘一盘/盘一盘-<MMDD>.md` (`type: 盘一盘`, `stage: working`, `range: "YYYY-MM-DD ~ YYYY-MM-DD"`) with three sections: `## 相关` (2–3 directly related), `## 惊喜` (1–2 that connect unexpectedly, ideally arguing against their recent view), `## 随机` (1 truly random pick). Each item: `### <one line>`, the quote with source and date, why now — quoting the user's own recent words with dates. Saved material is **other people's words**; don't present it as the user's opinion. Don't repeat items pushed in the last two weeks. |
| 体检一下 / health check | List: unhandled annotations, missing properties, wrong stages (notes only), broken links, sources nothing links to. Ask before fixing. |

## What the app does on its own

- **Chrome extension**: the first highlight on a page saves it as a source `来源-<what>-<MMDD>.md` (`from: 网页`) in the chosen topic folder, or in the folder of a note that links that URL, or in `网页划线/`. Highlights go under `## 我划的`, annotations get `web-` ids. Re-saving only replaces `## 我划的` and merges annotations; your replies and `done` flags survive.
- Creating, renaming, moving, archiving and trashing happen in the app; rename/move carries along annotations, history, links from other notes and relative image paths. If the user asks you to rename or move by hand, update all of those too.

## Never

- Write the user's "my thoughts" for them — that only comes from their own annotations and replies.
- Invent quotes, dates or sources. If you couldn't verify it, say so.
