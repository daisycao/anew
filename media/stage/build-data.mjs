// 把 demo-library 读成页面要的样子（和 AppDelegate.swift 的 openFolder / yamlMeta 一样），写进 stage/data.js
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const lib = process.argv[2] ? path.resolve(process.argv[2]) : path.join(here, '..', 'demo-library');
const ROOT = '/Users/demo/Anew Notes';
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.name.startsWith('.') ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
function yamlMeta(text) {
  const meta = {}; const lines = text.split('\n'); let inFront = text.startsWith('---\n');
  for (let i = 0; i < lines.length; i++) { const l = lines[i]; if (inFront) { if (i > 0 && l === '---') inFront = false; continue; } if (l.startsWith('# ')) { meta._heading = l.slice(2).trim(); break; } }
  if (!text.startsWith('---\n')) return meta;
  for (const l of lines.slice(1)) { if (l === '---') break; const c = l.indexOf(':'); if (c < 0) continue; const k = l.slice(0, c).trim(); let v = l.slice(c + 1).trim(); if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1); if (k && !k.includes(' ')) meta[k] = v; }
  return meta;
}
const notesDir = path.join(lib, '.paper-md-notes');
const NOTES = {};
if (fs.existsSync(notesDir)) for (const f of fs.readdirSync(notesDir)) NOTES[Buffer.from(f.replace(/\.json$/, '').replace(/_/g, '/'), 'base64').toString()] = JSON.parse(fs.readFileSync(path.join(notesDir, f), 'utf8'));
const FILES = {}, DOCS = [];
let t = Date.parse('2026-10-06T09:00:00');
for (const file of walk(lib).filter(f => f.endsWith('.md')).sort()) {
  const rel = path.relative(lib, file); const text = fs.readFileSync(file, 'utf8'); const p = ROOT + '/' + rel;
  FILES[p] = text;
  const body = text.replace(/^---\n[\s\S]*?\n---/, '');
  const notes = NOTES[rel] || [];
  DOCS.push({ name: path.basename(rel), path: p, relativePath: rel, size: Buffer.byteLength(text), modified: (t += 60000), meta: yamlMeta(text), chars: body.replace(/\s/g, '').length,
    noteBrief: notes.map(n => ({ id: n.id, done: !!n.done, replies: (n.replies || []).length, ...(n.resolved ? { resolved: n.resolved } : {}) })) });
}
const notesByPath = Object.fromEntries(Object.entries(NOTES).map(([k, v]) => [ROOT + '/' + k, v]));
fs.writeFileSync(path.join(here, 'data.js'), `const ROOT=${JSON.stringify(ROOT)};const DOCS=${JSON.stringify(DOCS)};const FILES=${JSON.stringify(FILES)};const NOTES=${JSON.stringify(notesByPath)};\n`);
console.log(DOCS.length, 'docs');
