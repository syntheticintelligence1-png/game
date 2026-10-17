// Zero-asset procedural sound engine (Web Audio API): noise buffers, oscillators, biquad filters,
// wave-shapers, generated convolution reverb, stereo panning, manual Doppler, air absorption.
// Cockpit voice alerts use speechSynthesis (with a synthesized attention tone first).

function makeNoise(ctx, type, seconds = 3) {
  const n = Math.floor(ctx.sampleRate * seconds); const buf = ctx.createBuffer(1, n, ctx.sampleRate); const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (type === 'white') d[i] = w;
    else if (type === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    } else if (type === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else if (type === 'crackle') { d[i] = Math.random() < 0.0016 ? (Math.random() * 2 - 1) * (0.5 + Math.random()) : 0; }
  }
  // fade loop seam
  const f = Math.min(400, n >> 4); for (let i = 0; i < f; i++) { const k = i / f; d[i] *= k; d[n - 1 - i] *= k; }
  return buf;
}
function makeIR(ctx, seconds, decay, metallic) {
  const n = Math.floor(ctx.sampleRate * seconds); const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const t = i / ctx.sampleRate; let v = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
      if (metallic) v *= 0.6 + 0.4 * Math.sin(t * 2 * Math.PI * (1800 + c * 130)) * Math.sin(t * 2 * Math.PI * 520);
      d[i] = v;
    }
  }
  return buf;
}
function distCurve(k) { const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)); } return c; }

const VOICE_LINES = {
  pullup: 'Pull up. Pull up.', altitude: 'Altitude. Altitude.', missile: 'Warning. Missile launch.', bingo: 'Bingo fuel.', overg: 'Over G. Over G.',
  stall: 'Stall. Stall.', fuellow: 'Fuel low.', enginefire: 'Engine fire.', gear: 'Check gear.', damage: 'Warning. Damage.', lock: 'Locked.',
};
const VOICE_PRI = { pullup: 9, missile: 8, overg: 6, stall: 6, altitude: 5, enginefire: 7, damage: 5, bingo: 4, fuellow: 3, gear: 3, lock: 2 };

export class AudioEngine {
  constructor() { this.ctx = null; this.ready = false; this.listener = { p: { x: 0, y: 0, z: 0 }, f: { x: 0, y: 0, z: -1 }, u: { x: 0, y: 1, z: 0 }, v: { x: 0, y: 0, z: 0 } }; this.cockpit = false; this.sources = new Set(); this.voiceQ = []; this.lastVoice = {}; this.speaking = false; this.muted = false; }

