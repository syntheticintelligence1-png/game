// Visual spot checks in a real browser: night lighting on deck, a crash fireball, the radio + briefing over the sim.
// Usage: node test/visual.mjs [night|crash|dogfight|all]
import { openGame } from './browser_util.mjs';

const which = process.argv[2] || 'all';
const G = await openGame({ W: +(process.env.W || 1280), H: +(process.env.H || 760), settings: { time: which === 'night' || which === 'all' ? 'night' : 'morning' } });
const { page, shot, runFor } = G;
const skipBrief = async () => { if (await page.isVisible('#briefing')) await page.click('#bf-start'); };

if (which === 'night' || which === 'all') {
  await page.click('label:has(input[value="carrier"])'); await page.click('#launch');
  await page.waitForSelector('#briefing:not([hidden])'); await skipBrief();
  await runFor(1.5);
  await shot('night-deck-chase');
  // night landing: the deck lights from the cockpit on final approach, then from outside
  await page.evaluate(() => { const g = window.__game; g.launch({ ...g.opts, scenario: 'approach', hour: 22 }); });
  await runFor(2.5); await shot('night-approach-cockpit');
  await page.evaluate(() => window.__game.rig.setMode('chase'));
  await runFor(0.4); await shot('night-approach-chase');
}
if (which === 'crash' || which === 'all') {
  await page.evaluate(() => { const g = window.__game; document.getElementById('menu').hidden = true; document.getElementById('briefing').hidden = true; g.launch({ ...g.opts, scenario: 'strike', hour: 9.5 }); });
  await runFor(0.5);
  // point the jet at the ground and let it hit
  // dive into the hills north-west of the city, seen from the chase camera
  await page.evaluate(() => { const g = window.__game, s = g.player.ac.s; const h = g.terrain.heightAt(-3000, 1000); s.p.set(-3000, h + 260, 1700); s.v.set(0, -90, -140); window.__crashH = h; });
  await runFor(2.6); await shot('crash-1');
  await runFor(0.5); await shot('crash-2');
  await runFor(2.5); await shot('crash-3');
}
if (which === 'dogfight' || which === 'all') {
  await page.evaluate(() => { const g = window.__game; document.getElementById('menu').hidden = true; document.getElementById('debrief').hidden = true; g.paused = false; g.launch({ ...g.opts, scenario: 'air', hour: 9.5 }); });
  await runFor(9); await shot('dogfight-9s');
}
console.log(`errors: ${G.errors.length}`); for (const e of G.errors.slice(0, 6)) console.log('  ', e.slice(0, 300));
await G.close();
