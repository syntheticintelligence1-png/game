# AEGIS SPEAR — handoff notes

Browser combat flight sim: carrier ops, air-to-air, SEAD/strike, SAMs, ships. three.js r186.1 + custom GLSL,
Web Audio, everything procedural (no asset files). Plain JS ES modules, bundled with esbuild into one HTML page.

## Build and run
- `npm install` (three@0.186.1, esbuild; eslint optional)
- `node build.mjs` writes:
  - `dist/aegis-spear.html`: page body for a claude.ai artifact (the host adds <html>/<head>)
  - `dist/aegis-spear-standalone.html`: full page; three.js comes from cdn.jsdelivr.net, fonts from Google Fonts (needs internet)
  - `dist/dev.html`: loads three.js from /node_modules, so serve the project folder (e.g. `npx http-server .`) and open /dist/dev.html
- The built HTML holds all the game code (bundled, not minified), but edit `src/` and rebuild. Don't edit dist.

## Tests (Node, no browser: stub WebGL in test/headless_env.mjs)
- `node test/smoke.mjs`: every scenario boots and runs. Slow; give it minutes.
- Others: mission.mjs, defense.mjs (missile survivability: follow the cue vs do nothing), sdb.mjs (stand-off bombs),
  crash.mjs, crash_hill.mjs, autopilot.mjs, handling.mjs, guide.mjs, radio.mjs (prints every radio call), trap*.mjs (carrier landings)
- `node test/land_easy.mjs [handsoff|offsets|mash|return|bolter] [case#]`: carrier landings with the easy controls and the
  landing assist, flown like a beginner (hands off, off-position starts, random key mashing, coming back from free flight
  by following the green circle, a bolter and go-around). `TRACE=t` prints every frame after t seconds.
- `node test/escorts.mjs`: the friendly escorts against an armed bandit and a missile chasing the player, the
  helicopters, and the escorts' radio calls.
- `node test/wingman.mjs [form,sead,ship,air,cat,misc]` (default all): formation, every order, SEAD and hunting
  (sead is slow, several minutes), Harpoons on the frigate and the destroyer, air combat, the catapult start, kill
  credit, despawn, being shot down. Kills are random, so the air part checks behaviour (shoots, keeps fighting).
- `node test/glsl_check.mjs`: shader validation (needs glslangValidator). "'average' : function name is redeclaration"
  is a known false positive.
- Real-browser screenshots: `node test/browser.mjs strike 10` and `node test/visual.mjs night` (Playwright + Chromium
  with SwiftShader; very slow, about 1 fps). test/browser_util.mjs imports Playwright from /opt/npm-tools; where that
  is missing, `npm install playwright-core` in a scratch folder and launch Chrome with
  `executablePath: '/usr/bin/google-chrome'` (that is how the helicopter and fleet were checked).

## Code map
- `shell.html`: menu, pause, debrief, briefing, radio, coach and controls-card markup + CSS
- `src/main.js`: boot, menu, launch → briefing → start, debrief and pause wiring
- `src/game/game.js`: main controller (world setup, fixed-step physics at 120 Hz, input, HUD state, deaths/crashes, autopilot while steering a missile)
- `src/game/mission.js`: City strike (radars/SAMs/AA → bunker) and dogfight; owns its spawned targets, debrief report
- `src/game/radio.js`: radio calls (MAGIC = AWACS, MOTHER = carrier, PADDLES = LSO) with brevity + plain-English lines
- `src/game/player.js`: loadouts, weapons, T designation (air + ground), stand-off bomb release logic
- `src/game/ai.js`: AI jets for either side (team 'red' or 'blue'), SA-21 / SA-15 / AA guns, ship defenses (enemy ships and, with team 'blue', our escorts)
- `src/game/wingman.js`: the wingman Spear 1-2 (see below)
- `src/game/helo.js`: helicopters circling the carrier group (scenery only); the model is `buildHelo()` in src/models/units.js
- `src/game/assist.js`: easy controls (bank-to-turn, auto-level) and the LandingAssist (see below). `cameras.js`, `input.js`, `world.js`
- `src/sim/`: flight.js (6-DOF RK4 + flight control system), weapons.js (missiles/bombs/guidance), radar.js (detection, notch, chaff, RWR), carrierOps.js (catapult, wires, ships), atmo.js
- `src/render/`, `src/world/` (terrain, ocean), `src/models/` (jet, carrier, units, munitions), `src/fx/` (explosions, navlights.js)
- `src/ui/`: hud.js (canvas HUD, target markers, BREAK cue), guide.js (coach card), comms.js (radio subtitles), briefing.js + briefmap.js (briefing card and tactical map)
- `src/audio/audio.js`: synthesized sound + speech voices