  async init(ctxOverride) {
    if (this.ready) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = ctxOverride || new AC({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.master = ctx.createGain(); this.master.gain.value = 0.8;
      this.comp = ctx.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.knee.value = 10; this.comp.ratio.value = 6; this.comp.attack.value = 0.003; this.comp.release.value = 0.25;
      this.master.connect(this.comp); this.comp.connect(ctx.destination);
      this.extFilter = ctx.createBiquadFilter(); this.extFilter.type = 'lowpass'; this.extFilter.frequency.value = 20000;
      this.extGain = ctx.createGain(); this.extGain.gain.value = 1;
      this.extFilter.connect(this.extGain); this.extGain.connect(this.master);
      this.sfx = ctx.createGain(); this.sfx.connect(this.extFilter);
      this.avionics = ctx.createGain(); this.avionics.gain.value = 0.32; this.avionics.connect(this.master);
      this.reverb = ctx.createConvolver(); this.reverb.buffer = makeIR(ctx, 2.6, 2.2, false); this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.5;
      this.reverbSend.connect(this.reverb); this.reverb.connect(this.sfx);
      this.metal = ctx.createConvolver(); this.metal.buffer = makeIR(ctx, 0.45, 3, true);
      this.noise = { white: makeNoise(ctx, 'white'), pink: makeNoise(ctx, 'pink'), brown: makeNoise(ctx, 'brown'), crackle: makeNoise(ctx, 'crackle', 2) };
      this.buildEngine(); this.buildAvionics(); this.buildGun(); this.buildAmbient();
      this.ready = true;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {}); // never block on resume (embedded frames may hold it pending)
    } catch (e) { console.warn('audio init failed', e); this.ready = false; }
  }
  now() { return this.ctx.currentTime; }
  loop(buf, rate = 1) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.loopStart = Math.random() * buf.duration * 0.5; s.start(0, Math.random() * buf.duration); return s; }
  filt(type, f, q = 0.7) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  gain(v = 0) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  set(param, v, tc = 0.05) { if (!isFinite(v)) return; param.setTargetAtTime(v, this.ctx.currentTime, tc); }

  setMasterVolume(v) { if (this.ready) this.set(this.master.gain, this.muted ? 0 : v * 0.8); this.vol = v; }
  setMuted(b) { this.muted = b; if (this.ready) this.set(this.master.gain, b ? 0 : (this.vol != null ? this.vol : 1) * 0.8); }
  setPaused(b) { if (!this.ready) return; if (b) this.ctx.suspend(); else this.ctx.resume(); if (b && window.speechSynthesis) speechSynthesis.cancel(); }
  setListener(p, f, u, v) { const L = this.listener; L.p.x = p.x; L.p.y = p.y; L.p.z = p.z; L.f.x = f.x; L.f.y = f.y; L.f.z = f.z; L.u.x = u.x; L.u.y = u.y; L.u.z = u.z; L.v.x = v.x; L.v.y = v.y; L.v.z = v.z; }
  setCockpit(b) {
    if (!this.ready || this.cockpit === b) { this.cockpit = b; return; }
    this.cockpit = b;
    this.set(this.extFilter.frequency, b ? 1600 : 20000, 0.1); this.set(this.extGain.gain, b ? 0.55 : 1, 0.1);
  }

  // ---------------- player engine ----------------
  buildEngine() {
    const c = this.ctx; const E = this.eng = {};
    E.out = this.gain(1); E.out.connect(this.master);
    E.extF = this.filt('lowpass', 20000); E.extF.connect(E.out);
    // turbine whine: two detuned partials through a resonant band-pass
    E.w1 = c.createOscillator(); E.w1.type = 'sawtooth'; E.w2 = c.createOscillator(); E.w2.type = 'triangle';
    E.wbp = this.filt('bandpass', 3000, 6); E.wg = this.gain(0);
    E.w1.connect(E.wbp); E.w2.connect(E.wbp); E.wbp.connect(E.wg); E.wg.connect(E.out); E.w1.start(); E.w2.start();
    // blade pass hum
    E.bp = c.createOscillator(); E.bp.type = 'square'; E.bpf = this.filt('lowpass', 500); E.bpg = this.gain(0); E.bp.connect(E.bpf); E.bpf.connect(E.bpg); E.bpg.connect(E.extF); E.bp.start();
    // jet roar: brown + pink noise, low-passed by spool
    E.roar = this.loop(this.noise.brown); E.roarF = this.filt('lowpass', 600); E.roarG = this.gain(0); E.roar.connect(E.roarF); E.roarF.connect(E.roarG); E.roarG.connect(E.extF);
    E.hiss = this.loop(this.noise.pink); E.hissF = this.filt('bandpass', 1500, 0.6); E.hissG = this.gain(0); E.hiss.connect(E.hissF); E.hissF.connect(E.hissG); E.hissG.connect(E.extF);
    // afterburner: sub-bass rumble + crackle
    E.abN = this.loop(this.noise.brown, 0.7); E.abF = this.filt('lowpass', 180, 1.2); E.abG = this.gain(0); E.abN.connect(E.abF); E.abF.connect(E.abG); E.abG.connect(E.out);
    E.sub = c.createOscillator(); E.sub.type = 'sine'; E.sub.frequency.value = 36; E.subG = this.gain(0); E.sub.connect(E.subG); E.subG.connect(E.out); E.sub.start();
    E.cr = this.loop(this.noise.crackle); E.crF = this.filt('highpass', 700); E.crShape = c.createWaveShaper(); E.crShape.curve = distCurve(30);
    E.crG = this.gain(0); E.cr.connect(E.crF); E.crF.connect(E.crShape); E.crShape.connect(E.crG); E.crG.connect(E.extF);
    // airflow / wind
    E.wind = this.loop(this.noise.pink); E.windF = this.filt('bandpass', 600, 0.5); E.windG = this.gain(0); E.wind.connect(E.windF); E.windF.connect(E.windG); E.windG.connect(E.out);
    // high-AoA buffet rumble with tremolo
    E.buf = this.loop(this.noise.brown, 0.5); E.bufF = this.filt('lowpass', 95, 2); E.bufG = this.gain(0); E.trem = c.createOscillator(); E.trem.frequency.value = 9; E.tremG = this.gain(0);
    E.buf.connect(E.bufF); E.bufF.connect(E.bufG); E.bufG.connect(E.out); E.trem.connect(E.tremG); E.tremG.connect(E.bufG.gain); E.trem.start();
    // gear/airbrake turbulence
    E.turb = this.loop(this.noise.pink, 0.8); E.turbF = this.filt('bandpass', 300, 0.9); E.turbG = this.gain(0); E.turb.connect(E.turbF); E.turbF.connect(E.turbG); E.turbG.connect(E.out);
  }
  setPlayerEngine(p) {
    if (!this.ready) return; const E = this.eng;
    const alive = p.alive !== false; const rpm = alive ? p.rpm : 0; const ab = alive ? p.ab : 0;
    const ck = this.cockpit; const dist = ck ? 1 : 1 / (1 + Math.max(0, (p.camDist || 20) - 15) / 40);
    const f = 800 + 4200 * rpm * rpm;
    this.set(E.w1.frequency, f); this.set(E.w2.frequency, f * 1.503); this.set(E.wbp.frequency, f * 1.1);
    this.set(E.wg.gain, Math.max(0, rpm - 0.3) * (ck ? 0.11 : 0.05) * dist);
    this.set(E.bp.frequency, 90 + 210 * rpm); this.set(E.bpg.gain, Math.max(0, rpm - 0.5) * 0.06 * dist);
    this.set(E.roarF.frequency, 250 + 1700 * rpm * rpm + ab * 900);
    this.set(E.roarG.gain, Math.max(0, rpm - 0.55) * (ck ? 0.35 : 0.8) * dist);
    this.set(E.hissG.gain, Math.max(0, rpm - 0.75) * (ck ? 0.03 : 0.12) * dist);
    this.set(E.abG.gain, ab * (ck ? 0.9 : 1.3) * dist); this.set(E.subG.gain, ab * 0.45 * dist);
    this.set(E.crG.gain, ab * (ck ? 0.05 : 0.22) * dist);
    const q = p.q || 0; const wind = Math.min(1, Math.sqrt(q) / 260);
    this.set(E.windF.frequency, 300 + wind * 1800); this.set(E.windG.gain, wind * (ck ? 0.22 : 0.12));
    const bf = p.buffet || 0; this.set(E.bufG.gain, bf * 0.6); this.set(E.tremG.gain, bf * 0.4);
    this.set(E.turbG.gain, ((p.gearDown ? 0.6 : 0) + (p.airbrake || 0)) * wind * 0.35);
    this.set(E.extF.frequency, ck ? 2500 : 20000, 0.1);
  }

  // ---------------- avionics ----------------
  buildAvionics() {
    const c = this.ctx; const A = this.av = {};
    A.lockOsc = c.createOscillator(); A.lockOsc.type = 'square'; A.lockOsc.frequency.value = 1000; A.lockF = this.filt('lowpass', 2500); A.lockG = this.gain(0);
    A.lockOsc.connect(A.lockF); A.lockF.connect(A.lockG); A.lockG.connect(this.avionics); A.lockOsc.start();
    A.lchOsc = c.createOscillator(); A.lchOsc.type = 'square'; A.lchOsc.frequency.value = 1400; A.lchG = this.gain(0); A.lchLfo = c.createOscillator(); A.lchLfo.type = 'square'; A.lchLfo.frequency.value = 9; A.lchLfoG = this.gain(260);
    A.lchLfo.connect(A.lchLfoG); A.lchLfoG.connect(A.lchOsc.frequency); A.lchOsc.connect(A.lchG); A.lchG.connect(this.avionics); A.lchOsc.start(); A.lchLfo.start();
    // sidewinder seeker tone: growl (modulated noise+tone) / squeal (high tone)
    A.grN = this.loop(this.noise.white); A.grF = this.filt('bandpass', 480, 5); A.grG = this.gain(0); A.grAM = c.createOscillator(); A.grAM.frequency.value = 13; A.grAMG = this.gain(0);
    A.grN.connect(A.grF); A.grF.connect(A.grG); A.grG.connect(this.avionics); A.grAM.connect(A.grAMG); A.grAMG.connect(A.grG.gain); A.grAM.start();
    A.grT = c.createOscillator(); A.grT.type = 'triangle'; A.grT.frequency.value = 420; A.grTG = this.gain(0); A.grT.connect(A.grTG); A.grTG.connect(this.avionics); A.grT.start();
    A.sq = c.createOscillator(); A.sq.type = 'sine'; A.sq.frequency.value = 1450; A.sqVib = c.createOscillator(); A.sqVib.frequency.value = 7; A.sqVibG = this.gain(18);
    A.sqVib.connect(A.sqVibG); A.sqVibG.connect(A.sq.frequency); A.sqG = this.gain(0); A.sq.connect(A.sqG); A.sqG.connect(this.avionics); A.sq.start(); A.sqVib.start();
    A.cau = c.createOscillator(); A.cau.type = 'square'; A.cau.frequency.value = 760; A.cauLfo = c.createOscillator(); A.cauLfo.type = 'square'; A.cauLfo.frequency.value = 2.2; A.cauLfoG = this.gain(150);
    A.cauLfo.connect(A.cauLfoG); A.cauLfoG.connect(A.cau.frequency); A.cauG = this.gain(0); A.cauF = this.filt('lowpass', 2000); A.cau.connect(A.cauF); A.cauF.connect(A.cauG); A.cauG.connect(this.avionics); A.cau.start(); A.cauLfo.start();
  }
  beep(f, dur, vol = 0.3, type = 'sine', when = 0, dest) {
    if (!this.ready) return; const c = this.ctx; const t = c.currentTime + when;
    const o = c.createOscillator(); o.type = type; o.frequency.value = f; const g = this.gain(0);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.005); g.gain.setValueAtTime(vol, t + dur - 0.01); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(dest || this.avionics); o.start(t); o.stop(t + dur + 0.02); o.onended = () => g.disconnect();
  }
  rwrPing(level = 1) { this.beep(1250, 0.05, 0.25 * level, 'square'); }
  rwrNewContact() { this.beep(900, 0.06, 0.3, 'square'); this.beep(1500, 0.08, 0.3, 'square', 0.08); }
  setRwrLock(on) { if (this.ready) this.set(this.av.lockG.gain, on ? 0.13 : 0, 0.02); }
  setRwrLaunch(on) { if (this.ready) this.set(this.av.lchG.gain, on ? 0.16 : 0, 0.02); }
  setSeekerTone(mode, s = 1) {
    if (!this.ready) return; const A = this.av;
    this.set(A.grG.gain, mode === 1 ? 0.5 : 0, 0.03); this.set(A.grAMG.gain, mode === 1 ? 0.45 : 0, 0.03); this.set(A.grTG.gain, mode === 1 ? 0.05 + 0.08 * s : 0, 0.03);
    this.set(A.grT.frequency, 380 + 120 * s);
    this.set(A.sqG.gain, mode === 2 ? 0.09 + 0.06 * s : 0, 0.03);
  }
  setMasterCaution(on) { if (this.ready) this.set(this.av.cauG.gain, on ? 0.07 : 0, 0.02); }
  uiClick() { this.beep(1800, 0.025, 0.15, 'square'); }
  uiConfirm() { this.beep(1200, 0.05, 0.2); this.beep(1600, 0.07, 0.2, 'sine', 0.06); }
  lockTone() { this.beep(2000, 0.05, 0.22, 'square'); this.beep(2000, 0.05, 0.22, 'square', 0.09); }
  weaponSelect() { this.beep(700, 0.04, 0.2, 'square'); }

  // ---------------- voices ----------------
  voice(key) {
    if (!VOICE_LINES[key]) return;
    const t = performance.now(); if (this.lastVoice[key] && t - this.lastVoice[key] < 4500) return;
    this.lastVoice[key] = t;
    this.beep(880, 0.07, 0.25, 'square'); this.beep(660, 0.09, 0.25, 'square', 0.09);
    this.enqueue({ text: VOICE_LINES[key], pri: VOICE_PRI[key] || 1, role: 'betty' });
  }
  speak(text, o = {}) {
    if (!this.ready) return;
    this.noiseBurst(0.06, 0.12, 2500); // radio squelch click
    this.enqueue({ text, pri: o.priority || 1, role: o.voice || 'radio' });
  }
  enqueue(item) {
    if (!window.speechSynthesis) return;
    this.voiceQ.push(item); this.voiceQ.sort((a, b) => b.pri - a.pri);
    if (this.voiceQ.length > 3) this.voiceQ.length = 3;
    this.pumpVoice();
  }
  pumpVoice() {
    if (this.speaking || !this.voiceQ.length || !window.speechSynthesis || this.muted) return;
    const it = this.voiceQ.shift();
    try {
      const u = new SpeechSynthesisUtterance(it.text);
      const voices = speechSynthesis.getVoices() || [];
      const en = voices.filter(v => /en[-_]/i.test(v.lang));
      // a different voice per speaker where the browser has several: Betty (the jet's warning voice), MAGIC (AWACS),
      // MOTHER (the carrier), PADDLES (LSO), you and your wingman
      const male = en.filter(v => /male|david|daniel|alex|fred|guy|james|google uk english male/i.test(v.name) && !/female/i.test(v.name));
      const pick = (list, i) => list.length ? list[i % list.length] : (en[i % Math.max(en.length, 1)] || null);
      if (it.role === 'betty') { u.voice = en.find(v => /female|zira|samantha|karen|victoria|susan|google us english/i.test(v.name)) || en[0] || null; u.rate = 1.08; u.pitch = 1.15; }
      else if (it.role === 'lso') { u.voice = pick(male, 0); u.rate = 1.15; u.pitch = 0.9; }
      else if (it.role === 'awacs') { u.voice = pick(male, 1); u.rate = 1.12; u.pitch = 0.82; }
      else if (it.role === 'ship') { u.voice = pick(male, 2); u.rate = 1.05; u.pitch = 1.0; }
      else if (it.role === 'pilot') { u.voice = pick(male, 3); u.rate = 1.2; u.pitch = 1.08; }
      else if (it.role === 'wing') { u.voice = pick(male, 4); u.rate = 1.18; u.pitch = 0.95; }
      else { u.voice = en[2] || en[0] || null; u.rate = 1.12; u.pitch = 0.95; }
      u.volume = Math.min(1, (this.vol != null ? this.vol : 1));
      this.speaking = true;
      u.onend = u.onerror = () => { this.speaking = false; setTimeout(() => this.pumpVoice(), 120); };
      speechSynthesis.speak(u);
      // safety net in case the browser never reports the end; long AWACS calls need longer
      setTimeout(() => { if (this.speaking) { this.speaking = false; this.pumpVoice(); } }, Math.max(6000, it.text.length * 85));
    } catch (e) { this.speaking = false; }
  }

  // ---------------- gun ----------------
  buildGun() {
    const c = this.ctx; const G = this.gun = {};
    G.n = this.loop(this.noise.white); G.f = this.filt('bandpass', 750, 0.8); G.am = this.gain(0);
    G.lfo = c.createOscillator(); G.lfo.type = 'square'; G.lfo.frequency.value = 100; G.lfoG = this.gain(0.5); G.dc = c.createConstantSource(); G.dc.offset.value = 0.5;
    G.lfo.connect(G.lfoG); G.lfoG.connect(G.am.gain); G.dc.connect(G.am.gain);
    G.sh = c.createWaveShaper(); G.sh.curve = distCurve(8);
    G.out = this.gain(0); G.n.connect(G.f); G.f.connect(G.am); G.am.connect(G.sh); G.sh.connect(G.out); G.out.connect(this.master);
    G.mSend = this.gain(0.6); G.sh.connect(G.mSend); G.mSend.connect(this.metal); G.metalOut = this.gain(0); this.metal.connect(G.metalOut); G.metalOut.connect(this.master);
    G.thump = c.createOscillator(); G.thump.type = 'sawtooth'; G.thump.frequency.value = 100; G.thF = this.filt('lowpass', 280); G.thG = this.gain(0);
    G.thump.connect(G.thF); G.thF.connect(G.thG); G.thG.connect(this.master);
    G.lfo.start(); G.dc.start(); G.thump.start();
    this.gunOn = false;
  }
  setPlayerGun(on) {
    if (!this.ready || this.gunOn === on) return; this.gunOn = on; const G = this.gun; const t = this.now();
    if (on) {
      G.lfo.frequency.setValueAtTime(35, t); G.lfo.frequency.linearRampToValueAtTime(100, t + 0.35);
      G.thump.frequency.setValueAtTime(35, t); G.thump.frequency.linearRampToValueAtTime(100, t + 0.35);
      this.set(G.out.gain, 0.55, 0.02); this.set(G.metalOut.gain, 0.35, 0.02); this.set(G.thG.gain, 0.5, 0.02);
    } else {
      G.lfo.frequency.setTargetAtTime(30, t, 0.15); G.thump.frequency.setTargetAtTime(30, t, 0.15);
      this.set(G.out.gain, 0, 0.12); this.set(G.metalOut.gain, 0, 0.25); this.set(G.thG.gain, 0, 0.12);
    }
  }

  // ---------------- ambient ----------------
  buildAmbient() {
    const c = this.ctx; const A = this.amb = {};
    A.sea = this.loop(this.noise.pink, 0.6); A.seaF = this.filt('lowpass', 500); A.seaG = this.gain(0); A.seaL = c.createOscillator(); A.seaL.frequency.value = 0.13; A.seaLG = this.gain(0);
    A.sea.connect(A.seaF); A.seaF.connect(A.seaG); A.seaG.connect(this.sfx); A.seaL.connect(A.seaLG); A.seaLG.connect(A.seaG.gain); A.seaL.start();
  }
  setAmbient(o) { if (!this.ready) return; this.set(this.amb.seaG.gain, (o.ocean || 0) * 0.15, 0.3); this.set(this.amb.seaLG.gain, (o.ocean || 0) * 0.08, 0.3); }

  // ---------------- spatial helpers ----------------
  spatial(pos) {
    const L = this.listener; const dx = pos.x - L.p.x, dy = pos.y - L.p.y, dz = pos.z - L.p.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-3;
    // right vector = f x u
    const rx = L.f.y * L.u.z - L.f.z * L.u.y, ry = L.f.z * L.u.x - L.f.x * L.u.z, rz = L.f.x * L.u.y - L.f.y * L.u.x;
    const pan = Math.max(-1, Math.min(1, (dx * rx + dy * ry + dz * rz) / d));
    const front = (dx * L.f.x + dy * L.f.y + dz * L.f.z) / d;
    return { d, pan, front };
  }
  voiceChain(pos, ref = 60) {
    const s = this.spatial(pos);
    const g = this.gain(ref / (ref + Math.max(0, s.d - ref) * 0.9));
    const lp = this.filt('lowpass', Math.max(500, 18000 * Math.exp(-s.d / 1800)) * (s.front < -0.3 ? 0.6 : 1));
    const pn = this.ctx.createStereoPanner(); pn.pan.value = s.pan * 0.85;
    lp.connect(g); g.connect(pn); pn.connect(this.sfx);
    return { input: lp, g, pn, d: s.d, cleanup: () => { lp.disconnect(); g.disconnect(); pn.disconnect(); } };
  }
  burst(buf, t, dur, attack, gain, filterType, f0, f1, dest, rate = 1) {
    const c = this.ctx; const s = c.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const f = this.filt(filterType, f0, 0.8); const g = this.gain(0);
    f.frequency.setValueAtTime(f0, t); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.05);
    s.onended = () => { f.disconnect(); g.disconnect(); };
    return g;
  }
  noiseBurst(dur, vol, f) { if (!this.ready) return; this.burst(this.noise.white, this.now(), dur, 0.003, vol, 'bandpass', f, f, this.avionics); }

  explosion(pos, size, delay = 0) {
    if (!this.ready) return; const c = this.ctx; const t = c.currentTime + Math.max(0, delay);
    const ch = this.voiceChain(pos, 120 + size * 60); const d = ch.d;
    const big = size >= 5;
    if (d < 1500) this.burst(this.noise.white, t, 0.05, 0.001, 0.9 * Math.min(1, size / 3), 'highpass', 1800, 1800, ch.input);
    this.burst(this.noise.brown, t, 0.8 + size * 0.35, 0.006, 1.4 + size * 0.15, 'lowpass', 2600 + size * 300, 120, ch.input);
    this.burst(this.noise.white, t, 0.4 + size * 0.1, 0.004, 0.7, 'lowpass', 4500, 300, ch.input);
    // sub-bass thump
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(24, t + 0.5 + size * 0.06);
    const og = this.gain(0); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.9 * Math.min(1.5, size / 4), t + 0.01); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.7 + size * 0.1);
    o.connect(og); og.connect(ch.input); o.start(t); o.stop(t + 1.5 + size * 0.1);
    if (big) { const rv = this.gain(0.6); ch.g.connect(rv); rv.connect(this.reverbSend); this.burst(this.noise.brown, t + 0.15, 2.5 + size * 0.4, 0.3, 0.6, 'lowpass', 300, 60, ch.input); }
    setTimeout(() => ch.cleanup(), (delay + 6 + size) * 1000);
  }
  impact(pos, kind, delay = 0) { if (kind === 'water') this.splash(pos, 2); else this.explosion(pos, 1, delay); }
  bulletHit(pos) {
    if (!this.ready) return; const ch = this.voiceChain(pos, 40);
    this.burst(this.noise.white, this.now(), 0.08, 0.001, 0.5, 'bandpass', 2600, 1200, ch.input);
    setTimeout(() => ch.cleanup(), 400);
  }
  splash(pos, size = 1) {
    if (!this.ready) return; const ch = this.voiceChain(pos, 60 + size * 20);
    this.burst(this.noise.pink, this.now(), 0.6 + size * 0.2, 0.01, 0.6, 'lowpass', 2500, 400, ch.input);
    setTimeout(() => ch.cleanup(), 2500);
  }
  missileLaunch(pos, kind = 'aam') {
    if (!this.ready) return; const ch = this.voiceChain(pos, kind === 'bigsam' ? 300 : 80); const t = this.now();
    this.burst(this.noise.white, t, 0.12, 0.002, 0.8, 'bandpass', 1200, 600, ch.input);
    this.burst(this.noise.brown, t, kind === 'bigsam' ? 3.5 : 1.6, 0.05, kind === 'bigsam' ? 1.6 : 1.0, 'lowpass', 1800, 300, ch.input);
    this.burst(this.noise.white, t + 0.02, 1.2, 0.08, 0.35, 'bandpass', 3500, 900, ch.input);
    setTimeout(() => ch.cleanup(), 5000);
  }
  flare() { if (!this.ready) return; this.burst(this.noise.white, this.now(), 0.08, 0.001, 0.4, 'bandpass', 1600, 900, this.avionics); this.beep(180, 0.06, 0.25, 'sine', 0, this.avionics); }
  chaff() { if (!this.ready) return; this.burst(this.noise.white, this.now(), 0.05, 0.001, 0.35, 'highpass', 3000, 3000, this.avionics); this.beep(120, 0.05, 0.3, 'sine', 0, this.avionics); }
  sonicBoom(delay = 0) {
    if (!this.ready) return; const t = this.now() + delay;
    for (const dt of [0, 0.11]) this.burst(this.noise.white, t + dt, 0.12, 0.0015, 1.1, 'lowpass', 1400, 200, this.sfx);
    this.burst(this.noise.brown, t, 1.6, 0.02, 0.8, 'lowpass', 200, 50, this.sfx);
  }
  flybyCrack(pos) { if (!this.ready) return; const ch = this.voiceChain(pos, 200); this.burst(this.noise.white, this.now(), 0.09, 0.001, 1.0, 'lowpass', 3000, 400, ch.input); setTimeout(() => ch.cleanup(), 800); }
  catapultHookup() { if (!this.ready) return; const t = this.now(); this.burst(this.noise.white, t, 0.15, 0.002, 0.6, 'bandpass', 1800, 900, this.sfx); this.beep(140, 0.12, 0.4, 'triangle', 0.05, this.sfx); }
  catapultFire() {
    if (!this.ready) return; const t = this.now();
    this.burst(this.noise.white, t, 3.0, 0.05, 0.7, 'highpass', 2500, 1200, this.sfx); // steam hiss
    this.burst(this.noise.brown, t, 2.7, 0.08, 1.4, 'lowpass', 400, 900, this.sfx);   // stroke roar
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(55, t + 2.5); o.frequency.exponentialRampToValueAtTime(28, t + 2.9);
    const g = this.gain(0); g.gain.setValueAtTime(0.0001, t + 2.5); g.gain.exponentialRampToValueAtTime(1.0, t + 2.52); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.1);
    o.connect(g); g.connect(this.master); o.start(t + 2.45); o.stop(t + 3.2);
    this.burst(this.noise.white, t + 2.5, 0.25, 0.003, 0.9, 'bandpass', 900, 300, this.sfx);
  }
  wireTrap() {
    if (!this.ready) return; const t = this.now();
    this.burst(this.noise.white, t, 0.25, 0.001, 1.0, 'bandpass', 2200, 800, this.master);
    for (const f of [1870, 2430, 3120]) this.beep(f, 0.4, 0.06, 'sine', 0.01, this.master);
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(1100, t); o.frequency.exponentialRampToValueAtTime(220, t + 2.0);
    const f = this.filt('bandpass', 900, 3); const g = this.gain(0); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    o.connect(f); f.connect(g); g.connect(this.master); o.start(t); o.stop(t + 2.3);
    this.burst(this.noise.brown, t, 2.2, 0.05, 0.9, 'lowpass', 300, 80, this.master);
  }
  touchdown(I = 1) { if (!this.ready) return; const t = this.now(); this.burst(this.noise.brown, t, 0.4, 0.002, 0.9 * I, 'lowpass', 400, 80, this.master); this.burst(this.noise.white, t, 0.12, 0.002, 0.35 * I, 'bandpass', 1200, 500, this.master); }
  gearMotor() { if (!this.ready) return; const t = this.now(); const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(140, t); o.frequency.linearRampToValueAtTime(190, t + 2.5); const f = this.filt('lowpass', 600); const g = this.gain(0); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2); o.connect(f); f.connect(g); g.connect(this.master); o.start(t); o.stop(t + 3.3); this.beep(90, 0.15, 0.3, 'sine', 3.1, this.master); }
  hookMotor() { this.gearMotor(); }
  wheelThump() { this.touchdown(0.4); }

  // ---------------- continuous spatial sources (Doppler) ----------------
  createSource(kind) {
    const self = this;
    if (!this.ready) {
      // deferred: becomes a real source once the AudioContext is running
      let real = null, stopped = false;
      return { update(p, v, o) { if (!real && !stopped && self.ready) real = self.createSource(kind); if (real) real.update(p, v, o); }, stop() { stopped = true; if (real) real.stop(); real = null; } };
    }
    const c = this.ctx; const src = { kind, alive: true, nodes: [] };
    const out = this.gain(0); const lp = this.filt('lowpass', 8000); const pn = c.createStereoPanner(); lp.connect(out); out.connect(pn); pn.connect(this.sfx);
    src.out = out; src.lp = lp; src.pn = pn;
    let base = 1, n1, n2, o1;
    if (kind === 'rocket') { n1 = this.loop(this.noise.white); const bp = this.filt('bandpass', 1100, 0.5); n1.connect(bp); bp.connect(lp); n2 = this.loop(this.noise.brown); n2.connect(lp); src.bp = bp; base = 1; }
    else if (kind === 'jet') { n1 = this.loop(this.noise.brown); n1.connect(lp); o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 2600; const og = this.gain(0.04); const bp = this.filt('bandpass', 2600, 4); o1.connect(bp); bp.connect(og); og.connect(lp); o1.start(); src.o1base = 2600; }
    else if (kind === 'ciws' || kind === 'cannon') {
      n1 = this.loop(this.noise.white); const bp = this.filt('bandpass', kind === 'ciws' ? 900 : 600, 0.8); const am = this.gain(0); const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.value = kind === 'ciws' ? 75 : 30;
      const lg = this.gain(0.5); const dc = c.createConstantSource(); dc.offset.value = 0.5; lfo.connect(lg); lg.connect(am.gain); dc.connect(am.gain); lfo.start(); dc.start();
      n1.connect(bp); bp.connect(am); am.connect(lp); src.lfo = lfo; src.dc = dc;
    } else if (kind === 'ship' || kind === 'prop') { n1 = this.loop(this.noise.brown, 0.5); n1.connect(lp); o1 = c.createOscillator(); o1.type = 'triangle'; o1.frequency.value = kind === 'prop' ? 95 : 42; const og = this.gain(0.2); o1.connect(og); og.connect(lp); o1.start(); src.o1base = o1.frequency.value; }
    src.n1 = n1; src.n2 = n2; src.o1 = o1;
    this.sources.add(src);
    src.update = (pos, vel, params = {}) => {
      if (!src.alive) return;
      const L = self.listener; const s = self.spatial(pos);
      // Doppler: f' = f * c / (c + v_r), v_r = radial relative speed (positive receding)
      const dx = (pos.x - L.p.x) / s.d, dy = (pos.y - L.p.y) / s.d, dz = (pos.z - L.p.z) / s.d;
      const vr = (vel.x - L.v.x) * dx + (vel.y - L.v.y) * dy + (vel.z - L.v.z) * dz;
      const dop = Math.max(0.35, Math.min(2.5, 343 / Math.max(343 + vr, 60)));
      const I = params.intensity != null ? params.intensity : 1;
      const ref = kind === 'rocket' ? 90 : kind === 'jet' ? 150 : kind === 'ship' ? 300 : 120;
      let g = I * ref / (ref + Math.max(0, s.d - ref)) * (kind === 'jet' ? 1.2 * (0.6 + 0.6 * (params.ab || 0)) : kind === 'ship' ? 0.5 : 1);
      if ((kind === 'ciws' || kind === 'cannon') && !params.firing) g = 0;
      self.set(out.gain, Math.min(g, 1.6), 0.04);
      self.set(pn.pan, s.pan * 0.85, 0.04);
      self.set(lp.frequency, Math.max(400, 16000 * Math.exp(-s.d / 2200)) * (s.front < -0.3 ? 0.65 : 1) * Math.min(dop, 1.3), 0.05);
      if (n1) self.set(n1.playbackRate, dop, 0.05); if (n2) self.set(n2.playbackRate, dop * 0.8, 0.05);
      if (o1 && src.o1base) self.set(o1.frequency, src.o1base * dop * (kind === 'jet' ? (0.8 + 0.3 * (params.rpm || 1)) : 1), 0.05);
      if (src.bp) self.set(src.bp.frequency, 1100 * dop, 0.05);
      if (src.lfo) self.set(src.lfo.frequency, (kind === 'ciws' ? 75 : 30) * dop, 0.05);
      // supersonic flyby crack
      const sp = Math.hypot(vel.x, vel.y, vel.z);
      if (sp > 345 && s.d < 400 && !src.cracked && vr > 0) { src.cracked = true; self.flybyCrack(pos); }
    };
    src.stop = () => {
      if (!src.alive) return; src.alive = false; self.set(out.gain, 0, 0.3);
      setTimeout(() => { try { for (const n of [n1, n2, o1, src.lfo, src.dc]) if (n) n.stop(); out.disconnect(); pn.disconnect(); } catch (e) { } self.sources.delete(src); }, 1500);
    };
    return src;
  }
  update() { if (this.ready && !this.speaking) this.pumpVoice(); }
}
