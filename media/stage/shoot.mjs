// 用本机 Chrome（无头）给舞台页截图：node shoot.mjs <out.png> <url> [等多少毫秒]
// 走 DevTools 协议，不装 puppeteer。1440×810 的页面，按 4/3 倍出 1920×1080。
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const [out, url, wait = '1500', js] = process.argv.slice(2);
const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anew-shoot-'));
const chrome = spawn(CH, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const ws = await new Promise((ok, bad) => { let buf = ''; chrome.stderr.on('data', d => { buf += d; const m = buf.match(/ws:\/\/\S+/); if (m) ok(m[0]); }); setTimeout(() => bad(new Error('chrome did not start')), 15000); });
const port = new URL(ws).port;
const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
const sock = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => sock.onopen = r);
let id = 0; const pending = {};
sock.onmessage = e => { const m = JSON.parse(e.data); if (m.method === 'Runtime.consoleAPICalled') console.log('[console]', m.params.args.map(a => a.value).join(' ')); if (m.method === 'Runtime.exceptionThrown') console.log('[error]', m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; } };
const send = (method, params = {}) => new Promise(r => { pending[++id] = r; sock.send(JSON.stringify({ id, method, params })); });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 4 / 3, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url });
await new Promise(r => setTimeout(r, +wait));
if (js) console.log('[eval]', JSON.stringify((await send('Runtime.evaluate', { expression: js, returnByValue: true })).result.result.value));
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
chrome.kill(); await new Promise(r => chrome.on('exit', r)); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
console.log('saved', out);
