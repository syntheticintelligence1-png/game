// Loudness of single sounds: renders each one offline through the real AudioEngine (master bus and compressor) in a
// headless browser and prints the peak and the loudest 100 ms RMS in dBFS. Use it to keep a new sound in line with
// the others (the gun and the engine are the loudest steady sounds).
//   node test/sound_levels.mjs   (Playwright and Chrome as in test/screens.mjs: PLAYWRIGHT=..., CHROME=...)
import http from 'http';
import fs from 'fs';
import path from 'path';

const { chromium } = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.mjs');
const root = path.resolve('.'), port = +(process.env.PORT || 8127);
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>sound levels</title>'); return; }
  const f = path.join(root, decodeURIComponent(u));
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': 'text/javascript' }); fs.createReadStream(f).pipe(res);
}).listen(port, '127.0.0.1');
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/`);
const out = await page.evaluate(async () => {
  const { AudioEngine } = await import('/src/audio/audio.js');
  const near = { x: 0, y: 0, z: -400 }, close = { x: 0, y: 0, z: -60 };
  const cases = {
    killConfirm: (a) => a.killConfirm(),
    hitTick: (a) => a.hitTick(),
    hullHit1: (a) => a.hullHit(1),
    hullHit035: (a) => a.hullHit(0.35),
    abLight: (a) => a.abLight(false),
    abLightCockpit: (a) => a.abLight(true),
    lockTone: (a) => a.lockTone(),
    uiConfirm: (a) => a.uiConfirm(),
    explosion4_5_400m: (a) => a.explosion(near, 4.5),
    explosion1_60m: (a) => a.explosion(close, 1),
    missileLaunchOwn: (a) => a.missileLaunch({ x: 0, y: 0, z: -3 }),
    wireTrap: (a) => a.wireTrap(),
    touchdown: (a) => a.touchdown(1),
    flare: (a) => a.flare(),
    engineMilChase: (a) => a.setPlayerEngine({ rpm: 1, ab: 0, q: 30000, camDist: 24, alive: true }),
    engineABChase: (a) => a.setPlayerEngine({ rpm: 1, ab: 1, q: 30000, camDist: 24, alive: true }),
    engineABCockpit: (a) => { a.setCockpit(true); a.setPlayerEngine({ rpm: 1, ab: 1, q: 30000, camDist: 0, alive: true }); },
    pull1g: (a) => a.setPlayerEngine({ rpm: 0.85, ab: 0, q: 30000, gLoad: 1, camDist: 24, alive: true }),
    pull7g: (a) => a.setPlayerEngine({ rpm: 0.85, ab: 0, q: 30000, gLoad: 7, camDist: 24, alive: true }),
    gun: (a) => a.setPlayerGun(true),
    // hit ticks every 0.1 s over the gun: suspend the offline render at each tick time to schedule it
    gunPlusTicks: (a) => { a.setPlayerGun(true); for (let i = 0; i < 20; i++) a.ctx.suspend(i * 0.1 + 0.05).then(() => { a.hitTick(); a.ctx.resume(); }); },
  };
  const res = {};
  for (const [k, fn] of Object.entries(cases)) {
    const sr = 44100, ctx = new OfflineAudioContext(2, sr * 3, sr);
    const a = new AudioEngine(); await a.init(ctx);
    fn(a);
    const buf = await ctx.startRendering();
    let peak = 0, sum = 0; const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const win = sr * 0.1; let best = 0;
    for (let i = 0; i < L.length; i++) { const v = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (v > peak) peak = v; }
    for (let s = 0; s + win < L.length; s += win / 2) { sum = 0; for (let i = s; i < s + win; i++) sum += L[i] * L[i] + R[i] * R[i]; best = Math.max(best, Math.sqrt(sum / (2 * win))); }
    const db = (x) => (20 * Math.log10(Math.max(x, 1e-6))).toFixed(1);
    res[k] = `peak ${db(peak)} dB  loudest-100ms rms ${db(best)} dB`;
  }
  return res;
});
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(20), v);
await browser.close(); server.close();