## Carrier landing with the easy controls (LandingAssist in src/game/assist.js)
- Only with the default easy controls (not with Realistic). It only moves the stick and the throttle; physics untouched.
- States: off → approach → deck → trap → done, plus climb (bolter / wave-off / too long). game.js applies its output
  (`{pitch, roll, yaw}` and/or `{throttle}`; pitch null = the player keeps the stick through FlightAssist).
- approach: takes over in the "basket" behind the ship (canCapture: inside 7 km, within 20° of the centre line, near the
  glide slope, flying up the landing line). Lowers the hook, auto-throttle on angle of attack, glide slope and lineup;
  W/A/S/D nudges fade out over the last few hundred metres. Full power (80%) at touchdown, idle once the wire stops the
  jet, climbs away by itself after a bolter or wave-off.
- Return to the ship: `armed` = the player lowered the gear in the air (or the assist already flew an approach), so
  nothing shows after a catapult launch with the gear still down. Armed, gear down, within 20 km: the green "FLY HERE"
  circle (joinPoint: 9 km behind the ship and 2.5 km to the side first, then it slides along the extended centre line
  ahead of the jet), the banner at the top of the screen (joinHint / status), the coach card "Coming back to land", and
  an auto-throttle holding 180 kt. Raising the gear gives back the throttle the player had before.
- Landing practice (scenario 'approach'): Enter restarts the approach at any time; no enemy fighters spawn there.
- carrierOps.js wire fix: once the wire had stopped the jet, the metering tension kept growing with the roll-back speed
  and flung the jet backwards onto its nose; metering now only runs while the jet is still moving forward (decided once
  per physics step).
- LSO (carrierOps.updateLens): the call timer now runs on the real step time (it counted down twice too fast). While
  the assist flies the approach, only "Wave off" and "Roger ball" are spoken. After a trap, game.onTrap shows a friendly
  headline (PERFECT / GREAT / GOOD LANDING, wire N of 4) and the LSO's grade with a one-line tip.

## Carrier group (friendly fleet)
- game.js init: carrier CVN-90 plus three escorts: destroyers HALSEY and KIDD, frigate CONSTELLATION (the destroyer
  model at 0.78 scale, `s.scale`). Two helicopters (Helo): a plane guard off the carrier's starboard side and one
  circling the frigate. They are scenery: no collisions, not targets.
- populate(): each escort gets a ShipDefense with team 'blue' (16 SAMs, 10 km, a close-in gun). It fires at the nearest
  enemy jet within 10 km and at enemy missiles chasing the player or any friendly ship (one interceptor per missile).
  Their radars ignore 90% of chaff (radar `eccm`) and are hard to notch. Missions.begin refills the magazines.
- Radio: "birds away on the bandit / missile" when an escort fires (game.escortShot, at most every 10 s), "Splash one"
  plus a green message if an escort shoots a jet down, and a MOTHER check-in 30 s into the dogfight and the strike
  (radio.escorts()). Briefing tips for the strike and the dogfight say "run for the carrier".
- Honest limit: the escorts' SAM is the short-range 'tor' missile, and the AI jets usually out-turn it. In tests a
  bandit near the fleet spends most of its time defending and fires far less, but it is rarely shot down. Longer-range
  missiles (SM-6 / ESSM style defs) were tried and didn't kill either, so weapons.js is unchanged.

