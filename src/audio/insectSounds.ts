/**
 * Insektenklänge (prozedural, keine Audio-Dateien).
 *
 * 1) Ambient-Bed: nicht positionale Stereo-Klangfläche aus mehreren nahtlosen Loops
 *    unterschiedlicher Länge (64 s Grillenchor, 23 s Summen/Brummen, 37 s Laubheuschrecken-Triller).
 *    Durch die verschiedenen Längen wiederholt sich die Überlagerung erst nach Stunden.
 *    Erzeugt mit 16 kHz (Insekten bis ~7 kHz, spart Speicher), ereignisbasiert gerendert
 *    (nur dort Rechenarbeit, wo ein Zirpen klingt), Naht per Überblendung.
 * 2) 15 Einzelgeräusch-Rezepte für räumliche Quellen (Web-Audio-Graphen), Tonhöhe ±12 %.
 */

export const BED_SAMPLE_RATE = 16000;

export interface BedLoop {
  left: Float32Array;
  right: Float32Array;
  seconds: number;
}

function rng32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Kurzer Sinus-Puls mit weicher Hüllkurve (Grillen-Zirp), ins Stereo-Paar gemischt (mit Umbruch an der Loopgrenze). */
function addPulse(L: Float32Array, R: Float32Array, n: number, start: number, len: number, freq: number, amp: number, pan: number, sr: number): void {
  const gl = amp * Math.cos((pan * Math.PI) / 4 + Math.PI / 4);
  const gr = amp * Math.sin((pan * Math.PI) / 4 + Math.PI / 4);
  const w = (2 * Math.PI * freq) / sr;
  for (let i = 0; i < len; i++) {
    const env = Math.sin((Math.PI * i) / len);
    const s = Math.sin(w * i) * env * env;
    const k = (start + i) % n;
    L[k] += s * gl;
    R[k] += s * gr;
  }
}

/**
 * Einen Bed-Loop erzeugen. `kind`:
 *   'crickets'  Grillenchor: viele Tiere, Zirp-Gruppen in eigenem Rhythmus, im Stereofeld verteilt
 *   'hum'       leises Summen/Brummen (gefiltertes Rauschen, langsam moduliert) + entfernte Fliegen
 *   'trills'    vereinzelte Laubheuschrecken-Triller
 */
