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
- `node test/flight_probe.mjs [str,itr,pull,roll,pitch,accel]`: flight-test card of the bare flight model (sustained
  and instantaneous turn, full aft stick, roll, pitch response, acceleration). Run it before and after any flight.js change.
- `node test/aim.mjs [tap,hold,track] [realistic]`: the easy controls: what a key tap and a key hold do to the nose,
  and two keyboard "pilots" keeping the gun cross on a target. The track part varies from run to run (random buffet
  and wing drop in flight.js); compare a few runs, not one.
- `node test/glsl_check.mjs`: shader validation (needs glslangValidator). "'average' : function name is redeclaration"
  is a known false positive.
- Real-browser screenshots: `node test/browser.mjs strike 10` and `node test/visual.mjs night` (Playwright + Chromium
  with SwiftShader; very slow, about 1 fps). test/browser_util.mjs imports Playwright from /opt/npm-tools; where that
  is missing, `npm install playwright-core` in a scratch folder and launch Chrome with
  `executablePath: '/usr/bin/google-chrome'` (that is how the helicopter and fleet were checked).
- `node test/screens.mjs [menu,briefing,flight,carrier,wing,pause,debrief,crash]` with `SIZES=1100x650,1920x950`:
  screenshots of every screen at several window sizes (steps the game at a fixed 60 fps, renders only the shots, so it
  is quick). Prints `[bad]` for NaN / undefined drawn on the HUD or in the page and for a PLAY / START MISSION button
  below the window. `node test/sound_levels.mjs`: peak and RMS of each sound, rendered offline through the real
  audio engine. Both take `PLAYWRIGHT=<scratch>/node_modules/playwright-core/index.mjs CHROME=/usr/bin/google-chrome`
  where /opt/npm-tools is missing; build first (screens.mjs loads dist/dev.html).

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
  circle (joinPoint: `PATTERN` = 7 km behind the ship and 2 km to the side first, then it slides along the extended
  centre line ahead of the jet), the banner at the top of the screen (joinHint / status), the coach card "Coming back
  to land", and an auto-throttle holding 180 kt. Raising the gear gives back the throttle the player had before.