## Wingman Spear 1-2 (src/game/wingman.js)
- `Wingman extends AIJet` with team 'blue'. game.spawnWingman runs on every launch except landing practice and the
  attract screen (clearWingman on relaunch). Carrier starts: he waits on catapult 2 and launches about 8 s after the
  player's catapult shot (game.onCatShot). Airborne starts: placed in the slot, 30 m right, 3 m up, 14 m ahead.
- Loads (LOADS): strike = 2 AIM-9X, 1 AIM-120, 2 HARM, 2 Harpoons, 8 small glide bombs; dogfight = 2 AIM-9X + 7 AIM-120.
- Orders: O opens the menu (drawn on screen), then 1 attack my target (the player's T mark: jet, radar/SAM, ship; he
  declines the bunker), 2 cover me (default), 3 hunt on your own (city strike: the air defenses, then the warships,
  only turning on bandits within 15 km meanwhile; otherwise any bandit), 4 rejoin, 5 go home (circles over the carrier). He answers on the radio ('wing' voice) and the HUD shows his status.
- Air combat is the ai.js fighter brain. `bvrScale = 0.6` (ai.js multiplies the AIM-120 max range by it): from further
  out, a bandit that turns away outruns the missile almost every time.
- Kill credit: game.js calls `creditKill` (not `onKill`: Entity sets an instance field `onKill = null` that hid the
  method). Debrief `stats.wing`, a green message and "splash one". If he dies, game.wingmanLost says who did it.
- Known bug, left in place on purpose: `Radar.inCoverage` in src/sim/radar.js is always false for a radar on a jet
  (`radar.pos` returns a shared scratch vector that the line-of-sight math then overwrites). So no AI jet ever gets a
  radar lock and the enemy jets only fight close in. Fixing it would give every enemy jet long-range missiles (a big
  difficulty change), so only the wingman overrides `radar.inCoverage`.

## Enemy fleet and the Harpoon (AGM-84)
- The enemy destroyer used to sit on dry land on the islet at (15200, 11800) and the ships sailed straight forever.
  mission.js STRIKE.fleet is now in open water (destroyer 18000,14200, frigates 16600,15300 and 19400,13100) and each
  ship circles its point (carrierOps.js Ship `opts.patrol {x, z, r}`, radius 600 m, clockwise).
- weapons.js Harpoon fixes (the player's Harpoons too): sea-skim cruise with a terrain look-ahead floor, a 180 m
  pop-up inside 4.5 km, then a terminal dive with proportional navigation; the radar seeker no longer loses a ship to
  the notch filter, and the line-of-sight check aims 15 m above the waterline.
- Honest limit: a fresh frigate (6 SAMs plus a close-in gun) shoots down a 2-Harpoon salvo almost every time, but it
  empties its SAMs. The wingman then says "She's out of SAMs" so the player knows the next attack gets through.

## Player preferences (important)
- Beginner who wants to have fun and roleplay as a military pilot. Wants plain English on screen and to always know what to press.
- Keep the physics as they are; don't sink time into physics tuning unless asked. Ship builds fast, then let them test.
- Don't use subagents.

## Known issues / next ideas
- Seen once in a slow software-rendered browser: after a crash into a hillside, the HUD showed NaN speed/altitude and the screen went white.
  Not reproduced headlessly (test/crash_hill.mjs). Next step: hook game.physics to catch the first non-finite value in player.ac.s.
- On short screens (under about 650 px tall) the coach card and the controls card overlap.
- In the outside view the radio box covers the lower part of the jet.
- Carrier landing: after a bolter in a mission, flying the green-circle pattern back takes about 3 minutes (a shorter
  downwind leg, joinPoint OUT_BACK 7500, was not tested).
- Five-phase plan agreed with the player; build one phase, let them play, wait for "continue":
  1 wingman (done), 2 free play + command room (CIC map, ship orders, time controls), 3 strike wing / naval strike,
  4 carrier battle group, 5 extras.
- Other ideas the player picked but not built yet: night CAS, sound and vapor polish, more jets (F-35C stealth,
  EA-18G jammer), fly-through hoops for practice, a shorter go-around, night landings in rough seas.