export function generateBedLoop(kind: 'crickets' | 'hum' | 'trills', seconds: number, seed = 1, sr = BED_SAMPLE_RATE): BedLoop {
  const n = Math.round(seconds * sr);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const rnd = rng32(seed);
  if (kind === 'crickets') {
    const animals = 12;
    for (let a = 0; a < animals; a++) {
      const f = 3800 + rnd() * 1500;
      const pan = rnd() * 2 - 1;
      const amp = 0.012 + rnd() * 0.02;
      const groupEvery = 0.55 + rnd() * 0.9; // s zwischen Zirp-Gruppen
      const pulses = 2 + Math.floor(rnd() * 4);
      // Aktivphasen: jedes Tier singt nur einen Teil der Zeit (lebendiger)
      const activeLen = 6 + rnd() * 18;
      const pauseLen = 3 + rnd() * 14;
      let t = rnd() * groupEvery;
      let phaseEnd = activeLen * rnd();
      let active = rnd() < 0.7;
      while (t < seconds) {
        if (t > phaseEnd) {
          active = !active;
          phaseEnd = t + (active ? activeLen : pauseLen) * (0.6 + rnd() * 0.8);
        }
        if (active) {
          for (let p = 0; p < pulses; p++) addPulse(L, R, n, Math.round((t + p * 0.032) * sr), Math.round(0.016 * sr), f * (1 + (rnd() - 0.5) * 0.01), amp, pan, sr);
        }
        t += groupEvery * (0.9 + rnd() * 0.2);
      }
    }
  } else if (kind === 'trills') {
    let t = rnd() * 2;
    while (t < seconds) {
      const f = 5500 + rnd() * 1800;
      const pan = rnd() * 2 - 1;
      const dur = 0.4 + rnd() * 1.2;
      const rate = 45 + rnd() * 35; // Pulse/s
      const amp = 0.008 + rnd() * 0.012;
      for (let k = 0; k < dur * rate; k++) addPulse(L, R, n, Math.round((t + k / rate) * sr), Math.round(0.008 * sr), f, amp * Math.sin((Math.PI * k) / (dur * rate)), pan, sr);
      t += 2 + rnd() * 6;
    }
  } else {
    // Summen: rosa-ähnliches Rauschen durch zwei Tiefpässe, langsam amplitudenmoduliert.
    // Über das Loop-Ende hinaus rechnen (x Samples) und das Überstück in den Anfang überblenden →
    // der letzte Wert geht stetig in den ersten über (nahtlose Schleife).
    const x = Math.round(0.5 * sr);
    const N2 = n + x;
    const L2 = new Float32Array(N2);
    const R2 = new Float32Array(N2);
    let l1 = 0, l2 = 0, r1 = 0, r2 = 0;
    const cyc = Math.max(1, Math.round(seconds / 9)); // ganzzahlige Zyklen über n → periodisch
    for (let i = 0; i < N2; i++) {
      const ph = (i / n) * Math.PI * 2;
      const mod = 0.5 + 0.3 * Math.sin(ph * cyc) + 0.2 * Math.sin(ph * (cyc * 2 + 1) + 1.3);
      l1 += 0.06 * (rnd() * 2 - 1 - l1);
      l2 += 0.2 * (l1 - l2);
      r1 += 0.06 * (rnd() * 2 - 1 - r1);
      r2 += 0.2 * (r1 - r2);
      L2[i] = l2 * 0.05 * mod;
      R2[i] = r2 * 0.05 * mod;
    }
    for (let i = 0; i < x; i++) {
      const k = i / x;
      L2[i] = L2[i] * k + L2[n + i] * (1 - k);
      R2[i] = R2[i] * k + R2[n + i] * (1 - k);
    }
    L.set(L2.subarray(0, n));
    R.set(R2.subarray(0, n));
    // ferne Fliegen: leise, langsam schwebende Summtöne (Ereignisse, mit Umbruch an der Loopgrenze)
    let t = rnd() * 3;
    while (t < seconds) {
      const f = 160 + rnd() * 120;
      const dur = 1.5 + rnd() * 2.5;
      const pan = rnd() * 2 - 1;
      const len = Math.round(dur * sr);
      const st = Math.round(t * sr);
      for (let i = 0; i < len; i++) {
        const env = Math.sin((Math.PI * i) / len);
        const saw = ((i * f) / sr) % 1;
        const tr = 0.6 + 0.4 * Math.sin((2 * Math.PI * 38 * i) / sr);
        const v = (saw * 2 - 1) * env * env * tr * 0.006;
        const k = (st + i) % n;
        L[k] += v * (0.5 - pan * 0.4);
        R[k] += v * (0.5 + pan * 0.4);
      }
      t += 4 + rnd() * 8;
    }
  }
  return { left: L, right: R, seconds };
}

/**
 * Kategorien: Vorbeiflug (Insekten), Boden (Zirpen aus Wall/Vegetation), Pflanze (Blasen, Ranken,
 * Sporen), Tropfen (von Pilzhüten), Ruf (ferne, melodisch-komische Alien-Rufe).
 */
export type CreatureCategory = 'flyby' | 'ground' | 'plant' | 'drip' | 'call';

/** Während `build()` gesammelte Tonhöhen-Parameter (Detune) – für Doppler-Verläufe. */
let pitchCollector: AudioParam[] | null = null;
export function collectPitch<T>(fn: () => T): { result: T; params: AudioParam[] } {
  pitchCollector = [];
  const result = fn();
  const params = pitchCollector;
  pitchCollector = null;
  return { result, params };
}

