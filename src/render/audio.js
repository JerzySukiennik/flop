// Audio: Kenney SFX (vendored, CC0) + a synthesized wind ambient bed
// (documented fallback in DECISIONS.md — no CC0 ambient loop was sourceable
// without Freesound OAuth). Everything routes through one WebAudio context,
// created lazily on first user gesture.
const BASE = import.meta.env.BASE_URL ?? '/';

const BANKS = {
  impact: { dir: 'sfx-impact', files: ['impactWood_medium_000.ogg', 'impactWood_medium_001.ogg', 'impactWood_medium_002.ogg', 'impactSoft_heavy_001.ogg', 'impactSoft_heavy_002.ogg'] },
  thud: { dir: 'sfx-impact', files: ['impactSoft_medium_000.ogg', 'impactSoft_medium_001.ogg', 'impactSoft_medium_002.ogg'] },
  grunt: { dir: 'sfx-grunts', files: ['1.ogg', '2.ogg', '3.ogg', '4.ogg', '5.ogg', '6.ogg'] },
  click: { dir: 'sfx-ui', files: ['click_001.ogg', 'click_002.ogg'] },
  confirm: { dir: 'sfx-ui', files: ['confirmation_001.ogg', 'confirmation_002.ogg'] },
  jingle: { dir: 'music-jingles', files: ['jingles_NES00.ogg', 'jingles_NES03.ogg'] },
  fanfare: { dir: 'music-jingles', files: ['jingles_NES09.ogg', 'jingles_NES13.ogg'] },
};

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.master = null;
    this.windGain = null;
    this._lastPlay = new Map();
  }

  /** Call from a user-gesture handler. */
  async unlock() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
    this._startWind();
    // fire-and-forget preload
    for (const [bank, def] of Object.entries(BANKS)) {
      for (const f of def.files) this._load(`${bank}:${f}`, `${BASE}assets/${def.dir}/${f}`);
    }
  }

  async _load(key, url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
      this.buffers.set(key, buf);
    } catch { /* missing sound is not fatal */ }
  }

  play(bank, { volume = 1, rate = 1, cooldownMs = 70 } = {}) {
    if (!this.ctx) return;
    const t = performance.now();
    if (t - (this._lastPlay.get(bank) ?? 0) < cooldownMs) return;
    this._lastPlay.set(bank, t);
    const def = BANKS[bank];
    if (!def) return;
    const f = def.files[Math.floor(Math.random() * def.files.length)];
    const buf = this.buffers.get(`${bank}:${f}`);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (0.92 + Math.random() * 0.16);
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.master);
    src.start();
  }

  /** Quiet procedural wind bed — filtered noise with a slow LFO. */
  _startWind() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02; // brown-ish noise
      d[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain).connect(filter.frequency);
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.05;
    src.connect(filter).connect(this.windGain).connect(this.master);
    src.start();
    lfo.start();
  }

  /** Per-level ambience tint: docks = brighter wind, castle = low rumble. */
  setAmbience(sky) {
    if (!this.windGain) return;
    this.windGain.gain.value = { day: 0.045, sunset: 0.07, dusk: 0.06 }[sky] ?? 0.05;
  }
}
