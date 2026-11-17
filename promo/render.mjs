// 사용법: PLAYWRIGHT_PATH=$(npm root -g)/playwright node promo/render.mjs [--only 0,45,100] [--workers 4]
// 프레임을 promo/out/frames/NNNN.jpg 로 저장한다 (프레임 t 의 순수 함수라 병렬 렌더 가능).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright'); // 전역 설치면 PLAYWRIGHT_PATH=$(npm root -g)/playwright
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = http.createServer((req, res) => {
  const p = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const f = join(root, p);
  if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f));
}).listen(0);
const port = server.address().port;

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const only = arg('--only', null)?.split(',').map(Number);
const workers = Number(arg('--workers', 4));
const total = 600;
const frames = only ?? Array.from({ length: total }, (_, i) => i);
mkdirSync('promo/out/frames', { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--ignore-gpu-blocklist'] });
const t0 = Date.now();
let done = 0;
async function worker(w) {
  // 연속 구간으로 나눠 가진다 (각 워커 시뮬레이션은 처음부터 결정적으로 빨리감기)
  const per = Math.ceil(frames.length / workers), mine = frames.slice(w * per, (w + 1) * per);
  if (!mine.length) return;
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('console', m.text()); });
  await page.goto(`http://localhost:${port}/promo/index.html`);
  await page.waitForFunction(() => typeof window.setup === 'function');
  await page.evaluate(() => window.setup());
  for (const i of mine) {
    const url = await page.evaluate((i) => window.frame(i), i);
    writeFileSync(`promo/out/frames/${String(i).padStart(4, '0')}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
    done++;
    if (done % 20 === 0) console.log(`${done}/${frames.length}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  await page.close();
}
await Promise.all(Array.from({ length: workers }, (_, w) => worker(w)));
console.log(`done ${done} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
await browser.close(); server.close();
