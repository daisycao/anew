#!/usr/bin/env node
// 知新 Anew 浏览器插件的本机这一头（Chrome Native Messaging）。
// 插件把「这篇网页 + 划的句子 + 批注」发过来，这里写进库：
//   notes/<主题>/来源-<说明>-<MMDD>.md          来源本身（摘要或全文）
//   notes/.paper-md-notes/<key>.json             批注，和 Anew 里加的一模一样
//   （可选）库是「这一天 Diem」的 notes/ 时，在 Diem 同步本记一行
// 协议：stdin/stdout 上每条消息 = 4 字节长度（小端）+ UTF-8 JSON。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';

// 库在哪：环境变量 ANEW_LIBRARY > ~/.anew/library（Anew App 打开库时写的）> ~/Documents/Anew Notes
function findLibrary() {
  if (process.env.ANEW_LIBRARY) return process.env.ANEW_LIBRARY;
  try {
    const saved = fs.readFileSync(path.join(os.homedir(), '.anew/library'), 'utf8').trim();
    if (saved && fs.existsSync(saved)) return saved;
  } catch {}
  return path.join(os.homedir(), 'Documents/Anew Notes');
}
const LIBRARY = findLibrary();
const NOTES_DIR = '.paper-md-notes';

// ────────── 收发 ──────────

let buffer = Buffer.alloc(0);
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const size = buffer.readUInt32LE(0);
    if (buffer.length < 4 + size) break;
    const body = buffer.subarray(4, 4 + size).toString('utf8');
    buffer = buffer.subarray(4 + size);
    let reply;
    try { reply = handle(JSON.parse(body)); }
    catch (error) { reply = { ok: false, error: String(error && error.message || error) }; }
    send(reply);
  }
});
process.stdin.on('end', () => process.exit(0));

