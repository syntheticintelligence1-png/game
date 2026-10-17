// Real-browser check (headless Chromium + SwiftShader WebGL): boot, menu, briefing, flight, radio subtitles.
// Screenshots go to $SHOTS (default ./shots). Usage: node test/browser.mjs [scenario] [seconds-of-flight]
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'http';
import fs from 'fs';
import path from 'path';

const root = path.resolve('.');
const SHOTS = process.env.SHOTS || path.join(root, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const scenario = process.argv[2] || 'strike';
const flightSec = +(process.argv[3] || 20);
const W = +(process.env.W || 1440), H = +(process.env.H || 900);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(8123);

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { const t = m.text(); if (!/toNonIndexed|fonts\.g|ERR_|net::/.test(t)) console.log(`[console.${m.type()}]`, t.slice(0, 300)); if (m.type() === 'error' && !/fonts\.g|ERR_|net::|Failed to load resource/.test(t)) errors.push(t); } });
page.on('pageerror', (e) => { console.log('[pageerror]', e.message); errors.push(e.message); });
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
await page.addInitScript((sc) => { try { localStorage.setItem('aegis-spear-settings', JSON.stringify({ quality: 'low', scenario: sc, time: process?.env?.TIME || 'morning' })); } catch (e) { } }, scenario);
const t0 = Date.now();
await page.goto('http://localhost:8123/dist/dev.html');
await page.waitForSelector('#menu:not([hidden])', { timeout: 300000 });
console.log(`menu up after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (process.env.TIME) await page.selectOption('#opt-time', process.env.TIME);
await page.screenshot({ path: path.join(SHOTS, 'menu.png') });
await page.click(`label:has(input[value="${scenario}"])`);
await page.click('#launch');
await page.waitForSelector('#briefing:not([hidden])', { timeout: 60000 });
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(SHOTS, `briefing-${scenario}.png`) });
console.log('briefing shown');
await page.click('#bf-start');
const tm0 = await page.evaluate(() => window.__game.time);
// let the sim run; sample the game clock and radio while it flies
const shotsAt = (process.env.AT || '4,10,20').split(',').map(Number).filter(x => x <= flightSec);
const start = Date.now(); let k = 0;
while ((Date.now() - start) / 1000 < flightSec * 6 && k < shotsAt.length) {
  const st = await page.evaluate((tm0) => ({ t: window.__game.time - tm0, radio: [...document.querySelectorAll('#radio .rc')].map(n => n.textContent), fps: window.__game.fps }), tm0);
  if (process.env.VERBOSE) console.log(`  … t=${st.t.toFixed(1)} fps=${st.fps.toFixed(1)} paused=${await page.evaluate(() => window.__game.paused)}`);
  if (st.t >= shotsAt[k]) {
    await page.screenshot({ path: path.join(SHOTS, `flight-${scenario}-${shotsAt[k]}s.png`) });
    console.log(`t=${st.t.toFixed(1)} fps=${st.fps.toFixed(1)} radio: ${st.radio.join(' | ').slice(0, 220)}`);
    k++;
  }
  await page.waitForTimeout(400);
}
console.log(`errors: ${errors.length}`); for (const e of errors.slice(0, 8)) console.log('  ', e.slice(0, 300));
await browser.close(); server.close();
