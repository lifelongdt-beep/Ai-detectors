// 사용법: 제안서_요약.md -> 제안서_요약.pdf (A4)
//   npm i --no-save marked @fontsource/noto-sans-kr      (임시 폴더에 설치해도 됨)
//   FONTS_DIR=<node_modules 가 있는 폴더> PLAYWRIGHT_PATH=$(npm root -g)/playwright node docs/build_pdf.mjs
// 제목용 폰트(Black Han Sans, SIL OFL)는 저장소의 promo/fonts 를 사용한다.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FONTS_DIR = resolve(process.env.FONTS_DIR || '.');
const req = createRequire(resolve(FONTS_DIR, 'noop.js'));
const { marked } = req('marked');
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');

const root = resolve(import.meta.dirname, '..');
const md = readFileSync(resolve(root, 'docs/제안서_요약.md'), 'utf8');

// 첫 줄(# 제목)은 표지에서 따로 쓰고, 상태 인용문은 강조 박스로 분리
const lines = md.split('\n');
const title = lines[0].replace(/^#\s*/, '');
// '제안자:' 줄은 표지로 옮긴다
const proposerLine = lines.find((l) => l.startsWith('제안자:'));
const proposer = proposerLine ? proposerLine.replace(/^제안자:\s*/, '') : '';
const contactLine = lines.find((l) => l.startsWith('연락:'));
const contact = contactLine ? contactLine.replace(/^연락:\s*/, '') : '';
const contactHtml = contact.replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>');
const body = lines.slice(1).filter((l) => l !== proposerLine && l !== contactLine).join('\n');
marked.setOptions({ gfm: true });
const html = marked.parse(body);

const noto = (w) => `file://${resolve(FONTS_DIR, `node_modules/@fontsource/noto-sans-kr/${w}.css`)}`;
const han = `file://${resolve(root, 'promo/fonts/blackhan/index.css')}`;
const today = new Date().toISOString().slice(0, 10);

const page = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="${noto(400)}"><link rel="stylesheet" href="${noto(700)}"><link rel="stylesheet" href="${han}">
<style>
  @page { size: A4; }
  :root { --ink:#1b2333; --sub:#5b6577; --accent:#1f3a8a; --line:#d6dbe6; --bg:#f4f6fb; --warn:#b45309; --warnbg:#fff7e6; }
  * { box-sizing: border-box; }
  body { word-break: keep-all; overflow-wrap: break-word; font-family: 'Noto Sans KR', sans-serif; color: var(--ink); font-size: 10.2pt; line-height: 1.62; margin: 0; }
  .cover { border-bottom: 3px solid var(--accent); padding: 4mm 0 6mm; margin-bottom: 6mm; }
  .tag { display:inline-block; font-size: 8.5pt; font-weight:700; color:#fff; background: var(--accent); padding: 1mm 3mm; border-radius: 2mm; letter-spacing:.04em; }
  .cover h1 { font-family: 'Black Han Sans','Noto Sans KR',sans-serif; font-weight: 400; font-size: 23pt; line-height: 1.25; margin: 4mm 0 2mm; color: var(--accent); }
  .proposer { font-size: 11.5pt; font-weight: 700; margin: 0 0 2mm; } .proposer span { font-size: 8.5pt; color: var(--accent); border: 1px solid var(--accent); border-radius: 1.5mm; padding: .3mm 2mm; margin-right: 2mm; vertical-align: 1px; }
  .contact { font-size: 9.5pt; margin: 0 0 2mm; } .contact span { font-size: 8.5pt; color: var(--accent); border: 1px solid var(--accent); border-radius: 1.5mm; padding: .3mm 2mm; margin-right: 2mm; vertical-align: 1px; } .contact a { color: var(--accent); text-decoration: none; border-bottom: 1px solid var(--accent); }
  .meta { color: var(--sub); font-size: 9pt; }
  h2 { font-size: 13.5pt; margin: 8mm 0 2.5mm; padding-left: 3mm; border-left: 1.6mm solid var(--accent); line-height: 1.3; break-after: avoid; }
  h3 { font-size: 11pt; margin: 5mm 0 1.5mm; color: var(--accent); break-after: avoid; }
  p { margin: 1.5mm 0 2.5mm; }
  ul, ol { margin: 1.5mm 0 3mm; padding-left: 5.5mm; } li { margin: .8mm 0; }
  blockquote { margin: 3mm 0 4mm; padding: 2.5mm 4mm; background: var(--warnbg); border-left: 1.6mm solid var(--warn); border-radius: 0 2mm 2mm 0; color: #5a3b0a; }
  blockquote p { margin: .8mm 0; }
  code { font-family: 'Noto Sans KR', monospace; font-size: 9pt; background: var(--bg); padding: .2mm 1.2mm; border-radius: 1mm; color: #243b6b; }
  table { border-collapse: collapse; width: 100%; margin: 2.5mm 0 4mm; font-size: 8.8pt; line-height: 1.45; break-inside: avoid; }
  th { background: var(--accent); color: #fff; font-weight: 700; text-align: left; padding: 1.8mm 2.2mm; border: 1px solid var(--accent); }
  th:first-child { white-space: nowrap; }
  td { padding: 1.7mm 2.2mm; border: 1px solid var(--line); vertical-align: top; }
  tr:nth-child(even) td { background: var(--bg); }
  strong { color: #0f1f4d; }
  em { color: var(--sub); }
</style></head><body>
<div class="cover"><span class="tag">교육부 제안용 · 초안</span><h1>${title}</h1>
${proposer ? `<div class="proposer"><span>제안자</span> ${proposer}</div>` : ''}
${contact ? `<div class="contact"><span>연락</span> ${contactHtml}</div>` : ''}
<div class="meta">AI-DETECTORS 프로젝트 · 작성일 ${today} · 모든 수치는 가정 기반 시뮬레이션 값이며 실측 성능이 아님</div></div>
${html}
</body></html>`;

const tmp = resolve(FONTS_DIR, '_proposal.html');
writeFileSync(tmp, page);
const browser = await chromium.launch({ args: ['--no-sandbox', '--allow-file-access-from-files'] });
const p = await browser.newPage();
await p.goto(`file://${tmp}`);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(500);
await p.pdf({
  path: resolve(root, 'docs/제안서_요약.pdf'), format: 'A4', printBackground: true,
  margin: { top: '16mm', bottom: '18mm', left: '16mm', right: '16mm' },
  displayHeaderFooter: true, headerTemplate: '<span></span>',
  footerTemplate: `<div style="width:100%;font-size:8px;color:#8a93a6;padding:0 16mm;display:flex;justify-content:space-between"><span>AI-DETECTORS · 수능 AI 부정행위 전파 탐지 제안 요약 (초안)</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
});
await browser.close();
console.log('wrote docs/제안서_요약.pdf');
