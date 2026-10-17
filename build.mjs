// Bundles src/ into one ES module and assembles the single-file page.
//   dist/aegis-spear.html            page content for the artifact (the host adds the document skeleton)
//   dist/aegis-spear-standalone.html complete document for opening locally
//   dist/dev.html                    local testing (three.js from node_modules)
import { build } from 'esbuild';
import fs from 'fs';

const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js';
const res = await build({
  entryPoints: ['src/main.js'], bundle: true, format: 'esm', external: ['three'], write: false,
  target: 'es2022', legalComments: 'none', minify: process.argv.includes('--min'), charset: 'utf8',
  banner: { js: '// AEGIS SPEAR — procedural combined-arms combat simulator (three.js r186 + custom GLSL + Web Audio)' },
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const shell = fs.readFileSync('shell.html', 'utf8');
const importMap = (url) => `<script type="importmap">{"imports":{"three":"${url}"}}</script>`;
const page = (url) => `${shell}\n${importMap(url)}\n<script type="module">\n${js}\n</script>\n`;
const doc = (url) => `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style>\n</head>\n<body>\n${page(url)}</body>\n</html>\n`;
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/aegis-spear.html', page(THREE_CDN));
fs.writeFileSync('dist/aegis-spear-standalone.html', doc(THREE_CDN));
fs.writeFileSync('dist/dev.html', doc('/node_modules/three/build/three.module.js'));
console.log('bundle', (js.length / 1024).toFixed(0), 'KB;', res.warnings.length, 'warnings');
for (const w of res.warnings) console.log('WARN', w.text, w.location && `${w.location.file}:${w.location.line}`);
