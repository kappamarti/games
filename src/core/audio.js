// Audio ambientale procedurale (WebAudio): pioggia, vento, torrente, uccelli, tuoni, passi.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.7;
  }

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch { this.ctx = null; return; }
    const ctx = this.ctx;
    this.master = ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(ctx.destination);
    this.noiseBuf = this.makeNoise(4);
    this.brownBuf = this.makeNoise(4, true);
    this.rain = this.loop(this.noiseBuf, 'highpass', 900, 0.5);
    this.rainLow = this.loop(this.brownBuf, 'lowpass', 500, 1);
    this.wind = this.loop(this.brownBuf, 'bandpass', 350, 0.7);
    this.stream = this.loop(this.noiseBuf, 'bandpass', 1500, 2.5);
    this.birdTimer = 2;
  }

  makeNoise(seconds, brown = false) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }

  loop(buf, type, freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
    return { src, f, g };
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  update(dt, { rain, wind, streamDist, daylight, snow, indoor }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = indoor ? 0 : 1;
    this.rain.g.gain.setTargetAtTime(rain * 0.22 * k, t, 0.4);
    this.rainLow.g.gain.setTargetAtTime(rain * 0.35 * k, t, 0.4);
    this.wind.g.gain.setTargetAtTime((0.04 + wind * 0.3 + snow * 0.05) * k, t, 0.6);
    this.wind.f.frequency.setTargetAtTime(250 + wind * 500 + Math.sin(t * 0.3) * 80, t, 0.5);
    const sv = Math.max(0, 1 - streamDist / 28);
    this.stream.g.gain.setTargetAtTime(sv * sv * 0.25 * k, t, 0.3);
    // uccelli di giorno, col bel tempo
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 1.5 + Math.random() * 5;
      if (daylight > 0.35 && rain < 0.2 && snow < 0.1 && k) this.bird();
    }
  }

  bird() {
    const ctx = this.ctx, t = ctx.currentTime;
    const notes = 2 + Math.floor(Math.random() * 5);
    const base = 2200 + Math.random() * 2200;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = Math.random() * 2 - 1; pan.connect(this.master); }
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      const st = t + i * (0.09 + Math.random() * 0.08);
      o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.3), st);
      o.frequency.exponentialRampToValueAtTime(base * (0.6 + Math.random() * 0.9), st + 0.08);
      g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(0.025, st + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, st + 0.1);
      o.connect(g); g.connect(pan || this.master); o.start(st); o.stop(st + 0.12);
    }
  }

  thunder(distance = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.4 + distance * 2.5;
    const src = ctx.createBufferSource(); src.buffer = this.brownBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180 + (1 - distance) * 300;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.9 * (1.2 - distance * 0.6), t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 3.5 + Math.random() * 2);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 2); src.stop(t + 6);
  }

  step(surface = 'foglie', run = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const cfg = {
      foglie: ['bandpass', 2600, 0.6, 0.12], aghi: ['bandpass', 1500, 0.8, 0.07], erba: ['highpass', 3000, 0.5, 0.05],
      sentiero: ['lowpass', 900, 0.7, 0.09], acqua: ['bandpass', 1200, 1.5, 0.14], neve: ['lowpass', 1400, 0.4, 0.1], roccia: ['bandpass', 600, 1.2, 0.08],
    }[surface] || ['bandpass', 2000, 0.6, 0.08];
    f.type = cfg[0]; f.frequency.value = cfg[1] * (0.85 + Math.random() * 0.3); f.Q.value = cfg[2];
    const vol = cfg[3] * (run ? 1.4 : 1);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 3); src.stop(t + 0.2);
  }

  click() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 1800; g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.07);
  }

  shutter() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const d of [0, 0.07]) {
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3000;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.15, t + d); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.05);
      src.connect(f); f.connect(g); g.connect(this.master); src.start(t + d); src.stop(t + d + 0.06);
    }
  }

  pick() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 2;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t); src.stop(t + 0.15);
  }
}

export const audio = new AudioEngine();
