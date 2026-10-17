// Carrier approach views by day and night: is the deck visible over the nose, and do the deck lights read?
import { openGame } from './browser_util.mjs';
const G = await openGame({ settings: { time: 'noon' } });
const { page, shot, runFor } = G;
for (const [hour, tag] of [[12.5, 'day'], [22, 'night']]) {
  await page.evaluate((h) => { const g = window.__game; g.launch({ ...g.opts, scenario: 'approach', hour: h }); g.rig.setMode('cockpit'); }, hour);
  await runFor(1.2); await shot(`approach-${tag}-cockpit`);
  await page.evaluate(() => window.__game.rig.setMode('chase'));
  await runFor(0.3); await shot(`approach-${tag}-chase`);
}
// night: free camera high behind the ship to see the deck lighting pattern
await page.evaluate(() => {
  const g = window.__game; g.paused = true;
  const c = g.carrier; const p = c.toWorld(new (g.camera.position.constructor)(-40, 140, 520));
  g.rig.setMode('attract'); g.rig.update = () => {}; g.camera.position.copy(p); g.camera.lookAt(c.toWorld(new (g.camera.position.constructor)(0, 19.5, 0)));
  g.render(0);
});
await page.waitForTimeout(1500); await shot('night-carrier-overview');
console.log(`errors: ${G.errors.length}`);
await G.close();
