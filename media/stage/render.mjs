// 备用渲染：本机 Chrome 逐帧 seek GSAP 时间线截图，管道喂给 ffmpeg 出 mp4。
// node render.mjs <out.mp4> [fps=30] [起秒] [止秒]   需要 FFMPEG 环境变量或 PATH 里有 ffmpeg
import { openPage } from './cdp.mjs';
import { spawn } from 'node:child_process';
const [out, fps = '30', from = '0', to] = process.argv.slice(2);
const p = await openPage('http://localhost:8791/media/video/index.html');
await p.viewport(1920, 1080, 1);
await p.js('location.reload()'); await p.wait(2000);
await p.js('document.fonts.ready.then(() => true)');
// 先把所有图解码好
await p.js('Promise.all([...document.images].map(i => i.decode().catch(() => 0))).then(() => true)');
const dur = to ? +to : await p.js('window.__timelines.main.duration()');
const n = Math.round((dur - from) * fps);
const ff = spawn(process.env.FFMPEG || 'ffmpeg', ['-y', '-f', 'image2pipe', '-framerate', fps, '-c:v', 'png', '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', out], { stdio: ['pipe', 'ignore', 'inherit'] });
for (let i = 0; i < n; i++) {
  const t = +from + i / fps;
  if (process.env.TRACE) console.error('t', t.toFixed(3));
  await p.js(`(() => { const tl = window.__timelines.main; tl.pause(); tl.seek(${t}, false); return 1; })()`);
  const png = await p.frame();
  if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r));
  if (i % 150 === 0) console.log(`frame ${i}/${n}`);
}
ff.stdin.end();
await new Promise(r => ff.on('exit', r));
await p.close();
console.log('saved', out);
