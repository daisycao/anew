// 视频要的每个画面：用真 App（假桥接 + 编的书库）摆出来，截成 1920×1080，存到 ../video/shots/
// 跑之前要开着静态服务（.claude/launch.json 里的 stage，端口 8791）。
// 流程和 skill 一致：批注原文 → Process annotations → Claude 改笔记（v2）→ 在 Claude 的卡片上再批注 → 再改（v3）
import { openPage } from './cdp.mjs';
import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
const BASE = 'http://localhost:8791/media/stage/index.html';
const OUT = fileURLToPath(new URL('../video/shots/', import.meta.url));
fs.rmSync(OUT, { recursive: true, force: true });
const SRC = 'Time is money/source-Franklin 1748-1005.md';
const NOTE = 'Time is money/Time is money — was Franklin right.md';
const V1 = 'Time is money/old-process annotations-1005.md';
const V2 = 'Time is money/old-process annotations-1006.md';
const Q1 = 'he has really spent, or rather thrown away, five shillings besides';
const ME1 = "Isn't this just opportunity cost? Most of us are salaried now. Idling half a day costs us nothing.";
const Q2 = 'The cost is just paid later.';
const ME2 = "Then my evenings scrolling aren't free either. By Franklin's math, they're my five shillings.";
const older = { id: 'demo-2', tz: 'local', created: '2026-10-05 09:20', quote: 'Money can beget money, and its offspring can beget more', note: 'Compound interest? Did Franklin ever use a compounding example himself?' };
const mine1 = { id: 'demo-1', tz: 'local', created: '2026-10-05 09:12', quote: Q1, note: ME1 };
const mine2 = { id: 'demo-3', tz: 'local', created: '2026-10-06 21:05', quote: Q2, note: ME2 };

const p = await openPage(BASE);
const show = o => p.js(`stageShow(${JSON.stringify(o)})`);
const shot = async (name, ms = 350) => { await p.wait(ms); await p.shot(OUT + name + '.png'); };
const hideNotice = () => p.js(`document.querySelector('#app-notice').hidden = true`);
async function annotate(prefix, quote, text) {
  await p.js(`stageSelect(${JSON.stringify(quote)})`); await shot(prefix + '-select');
  await p.js(`document.querySelector('#note-hint').click()`); await shot(prefix + '-popover');
  const words = text.split(' ');
  for (let i = 1; i <= words.length; i++) { await p.js(`document.querySelector('#note-input').value = ${JSON.stringify(words.slice(0, i).join(' '))}`); await shot(`${prefix}-type-${String(i).padStart(2, '0')}`, 60); }
  await p.js(`document.querySelector('#note-cancel').click(); getSelection().removeAllRanges()`);
}
async function handToAI(prefix) {
  await p.js(`document.querySelector('#hand-ai').click()`); await shot(prefix + '-menu');
  await p.js(`(document.querySelector('.anew-menu button, [class*=menu] button:not([disabled])') || {}).click?.()`); await shot(prefix + '-copied', 200);
  await hideNotice();
}

// 第一轮：在原文上批注（之前已经有一条关于复利的批注等着）
await show({ rel: SRC, notes: [older] }); await shot('a1-source');
await annotate('a2', Q1, ME1);
await show({ rel: SRC, notes: [older, mine1] }); await shot('a3-saved');
await handToAI('a4');
// Claude 改了笔记：v1 → v2，改动标绿等你确认
await show({ rel: NOTE, as: V1, notes: [] }); await shot('b1-note-v1');
await show({ rel: NOTE, as: V2, notes: [], baseline: V1 }); await shot('b2-note-v2', 600);
await p.js(`window.scrollTo({ top: 260, behavior: 'instant' })`); await shot('b3-note-v2-card', 400);
// 第二轮：在 Claude 的卡片上回一句
await show({ rel: NOTE, as: V2, notes: [], scroll: 260 }); await shot('c1-note-v2');
await annotate('c2', Q2, ME2);
await show({ rel: NOTE, as: V2, notes: [mine2], scroll: 260 }); await shot('c3-saved');
await handToAI('c4');
// 再改一版：v2 → v3，新的第 4 节标绿
await show({ rel: NOTE, notes: [], baseline: V2 });
await p.wait(400);
await p.js(`(() => { const h = [...document.querySelectorAll('#content h2')].find(e => e.textContent.trim().startsWith('4.')); window.scrollTo({ top: window.scrollY + h.getBoundingClientRect().top - 230, behavior: 'instant' }); })()`);
await shot('d1-note-v3', 500);
// 图谱
await show({ rel: NOTE, notes: [] });
await p.js(`document.querySelector('#graph').click()`); await shot('e1-graph-topic', 700);
await p.js(`document.querySelector('.gr-tab[data-mode="cat"]').click()`); await shot('e2-graph-cat', 700);
await p.close();
fs.copyFileSync(fileURLToPath(new URL('../../native/Anew.svg', import.meta.url)), OUT + 'anew-icon.svg');
