import { openGame } from './browser_util.mjs';
const G = await openGame({ W: 640, H: 400, settings: { time: 'morning' } });
const { page } = G;
await page.evaluate(() => {
  const g = window.__game; document.getElementById('menu').hidden = true; g.launch({ ...g.opts, scenario: 'strike', hour: 9.5 });
  const of = g.onFrame; window.__log = []; window.__nan = null;
  const snap = (tag) => { const ac = g.player.ac, s = ac.s; return { tag, t: +g.time.toFixed(3), alive: g.player.alive, p: s.p.toArray(), v: s.v.toArray(), w: s.w.toArray(), q: s.q.toArray(), crashed: ac.crashed ? { kind: ac.crashed.kind } : null, onGround: ac.onGround, alpha: ac.alpha, mode: g.rig.mode, cam: g.camera.position.toArray() }; };
  const origPhys = g.physics.bind(g);
  g.physics = (dt) => { const before = snap('before'); origPhys(dt); const s = g.player.ac.s; if (!window.__nan && ![s.p.x, s.p.y, s.p.z, s.v.x, s.q.x].every(Number.isFinite)) window.__nan = { before, after: snap('after') }; };
  g.onFrame = (dt) => { of && of(dt); const c = g.camera.position; if (!window.__camNaN && ![c.x, c.y, c.z].every(Number.isFinite)) window.__camNaN = snap('cam'); };
});
await page.waitForTimeout(2500);
await page.evaluate(() => { const g = window.__game, s = g.player.ac.s; const h = g.terrain.heightAt(-3000, 1000); s.p.set(-3000, h + 260, 1700); s.v.set(0, -90, -140); });
for (let i = 0; i < 60; i++) {
  const st = await page.evaluate(() => ({ t: window.__game.time.toFixed(2), alive: window.__game.player.alive, y: window.__game.player.ac.s.p.y, nan: window.__nan, camNaN: window.__camNaN }));
  if (st.nan || st.camNaN || i % 10 === 0) console.log(i, st.t, st.alive, st.y, st.nan ? JSON.stringify(st.nan).slice(0, 1500) : '', st.camNaN ? 'CAM ' + JSON.stringify(st.camNaN).slice(0, 600) : '');
  if (st.nan || st.camNaN) break;
  if (!st.alive && i > 40) break;
  await page.waitForTimeout(1000);
}
await G.close();