function send(message) {
  const data = Buffer.from(JSON.stringify(message), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(data.length, 0);
  process.stdout.write(Buffer.concat([head, data]));
}

// 中英双语：插件按浏览器语言发来 lang，新建来源的文件名、标题、属性值跟着它
let EN = false;
const T = (zh, en) => (EN ? en : zh);
const H_QUOTES = '(?:我划的|My highlights)', H_FULL = '(?:原文|Full text)';

function handle(message) {
  EN = message.lang === 'en';
  switch (message.cmd) {
    case 'hello': return { ok: true, library: LIBRARY, folders: folders() };
    case 'find': return { ok: true, ...findSource(message.url), linkedFrom: linkedFrom(message.url) };
    // 「加进笔记」去掉了：句子直接追加在笔记末尾，整理时会重复。旧版插件还在发就提醒刷新
    case 'notes':
    case 'addToNote': return { ok: false, error: T('「加进笔记」去掉了：到 chrome://extensions 刷新一下 Anew 插件', 'This command was removed — reload the Anew extension in chrome://extensions') };
    case 'save': return save(message);
    case 'open': return openInAnew(message.path);
    default: return { ok: false, error: T(`不认识的命令：${message.cmd}`, `Unknown command: ${message.cmd}`) };
  }
}

// ────────── 库 ──────────

/** 主题文件夹：库最外层的文件夹，最近动过的排前面 */
function folders() {
  return fs.readdirSync(LIBRARY, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'images' && !d.name.startsWith('划划-'))
    .map(d => ({ name: d.name, t: fs.statSync(path.join(LIBRARY, d.name)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .map(d => d.name);
}

function walk(dir, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.name.startsWith('.')) continue;
    const full = path.join(dir, d.name);
    if (d.isDirectory()) walk(full, out);
    else if (d.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function headOf(file) {
  const fd = fs.openSync(file, 'r');
  const chunk = Buffer.alloc(4096);
  const n = fs.readSync(fd, chunk, 0, 4096, 0);
  fs.closeSync(fd);
  return chunk.subarray(0, n).toString('utf8');
}

const sameURL = (a, b) => norm(a) === norm(b);
function norm(u) {
  try { const x = new URL(u); x.hash = ''; return (x.host.replace(/^www\./, '') + x.pathname.replace(/\/$/, '') + x.search); }
  catch { return String(u || '').trim(); }
}

/** 这个网址以前存过没有：看每篇开头属性里的 source */
function findSource(url) {
  if (!url) return { path: null };
  for (const file of walk(LIBRARY)) {
    const m = headOf(file).match(/^---\n[\s\S]*?^source:\s*"?([^"\n]+)"?\s*$/m);
    if (m && sameURL(m[1], url)) return { path: rel(file) };
  }
  return { path: null };
}

/** 谁链着这个网址：库里哪篇笔记、第几行（旧版、来源本身不算） */
function linkedFrom(url) {
  const key = norm(url);
  if (!key) return [];
  const out = [];
  for (const file of walk(LIBRARY)) {
    const r = rel(file);
    if (/(^|\/)(旧版|old-)/i.test(r)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes(key.split('/')[0])) continue;
    const head = text.match(/^---\n[\s\S]*?\n---/);
    if (head && /^type:\s*(来源|source)\s*$/mi.test(head[0])) continue;
    text.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/https?:\/\/[^\s)>\]"']+/g)) {
        if (norm(m[0]) === key) { out.push({ path: r, title: path.basename(file, '.md'), line: i + 1, text: plain(line).slice(0, 80) }); break; }
      }
    });
  }
  return out;
}

const plain = s => String(s).replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*>`#]/g, '').replace(/^\s*-\s*/, '').trim();

const rel = file => path.relative(LIBRARY, file).split(path.sep).join('/');

function notesFile(relPath) {
  const key = Buffer.from(relPath, 'utf8').toString('base64').replace(/\//g, '_');
  return path.join(LIBRARY, NOTES_DIR, key + '.json');
}

// ────────── 存 ──────────

/** 没指定放哪：链着这个网址的笔记在哪个主题，就放哪；都没有就放「网页划线」，Claude 整理时再挪。
 *  好几个主题都链着时：主题名出现在网页标题里的优先（讲张月光的文章放「张月光」），其次链得多的 */
const INBOX = '网页划线';
function autoFolder(url, title = '') {
  const score = new Map();
  for (const l of linkedFrom(url)) {
    let dir = l.path.includes('/') ? l.path.split('/')[0] : '';
    if (!dir) {
      const topic = (headOf(path.join(LIBRARY, l.path)).match(/^topic:\s*"?([^"\n]+?)"?\s*$/m) || [])[1];
      if (topic && fs.existsSync(path.join(LIBRARY, safeName(topic)))) dir = safeName(topic);
    }
    if (dir) score.set(dir, (score.get(dir) || 0) + 1);
  }
  if (!score.size) return fs.existsSync(path.join(LIBRARY, INBOX)) || !EN ? INBOX : 'Web highlights';
  const rank = d => (title && title.includes(d) ? 1000 : 0) + score.get(d);
  return [...score.keys()].sort((a, b) => rank(b) - rank(a))[0];
}

function save(m) {
  const highlights = (m.highlights || []).filter(h => h.quote);

  // 以前存过：接着用那个文件（插件记的路径 → 按网址找）
  let relPath = m.path && fs.existsSync(path.join(LIBRARY, m.path)) ? m.path : findSource(m.url).path;
  let file;
  let folder = '';
  let created = false;
  if (relPath) {
    file = path.join(LIBRARY, relPath);
  } else {
    folder = safeName(m.folder ?? autoFolder(m.url, m.title));
    const dir = folder ? path.join(LIBRARY, folder) : LIBRARY;
    const label = safeName(m.label || '') || hostOf(m.url) || T('网页', 'web');
    const base = `${T('来源', 'source')}-${label}-${mmdd()}`;
    file = path.join(dir, base + '.md');
    for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${base} ${n}.md`);
    relPath = rel(file);
    created = true;
  }

  const section = quotesSection(highlights, m.keep === '全文' ? new Set(m.inText || []) : null);
  let text;
  if (created) {
    text = frontMatter(m, folder) + '\n' + body(m, section);
  } else {
    // 已有的：属性、正文（Claude 可能动过）都不碰，只换「我划的」那一节；要全文而原来没有就补上
    text = fs.readFileSync(file, 'utf8');
    text = replaceSection(text, H_QUOTES, section);
    if (/^\d{4}-\d{2}(-\d{2})?$/.test(m.published || '') && !/^published:/m.test(text.split(/\n---\n/)[0])) {
      text = text.replace(/^(source:.*)$/m, `$1\npublished: ${m.published}`);
    }
    if (m.keep === '全文' && m.markdown && !new RegExp(`^## ${H_FULL}\\s*$`, 'm').test(text)) {
      text = text.replace(/\s*$/, `\n\n## ${T('原文', 'Full text')}\n\n` + m.markdown.trim() + '\n');
      text = text.replace(/^keep:.*$/m, `keep: ${T('全文', 'full')}`);
    }
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  const count = writeNotes(relPath, highlights);
  syncLog([file], `${created ? '存来源' : '更新来源'}（浏览器插件）：${relPath}`);
  return { ok: true, path: relPath, abs: file, created, notes: count };
}

function frontMatter(m, folder) {
  const y = ['---', `type: ${T('来源', 'source')}`, 'stage: working'];
  if (folder && folder !== INBOX && folder !== 'Web highlights') y.push(`topic: ${yamlValue(folder)}`);
  y.push(`created: ${today()}`);
  y.push(`source: ${yamlValue(m.url)}`);
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(m.published || '')) y.push(`published: ${m.published}`);   // 原文发表日期：Anew 按它给来源排序
  y.push(`keep: ${m.keep === '全文' && m.markdown ? T('全文', 'full') : T('摘要', 'summary')}`);
  y.push(`from: ${T('网页', 'web')}`);
  y.push('---');
  return y.join('\n') + '\n';
}

