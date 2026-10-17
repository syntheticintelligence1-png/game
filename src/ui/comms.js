// Radio subtitles: who is talking, what they said (real radio brevity) and what it means in plain English.
// Reads game.comms (the radio queue) once per frame; only touches the DOM when a call starts or ends.
export class CommsView {
  constructor(game) {
    this.g = game; this.el = document.getElementById('radio'); this.ver = -1; this.nodes = new Map();
  }
  update() {
    const g = this.g, R = g.comms, el = this.el; if (!el || !R) return;
    const show = !g.attract && R.active.length > 0;
    if (el.hidden === show) el.hidden = !show;
    if (R.ver !== this.ver) { this.ver = R.ver; this.render(R.active); }
    for (const it of R.active) {
      const n = this.nodes.get(it.id); if (!n) continue;
      n.style.opacity = Math.max(0, Math.min(1, (it.dur - it.age) / 0.7)).toFixed(2);
      const live = it.age < it.talk; if (n._live !== live) { n._live = live; n.classList.toggle('live', live); }
    }
  }
  render(list) {
    const keep = new Set(list.map(i => i.id));
    for (const [id, n] of this.nodes) if (!keep.has(id)) { n.remove(); this.nodes.delete(id); }
    for (const it of list) {
      if (this.nodes.has(it.id)) continue;
      const n = document.createElement('div'); n.className = `rc rc-${it.who}`;
      const who = document.createElement('b'); who.className = 'rc-from'; who.textContent = it.from;
      const line = document.createElement('p'); line.className = 'rc-line'; line.textContent = it.text;
      n.append(who, line);
      if (it.plain) { const p = document.createElement('p'); p.className = 'rc-plain'; p.textContent = it.plain; n.append(p); }
      this.el.append(n); this.nodes.set(it.id, n);
    }
  }
}