export interface Recipe {
  id: string;
  category: CreatureCategory;
  duration: [number, number];
  /** Baut den Klang ab Zeit t in `out` (Gain → Panner). `p` = Tonhöhenfaktor. */
  build(ctx: BaseAudioContext, out: AudioNode, t: number, dur: number, p: number, noise: AudioBuffer): void;
}

function osc(ctx: BaseAudioContext, type: OscillatorType, f: number, t: number, dur: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  o.start(t);
  o.stop(t + dur + 0.05);
  pitchCollector?.push(o.detune);
  return o;
}

function noiseSrc(ctx: BaseAudioContext, buf: AudioBuffer, t: number, dur: number): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.start(t, Math.random() * Math.max(0, buf.duration - 0.1));
  s.stop(t + dur + 0.05);
  pitchCollector?.push(s.detune);
  return s;
}

function filt(ctx: BaseAudioContext, type: BiquadFilterType, f: number, q = 1): BiquadFilterNode {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  return b;
}

/** Amplitudenmodulation (Flügelschlag/Tremolo): Signal → Gain, dessen Verstärkung ein LFO moduliert. */
function trem(ctx: BaseAudioContext, rate: number, depth: number, t: number, dur: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = 1 - depth;
  const l = osc(ctx, 'sine', rate, t, dur);
  const lg = ctx.createGain();
  lg.gain.value = depth;
  l.connect(lg).connect(g.gain);
  return g;
}

function clicks(ctx: BaseAudioContext, out: AudioNode, t: number, count: number, gap: number, f: number, noise: AudioBuffer): void {
  for (let i = 0; i < count; i++) {
    const s = noiseSrc(ctx, noise, t + i * gap, 0.02);
    const g = ctx.createGain();
    const st = t + i * gap;
    g.gain.setValueAtTime(0, st);
    g.gain.linearRampToValueAtTime(0.9, st + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, st + 0.018);
    s.connect(filt(ctx, 'bandpass', f, 4)).connect(g).connect(out);
  }
}

function pulses(ctx: BaseAudioContext, out: AudioNode, t: number, count: number, gap: number, f: number, len: number): void {
  for (let i = 0; i < count; i++) {
    const st = t + i * gap;
    const o = osc(ctx, 'sine', f, st, len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, st);
    g.gain.linearRampToValueAtTime(0.6, st + len * 0.3);
    g.gain.linearRampToValueAtTime(0, st + len);
    o.connect(g).connect(out);
  }
}

