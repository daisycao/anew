// 抽帧检查：node frames.mjs <输出目录> t1 t2 …（秒）。直接 seek 合成里的 GSAP 时间线。
import { openPage } from './cdp.mjs';
const [dir, ...times] = process.argv.slice(2);
const p = await openPage('http://localhost:8791/media/video/index.html');
await p.viewport(1920, 1080, 1);
await p.js('location.reload()'); await p.wait(1500);
await p.js('document.fonts.ready.then(() => true)');
await p.wait(1500);
for (const t of times) {
  await p.js(`(() => { const tl = window.__timelines.main; tl.pause(); tl.seek(${t}, false); return tl.time(); })()`);
  await p.wait(250);
  await p.shot(`${dir}/f-${String(t).padStart(5, '0')}.png`);
}
await p.close();
