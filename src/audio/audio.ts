import type { I18nKey } from '../ui/i18n';
import { BED_SAMPLE_RATE, type CreatureCategory, chorusIntensity, generateBedLoop, recipesFor } from './insectSounds';

/**
 * Prozeduraler Klang mit Web Audio – keine Audio-Assets nötig (Ladezeit!).
 *  Ambient: gefiltertes Rauschen (Insekten/Wind), tiefes Brummen, zufällige Tierrufe
 *           aus wechselnden Richtungen (PannerNode → räumlich in VR).
 *  Effekte: Zug, Schlag, Schach, ungültig, Spielende – jeweils mit Untertitel-Schlüssel.
 */
export type Sfx = 'move' | 'capture' | 'check' | 'illegal' | 'end' | 'pickup';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private ambientGain!: GainNode;
  /** Insekten-Bus (Schalter „Insekten aus“) – hängt am Umgebungs-Bus. */
  private insectGain!: GainNode;
  private creaturesVolume = 0.6;
  private insectsOn = true;
  /** Pool räumlicher Quellen (8 Panner, max. 6 Insektengeräusche gleichzeitig). */
  private pool: { panner: PannerNode; busyUntil: number; getPos: (() => { x: number; y: number; z: number }) | null }[] = [];
  static readonly MAX_CREATURE_VOICES = 6;
  static readonly POOL_SIZE = 8;
  /** Ambient-Bed (Insekten-Klangfläche) – hängt am Insekten-Bus. */
  private bedGain: GainNode | null = null;
  private shortNoise: AudioBuffer | null = null;
  private lastIntensityUpdate = -10;
  private duckUntil = 0;
  private callTimer = 0;
  private volume = 0.7;
  muted = false;
  onSubtitle: ((key: I18nKey) => void) | null = null;

  /** Muss aus einer Nutzergeste heraus aufgerufen werden (Autoplay-Regeln). */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.ctx.destination);
    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.value = 0;
    this.ambientGain.connect(this.master);
    this.ambientGain.gain.linearRampToValueAtTime(this.creaturesVolume * 0.9, this.ctx.currentTime + 4);
    this.insectGain = this.ctx.createGain();
    this.insectGain.gain.value = this.insectsOn ? 1 : 0;
    this.insectGain.connect(this.ambientGain);
    for (let i = 0; i < AudioEngine.POOL_SIZE; i++) {
      const panner = this.ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1;
      panner.rolloffFactor = 1.3;
      panner.maxDistance = 30;
      panner.connect(this.insectGain); // Einzelgeräusche über den Insekten-Bus (Schalter „Insekten aus“)
      this.pool.push({ panner, busyUntil: 0, getPos: null });
    }
    this.buildAmbient();
    this.onSubtitle?.('sfx.ambient');
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.1);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.setVolume(this.volume);
  }

  private noiseBuffer(seconds: number, brown = false): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  private buildAmbient(): void {
    const ctx = this.ctx!;
    // Wind/Blätter: braunes Rauschen, langsam modulierter Tiefpass
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuffer(6, true);
    wind.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 250;
    lfo.connect(lfoGain).connect(lp.frequency);
    const wg = ctx.createGain();
    wg.gain.value = 0.35;
    wind.connect(lp).connect(wg).connect(this.ambientGain);
    wind.start();
    lfo.start();

    // Insekten-Klangfläche (Ambient-Bed): drei nahtlose Stereo-Loops unterschiedlicher Länge,
    // nacheinander erzeugt (je ein Schritt pro Tick → kein Ruckeln beim Start)
    this.bedGain = ctx.createGain();
    this.bedGain.gain.value = 0;
    this.bedGain.connect(this.insectGain);
    this.shortNoise = this.noiseBuffer(2);
    const loops: ['crickets' | 'hum' | 'trills', number, number][] = [['crickets', 64, 0.9], ['hum', 23, 0.8], ['trills', 37, 0.7]];
    loops.forEach(([kind, sec, gain], i) => {
      window.setTimeout(() => {
        if (!this.ctx || !this.bedGain) return;
        const loop = generateBedLoop(kind, sec, 11 + i);
        const buf = this.ctx.createBuffer(2, loop.left.length, BED_SAMPLE_RATE);
        buf.copyToChannel(loop.left as Float32Array<ArrayBuffer>, 0);
        buf.copyToChannel(loop.right as Float32Array<ArrayBuffer>, 1);
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const g = this.ctx.createGain();
        g.gain.value = gain;
        src.connect(g).connect(this.bedGain);
        src.start(this.ctx.currentTime + 0.05, Math.random() * sec);
        if (i === 0) this.bedGain.gain.setTargetAtTime(0.9, this.ctx.currentTime, 2);
      }, 400 + i * 350);
    });

    // Tiefes Brummen: zwei leicht verstimmte Sinus + Oberton
    for (const [f, g] of [[48, 0.12], [48.7, 0.1], [96.3, 0.03]] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(this.ambientGain);
      o.start();
    }
    this.scheduleCall();
  }

  /** Ferne Tierrufe aus zufälliger Richtung (räumlich). */
  private scheduleCall(): void {
    const delay = 4000 + Math.random() * 9000;
    this.callTimer = window.setTimeout(() => {
      if (this.ctx && this.ctx.state === 'running') this.animalCall();
      this.scheduleCall();
    }, delay);
  }

  private animalCall(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 5;
    const a = Math.random() * Math.PI * 2;
    const r = 15 + Math.random() * 25;
    panner.positionX.value = Math.cos(a) * r;
    panner.positionY.value = 2 + Math.random() * 6;
    panner.positionZ.value = Math.sin(a) * r;
    panner.connect(this.ambientGain);
    const kind = Math.floor(Math.random() * 3);
    const notes = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = kind === 2 ? 'triangle' : 'sine';
      const st = t + i * (0.18 + Math.random() * 0.1);
      const base = kind === 0 ? 900 : kind === 1 ? 420 : 1600;
      o.frequency.setValueAtTime(base * (1 + Math.random() * 0.2), st);
      o.frequency.exponentialRampToValueAtTime(base * (kind === 1 ? 0.6 : 1.8), st + 0.15);
      g.gain.setValueAtTime(0, st);
      g.gain.linearRampToValueAtTime(0.18, st + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.22);
      o.connect(g).connect(panner);
      o.start(st);
      o.stop(st + 0.25);
    }
  }

  /** Zuhörerposition (VR-Kopf) für räumliche Quellen. */
  /** Zuhörer = Kopf/Kamera (pro Frame). Aktualisiert auch die Positionen bewegter Quellen. */
  setListener(pos: { x: number; y: number; z: number }, fwd: { x: number; y: number; z: number }, up: { x: number; y: number; z: number }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos.x;
      l.positionY.value = pos.y;
      l.positionZ.value = pos.z;
      l.forwardX.value = fwd.x;
      l.forwardY.value = fwd.y;
      l.forwardZ.value = fwd.z;
      l.upX.value = up.x;
      l.upY.value = up.y;
      l.upZ.value = up.z;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
    this.updateDynamics();
    for (const v of this.pool) {
      if (!v.getPos || v.busyUntil < ctx.currentTime) continue;
      const p = v.getPos();
      v.panner.positionX.value = p.x;
      v.panner.positionY.value = p.y;
      v.panner.positionZ.value = p.z;
    }
  }

  /** Lautstärke „Tiere / Umgebung“ und Schalter „Insekten aus“. */
  setCreatures(volume: number, insectsOn: boolean): void {
    this.creaturesVolume = volume;
    this.insectsOn = insectsOn;
    if (!this.ctx) return;
    this.ambientGain.gain.setTargetAtTime(volume * 0.9, this.ctx.currentTime, 0.2);
    this.insectGain.gain.setTargetAtTime(insectsOn ? 1 : 0, this.ctx.currentTime, 0.2);
  }

  /** Aktuelle Chor-Intensität (0,3–1), schwankt langsam über Minuten. */
  intensity(): number {
    return this.ctx ? chorusIntensity(this.ctx.currentTime) : 0.6;
  }

  /** Langsame Dynamik des Ambient-Beds + Ende des Duckings (aus der Frame-Schleife aufgerufen). */
  private updateDynamics(): void {
    const ctx = this.ctx;
    if (!ctx || !this.bedGain) return;
    if (ctx.currentTime - this.lastIntensityUpdate < 0.5) return;
    this.lastIntensityUpdate = ctx.currentTime;
    this.bedGain.gain.setTargetAtTime(0.35 + 0.65 * this.intensity(), ctx.currentTime, 3);
    if (this.duckUntil && ctx.currentTime > this.duckUntil) {
      this.duckUntil = 0;
      this.ambientGain.gain.setTargetAtTime(this.creaturesVolume * 0.9, ctx.currentTime, 0.4);
    }
  }

  /** Spielsound ertönt → Umgebung/Insekten um ~30 % absenken (Ducking), danach sanft zurück. */
  private duck(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.ambientGain.gain.setTargetAtTime(this.creaturesVolume * 0.9 * 0.7, ctx.currentTime, 0.05);
    this.duckUntil = ctx.currentTime + 1.2;
  }

  /**
   * Räumliches Insektengeräusch an einer (bewegten) Position. Zufälliges Rezept der Kategorie,
   * Tonhöhe ±12 %, Lautstärke variiert. Nutzt den Panner-Pool (8); höchstens 6 gleichzeitig.
   * Pegel deutlich unter den Spielgeräuschen.
   */
  playCreature(category: CreatureCategory, getPos: () => { x: number; y: number; z: number }): boolean {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.insectsOn || !this.shortNoise) return false;
    const now = ctx.currentTime;
    const active = this.pool.filter((v) => v.busyUntil > now).length;
    const voice = this.pool.find((v) => v.busyUntil <= now);
    if (!voice || active >= AudioEngine.MAX_CREATURE_VOICES) return false;
    const list = recipesFor(category);
    const r = list[Math.floor(Math.random() * list.length)];
    const dur = r.duration[0] + Math.random() * (r.duration[1] - r.duration[0]);
    const pitch = 1 + (Math.random() * 2 - 1) * 0.12;
    const vol = (category === 'ground' ? 0.06 : 0.09) * (0.6 + Math.random() * 0.6);
    voice.busyUntil = now + dur + 0.2;
    voice.getPos = getPos;
    const p0 = getPos();
    voice.panner.positionX.value = p0.x;
    voice.panner.positionY.value = p0.y;
    voice.panner.positionZ.value = p0.z;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(vol, now + Math.min(0.3, dur * 0.3));
    out.gain.setValueAtTime(vol, now + dur * 0.7);
    out.gain.linearRampToValueAtTime(0, now + dur);
    out.connect(voice.panner);
    r.build(ctx, out, now, dur, pitch, this.shortNoise);
    return true;
  }

  play(sfx: Sfx): void {
    this.onSubtitle?.(`sfx.${sfx}` as I18nKey);
    const ctx = this.ctx;
    if (!ctx) return;
    this.duck();
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.connect(this.master);
    const tone = (freq: number, start: number, dur: number, gain: number, type: OscillatorType = 'sine', glideTo?: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t + start);
      if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + start + dur);
      g.gain.setValueAtTime(0, t + start);
      g.gain.linearRampToValueAtTime(gain, t + start + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0008, t + start + dur);
      o.connect(g).connect(out);
      o.start(t + start);
      o.stop(t + start + dur + 0.05);
    };
    const noise = (start: number, dur: number, gain: number, freq: number) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noiseBuffer(dur + 0.05);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t + start);
      g.gain.exponentialRampToValueAtTime(0.001, t + start + dur);
      s.connect(f).connect(g).connect(out);
      s.start(t + start);
    };
    switch (sfx) {
      case 'move': // schwerer Stein setzt auf
        tone(110, 0, 0.25, 0.5, 'sine', 60);
        noise(0, 0.08, 0.35, 1800);
        break;
      case 'capture': // Sporen-Glitzern
        noise(0, 0.12, 0.25, 1200);
        [880, 1175, 1568, 2093, 2637].forEach((f, i) => tone(f, 0.04 + i * 0.05, 0.6, 0.08, 'triangle'));
        break;
      case 'check': // Glocke
        [220, 440, 553, 660, 880].forEach((f, i) => tone(f, 0, 1.6 - i * 0.2, 0.18 / (i + 1)));
        break;
      case 'illegal':
        tone(140, 0, 0.18, 0.35, 'square', 90);
        break;
      case 'pickup': // leises „Plopp“ mit Sporen-Glitzern beim Greifen
        tone(620, 0, 0.09, 0.18, 'sine', 300);
        tone(2400, 0.02, 0.12, 0.03, 'triangle');
        break;
      case 'end':
        [261.6, 329.6, 392, 523.3].forEach((f, i) => tone(f, i * 0.12, 2.8, 0.12, 'sine'));
        break;
    }
  }

  dispose(): void {
    clearTimeout(this.callTimer);
    void this.ctx?.close();
    this.ctx = null;
  }
}
