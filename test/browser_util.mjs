// Shared harness for real-browser checks: static server for the project + headless Chromium (SwiftShader WebGL).
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'http';
import fs from 'fs';
import path from 'path';

export const SHOTS = process.env.SHOTS || path.resolve('shots');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };

export async function openGame({ W = 1280, H = 760, settings = {}, port = 8124 } = {}) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const root = path.resolve('.');
  const server = http.createServer((req, res) => {
    const f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  }).listen(port);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/fonts\.g|ERR_|net::|Failed to load resource/.test(t)) { errors.push(t); console.log('[console.error]', t.slice(0, 300)); } });
  page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.addInitScript((st) => { try { localStorage.setItem('aegis-spear-settings', JSON.stringify(st)); } catch (e) { } }, { quality: 'low', ...settings });
  await page.goto(`http://localhost:${port}/dist/dev.html`);
  await page.waitForSelector('#menu:not([hidden])', { timeout: 300000 });
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), timeout: 180000 });
  // advance until the game clock has moved `sec` seconds (the page renders slowly under software WebGL)
  const runFor = async (sec, maxWall = 600) => {
    const t0 = await page.evaluate(() => window.__game.time); const w0 = Date.now();
    while ((Date.now() - w0) / 1000 < maxWall) { const t = await page.evaluate(() => window.__game.time); if (t - t0 >= sec) return t - t0; await page.waitForTimeout(250); }
    return -1;
  };
  const close = async () => { await browser.close(); server.close(); };
  return { page, browser, errors, shot, runFor, close };
}
