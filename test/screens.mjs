// Real-browser screenshots of the screens (menu, briefing, HUD with coach and radio, wingman orders, pause, debrief,
// crash) at several window sizes, stepping the game at a fixed 60 fps. Prints a [bad] line for any NaN / undefined /
// Infinity drawn on the HUD canvas or shown in the page text, and for a PLAY / START MISSION button off the bottom of
// the window. Build first (it loads dist/dev.html).
//   node test/screens.mjs [menu,briefing,flight,carrier,wing,pause,debrief,crash]   env: SIZES="1100x650,1920x950" SHOTS TAG
// Playwright comes from /opt/npm-tools; elsewhere `npm install playwright-core` in a scratch folder and run with
// PLAYWRIGHT=/that/folder/node_modules/playwright-core/index.mjs CHROME=/usr/bin/google-chrome
import http from 'http';
import fs from 'fs';
import path from 'path';

const { chromium } = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.mjs');
const SHOTS = process.env.SHOTS || path.resolve('shots'); fs.mkdirSync(SHOTS, { recursive: true });
const tag = process.env.TAG || 'scr';
const root = path.resolve('.'), port = +(process.env.PORT || 8129);
const sizes = (process.env.SIZES || '1100x650').split(',').map(s => s.split('x').map(Number));
const scenes = (process.argv[2] || 'menu,briefing,flight,pause,debrief').split(',');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(port, '127.0.0.1');
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const bad = new Set();
for (const [W, H] of sizes) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on('console', (m) => { const t = m.text(); if (/^\[bad\]/.test(t)) { if (!bad.has(t)) { bad.add(t); console.log(t); } } else if (m.type() === 'error' && !/fonts\.g|ERR_|net::|Failed to load resource/.test(t)) { errors.push(t); console.log('[console.error]', t.slice(0, 300)); } else if (/^\[scr\]/.test(t)) console.log(t); });
  page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.addInitScript(() => {
    try { localStorage.setItem('aegis-spear-settings', JSON.stringify({ quality: 'low', time: 'morning' })); } catch (e) { }
    const P = CanvasRenderingContext2D.prototype;
    for (const fn of ['fillText', 'strokeText']) {
      const o = P[fn]; P[fn] = function (t, ...a) { const s = String(t); if (/NaN|undefined|Infinity|null/.test(s)) console.log(`[bad] canvas ${fn}: "${s}"`); return o.call(this, t, ...a); };
    }
  });
  await page.goto(`http://127.0.0.1:${port}/dist/dev.html`);
  await page.waitForSelector('#menu:not([hidden])', { timeout: 300000 });
  // take over the frame loop: every step is exactly 1/60 s, and only the frames that get photographed are rendered
  await page.evaluate(() => {
    const g = window.__game; g.running = false; g.__T = performance.now() + 1000; g.last = g.__T;
    window.__step = (sec) => { const R = g.render; g.render = () => {}; try { for (let i = 0, n = Math.round(sec * 60); i < n; i++) { g.__T += 1000 / 60; g.frame(g.__T); } } finally { g.render = R; } };
    window.__draw = () => { g.__T += 1000 / 60; g.frame(g.__T); };
  });
  const runFor = async (sec) => { for (let t = 0; t < sec - 1e-6; t += 0.5) await page.evaluate((s) => window.__step(s), Math.min(0.5, sec - t)); };
  const shot = async (name) => {
    await page.evaluate(() => window.__draw());
    const txt = await page.evaluate(() => [...document.querySelectorAll('section:not([hidden]), aside:not([hidden])')].map(e => e.innerText).join('\n'));
    const m = txt.match(/.{0,40}(NaN|undefined|Infinity|\[object).{0,40}/g); if (m) for (const s of m) console.log(`[bad] page text (${name}): "${s.replace(/\n/g, ' ')}"`);
    await page.screenshot({ path: path.join(SHOTS, `${tag}-${W}x${H}-${name}.png`), timeout: 180000 });
  };
  const onScreen = async (id, label) => {
    const b = await page.evaluate((i) => document.getElementById(i).getBoundingClientRect().bottom, id);
    if (b > H) console.log(`[bad] ${W}x${H}: ${label} is below the bottom of the window (${Math.round(b)} px)`);
  };
  const click = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
  const pick = (scn) => page.evaluate((v) => { document.querySelector(`input[name="scenario"][value="${v}"]`).checked = true; }, scn);
  for (const sc of scenes) {
    const w0 = Date.now();
    if (sc === 'menu') { await runFor(2); await shot('menu'); await onScreen('launch', 'PLAY'); }
    else if (sc === 'briefing') { await pick('strike'); await click('#launch'); await runFor(0.2); await shot('briefing-strike'); await onScreen('bf-start', 'START MISSION'); await click('#bf-back'); await runFor(0.3); }
    else if (sc === 'flight') {
      // a dogfight with the coach, controls card and the first AWACS call on screen
      await pick('air'); await click('#launch'); await runFor(0.2); await click('#bf-start'); await runFor(6); await shot('flight-dogfight');
    } else if (sc === 'carrier') {
      await pick('carrier'); await click('#launch'); await runFor(0.2); await click('#bf-start'); await runFor(4); await shot('flight-deck');
    } else if (sc === 'wing') {
      // wingman orders menu + a wingman radio call
      await pick('strike'); await click('#launch'); await runFor(0.2); await click('#bf-start'); await runFor(3);
      await page.keyboard.press('KeyO'); await runFor(0.5); await shot('wing-orders');
      await page.keyboard.press('Digit3'); await runFor(2.5); await shot('wing-hunt');
    } else if (sc === 'pause') { await page.evaluate(() => window.__game.togglePause(true)); await shot('pause'); await page.evaluate(() => window.__game.togglePause(false)); }
    else if (sc === 'debrief') {
      await pick('air'); await click('#launch'); await runFor(0.2); await click('#bf-start'); await runFor(1);
      await page.evaluate(() => { const g = window.__game; g.aiJets.slice(0, 2).forEach(j => j.damage(1000, g.player)); g.mission.finish(true, 'ALL ENEMY FIGHTERS DOWN'); });
      await runFor(5); await shot('debrief-win');
      await click('#db-again'); await runFor(0.2); if (await page.evaluate(() => !document.getElementById('briefing').hidden)) await click('#bf-start');
      await runFor(1); await page.evaluate(() => { const g = window.__game; g.mission.finish(false, 'SHOT DOWN'); });
      await runFor(5); await shot('debrief-fail'); await click('#db-menu'); await runFor(0.3);
    } else if (sc === 'crash') {
      // fly into the highest hilltop nearby, then look at the HUD over the next seconds
      await pick('air'); await click('#launch'); await runFor(0.2); await click('#bf-start'); await runFor(0.5);
      await page.evaluate(() => {
        const g = window.__game, s = g.player.ac.s;
        let best = null; for (let x = -20000; x <= 20000; x += 500) for (let z = -20000; z <= 20000; z += 500) { const h = g.terrain.heightAt(x, z); if (!best || h > best.h) best = { x, z, h }; }
        s.p.set(best.x, best.h - 30, best.z + 900); s.v.set(0, 0, -200); s.q.identity(); s.w.set(0, 0, 0);
        console.log(`[scr] crash into peak ${best.h.toFixed(0)} m`);
      });
      let tc = 0; while (tc < 12 && await page.evaluate(() => window.__game.player.alive)) { await runFor(0.1); tc += 0.1; }
      console.log(`[scr] crashed after ${tc.toFixed(1)} s, camera ${await page.evaluate(() => window.__game.rig.mode)}`);
      let prev = 0; for (const t of [0.3, 1.5, 4, 8]) { await runFor(t - prev); prev = t; await shot(`crash+${t}s`); }
    }
    console.log(`${W}x${H} ${sc} done in ${((Date.now() - w0) / 1000).toFixed(0)} s`);
  }
  console.log(`${W}x${H} errors: ${errors.length}`); for (const e of errors.slice(0, 6)) console.log('  ', e.slice(0, 300));
  await page.close();
}
console.log(bad.size ? `${bad.size} problem(s) found` : 'no problems found');
await browser.close(); server.close();
