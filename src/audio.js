// Procedural Web Audio sound effects and a small sequenced soundtrack.
// No audio files are shipped, so everything works offline out of the box.

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

const SONGS = {
  menu: {
    bpm: 92,
    bass: [45, null, null, 45, null, null, 43, null, 41, null, null, 41, null, null, 43, null],
    lead: [69, null, 72, null, 76, null, 74, null, 72, null, 69, null, 67, null, 69, null],
    kick: [],
    hat: [2, 6, 10, 14],
  },
  battle: {
    bpm: 138,
    bass: [40, 40, 52, 40, 40, 52, 40, 43, 38, 38, 50, 38, 41, 41, 53, 43],
    lead: [64, null, null, 67, null, 69, null, null, 71, null, 69, null, 67, null, 64, null],
    kick: [0, 4, 8, 12],
    hat: [2, 6, 10, 14, 15],
  },
  boss: {
    bpm: 152,
    bass: [38, 38, 50, 38, 39, 39, 51, 39, 38, 38, 50, 38, 36, 36, 48, 37],
    lead: [74, 73, null, 70, null, 69, null, 70, 74, 73, null, 77, null, 76, null, 73],
    kick: [0, 3, 4, 8, 11, 12],
    hat: [2, 6, 10, 14],
  },
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.sfxOn = true;
    this.musicOn = true;
    this.last = {};
    this.song = null;
    this.step = 0;
    this.nextStepTime = 0;
    this.timer = null;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.7;
      const comp = ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(ctx.destination);
      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = this.sfxOn ? 1 : 0;
      this.sfxBus.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = this.musicOn ? 0.32 : 0;
      this.musicBus.connect(this.master);
      const len = ctx.sampleRate;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      if (this.song) this._startScheduler();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setSfx(on) {
    this.sfxOn = on;
    if (this.sfxBus) this.sfxBus.gain.value = on ? 1 : 0;
  }

  setMusic(on) {
    this.musicOn = on;
    if (this.musicBus) this.musicBus.gain.value = on ? 0.32 : 0;
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  _gate(name, gap) {
    const t = this.ctx.currentTime;
    if (t - (this.last[name] || -1) < gap) return false;
    this.last[name] = t;
    return true;
  }

  _osc(type, f0, f1, dur, vol, delay = 0, dest = this.sfxBus) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  _noise(dur, vol, type, f0, f1, q = 1, delay = 0, dest = this.sfxBus) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) filter.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  play(name, size = 1) {
    if (!this.ctx || !this.sfxOn || this.ctx.state !== 'running') return;
    switch (name) {
      case 'shoot':
        if (this._gate(name, 0.06)) this._osc('square', 820, 260, 0.06, 0.035);
        break;
      case 'enemyShoot':
        if (this._gate(name, 0.09)) this._osc('sawtooth', 420, 160, 0.09, 0.025);
        break;
      case 'hit':
        if (this._gate(name, 0.04)) this._noise(0.06, 0.12, 'highpass', 2500, 1500);
        break;
      case 'explode':
        if (this._gate(name, 0.05)) {
          // Crack, blast and rumble: all filtered noise, no pitched tones.
          const k = Math.min(2, size);
          this._noise(0.1, 0.3, 'bandpass', 2600, 800, 0.8);
          this._noise(0.45 + 0.3 * k, 0.4 + 0.12 * k, 'lowpass', 1500, 110, 0.7);
          this._noise(0.9 + 0.5 * k, 0.3 + 0.1 * k, 'lowpass', 240, 50, 1, 0.02);
        }
        break;
      case 'bigExplode':
        this._noise(1.8, 0.8, 'lowpass', 1500, 40);
        this._osc('sine', 90, 20, 1.2, 0.6);
        this._noise(0.8, 0.4, 'bandpass', 3000, 200, 0.7, 0.15);
        break;
      case 'missile':
        this._noise(0.6, 0.18, 'bandpass', 500, 2600, 2);
        break;
      case 'bomb':
        this._osc('sine', 1400, 380, 0.8, 0.05);
        break;
      case 'flak':
        if (this._gate(name, 0.08)) this._noise(0.35, 0.25, 'lowpass', 1600, 150);
        break;
      case 'pickup':
        this._osc('triangle', 660, 660, 0.08, 0.14);
        this._osc('triangle', 990, 990, 0.14, 0.14, 0.07);
        break;
      case 'coin':
        if (this._gate(name, 0.05)) {
          this._osc('square', 1318, 1318, 0.05, 0.05);
          this._osc('square', 1760, 1760, 0.1, 0.05, 0.05);
        }
        break;
      case 'hurt':
        this._noise(0.25, 0.3, 'lowpass', 900, 150);
        this._osc('square', 160, 50, 0.22, 0.08);
        break;
      case 'warning':
        for (let i = 0; i < 3; i++) {
          this._osc('square', 660, 660, 0.22, 0.06, i * 0.5);
          this._osc('square', 440, 440, 0.22, 0.06, i * 0.5 + 0.25);
        }
        break;
      case 'ui':
        this._osc('triangle', 600, 900, 0.06, 0.08);
        break;
      case 'buy':
        this._osc('triangle', 523, 523, 0.08, 0.12);
        this._osc('triangle', 659, 659, 0.08, 0.12, 0.08);
        this._osc('triangle', 784, 784, 0.16, 0.12, 0.16);
        break;
      case 'deny':
        this._osc('square', 200, 140, 0.18, 0.06);
        break;
      case 'win':
        [60, 64, 67, 72].forEach((n, i) => this._osc('triangle', NOTE(n), NOTE(n), 0.3, 0.14, i * 0.12));
        break;
      case 'thunder': {
        const d = 0.15 + Math.random() * 0.5;
        this._noise(0.25, 0.5, 'highpass', 1800, 900, 1, d);
        this._noise(2.8, 0.7, 'lowpass', 700, 60, 1, d + 0.05);
        break;
      }
      case 'lose':
        [67, 63, 60, 55].forEach((n, i) => this._osc('triangle', NOTE(n), NOTE(n), 0.35, 0.12, i * 0.18));
        break;
      default:
        break;
    }
  }

  playSong(name) {
    if (this.song === SONGS[name]) return;
    this.song = SONGS[name] || null;
    this.step = 0;
    if (this.ctx) {
      this.nextStepTime = this.ctx.currentTime + 0.05;
      this._startScheduler();
    }
  }

  _startScheduler() {
    if (this.timer) return;
    this.nextStepTime = this.ctx.currentTime + 0.05;
    this.timer = setInterval(() => this._schedule(), 25);
  }

  _schedule() {
    const ctx = this.ctx;
    const song = this.song;
    if (!song || ctx.state !== 'running') return;
    const stepDur = 60 / song.bpm / 4;
    // Recover gracefully if the tab was throttled.
    if (this.nextStepTime < ctx.currentTime - 0.2) this.nextStepTime = ctx.currentTime + 0.05;
    while (this.nextStepTime < ctx.currentTime + 0.12) {
      const s = this.step % 16;
      const delay = Math.max(0, this.nextStepTime - ctx.currentTime);
      const bass = song.bass[s];
      if (bass != null) this._osc('sawtooth', NOTE(bass), NOTE(bass), stepDur * 1.6, 0.16, delay, this.musicBus);
      const lead = song.lead[s];
      if (lead != null && (this.step >> 4) % 2 === 1) {
        this._osc('square', NOTE(lead), NOTE(lead), stepDur * 1.8, 0.05, delay, this.musicBus);
      }
      if (song.kick.includes(s)) this._osc('sine', 150, 40, 0.18, 0.5, delay, this.musicBus);
      if (song.hat.includes(s)) this._noise(0.04, 0.12, 'highpass', 7000, 7000, 1, delay, this.musicBus);
      this.nextStepTime += stepDur;
      this.step++;
    }
  }
}