export const RECIPES: Recipe[] = [
  // --- Vorbeiflug ---
  { id: 'fliege', category: 'flyby', duration: [1.2, 2.2], build: (c, o, t, d, p) => osc(c, 'sawtooth', 210 * p, t, d).connect(filt(c, 'bandpass', 950 * p, 2)).connect(trem(c, 42, 0.4, t, d)).connect(o) },
  { id: 'hummel', category: 'flyby', duration: [1.6, 2.8], build: (c, o, t, d, p) => osc(c, 'sawtooth', 115 * p, t, d).connect(filt(c, 'lowpass', 700, 1)).connect(trem(c, 26, 0.35, t, d)).connect(o) },
  { id: 'muecke', category: 'flyby', duration: [1.0, 1.8], build: (c, o, t, d, p) => {
    const s = osc(c, 'square', 560 * p, t, d);
    const v = osc(c, 'sine', 6, t, d);
    const vg = c.createGain();
    vg.gain.value = 18;
    v.connect(vg).connect(s.frequency);
    const g = c.createGain();
    g.gain.value = 0.25;
    s.connect(filt(c, 'highpass', 400)).connect(g).connect(o);
  } },
  { id: 'libelle', category: 'flyby', duration: [0.9, 1.5], build: (c, o, t, d, p, n) => noiseSrc(c, n, t, d).connect(filt(c, 'bandpass', 450 * p, 1.5)).connect(trem(c, 32, 0.6, t, d)).connect(o) },
  { id: 'motte', category: 'flyby', duration: [1.2, 2.0], build: (c, o, t, d, p, n) => noiseSrc(c, n, t, d).connect(filt(c, 'bandpass', 320 * p, 1.2)).connect(trem(c, 14, 0.7, t, d)).connect(o) },
  { id: 'biene', category: 'flyby', duration: [1.4, 2.4], build: (c, o, t, d, p) => {
    const s = osc(c, 'sawtooth', 240 * p, t, d);
    const v = osc(c, 'sine', 1.3, t, d);
    const vg = c.createGain();
    vg.gain.value = 12;
    v.connect(vg).connect(s.frequency);
    s.connect(filt(c, 'bandpass', 1100, 1.5)).connect(trem(c, 50, 0.3, t, d)).connect(o);
  } },
  { id: 'wespe', category: 'flyby', duration: [1.0, 1.8], build: (c, o, t, d, p) => osc(c, 'sawtooth', 300 * p, t, d).connect(filt(c, 'bandpass', 1300 * p, 2.5)).connect(trem(c, 60, 0.25, t, d)).connect(o) },
  { id: 'kaefer', category: 'flyby', duration: [1.8, 3.0], build: (c, o, t, d, p) => {
    const a = osc(c, 'triangle', 88 * p, t, d);
    const b = osc(c, 'triangle', 176 * p, t, d);
    const g = c.createGain();
    g.gain.value = 0.7;
    a.connect(g);
    b.connect(g);
    g.connect(trem(c, 20, 0.3, t, d)).connect(o);
  } },
  // --- Boden: Wall und Vegetation ---
  { id: 'grille', category: 'ground', duration: [0.4, 0.8], build: (c, o, t, _d, p) => pulses(c, o, t, 4, 0.034, 4500 * p, 0.018) },
  { id: 'triller', category: 'ground', duration: [0.6, 1.2], build: (c, o, t, d, p) => {
    const n = Math.round(d * 55);
    pulses(c, o, t, n, 1 / 55, 6100 * p, 0.009);
  } },
  { id: 'zikade', category: 'ground', duration: [0.8, 1.6], build: (c, o, t, d, p, n) => noiseSrc(c, n, t, d).connect(filt(c, 'bandpass', 5000 * p, 6)).connect(trem(c, 120, 0.8, t, d)).connect(o) },
  { id: 'schnarren', category: 'ground', duration: [0.5, 1.0], build: (c, o, t, d, p, n) => noiseSrc(c, n, t, d).connect(filt(c, 'bandpass', 3000 * p, 3)).connect(trem(c, 18, 0.9, t, d)).connect(o) },
  { id: 'klickkaefer', category: 'ground', duration: [0.3, 0.6], build: (c, o, t, _d, p, n) => clicks(c, o, t, 3 + Math.floor(Math.random() * 4), 0.07, 2500 * p, n) },
  { id: 'zikadenticks', category: 'ground', duration: [0.4, 0.9], build: (c, o, t, _d, p, n) => clicks(c, o, t, 10, 0.035, 1200 * p, n) },
  { id: 'gluehfunke', category: 'ground', duration: [0.25, 0.4], build: (c, o, t, _d, p) => pulses(c, o, t, 2, 0.09, 7000 * p, 0.03) },
  // --- weitere Insekten (insgesamt ≥ 20) ---
  { id: 'hornisse', category: 'flyby', duration: [1.0, 1.8], build: (c, o, t, d, p) => osc(c, 'sawtooth', 150 * p, t, d).connect(filt(c, 'bandpass', 700 * p, 2)).connect(trem(c, 35, 0.35, t, d)).connect(o) },
  { id: 'schwebfliege', category: 'flyby', duration: [1.4, 2.4], build: (c, o, t, d, p) => {
    const s = osc(c, 'triangle', 330 * p, t, d);
    const g = c.createGain();
    // Schweben mit Aussetzern: Lautstärke springt zwischen an/aus
    g.gain.setValueAtTime(0.9, t);
    for (let k = 0.3; k < d; k += 0.35 + Math.random() * 0.3) g.gain.setTargetAtTime(Math.random() < 0.35 ? 0.1 : 0.9, t + k, 0.03);
    s.connect(filt(c, 'bandpass', 1500, 2)).connect(trem(c, 55, 0.3, t, d)).connect(g).connect(o);
  } },
  { id: 'brummer', category: 'flyby', duration: [1.6, 2.6], build: (c, o, t, d, p) => osc(c, 'square', 95 * p, t, d).connect(filt(c, 'lowpass', 500, 1)).connect(trem(c, 22, 0.4, t, d)).connect(o) },
  { id: 'grillentriller', category: 'ground', duration: [1.0, 1.8], build: (c, o, t, d, p) => pulses(c, o, t, Math.round(d * 28), 1 / 28, 4200 * p, 0.022) },
  { id: 'rhythmusklicker', category: 'ground', duration: [0.8, 1.4], build: (c, o, t, _d, p, n) => {
    for (let k = 0; k < 4; k++) clicks(c, o, t + k * 0.28, 2, 0.05, 1800 * p, n);
  } },
  { id: 'heuschrecke', category: 'ground', duration: [0.5, 0.9], build: (c, o, t, d, p, n) => {
    clicks(c, o, t, 1, 0.01, 900 * p, n); // Sprung-Schnalzen
    noiseSrc(c, n, t + 0.08, d - 0.08).connect(filt(c, 'bandpass', 3600 * p, 4)).connect(trem(c, 24, 0.9, t, d)).connect(o);
  } },
  { id: 'zirpchor', category: 'ground', duration: [0.9, 1.5], build: (c, o, t, _d, p) => {
    for (let k = 0; k < 3; k++) pulses(c, o, t + k * 0.12 + Math.random() * 0.05, 3, 0.03, (4300 + k * 350) * p, 0.016);
  } },
  // --- Pflanzen ---
  { id: 'blubbern', category: 'plant', duration: [0.4, 0.9], build: (c, o, t, d, p) => {
    for (let k = 0; k < 3; k++) {
      const st = t + k * (d / 3) + Math.random() * 0.05;
      const s = osc(c, 'sine', 380 * p, st, 0.12);
      s.frequency.exponentialRampToValueAtTime(160 * p, st + 0.1);
      const g = c.createGain();
      g.gain.setValueAtTime(0, st);
      g.gain.linearRampToValueAtTime(0.7, st + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.12);
      s.connect(g).connect(o);
    }
  } },
  { id: 'ploppen', category: 'plant', duration: [0.2, 0.3], build: (c, o, t, _d, p) => {
    const s = osc(c, 'sine', 700 * p, t, 0.1);
    s.frequency.exponentialRampToValueAtTime(220 * p, t + 0.08);
    const g = c.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    s.connect(g).connect(o);
  } },
  { id: 'rascheln', category: 'plant', duration: [0.6, 1.2], build: (c, o, t, d, p, n) => noiseSrc(c, n, t, d).connect(filt(c, 'highpass', 2500 * p, 0.7)).connect(trem(c, 9, 0.8, t, d)).connect(o) },
  { id: 'knistern', category: 'plant', duration: [0.5, 1.0], build: (c, o, t, d, p, n) => clicks(c, o, t, Math.round(d * 18), d / Math.round(d * 18), 3500 * p, n) },
  { id: 'sporenpuff', category: 'plant', duration: [0.4, 0.6], build: (c, o, t, d, p, n) => {
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.8, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + d);
    noiseSrc(c, n, t, d).connect(filt(c, 'lowpass', 900 * p, 0.8)).connect(g).connect(o);
  } },
  // --- Tropfen von den Pilzhüten ---
  { id: 'tropfen', category: 'drip', duration: [0.15, 0.25], build: (c, o, t, _d, p) => {
    const s = osc(c, 'sine', 1900 * p, t, 0.08);
    s.frequency.exponentialRampToValueAtTime(900 * p, t + 0.06);
    const g = c.createGain();
    g.gain.setValueAtTime(0.8, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    s.connect(g).connect(o);
  } },
  // --- ferne, melodisch-komische Alien-Rufe ---
  { id: 'wuu-ip', category: 'call', duration: [0.8, 1.2], build: (c, o, t, d, p) => {
    const s = osc(c, 'sine', 300 * p, t, d);
    s.frequency.exponentialRampToValueAtTime(220 * p, t + d * 0.4);
    s.frequency.exponentialRampToValueAtTime(700 * p, t + d);
    const v = osc(c, 'sine', 7, t, d);
    const vg = c.createGain();
    vg.gain.value = 15;
    v.connect(vg).connect(s.frequency);
    s.connect(o);
  } },
  { id: 'boing', category: 'call', duration: [0.6, 0.9], build: (c, o, t, d, p) => {
    const s = osc(c, 'triangle', 180 * p, t, d);
    s.frequency.setValueAtTime(180 * p, t);
    s.frequency.exponentialRampToValueAtTime(520 * p, t + 0.12);
    s.frequency.exponentialRampToValueAtTime(260 * p, t + d);
    const m = osc(c, 'sine', 11, t, d);
    const mg = c.createGain();
    mg.gain.value = 40;
    m.connect(mg).connect(s.frequency);
    s.connect(o);
  } },
  { id: 'gurren', category: 'call', duration: [1.0, 1.4], build: (c, o, t, d, p) => {
    for (let k = 0; k < 3; k++) {
      const st = t + k * (d / 3);
      const s = osc(c, 'sine', (420 - k * 40) * p, st, d / 3);
      s.frequency.exponentialRampToValueAtTime((360 - k * 40) * p, st + d / 3);
      const g = c.createGain();
      g.gain.setValueAtTime(0, st);
      g.gain.linearRampToValueAtTime(0.8, st + 0.05);
      g.gain.linearRampToValueAtTime(0, st + d / 3);
      s.connect(g).connect(o);
    }
  } },
  { id: 'trillerflöte', category: 'call', duration: [0.9, 1.3], build: (c, o, t, d, p) => {
    const s = osc(c, 'sine', 900 * p, t, d);
    for (let k = 0; k < 6; k++) s.frequency.setValueAtTime((900 + (k % 2) * 180 + k * 40) * p, t + (k * d) / 6);
    s.connect(o);
  } },
];