- Bolter to trap in `land_easy bolter`: 4.6 min (it was 5.3 min with the old 9 km / 2.5 km pattern). 6 km / 2 km was
  tried too: FAIR grades and more bank near the deck. Most of what is left is the straight-in from 7 km (about 100 s),
  which is where canCapture takes over.
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
- Hunting while there are still things for him to bomb: a dogfight still going after 90 s (`HUNT_FIGHT_MAX`; losing
  the bandit for under 30 s doesn't restart the clock) is broken off ("bugging out, pressing to the target") and that
  bandit is left alone for 60 s (`HUNT_IGNORE`). Two computer pilots in the same jet can circle each other for minutes
  while the SAMs stay up.
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

## Flight feel (session 3: the player asked for physics tuning)
- What they said: turning felt slow and heavy, and aiming felt too twitchy; they wanted something in between arcade
  and realistic. The tuning knobs are named constants: `FCS` and `AERO` in flight.js, `EASY` in assist.js.
- flight.js lift: past 16° AoA the lift keeps rising (vortex lift off the leading-edge extensions) to CL 1.95 at 32°;
  the stall is at 26-38° (was 18-28°) and the pitch-up, roll damping, yaw stability and buffet bands moved up with it.
  Induced drag `AERO.k` 0.10 (was 0.118); separated-flow drag builds over `AERO.a0..a1` = 18-36° (was 14-32°).
- flight.js FCS, gear up: G-error gain `FCS.kn` 4.5 (was 2.2), capped at `FCS.cap` 1 rad/s (uncapped, it threw the nose
  past the AoA limit at low speed into a slow pitch bobble); pitch-rate gain `FCS.kq` 8 (was 6). The gear-down
  powered-approach law keeps the old 2.2 / 6 that the landing assist was tuned with. AoA limit 30° (was 24.5°), applied
  to the AoA predicted 0.25 s ahead, and the G limits become AoA limits (`FCS.kg`, `FCS.lg`), so a hard pull stops at
  the limit without overshoot.
- Result (flight_probe, 1000 m, afterburner): sustained turn about 17°/s from 250 to 450 kt (was 12.5-16.7),
  instantaneous 25°/s at 350 kt and 7.2 g (was 22.5°/s), roll rate unchanged (229°/s).
- Easy controls (FlightAssist, `EASY`, the comment above it explains every number): a tap is a small nudge (rudder
  first, so the nose moves at once), a hold is a full turn (the roll speeds up the longer A/D is held); letting go stops
  the roll where the jet is and holds the nose on the heading it was swinging toward; W/S move the nose and it stays
  where it was put; automatic back-pressure up to 5.5 g in a held turn; up to 80° of bank.
- AI jets (ai.js move): they roll toward the turn first (`rollRate` 200°/s, less at low dynamic pressure, 1.5x when
  dodging terrain) and the pull comes on as the wings get there, so their wings show where they are about to go.
  `clMax` 1.5 (was 1.75) and `maxG` 8 (was 8.5): about a match for the player's jet. The wingman keeps maxG 9.
- player.js LCOS gun sight: the target's acceleration is worked out from the real time between looks (it assumed 60 fps).

## Looks and sound (session 3)
- cameras.js chase camera: the spring now works the same at any frame rate (it sat speed x frame time too close: 4 m
  at 60 fps, 12 m at 20 fps); distance 24.5 m (was 28); smooth shake (a few sines, not random jumps); a fine buzz
  while the gun fires; a small zoom kick when the afterburner lights (`rig.fovKick`).
- fx.js explosions (`BLAST`): the fireball is glowing smoke (`PT.BALL`, alpha blended, its heat cools at `cool` per
  second) with a few additive flames on top; dozens of additive flames used to add up to a white blob. `fuel: true`
  (aircraft) gives a bigger fireball and black smoke; at sea it is mostly grey steam; smaller shock ripple and
  condensation puff. Burning wrecks falling from the sky lay flame and smoke evenly along their path; shot-down
  enemy jets trail smoke.
- fx.js trails: a trail only grew when its emitter covered `minStep` in one frame (fixed: the newest point rides
  with the emitter until it is minStep from the one before). Vortex ribbons are capped at `VORTEX_MAX_ANGLE` width per
  metre from the camera and fade out within 2-16 m of it (in hard turns the LEX vapor streamed past the chase camera
  as a wide white band); LEX vapor lives 0.12 s. Contrails start closer to the nozzles.
- ocean.js: the splash foam of crashes and explosions at sea is a ragged patch, not a flat white disc.
- audio.js: `hitTick` (our bullets hitting: a 3.6 kHz click and a low thump on the master bus; that is where our own
  gun is quietest, so it cuts through), `hullHit` (rounds and fragments hitting us), `killConfirm` (two-note chime
  when the player destroys anything), `abLight` (deep whump when the afterburner lights; game.js spots it, not again
  within 0.8 s of going out), and the wind roars louder and deeper above 2 g. The rate limiters start from `?? -1`
  (`|| 0` swallowed a sound played at time 0). Check new sounds against the others with test/sound_levels.mjs.

## Screens (session 3)
- HUD scale `s = min(H/900, W/1500)` (was H/900), so in narrow windows the HUD stays clear of the cards at the
  sides. `hud.cssHalfW` (half-width of the flight HUD, CSS px) and `hud.topRightCss` (bottom of the weapon list and
  wingman text) are what the cards and the radio column lay out against.
- Radio subtitles: a column at the top right under the weapon list, newest on top (shell.html #radio; comms.js
  `place()` sets its top and its width, 300-460 px and never wider than the gap beside the HUD). They used to sit at
  the bottom, over the jet in the outside view.
- Coach and controls cards: as wide as the gap left of the HUD allows (280-388 px, guide.js `layout()`). The controls
  card folds to its one-line form while the coach would run into it and comes back when there is room (Tab still
  opens it). `game.cardRight` keeps the HUD messages clear of the cards.
- The menu's PLAY bar and the briefing's START MISSION bar stick to the bottom of short windows (they were below the
  fold under about 800-900 px); the title shrinks under 820 px.
- NaN after a crash (the old known issue): the HUD drew the speed / altitude strip with no jet data. It now only draws
  while there is a jet (`S.ias != null`). The "white screen" was the fireball flash.
- The debrief tip matches how the mission was lost (flew into the ground, the sea or the ship, or shot down). Radio
  text: no more "9.6 km to your right of you" or "fired a missile at you from to your right".
- Checked with test/screens.mjs at 1100x600, 1100x650, 1366x650, 1920x950 and 960x1040.

## Player preferences (important)
- Beginner who wants to have fun and roleplay as a military pilot. Wants plain English on screen and to always know what to press.
- Session 3 asked for physics tuning and polish (feel, looks, sound, screens). Don't retune the physics again unless
  asked. Ship builds fast, then let them test.
- Don't use subagents.

## Known issues / next ideas
- `wingman.mjs sead` can still fail: the air combat is random, and now and then the wingman is shot down before he
  gets the 3 air defenses the check asks for (1 run in 8 with the hunt break-off; about 5 in 8 before it). Run it a
  few times before blaming a change. `aim.mjs` numbers also change from run to run.
- A bolter still costs about 4.6 minutes back to the trap; a shorter go-around would need a new pattern, not just a
  smaller one (6 km / 2 km gave FAIR grades).
- Five-phase plan agreed with the player: 1 wingman (done), 2 free play + command room (CIC map, ship orders, time
  controls), 3 strike wing / naval strike, 4 carrier battle group, 5 extras. Phases 2-5 are on hold (after phase 1 the
  player asked for tuning and polish instead); ask before starting one.
- Other ideas the player picked but not built yet: night CAS, more jets (F-35C stealth, EA-18G jammer), fly-through
  hoops for practice, a shorter go-around, night landings in rough seas.
