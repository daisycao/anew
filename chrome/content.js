// 知新 Anew 插件：在网页上划线、批注，存进 Anew 的库。
// 划线和批注记在浏览器里（按网址），回来还在；划第一句就自动存成一篇来源，之后再划、再写自动跟着更新。
// 放哪：面板里选了就放那；没选就放链着这页的笔记所在的主题，都没有就放「网页划线」（本机那头定）。
(() => {
  if (window.__anewClip) return;
  window.__anewClip = true;

  // 中英双语：跟浏览器语言走 / bilingual, follows the browser language
  const IS_ZH = /^zh/i.test(navigator.language || '');
  const L = (zh, en) => (IS_ZH ? zh : en);

  // ────────── 状态 ──────────

  const pageKey = (() => {
    const u = new URL(location.href);
    u.hash = '';
    [...u.searchParams.keys()].filter(k => /^(utm_|spm|from$|share|ref$)/.test(k)).forEach(k => u.searchParams.delete(k));
    return 'page:' + u.toString();
  })();
  const pageURL = pageKey.slice(5);

  let state = { highlights: [], path: null, abs: null, folder: null, label: '', keep: '摘要', savedAt: null };
  let settings = { lastFolder: '', keep: '摘要' };
  let folders = null;          // 本机给的主题文件夹
  let linked = [];             // 库里哪几篇笔记链着这页
  let hostError = null;

  const stable = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().filter(key => x[key] !== undefined).map(key => [key, x[key]])) : x);
  const uid = () => 'web-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const oneLine = s => String(s || '').replace(/\s+/g, ' ').trim();
  const pad = n => String(n).padStart(2, '0');
  const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 插件在 chrome://extensions 里刷新过、这页没刷新：这页的脚本就和插件断开了，chrome.* 全都用不了。
  // 这时先把改动存在这页自己的 localStorage 里，提示刷新；刷新后 load() 补回去。
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  const pendingKey = 'anew-pending:' + pageKey;
  let staleShown = false;
  function store(obj) {
    if (alive()) {
      try { return chrome.storage.local.set(obj).catch(() => stash()); } catch { /* 落到下面 */ }
    }
    stash();
  }
  function stash() {
    try { localStorage.setItem(pendingKey, JSON.stringify({ state, at: Date.now() })); } catch {}
    showStale();
  }
  function showStale() {
    if (staleShown) return;
    staleShown = true;
    const tip = document.createElement('div');
    tip.className = 'stale';
    tip.innerHTML = L('Anew 插件刚更新过，这页要<b>刷新一下</b>才能接着存。<br>你写的已经先记在这页里，刷新后会自动补回去。<button data-act="reload">刷新</button>', 'The Anew extension was just updated — <b>reload this page</b> to keep saving.<br>What you wrote is kept and will come back after reloading.<button data-act="reload">Reload</button>');
    tip.querySelector('button').onclick = () => location.reload();
    shadow.appendChild(tip);
  }

  const native = body => new Promise(resolve => {
    if (!alive()) { showStale(); resolve({ ok: false, error: L('插件刚更新过，刷新一下这页', 'Extension updated — reload this page') }); return; }
    try { chrome.runtime.sendMessage({ type: 'native', body: { ...body, lang: IS_ZH ? 'zh' : 'en' } }, r => resolve(r || { ok: false, error: chrome.runtime.lastError?.message || L('没回话', 'No response') })); }
    catch (e) { resolve({ ok: false, error: String(e.message || e) }); }
  });

  async function load() {
    const got = await chrome.storage.local.get([pageKey, 'settings']);
    settings = { ...settings, ...(got.settings || {}) };
    if (got[pageKey]) state = { ...state, ...got[pageKey] };
    // 上次和插件断开时记在这页里的，补回去
    try {
      const pending = JSON.parse(localStorage.getItem(pendingKey) || 'null');
      if (pending && pending.state) {
        state = { ...state, ...pending.state };
        await chrome.storage.local.set({ [pageKey]: state });
        localStorage.removeItem(pendingKey);
        if (state.path) setTimeout(() => saveToAnew({ auto: true }), 500);
      }
    } catch {}
    restoreAll();
    badge();
    // 动态加载的页面：正文晚点才出来，再试两次
    if (state.highlights.some(h => !document.querySelector(`mark[data-anew-id="${h.id}"]`))) {
      setTimeout(restoreAll, 1500);
      setTimeout(restoreAll, 4000);
    }
  }

  let syncTimer = null;
  function persist({ sync = true } = {}) {
    store({ [pageKey]: state });
    badge();
    renderPanel();
    // 划了就自动存；点过「断开」的这页不再自动存
    if (sync && !state.detached && (state.path || state.highlights.length)) {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => saveToAnew({ auto: true }), 1500);
    }
  }
  const badge = () => { if (!alive()) return; try { chrome.runtime.sendMessage({ type: 'badge', count: state.highlights.length, saved: !!state.path }).catch(() => {}); } catch {} };

  // ────────── 页面文字的索引：把所有文字串成一条，划线按位置记 ──────────

  function textIndex() {
    const nodes = [];
    let text = '';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p || p.closest('script,style,noscript,textarea,#anew-root')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode())) { nodes.push({ node, start: text.length }); text += node.nodeValue; }
    return { nodes, text };
  }

  /** 选区 → 在索引里的起止，加前后各 32 字当定位 */
  function anchorOf(range) {
    const idx = textIndex();
    let start = -1, end = -1;
    for (const { node, start: s } of idx.nodes) {
      if (!range.intersectsNode(node)) continue;
      const a = node === range.startContainer ? range.startOffset : 0;
      const b = node === range.endContainer ? range.endOffset : node.length;
      if (b <= a) continue;
      if (start < 0) start = s + a;
      end = s + b;
    }
    if (start < 0 || end <= start) return null;
    return {
      text: idx.text.slice(start, end),
      prefix: idx.text.slice(Math.max(0, start - 32), start),
      suffix: idx.text.slice(end, end + 32),
      start, end, idx
    };
  }

  /** 定位：同一句出现好几次时，挑前后文最像的那次 */
  function locate(anchor, idx) {
    const hits = [];
    for (let i = idx.text.indexOf(anchor.text); i >= 0; i = idx.text.indexOf(anchor.text, i + 1)) hits.push(i);
    if (!hits.length) return -1;
    const common = (a, b, fromEnd) => {
      let n = 0;
      while (n < a.length && n < b.length && (fromEnd ? a[a.length - 1 - n] === b[b.length - 1 - n] : a[n] === b[n])) n++;
      return n;
    };
    let best = hits[0], bestScore = -1;
    for (const i of hits) {
      const score = common(idx.text.slice(Math.max(0, i - 32), i), anchor.prefix || '', true)
        + common(idx.text.slice(i + anchor.text.length, i + anchor.text.length + 32), anchor.suffix || '', false);
      if (score > bestScore) { best = i; bestScore = score; }
    }
    return best;
  }

  function wrap(h, start, end, idx) {
    const marks = [];
    for (const { node, start: s } of idx.nodes) {
      const a = Math.max(start, s) - s, b = Math.min(end, s + node.length) - s;
      if (b <= a) continue;
      if (!node.nodeValue.slice(a, b).trim()) continue;   // 表格、列表之间的空白不包
      let target = node;
      if (a > 0) target = target.splitText(a);
      if (b - a < target.length) target.splitText(b - a);
      const mark = document.createElement('mark');
      mark.className = 'anew-hl';
      mark.dataset.anewId = h.id;
      target.parentNode.insertBefore(mark, target);
      mark.appendChild(target);
      marks.push(mark);
    }
    styleMarks(h);
    return marks;
  }

  function styleMarks(h) {
    document.querySelectorAll(`mark[data-anew-id="${h.id}"]`).forEach(m => {
      m.classList.toggle('anew-has-note', !!h.note);
      m.classList.toggle('anew-follow', !!h.follow);
      m.title = h.note ? h.note : L('点一下写回响', 'Click to add a note');
    });
  }

  function unwrap(id) {
    document.querySelectorAll(`mark[data-anew-id="${id}"]`).forEach(m => {
      const parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    });
  }

  function restoreAll() {
    for (const h of state.highlights) {
      if (document.querySelector(`mark[data-anew-id="${h.id}"]`)) continue;
      const idx = textIndex();
      const at = locate(h.anchor, idx);
      if (at >= 0) wrap(h, at, at + h.anchor.text.length, idx);
    }
    renderPanel();
  }

  // ────────── 划线、批注 ──────────

  function selectionRange() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (root.contains(range.commonAncestorContainer) || (range.commonAncestorContainer.closest?.('#anew-root'))) return null;
    if (!oneLine(sel.toString())) return null;
    return range;
  }

  function markSelection() {
    const range = selectionRange();
    if (!range) return null;
    const quote = oneLine(getSelection().toString());
    const anchor = anchorOf(range);
    if (!anchor) return null;
    // 和已有的划线重了：直接给那条
    const overlap = state.highlights.find(h => {
      const at = locate(h.anchor, anchor.idx);
      return at >= 0 && at < anchor.end && at + h.anchor.text.length > anchor.start;
    });
    if (overlap) { getSelection().removeAllRanges(); return overlap; }
    const h = { id: uid(), quote, note: '', follow: false, created: stamp(), anchor: { text: anchor.text, prefix: anchor.prefix, suffix: anchor.suffix } };
    state.highlights.push(h);
    wrap(h, anchor.start, anchor.end, anchor.idx);
    // 按在页面里的先后排
    const pos = new Map(state.highlights.map(x => [x.id, locate(x.anchor, textIndex())]));
    state.highlights.sort((a, b) => pos.get(a.id) - pos.get(b.id));
    getSelection().removeAllRanges();
    persist();
    return h;
  }

  function removeHighlight(id) {
    unwrap(id);
    state.highlights = state.highlights.filter(h => h.id !== id);
    persist();
  }

  // ────────── 界面（shadow DOM，不受网页样式影响） ──────────

  const root = document.createElement('div');
  root.id = 'anew-root';
  root.style.cssText = 'all:initial;position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;';
  const shadow = root.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${CSS()}</style>
    <div class="bar" hidden>
      <button data-act="mark" title="${L('划线', 'Highlight')}">${L('划线', 'Highlight')}</button>
      <button data-act="note" title="${L('划线并写回响', 'Highlight and add a note')}">${L('＋ 回响', '＋ Note')}</button>
    </div>
    <div class="pop" hidden>
      <blockquote class="pop-quote"></blockquote>
      <textarea placeholder="${L('写两句你的想法…（⌘↩ 存）', 'What do you think? (⌘↩ to save)')}"></textarea>
      <div class="row">
        <button class="star" data-act="follow" title="${L('要接着想', 'Keep thinking')}">☆ ${L('要接着想', 'Keep thinking')}</button>
        <span class="grow"></span>
        <button class="ghost" data-act="del">${L('删掉划线', 'Remove')}</button>
        <button class="primary" data-act="ok">${L('好', 'OK')}</button>
      </div>
    </div>
    <aside class="panel" hidden></aside>`;
  document.documentElement.appendChild(root);

  const $ = sel => shadow.querySelector(sel);
  const bar = $('.bar'), pop = $('.pop'), panel = $('.panel');
  const popText = pop.querySelector('textarea');
  let editingId = null;
  // 正在写的那条：每次按 id 从 state 里拿，state 被整个换掉（别的标签页改了）也不会写到旧对象上
  const current = () => editingId && state.highlights.find(x => x.id === editingId) || null;

  // 选中文字 → 小条
  document.addEventListener('mouseup', e => {
    if (e.composedPath().includes(root)) return;
    setTimeout(() => {
      const range = selectionRange();
      if (!range) { bar.hidden = true; return; }
      const r = range.getBoundingClientRect();
      bar.hidden = false;
      const top = r.bottom + scrollY + 8, left = Math.max(8, Math.min(r.left + scrollX + r.width / 2 - 70, scrollX + innerWidth - 160));
      bar.style.top = top + 'px'; bar.style.left = left + 'px';
    }, 0);
  }, true);
  document.addEventListener('mousedown', e => {
    if (e.composedPath().includes(root)) return;
    bar.hidden = true;
    if (!pop.hidden) closePop(true);
  }, true);
  bar.addEventListener('mousedown', e => e.preventDefault());   // 别把选区点没了
  bar.addEventListener('click', e => {
    const act = e.target.dataset.act;
    if (!act) return;
    bar.hidden = true;
    const h = markSelection();
    if (h && act === 'note') openPop(h);
  });

  // 点划线 → 写批注
  document.addEventListener('click', e => {
    const mark = e.target.closest?.('mark.anew-hl');
    if (!mark || !getSelection().isCollapsed) return;
    const h = state.highlights.find(x => x.id === mark.dataset.anewId);
    if (!h) return;
    e.preventDefault(); e.stopPropagation();
    openPop(h);
  }, true);

  function openPop(h) {
    editingId = h.id;
    const mark = document.querySelector(`mark[data-anew-id="${h.id}"]`);
    document.querySelectorAll('mark.anew-active').forEach(m => m.classList.remove('anew-active'));
    document.querySelectorAll(`mark[data-anew-id="${h.id}"]`).forEach(m => m.classList.add('anew-active'));
    pop.querySelector('.pop-quote').textContent = h.quote.length > 90 ? h.quote.slice(0, 90) + '…' : h.quote;
    popText.value = h.note || '';
    pop.querySelector('.star').classList.toggle('on', !!h.follow);
    pop.querySelector('.star').textContent = (h.follow ? '★ ' : '☆ ') + L('要接着想', 'Keep thinking');
    pop.hidden = false;
    const r = (mark || document.body).getBoundingClientRect();
    const w = 320;
    let left = r.left + scrollX;
    left = Math.max(scrollX + 8, Math.min(left, scrollX + innerWidth - w - 24 - (panel.hidden ? 0 : 360)));
    let top = r.bottom + scrollY + 8;
    if (r.bottom + 220 > innerHeight) top = Math.max(scrollY + 8, r.top + scrollY - 210);
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
    setTimeout(() => popText.focus(), 0);
  }

  function closePop(save) {
    clearTimeout(typeTimer);
    const h = current();
    if (h && save) {
      const note = popText.value.trim();
      if (note !== (h.note || '')) { h.note = note; styleMarks(h); persist(); }
    }
    document.querySelectorAll('mark.anew-active').forEach(m => m.classList.remove('anew-active'));
    editingId = null;
    pop.hidden = true;
  }

  pop.addEventListener('click', e => {
    const act = e.target.dataset.act;
    const h = current();
    if (!act || !h) return;
    if (act === 'ok') closePop(true);
    if (act === 'del') { editingId = null; pop.hidden = true; removeHighlight(h.id); }
    if (act === 'follow') {
      h.follow = !h.follow;
      e.target.classList.toggle('on', h.follow);
      e.target.textContent = (h.follow ? '★ ' : '☆ ') + L('要接着想', 'Keep thinking');
      styleMarks(h); persist();
    }
  });
  // 边打边存：不点「好」、直接关页面也不丢
  let typeTimer = null;
  // 输入法还在拼（拼音、语音没上屏）的时候不存，上屏了再存
  let composing = false;
  popText.addEventListener('compositionstart', () => { composing = true; });
  popText.addEventListener('compositionend', () => { composing = false; popText.dispatchEvent(new Event('input')); });
  popText.addEventListener('input', () => {
    if (composing) return;
    const id = editingId;
    clearTimeout(typeTimer);
    typeTimer = setTimeout(() => {
      const h = id && state.highlights.find(x => x.id === id);
      if (!h) return;
      h.note = popText.value.trim();
      styleMarks(h);
      persist();
    }, 400);
  });
  popText.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) { e.stopPropagation(); return; }   // 输入法里的回车、Esc 归输入法
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); closePop(true); }
    if (e.key === 'Escape') { e.preventDefault(); closePop(true); }
    e.stopPropagation();
  });
  ['keyup', 'keypress'].forEach(t => pop.addEventListener(t, e => e.stopPropagation()));

  // ────────── 右边一栏：这页划了什么、存到哪 ──────────

  async function togglePanel(force) {
    panel.hidden = force === undefined ? !panel.hidden : !force;
    if (panel.hidden) return;
    renderPanel();
    if (!folders) {
      const r = await native({ cmd: 'hello' });
      if (r.ok) { folders = r.folders; hostError = null; } else hostError = r.error || L('连不上本机', 'Can\'t reach the native host');
    }
    if (!hostError) {
      // 每次打开都看一眼：谁链着这页、以前存成过来源没有
      const f = await native({ cmd: 'find', url: pageURL });
      if (f.ok) {
        linked = f.linkedFrom || [];
        if (f.path && !state.path) { state.path = f.path; persist({ sync: false }); }
      }
    }
    renderPanel();
  }

  /** 文件名里的说明：标题冒号后面那半句（多半是正题），去掉标点，16 个字以内 */
  function defaultLabel(meta) {
    const parts = (meta.title || '').split(/[:：]/).map(x => x.trim()).filter(Boolean);
    const pick = parts.length > 1 && parts[parts.length - 1].length >= 6 ? parts[parts.length - 1] : (meta.title || '');
    return pick.replace(/[“”"「」《》『』|｜?？!！，,。、；;（）()\[\]]+/g, ' ')
      .replace(/\s+/g, ' ').replace(/(?<=[^\x00-\xff]) | (?=[^\x00-\xff])/g, '').trim().slice(0, 16).trim();
  }

  function renderPanel() {
    if (panel.hidden) return;
    const meta = pageMeta();
    const hs = state.highlights;
    const folder = state.folder;   // undefined = 自动
    const keep = state.keep || settings.keep || '摘要';
    const label = state.label || defaultLabel(meta);
    const list = hs.length ? hs.map((h, i) => `
      <li data-id="${h.id}" class="${document.querySelector(`mark[data-anew-id="${h.id}"]`) ? '' : 'lost'}">
        <div class="q">${esc(h.quote.length > 80 ? h.quote.slice(0, 80) + '…' : h.quote)}</div>
        ${h.note ? `<div class="n">${h.follow ? '★ ' : ''}${esc(h.note)}</div>` : `<div class="n empty">${h.follow ? '★ ' : ''}${L('点一下写回响', 'Click to add a note')}</div>`}
      </li>`).join('') : `<li class="none">${L('选中一段文字，点「划线」或「＋ 回响」。', 'Select text, then click Highlight or ＋ Note.')}</li>`;
    const folderOptions = (folders || []).map(f => `<option ${f === folder ? 'selected' : ''}>${esc(f)}</option>`).join('');
    const saved = state.path;
    panel.innerHTML = `
      <header><b>${L('知新', 'Anew')}</b><span class="count">${L(`${hs.length} 处划线`, `${hs.length} highlights`)}</span><button class="x" data-act="close" title="${L('收起', 'Close')}">×</button></header>
      <ol class="list">${list}</ol>
      <section class="save">
        ${hostError ? `<div class="err">${L('连不上 Anew：', 'Can\'t reach Anew: ')}${esc(hostError)}<br>${L('先在访达里双击 <code>chrome/install-extension.command</code>，再刷新这页。', 'Double-click <code>chrome/install-extension.command</code> in Finder, then reload this page.')}</div>` : ''}
        ${linked.length ? `<div class="from">${linked.map(l => L(`从 <a data-open="${esc(l.path)}">《${esc(l.title)}》</a>第 ${l.line} 行链过来`, `Linked from <a data-open="${esc(l.path)}">${esc(l.title)}</a>, line ${l.line}`)).join('<br>')}</div>` : ''}
        ${saved ? `
          <div class="done"><span class="ok">✓</span> ${L('存进了', 'Saved to')} 「${esc(saved.includes('/') ? saved.split('/')[0] : L('库的最外层', 'library root'))}」<br><code>${esc(saved.split('/').pop())}</code></div>
          <div class="hint">${L('再划、再写会自动跟上。这一批都读完，到 Anew 点「交给 AI ▾」→「收网页回响」，Claude 一起收进主题笔记。', 'New highlights and notes sync automatically. When you finish a batch, use Hand to AI ▾ → Collect web highlights in Anew, and Claude folds them into your topic note.')}</div>
          <div class="row">
            <button data-act="open">${L('在 Anew 里打开', 'Open in Anew')}</button>
            <span class="grow"></span>
            ${keep !== '全文' ? `<button class="ghost" data-act="full" title="${L('把正文整篇也存下来', 'Also save the full text')}">${L('补存全文', 'Save full text')}</button>` : ''}
            <button class="ghost" data-act="forget" title="${L('这页和那篇来源断开（文件不删）', 'Disconnect this page from the source (file is kept)')}">${L('断开', 'Disconnect')}</button>
          </div>
        ` : `
          <div class="hint">${state.detached ? L('这页断开了，不再自动存。', 'Disconnected — not saving automatically. ') : L('划第一句就自动存成来源，不用点。', 'Your first highlight saves this page as a source. ')}${L('放进：', 'Goes to: ')}<b>${folder === undefined || folder === null ? L('自动', 'Auto') : esc(folder || L('库的最外层', 'library root'))}</b>${folder === undefined || folder === null ? L('（链着这页的笔记在哪个主题就放哪）', ' (the topic of the note that links here)') : ''}</div>
          <details ${folder !== undefined && folder !== null ? 'open' : ''}>
            <summary>${L('改位置、文件名', 'Folder & file name')}</summary>
            <label>${L('放进', 'Folder')}<select data-k="folder">
              <option value="__auto" ${folder === undefined || folder === null ? 'selected' : ''}>${L('自动', 'Auto')}</option>
              <option value="" ${folder === '' ? 'selected' : ''}>${L('库的最外层', 'Library root')}</option>
              ${folderOptions}
              ${folder && folders && !folders.includes(folder) ? `<option selected>${esc(folder)}</option>` : ''}
              <option value="__new">${L('新主题…', 'New topic…')}</option>
            </select></label>
            <label>${L('说明', 'Label')}<input data-k="label" value="${esc(label)}" placeholder="${L('文件名里的说明', 'label in the file name')}"></label>
            <div class="file">${L('来源', 'source')}-${esc(label || '…')}-${mmdd()}.md</div>
            <div class="seg">
              <button data-keep="摘要" class="${keep === '摘要' ? 'on' : ''}" title="${L('标题、链接、摘要、你划的句子', 'Title, link, summary and your highlights')}">${L('存摘要', 'Summary')}</button>
              <button data-keep="全文" class="${keep === '全文' ? 'on' : ''}" title="${L('再把正文整篇存下来，回头在 Anew 里接着写回响', 'Also save the full text to keep annotating in Anew')}">${L('存全文', 'Full text')}</button>
            </div>
          </details>
          ${state.detached ? `<button class="primary" data-act="save" ${hostError ? 'disabled' : ''}>${L('再存一次', 'Save again')}</button>` : `
          <div class="row">
            <span class="grow">${L('不划也能存：', 'Save without highlighting:')}</span>
            <button data-act="save-summary" ${hostError ? 'disabled' : ''} title="${L('标题、链接、摘要', 'Title, link, summary')}">${L('存摘要', 'Summary')}</button>
            <button class="primary" data-act="save-full" ${hostError ? 'disabled' : ''} title="${L('正文整篇存下来，回头在 Anew 里读、写回响', 'Save the full text to read and annotate in Anew')}">${L('存全文', 'Full text')}</button>
          </div>`}
        `}
        <div class="msg"></div>
      </section>`;
  }

  panel.addEventListener('click', async e => {
    const li = e.target.closest('li[data-id]');
    if (li) {
      const h = state.highlights.find(x => x.id === li.dataset.id);
      const mark = h && document.querySelector(`mark[data-anew-id="${h.id}"]`);
      if (mark) {
        const vr = mark.getBoundingClientRect();
        const inView = vr.top > 60 && vr.bottom < innerHeight - 240;
        if (!inView) mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
        document.querySelectorAll(`mark[data-anew-id="${h.id}"]`).forEach(m => { m.classList.remove('anew-flash'); void m.offsetWidth; m.classList.add('anew-flash'); });
        // 滚完再弹，不然位置是滚之前的
        let opened = false;
        const open = () => { if (!opened) { opened = true; openPop(h); } };
        addEventListener('scrollend', open, { once: true });
        setTimeout(open, inView ? 0 : 900);
      } else if (h) {
        // 页面变了、找不着那句：只能删
        if (confirm(L(`页面上找不到这句了：\n\n${h.quote.slice(0, 80)}\n\n删掉这条？`, `Can't find this on the page anymore:\n\n${h.quote.slice(0, 80)}\n\nDelete it?`))) removeHighlight(h.id);
      }
      return;
    }
    const openLink = e.target.closest('[data-open]');
    if (openLink) { native({ cmd: 'open', path: openLink.dataset.open }).then(r => !r.ok && say(r.error)); return; }
    const keepBtn = e.target.closest('[data-keep]');
    if (keepBtn) { state.keep = settings.keep = keepBtn.dataset.keep; store({ settings }); persist({ sync: false }); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') togglePanel(false);
    if (act === 'save') { state.detached = false; saveToAnew(); }
    if (act === 'full' || act === 'save-full') { state.keep = '全文'; saveToAnew(); }
    if (act === 'save-summary') { state.keep = '摘要'; saveToAnew(); }
    if (act === 'open') native({ cmd: 'open', path: state.path }).then(r => !r.ok && say(r.error));
    if (act === 'forget' && confirm(L('这页和那篇来源断开？（文件、回响都不删；之后不再自动存，再存会新建一篇）', 'Disconnect this page from its source? (Files and notes are kept; saving again creates a new source.)'))) {
      state.path = null; state.abs = null; state.detached = true; persist({ sync: false });
    }
  });
  panel.addEventListener('change', e => {
    const k = e.target.dataset.k;
    if (k === 'folder') {
      let v = e.target.value;
      if (v === '__auto') { state.folder = undefined; persist({ sync: false }); return; }
      if (v === '__new') {
        v = (prompt(L('新主题叫什么？（会建一个文件夹）', 'New topic name? (creates a folder)')) || '').trim();
        if (!v) { renderPanel(); return; }
      }
      state.folder = v; settings.lastFolder = v; store({ settings });
      persist({ sync: false });
    }
  });
  panel.addEventListener('input', e => {
    if (e.target.dataset.k === 'label') {
      state.label = e.target.value;
      store({ [pageKey]: state });
      const f = panel.querySelector('.file');
      if (f) f.textContent = `${L('来源', 'source')}-${state.label || '…'}-${mmdd()}.md`;
    }
  });
  ['keydown', 'keyup', 'keypress'].forEach(t => panel.addEventListener(t, e => e.stopPropagation()));

  const say = text => { const m = panel.querySelector('.msg'); if (m) { m.textContent = text; } };
  function mmdd(d = new Date()) { return pad(d.getMonth() + 1) + pad(d.getDate()); }

  // ────────── 存进 Anew ──────────

  let saving = false;
  async function saveToAnew({ auto = false } = {}) {
    if (saving) { clearTimeout(syncTimer); syncTimer = setTimeout(() => saveToAnew({ auto }), 800); return; }
    saving = true;
    if (!auto) say(L('存着…', 'Saving…'));
    const meta = pageMeta();
    const keep = state.keep || settings.keep || '摘要';
    const full = keep === '全文' ? fullText() : null;
    const body = {
      cmd: 'save',
      url: pageURL, path: state.path,
      folder: state.path ? undefined : state.folder,   // 不给 = 本机那头自动定
      label: state.label || defaultLabel(meta),
      keep: full ? '全文' : '摘要',
      title: meta.title, site: meta.site, author: meta.author, published: meta.published, description: meta.description,
      markdown: full?.markdown, inText: full?.inText,
      highlights: state.highlights.map(({ id, quote, note, follow, created }) => ({ id, quote, note, follow, created }))
    };
    const r = await native(body);
    saving = false;
    if (!r.ok) {
      if (r.noHost) { hostError = r.error; renderPanel(); }
      say(L('没存成：', 'Not saved: ') + (r.error || ''));
      return;
    }
    state.path = r.path; state.abs = r.abs; state.savedAt = stamp(); state.keep = body.keep;
    store({ [pageKey]: state });
    badge();
    renderPanel();
    say(auto ? L(`已同步 · ${state.savedAt.slice(11)}`, `Synced · ${state.savedAt.slice(11)}`) : (r.created ? L('存好了。', 'Saved. ') : L('更新好了。', 'Updated. ')) + L(`${r.notes} 条回响在 Anew 里。`, `${r.notes} notes in Anew.`));
  }

  // ────────── 读这页：标题、作者、正文 ──────────

  function jsonLdDate() {
    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      const m = (el.textContent || '').match(/"datePublished"\s*:\s*"([^"]+)"/);
      if (m) return m[1];
    }
    return '';
  }
  function mmddFull() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

  function metaContent(...names) {
    for (const n of names) {
      const el = document.querySelector(`meta[property="${n}"],meta[name="${n}"]`);
      if (el && el.content && el.content.trim()) return el.content.trim();
    }
    return '';
  }

  let metaCache = null;
  function pageMeta() {
    if (metaCache) return metaCache;
    let site = metaContent('og:site_name', 'application-name');
    let title = document.querySelector('h1')?.innerText?.trim() || metaContent('og:title', 'twitter:title') || document.title;
    if (!title || title.length > 120) title = metaContent('og:title') || document.title;
    title = oneLine(title);
    // 「标题 | 站点名」：后半截短的当站点名，从标题里拿掉
    const tail = title.match(/^(.{6,}?)\s+[|｜\-–—_]\s+([^|｜–—]{2,14})$/);
    if (tail && (!site || tail[2].includes(site) || site.includes(tail[2]))) { title = tail[1]; site = site || tail[2]; }
    if (!site) {
      const t2 = document.title.match(/\s[|｜\-–—_]\s*([^|｜–—]{2,14})$/);
      site = t2 ? t2[1].trim() : location.host.replace(/^www\./, '');
    }
    let published = metaContent('article:published_time', 'og:article:published_time', 'pubdate', 'publishdate', 'PubDate')
      || jsonLdDate() || document.querySelector('time[datetime]')?.getAttribute('datetime') || '';
    if (!published) {
      const m = (document.querySelector('time')?.innerText || '').match(/\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}/);
      published = m ? m[0] : '';
    }
    const dm = published.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    published = dm ? `${dm[1]}-${pad(dm[2])}-${pad(dm[3])}` : '';
    // 有的站（36 氪）页面上的 time 是「现在」，不是发表日期：等于今天的不信
    if (published === mmddFull()) published = '';
    metaCache = {
      title, site, published,
      author: metaContent('author', 'article:author', 'twitter:creator'),
      description: metaContent('description', 'og:description', 'twitter:description')
    };
    return metaCache;
  }

  /** 正文：Readability 抽出来，转成 Markdown；顺便看哪几句划线在正文里能原样找到 */
  function fullText() {
    try {
      const clone = document.cloneNode(true);
      clone.getElementById('anew-root')?.remove();
      clone.querySelectorAll('mark.anew-hl').forEach(m => m.replaceWith(...m.childNodes));
      // 懒加载的图
      clone.querySelectorAll('img').forEach(img => {
        const lazy = img.getAttribute('data-original') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
        if (lazy && (!img.getAttribute('src') || /^data:|loading|blank|placeholder/i.test(img.getAttribute('src')))) img.setAttribute('src', lazy);
      });
      const article = new Readability(clone, { charThreshold: 200 }).parse();
      if (!article || !article.content) return null;
      const box = document.createElement('div');
      box.innerHTML = article.content;
      box.querySelectorAll('img').forEach(img => { try { img.setAttribute('src', new URL(img.getAttribute('src'), location.href).href); } catch {} });
      const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*' });
      td.remove(['script', 'style', 'iframe', 'button', 'form']);
      let markdown = td.turndown(box.innerHTML).replace(/\n{3,}/g, '\n\n').trim();
      // 正文的小标题往下降两级，别和「## 原文」「## 我划的」平级
      markdown = markdown.replace(/^(#{1,6})(?=\s)/gm, h => '#'.repeat(Math.min(h.length + 2, 6)));
      // 第一行和标题一样的去掉
      const t = pageMeta().title;
      markdown = markdown.replace(/^#+\s*(.+)\n+/, (all, h) => oneLine(h) === t ? '' : all);
      const blocks = [...box.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,td,th,figcaption,pre')].map(b => oneLine(b.textContent));
      const inText = state.highlights.filter(h => blocks.some(b => b.includes(oneLine(h.quote)))).map(h => h.id);
      return { markdown, inText };
    } catch (e) {
      console.warn('[Anew] 抽正文失败', e);
      return null;
    }
  }

  // ────────── 后台来的命令 ──────────

  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'toggle-panel') togglePanel();
    if (msg.type === 'mark-selection') markSelection();
    if (msg.type === 'note-selection') { const h = markSelection(); if (h) openPop(h); }
  });

  // 别的标签页里改了同一页（或这页存了），跟上
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[pageKey]) return;
    const next = changes[pageKey].newValue;
    // Chrome 存的时候会把键按字母排序，比之前要先排好，不然自己刚存的也会被当成别处改的
    if (!next || stable(next) === stable(state)) return;
    const gone = state.highlights.filter(h => !next.highlights.some(x => x.id === h.id));
    gone.forEach(h => unwrap(h.id));
    state = { ...state, ...next };
    restoreAll();
    state.highlights.forEach(styleMarks);
    badge();
  });

  load();

  function CSS() { return `
    :host { all: initial;
      --paper: #f4f1ea; --paper-bright: #fbf9f4; --paper-side: #efebe1; --paper-sunk: #e8e3d7;
      --ink: #2e2a25; --ink-soft: #5b544a; --muted: #8a8174; --faint: #b4ab9b; --line: #e2dcd0; --line-soft: #ece7dc;
      --moss: #4e6a53; --moss-pale: #e2e9df; --clay: #a9684d; --amber: #b07642; --alert: #b54e45;
      --sans: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", sans-serif;
      --serif: "Iowan Old Style", Palatino, "Songti SC", "Noto Serif CJK SC", serif; }
    * { box-sizing: border-box; font-family: var(--sans); -webkit-font-smoothing: antialiased; }
    [hidden] { display: none !important; }
    button { font: inherit; cursor: pointer; border: 1px solid var(--line); background: var(--paper-bright); color: var(--ink-soft); border-radius: 999px; padding: 4px 12px; font-size: 12.5px; }
    button:hover { background: var(--paper-sunk); }
    button.primary { background: var(--moss); border-color: var(--moss); color: #fff; font-weight: 600; }
    button.primary:hover { background: #435c48; }
    button.primary:disabled { opacity: .45; cursor: default; }
    button.ghost { border-color: transparent; background: transparent; color: var(--muted); }
    button.ghost:hover { background: var(--paper-sunk); color: var(--ink-soft); }
    .bar { position: absolute; display: flex; width: max-content; white-space: nowrap; gap: 2px; padding: 3px; background: var(--ink); border-radius: 999px; box-shadow: 0 6px 20px #0003; }
    .bar button { background: transparent; border: 0; color: var(--paper-bright); padding: 5px 12px; font-size: 13px; }
    .bar button:hover { background: #ffffff1f; }
    .pop { position: absolute; width: 320px; padding: 12px; background: var(--paper-bright); border: 1px solid var(--line); border-radius: 9px; box-shadow: 0 4px 22px #0002; color: var(--ink); }
    .pop-quote { margin: 0 0 8px; padding: 2px 0 2px 9px; border-left: 2px solid color-mix(in srgb, var(--amber) 55%, transparent); color: var(--ink-soft); font-family: var(--serif); font-size: 13px; line-height: 1.6; max-height: 64px; overflow: hidden; }
    textarea { width: 100%; min-height: 84px; resize: vertical; border: 1px solid var(--line); border-radius: 6px; padding: 8px 9px; font-size: 14px; line-height: 1.65; color: var(--ink); background: #fff; outline: none; }
    textarea:focus { border-color: var(--moss); box-shadow: 0 0 0 3px color-mix(in srgb, var(--moss) 14%, transparent); }
    .row { display: flex; gap: 6px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
    .grow { flex: 1; }
    .star.on { color: var(--amber); border-color: color-mix(in srgb, var(--amber) 40%, var(--line)); background: color-mix(in srgb, var(--amber) 10%, var(--paper-bright)); }
    .panel { position: fixed; top: 12px; right: 12px; bottom: 12px; width: 340px; display: flex; flex-direction: column; background: var(--paper); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 12px 40px #0002; color: var(--ink); font-size: 13px; overflow: hidden; }
    header { display: flex; align-items: baseline; gap: 8px; padding: 12px 14px 10px; border-bottom: 1px solid var(--line); background: var(--paper-side); }
    header b { color: var(--moss); font-family: var(--serif); font-weight: 700; font-size: 16px; letter-spacing: .04em; }
    header .count { color: var(--muted); font-size: 12px; flex: 1; }
    .x { border: 0; background: transparent; font-size: 18px; line-height: 1; padding: 2px 6px; color: var(--muted); }
    .list { list-style: none; margin: 0; padding: 10px; overflow: auto; flex: 1; }
    .list li { padding: 10px 11px; border-radius: 9px; cursor: pointer; margin-bottom: 6px; background: var(--paper-bright); border: 1px solid var(--line-soft); }
    .list li:hover { border-color: var(--line); box-shadow: 0 1px 6px #0000000d; }
    .list li.lost { opacity: .55; }
    .list li.lost .q::after { content: '${L('（页面上找不到了）', ' (not on page anymore)')}'; color: var(--alert); font-size: 11px; font-family: var(--sans); }
    .list li.none { cursor: default; color: var(--muted); background: transparent; border: 0; line-height: 1.7; box-shadow: none; }
    .q { border-left: 2px solid color-mix(in srgb, var(--amber) 55%, transparent); padding-left: 9px; color: var(--ink-soft); font-family: var(--serif); font-size: 13.5px; line-height: 1.6; }
    .n { margin-top: 7px; color: var(--ink); line-height: 1.6; white-space: pre-wrap; }
    .n.empty { color: var(--faint); font-size: 12px; }
    .save { padding: 12px 14px 14px; border-top: 1px solid var(--line); background: var(--paper-side); display: flex; flex-direction: column; gap: 8px; }
    details { display: flex; flex-direction: column; gap: 8px; }
    details[open] { display: flex; }
    summary { cursor: pointer; color: var(--muted); font-size: 12px; list-style: none; }
    summary::before { content: '▸ '; }
    details[open] summary::before { content: '▾ '; }
    details > label, details > .file, details > .seg { margin-top: 8px; }
    label { display: flex; align-items: center; gap: 8px; color: var(--ink-soft); font-size: 12.5px; }
    select, input { flex: 1; min-width: 0; font: inherit; font-size: 13px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper-bright); color: var(--ink); outline: none; }
    select:focus, input:focus { border-color: var(--moss); }
    .file { color: var(--faint); font-size: 11.5px; padding-left: 36px; line-height: 1.5; word-break: break-all; }
    .seg { display: flex; }
    .seg button { flex: 1; border-radius: 0; }
    .seg button:first-child { border-radius: 999px 0 0 999px; }
    .seg button:last-child { border-radius: 0 999px 999px 0; border-left: 0; }
    .seg button.on { background: var(--moss-pale); color: var(--moss); border-color: color-mix(in srgb, var(--moss) 30%, var(--line)); font-weight: 600; }
    .done { color: var(--ink); line-height: 1.65; }
    .done .ok { color: var(--moss); font-weight: 700; }
    .done code, .err code { font-family: var(--sans); font-size: 12px; color: var(--muted); word-break: break-all; }
    .hint { color: var(--muted); font-size: 12px; line-height: 1.65; }
    .hint b { color: var(--ink-soft); }
    .err { color: var(--alert); line-height: 1.6; font-size: 12.5px; }
    .from { color: var(--ink-soft); font-size: 12.5px; line-height: 1.6; padding: 6px 10px; background: color-mix(in srgb, var(--paper-sunk) 55%, transparent); border-radius: 8px; }
    .from a { color: var(--moss); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
    .stale { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); width: max-content; max-width: 90vw; padding: 12px 16px; background: var(--paper-bright); border: 1px solid color-mix(in srgb, var(--amber) 45%, var(--line)); border-radius: 9px; box-shadow: 0 4px 22px #0002; color: var(--ink); font-size: 13px; line-height: 1.6; }
    .stale button { margin-left: 10px; background: var(--moss); color: #fff; border-color: var(--moss); }
    .msg { color: var(--muted); font-size: 12px; min-height: 1em; }
  `; }
})();
