// 사용법: node build.mjs  -> dist/index.html (의존성 없이 파일 하나로 열리는 단일 HTML)
// esbuild 필요: npm i -D esbuild (배포는 Pages가 sim/ 을 그대로 서빙하므로 이 빌드는 선택 사항)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const out = await build({
  entryPoints: ['sim/main.js'], bundle: true, minify: true, format: 'iife', write: false,
  alias: { three: './sim/vendor/three.module.min.js' },
});
let html = readFileSync('sim/index.html', 'utf8')
  .replace(/<script type="importmap">.*?<\/script>\n?/s, '')
  .replace('<script type="module" src="./main.js"></script>', () => `<script>${out.outputFiles[0].text.replace(/<\/script>/g, '<\\/script>')}</script>`);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
console.log('dist/index.html', (html.length / 1024).toFixed(0) + ' KB');
