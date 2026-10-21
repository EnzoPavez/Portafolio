/* Sonido ambiente sintetizado con WebAudio (sin archivos externos):
   río (ruido filtrado), pájaros (chirridos) y un bandoneón suave que toca
   una frase original en ritmo de habanera cada tanto. Apagado por defecto:
   el AudioContext se crea recién cuando el usuario lo activa. */

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);

// Frase en Re menor: [compás, tiempo, nota MIDI, duración] (tiempos en negras)
const MELODY = [
  [0, 0, 69, 1.5], [0, 1.5, 70, 0.5], [0, 2, 69, 1], [0, 3, 65, 1],
  [1, 0, 64, 1.5], [1, 1.5, 65, 0.5], [1, 2, 67, 0.5], [1, 2.5, 69, 0.5], [1, 3, 73, 1],
  [2, 0, 74, 1.5], [2, 1.5, 72, 0.5], [2, 2, 70, 1], [2, 3, 69, 1],
  [3, 0, 67, 1], [3, 1, 70, 0.5], [3, 1.5, 69, 0.5], [3, 2, 67, 0.5], [3, 2.5, 64, 0.5], [3, 3, 61, 1],
  [4, 0, 62, 2.5],
];
// Acordes por compás: [fundamental, quinta, tercera] para el bajo de habanera
const CHORDS = [[50, 45, 53], [45, 52, 49], [50, 45, 53], [43, 50, 46], [50, 45, 53]];
const BPM = 64;

export class Ambience {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.paused = false;
    this.timers = new Set();
  }

  get enabled() {
    return this.on;
  }

  async enable() {
    if (!this.ctx) this._build();
    this.on = true;
    if (!this.paused) await this.ctx.resume();
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0.85, t, 0.5);
    this._loopBirds();
    this._later(() => this._loopBandoneon(), 2500);
  }

  disable() {
    this.on = false;
    this._clear();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0, t, 0.2);
    setTimeout(() => !this.on && this.ctx?.suspend(), 900);
  }

  // Fuera de pantalla o pestaña oculta: se suspende sin perder el estado.
  setPaused(p) {
    this.paused = p;
    if (!this.ctx || !this.on) return;
    if (p) this.ctx.suspend();
    else this.ctx.resume();
  }

  dispose() {
    this.disable();
    this.ctx?.close();
    this.ctx = null;
  }

  _later(fn, ms) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      if (this.on) fn();
    }, ms);
    this.timers.add(id);
  }

  _clear() {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
  }

  _build() {
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(comp);

    // Reverb corta (respuesta al impulso generada) para dar aire de exterior
    const len = Math.floor(ctx.sampleRate * 1.8);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.28;
    this.reverb.connect(wet).connect(this.master);

    this._buildRiver();
  }

  _buildRiver() {
    const ctx = this.ctx;
    const secs = 4, len = ctx.sampleRate * secs;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.035 * (Math.random() * 2 - 1)) / 1.035; // ruido marrón
        d[i] = last * 3.2;
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const rumble = ctx.createBiquadFilter();
    rumble.type = 'lowpass';
    rumble.frequency.value = 650;
    const babble = ctx.createBiquadFilter();
    babble.type = 'bandpass';
    babble.frequency.value = 1700;
    babble.Q.value = 0.7;
    const gLow = ctx.createGain(), gHigh = ctx.createGain();
    gLow.gain.value = 0.2;
    gHigh.gain.value = 0.09;
    src.connect(rumble).connect(gLow).connect(this.master);
    src.connect(babble).connect(gHigh).connect(this.master);
    // Oleaje lento del caudal
    for (const [target, f, depth] of [[gLow.gain, 0.11, 0.05], [gHigh.gain, 0.23, 0.04], [babble.frequency, 0.07, 350]]) {
      const lfo = ctx.createOscillator();
      const amt = ctx.createGain();
      lfo.frequency.value = f;
      amt.gain.value = depth;
      lfo.connect(amt).connect(target);
      lfo.start();
    }
    src.start();
  }

  _chirp(t, base, pan) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    o.type = 'sine';
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * 1.35, t + 0.05);
    o.frequency.exponentialRampToValueAtTime(base * 0.9, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.045, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    p.pan.value = pan;
    o.connect(g).connect(p);
    p.connect(this.master);
    p.connect(this.reverb);
    o.start(t);
    o.stop(t + 0.15);
  }

  _loopBirds() {
    if (this.paused) return this._later(() => this._loopBirds(), 1500);
    const t = this.ctx.currentTime + 0.05;
    const base = rand(2600, 4200), pan = rand(-0.8, 0.8);
    const n = Math.floor(rand(1, 5));
    const trill = Math.random() < 0.25;
    for (let i = 0; i < (trill ? 7 : n); i++) this._chirp(t + i * (trill ? 0.07 : rand(0.12, 0.22)), base * (trill ? 1 : rand(0.92, 1.08)), pan);
    this._later(() => this._loopBirds(), rand(2200, 6500));
  }

  _reed(t, midi, dur, vel, bass) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = bass ? 700 : 1300 + vel * 700;
    filt.Q.value = 0.6;
    // Dos lengüetas levemente desafinadas: el "batido" típico del bandoneón
    for (const [type, det, lvl] of [['sawtooth', -5, 0.5], ['square', 5, 0.28], ['triangle', 0, 0.4]]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = midiHz(midi);
      o.detune.value = det;
      g.gain.value = lvl;
      o.connect(g).connect(filt);
      o.start(t);
      o.stop(t + dur + 0.4);
    }
    const peak = (bass ? 0.05 : 0.07) * vel;
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(peak, t + 0.06);
    out.gain.setValueAtTime(peak * 0.85, t + Math.max(0.07, dur - 0.05));
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
    filt.connect(out);
    out.connect(this.bando);
  }

  _loopBandoneon() {
    if (this.paused) return this._later(() => this._loopBandoneon(), 2000);
    const ctx = this.ctx;
    if (!this.bando) {
      this.bando = ctx.createGain();
      this.bando.gain.value = 0.9;
      const trem = ctx.createOscillator();
      const depth = ctx.createGain();
      trem.frequency.value = 5.2;
      depth.gain.value = 0.08;
      trem.connect(depth).connect(this.bando.gain);
      trem.start();
      const pan = ctx.createStereoPanner();
      pan.pan.value = -0.25;
      this.bando.connect(pan);
      pan.connect(this.master);
      pan.connect(this.reverb);
    }
    const beat = 60 / BPM;
    const t0 = ctx.currentTime + 0.1;
    for (const [bar, b, midi, d] of MELODY) this._reed(t0 + (bar * 4 + b) * beat, midi, d * beat * 0.95, 0.8 + Math.random() * 0.2, false);
    CHORDS.forEach(([root, fifth, third], bar) => {
      const pattern = bar === CHORDS.length - 1 ? [[0, root, 1.8]] : [[0, root, 0.7], [0.75, root, 0.2], [1, fifth, 0.45], [1.5, third, 0.45], [2, root, 0.7], [2.75, root, 0.2], [3, fifth, 0.45], [3.5, third, 0.45]];
      for (const [b, m, d] of pattern) this._reed(t0 + (bar * 4 + b) * beat, m, d * beat, 0.75, true);
    });
    const phrase = CHORDS.length * 4 * beat * 1000;
    this._later(() => this._loopBandoneon(), phrase + rand(5000, 11000));
  }
}