export function recipesFor(cat: CreatureCategory): Recipe[] {
  return RECIPES.filter((r) => r.category === cat);
}

/**
 * „Tag-Nacht-artige“ Intensität 0,3–1: schwankt langsam über mehrere Minuten
 * (zwei überlagerte langsame Wellen, Perioden 5 und ~7,8 min).
 */
export function chorusIntensity(seconds: number): number {
  const v = 0.6 + 0.25 * Math.sin((seconds / 300) * Math.PI * 2 + 1.3) + 0.15 * Math.sin((seconds / 470) * Math.PI * 2 + 4.1);
  return Math.min(1, Math.max(0.3, v));
}

/** Zufälliges Intervall bis zum nächsten Boden-Einzelgeräusch: 1,5–6 s, bei hoher Intensität kürzer. */
export function nextInterval(rnd: number, intensity: number): number {
  const base = 1.5 + rnd * 4.5;
  return Math.min(6, Math.max(1.5, base * (1.25 - 0.5 * intensity)));
}

/** Intervall bis zum nächsten Insekten-Vorbeiflug: 0,5–3 s, bei hoher Intensität dichter. */
export function nextFlybyInterval(rnd: number, intensity: number): number {
  const base = 0.5 + rnd * 2.5;
  return Math.min(3, Math.max(0.5, base * (1.3 - 0.6 * intensity)));
}

/** Insekten-Rezepte (Vorbeiflug + Boden) – Vorgabe: mindestens 20. */
export const INSECT_RECIPES = (): Recipe[] => RECIPES.filter((r) => r.category === 'flyby' || r.category === 'ground');