function body(m, section) {
  const meta = [m.site, m.author, m.published].filter(Boolean).join(' · ');
  let out = `# ${m.title || hostOf(m.url)}\n\n${T('原文：', 'Original: ')}<${m.url}>${meta ? '　' + meta : ''}\n`;
  if (m.description) out += `\n## ${T('摘要', 'Summary')}\n\n> ${oneLine(m.description)}\n`;
  if (section) out += '\n' + section;
  if (m.keep === '全文' && m.markdown) out += `\n## ${T('原文', 'Full text')}\n\n${m.markdown.trim()}\n`;
  return out;
}

/** 「我划的」：每句一个灰框。全文里能直接找到的句子就不再抄一遍（inText） */
function quotesSection(highlights, inText) {
  const list = highlights.filter(h => !(inText && inText.has(h.id)));
  if (!list.length) return '';
  return `## ${T('我划的', 'My highlights')}\n\n` + list.map(h => `> ${oneLine(h.quote)}`).join('\n\n') + '\n';
}

function replaceSection(text, heading, section) {
  const re = new RegExp(`^## ${heading}\\s*\\n[\\s\\S]*?(?=^## |(?![\\s\\S]))`, 'm');
  if (re.test(text)) return text.replace(re, section ? section + '\n' : '');
  if (!section) return text;
  // 放在「## 原文」前面，没有就放最后
  const full = new RegExp(`^(## ${H_FULL})\\s*$`, 'm');
  if (full.test(text)) return text.replace(full, section + '\n$1');
  return text.replace(/\s*$/, '\n\n' + section);
}

/** 批注：按 id 合并。Anew / Claude 加的回复、done 都留着；插件删掉的、又没人回过的，拿掉 */
function writeNotes(relPath, highlights) {
  const file = notesFile(relPath);
  let disk = [];
  try { disk = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  if (!Array.isArray(disk)) disk = [];
  const byID = new Map(disk.map(item => [item.id, item]));
  const mine = new Set(highlights.map(h => h.id));
  const next = disk.filter(item => {
    if (!String(item.id || '').startsWith('web-') || mine.has(item.id)) return true;
    return (item.replies && item.replies.length) || item.done;   // 有人回过 / 处理过，留着
  }).map(item => {
    const h = mine.has(item.id) && highlights.find(x => x.id === item.id);
    if (!h) return item;
    const updated = { ...item, quote: oneLine(h.quote), note: h.note || '' };
    if (h.follow) updated.follow = true; else delete updated.follow;
    return updated;
  });
  for (const h of highlights) {
    if (byID.has(h.id)) continue;
    const item = { id: h.id, created: h.created || stamp(), quote: oneLine(h.quote), note: h.note || '' };
    if (h.follow) item.follow = true;
    next.push(item);
  }
  if (!next.length && !fs.existsSync(file)) return 0;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  return next.length;
}

// ────────── Diem 同步本 ──────────

function syncLog(files, what) {
  if (path.basename(LIBRARY) !== 'notes') return;
  const root = path.dirname(LIBRARY);
  if (!fs.existsSync(path.join(root, 'ideas'))) return;
  const t = isoNow();
  const line = { t, agent: 'me', tool: 'Anew 插件', files: files.map(f => path.relative(root, f)), cmd: what };
  const dir = path.join(root, 'sync');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, t.slice(0, 10) + '.jsonl'), JSON.stringify(line) + '\n');
}

// ────────── 在 Anew 里打开 ──────────

function openInAnew(relPath) {
  const file = path.join(LIBRARY, relPath || '');
  if (!relPath || !fs.existsSync(file)) return { ok: false, error: T('文件不在了', 'File not found') };
  execFile('/usr/bin/open', ['-b', 'com.anew.app', file]);
  return { ok: true };
}

// ────────── 小工具 ──────────

function safeName(raw) {
  let name = String(raw).trim().replace(/\//g, '／').replace(/:/g, '：').replace(/[\\?*"<>|\n\r\t]/g, ' ').replace(/\s+/g, ' ');
  while (name.startsWith('.')) name = name.slice(1);
  return name.replace(/\.md$/i, '').trim();
}
function yamlValue(v) {
  v = String(v ?? '');
  if (!v) return '""';
  if (/[:#]/.test(v) || /^[\[{'"\-*&]/.test(v)) return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  return v;
}
const oneLine = s => String(s || '').replace(/\s*\n+\s*/g, ' ').replace(/\s+/g, ' ').trim();
const hostOf = u => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };
const pad = n => String(n).padStart(2, '0');
const today = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const mmdd = (d = new Date()) => pad(d.getMonth() + 1) + pad(d.getDate());
const stamp = (d = new Date()) => `${today(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
function isoNow(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${today(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}
