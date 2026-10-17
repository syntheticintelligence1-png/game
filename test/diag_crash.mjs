import { openGame } from './browser_util.mjs';
const G = await openGame({ settings: { time: 'morning' } });
const { page } = G;
await page.evaluate(() => { const g = window.__game; document.getElementById('menu').hidden = true; g.launch({ ...g.opts, scenario: 'strike', hour: 9.5 }); });
await page.waitForTimeout(3000);
await page.evaluate(() => { const g = window.__game, s = g.player.ac.s; s.p.set(2500, 420, 20000); s.v.set(0, -120, -160); });
for (let i = 0; i < 40; i++) {
  const t0 = Date.now();
  const st = await Promise.race([page.evaluate(() => { const g = window.__game; return { t: g.time.toFixed(2), f: g.frameN, alive: g.player.alive, wreck: !!g.player.wreck, fxN: g.fx.emitters.length, mode: g.rig.mode, y: g.player.ac.s.p.y.toFixed(0) }; }), new Promise(r => setTimeout(() => r('TIMEOUT'), 20000))]);
  console.log(i, ((Date.now() - t0) / 1000).toFixed(1) + 's', JSON.stringify(st));
  if (st === 'TIMEOUT') break;
  await page.waitForTimeout(1500);
}
await G.close();
