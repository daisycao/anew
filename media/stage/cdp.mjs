// 无头 Chrome 的小封装：开一页，跑 JS，截图。1440×810 的页面按 4/3 倍出 1920×1080。
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export async function openPage(url) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anew-cdp-'));
  const chrome = spawn(CH, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const ws = await new Promise((ok, bad) => { let buf = ''; chrome.stderr.on('data', d => { buf += d; const m = buf.match(/ws:\/\/\S+/); if (m) ok(m[0]); }); setTimeout(() => bad(new Error('chrome did not start')), 15000); });
  const port = new URL(ws).port;
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
  const sock = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => sock.onopen = r);
  let id = 0; const pending = {};
  sock.onmessage = e => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') console.log('[page error]', m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; } };
  const send = (method, params = {}) => new Promise((r, bad) => { const my = ++id; pending[my] = r; sock.send(JSON.stringify({ id: my, method, params })); setTimeout(() => { if (pending[my]) { delete pending[my]; bad(new Error(`CDP ${method} timed out`)); } }, 20000); });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 4 / 3, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await wait(1500);
  return {
    wait,
    async js(expression) { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed'); return r.result.result.value; },
    async viewport(w, h, f) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: f, mobile: false }); },
    async scale(f, h = 810) { await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: h, deviceScaleFactor: f, mobile: false }); },
    async frame() { await send('Runtime.evaluate', { expression: 'new Promise(r => { requestAnimationFrame(() => requestAnimationFrame(r)); setTimeout(r, 120); })', awaitPromise: true }); const s = await send('Page.captureScreenshot', { format: 'png' }); return Buffer.from(s.result.data, 'base64'); },
    async shot(out) { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, Buffer.from(s.result.data, 'base64')); console.log('shot', path.basename(out)); },
    async close() { chrome.kill(); await new Promise(r => chrome.on('exit', r)); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} },
  };
}
