// 假桥接：页面以为自己在 WKWebView 里，其实数据来自 data.js（编的示例书库）
window.ANEW_LANG = new URLSearchParams(location.search).get('lang') || 'en';
window.BRIDGE_LOG = [];
const stageDoc = p => DOCS.find(d => d.path === p);
function stagePayload(doc, content) {
  return { imageScope: 'demo', name: doc.name, path: doc.path, content: content ?? FILES[doc.path], logs: [], notes: NOTES[doc.path] || [], reveal: true, baseline: null, backlinks: [] };
}
window.webkit = { messageHandlers: new Proxy({}, { get: (_, name) => ({ postMessage: body => {
  window.BRIDGE_LOG.push([name, body]);
  // 时间轴：没有 Diem 的阅读时长，只给批注（和 App 一样把整库的批注都给，页面自己按天挑）
  if (name === 'loadTimeline') setTimeout(() => window.__timelineData({ date: body.date, hasUsage: false, segments: [], notes: Object.entries(NOTES).map(([p, items]) => ({ rel: p.slice(ROOT.length + 1), items })) }), 10);
  if (name === 'loadGraph') setTimeout(() => window.__graphData({ token: body.token, files: Object.fromEntries(body.paths.map(p => [p, FILES[p]])) }), 10);
  if (name === 'openDocument' && !window.STAGE_LOCK) { const d = stageDoc(body.path); if (d) setTimeout(() => window.renderDocument(stagePayload(d)), 10); }
  if (name === 'shelfOpen' || name === 'openRecentFolder') setTimeout(stageBoot, 10);
} }) }) };
function stageBoot() { window.renderLibrary({ name: 'Anew Notes', folderName: 'Anew Notes', path: ROOT, documents: DOCS, keepingDocument: false }); }
window.addEventListener('load', () => {
  const q = new URLSearchParams(location.search);
  try { localStorage.night = '0'; } catch {}
  stageBoot();
  const open = q.get('doc'); window.STAGE_LOCK = !!open; setTimeout(() => { window.STAGE_LOCK = false; }, 1500);
  if (open) setTimeout(() => { const d = DOCS.find(x => x.relativePath === open); const over = q.get('as'); window.renderDocument(stagePayload(d, over ? FILES[ROOT + '/' + over].replace('stage: archive', 'stage: working') : undefined)); if (q.get('scroll')) setTimeout(() => window.scrollTo({ top: +q.get('scroll'), behavior: 'instant' }), 100); }, 200);
  if (q.get('timeline')) setTimeout(() => document.querySelector('#timeline').click(), 800);
  if (q.get('graph')) setTimeout(() => { document.querySelector('#graph').click(); if (q.get('graph') === 'cat') setTimeout(() => document.querySelector('.gr-tab[data-mode="cat"]').click(), 80); }, 800);
});

// 录制脚本用：直接摆出一个画面。opts = { rel, as, notes, baseline, scroll }
window.stageShow = opts => {
  const d = DOCS.find(x => x.relativePath === opts.rel);
  const content = opts.as ? FILES[ROOT + '/' + opts.as].replace('stage: archive', 'stage: working') : FILES[d.path];
  const p = stagePayload(d, content);
  if (opts.notes) p.notes = opts.notes;
  if (opts.baseline) p.baseline = FILES[ROOT + '/' + opts.baseline].replace('stage: archive', 'stage: working');
  window.renderDocument(p);
  window.scrollTo({ top: opts.scroll || 0, behavior: 'instant' });
};
// 选中正文里的一句（找到含这句的文本节点）
window.stageSelect = text => {
  const walker = document.createTreeWalker(document.querySelector('#content'), NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const i = node.data.indexOf(text);
    if (i < 0) continue;
    const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + text.length);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.dispatchEvent(new MouseEvent('mouseup'));
    return true;
  }
  return false;
};
window.stageRect = sel => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
