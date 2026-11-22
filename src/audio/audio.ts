import type { I18nKey } from '../ui/i18n';
import {
  BED_SAMPLE_RATE,
  type CreatureCategory,
  chorusIntensity,
  collectPitch,
  generateBedLoop,
  pickRecipe,
  recipesFor,
} from './insectSounds';
import { PRIORITY_WEIGHT, type V3, chooseVoice, dopplerCents, flybyPath, lerp3 } from './mix';

/**
 * Prozedurale Klangwelt mit Web Audio (keine Audio-Dateien).
 *
 * Busse (getrennt regelbar):
 *   master ─┬─ sfx        „Spiel-Sounds“ (Zug, Schach, UI) – hat immer Vorrang
 *           ├─ ambience   „Umgebung“: Wind/Böen, Dschungel-Teppich, Pflanzen, Tropfen, Pilz-Summen
 *           └─ creatures  „Tiere / Insekten“: ferne Rufe ─ insects (Schalter „Insekten aus“):
 *                         Insekten-Klangfläche, Vorbeiflüge, Zirpen
 * Ducking: Spielsound → Umgebung und Tiere um ~35 % leiser. Vor einem fernen Ruf kurz Stille.
 * Räumlich: Pool aus 12 HRTF-Pannern mit Priorität (nahe vor fern), dazu 3 feste Stimmen für das
 * Summen der nächstgelegenen Riesenpilze.
 */
export type Sfx = 'move' | 'capture' | 'check' | 'illegal' | 'end' | 'pickup';

interface Voice {
  panner: PannerNode;
  busyUntil: number;
  dist: number;
  getPos: (() => V3) | null;
  out: GainNode | null;
}

export interface SoundSpots {
  bubbles: V3[];
  vines: V3[];
  giants: V3[];
  drips: V3[];
  leaves: V3[];
}

export interface Mix {
  master: number;
  sfx: number;
  ambience: number;
  creatures: number;
  insects: boolean;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private ambienceBus!: GainNode;
  private creaturesBus!: GainNode;
  private insectBus!: GainNode;
  private bedGain: GainNode | null = null;
  private gustGain: GainNode | null = null;
  private shortNoise: AudioBuffer | null = null;
  private pool: Voice[] = [];
  private hums: { panner: PannerNode; gain: GainNode }[] = [];
  /** 3 feste Stimmen für das Brummen der nächsten Brummer */
  private brummer: { panner: PannerNode; gain: GainNode; pos: V3 | null }[] = [];
  private glugActive: number[] = [];
  private mix: Mix = { master: 0.7, sfx: 0.9, ambience: 0.6, creatures: 0.6, insects: true };
  private duckFactor = 1;
  private duckUntil = 0;
  private silenceUntil = 0;
  private listener: V3 = { x: 0, y: 1.6, z: 0 };
  private spots: SoundSpots = { bubbles: [], vines: [], giants: [], drips: [], leaves: [] };
  private timers = { plant: 3, drip: 4, call: 25, gust: 6, hum: 0, dyn: 0 };
  private lastTick = 0;
  private wind = 0;
  private gustUntil = 0;
  static readonly POOL_SIZE = 12;
  static readonly MAX_INSECT_VOICES = 8;
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
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.ambienceBus = ctx.createGain();
    this.creaturesBus = ctx.createGain();
    this.insectBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.ambienceBus.connect(this.master);
    this.creaturesBus.connect(this.master);
    this.insectBus.connect(this.creaturesBus);
    this.ambienceBus.gain.value = 0;
    this.creaturesBus.gain.value = 0;
    this.applyMix(4); // sanft einblenden
    for (let i = 0; i < AudioEngine.POOL_SIZE; i++) {
      const panner = this.makePanner(1, 1.3);
      this.pool.push({ panner, busyUntil: 0, dist: 0, getPos: null, out: null });
    }
    this.shortNoise = this.noiseBuffer(2);
    this.buildAmbience();
    this.buildInsectBed();
    this.buildHums();
    this.buildBrummer();
    this.onSubtitle?.('sfx.ambient');
  }

  private makePanner(ref: number, rolloff: number): PannerNode {
    const p = this.ctx!.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = rolloff;
    p.maxDistance = 60;
    return p;
  }

  // ---------- Lautstärken ----------

  setMix(m: Partial<Mix>): void {
    this.mix = { ...this.mix, ...m };
    this.applyMix(0.2);
  }

  /** Kompatibel zur bisherigen API. */
  setVolume(v: number): void {
    this.setMix({ master: v });
  }
  setCreatures(volume: number, insectsOn: boolean): void {
    this.setMix({ creatures: volume, insects: insectsOn });
  }
  setMuted(m: boolean): void {
    this.muted = m;
    this.applyMix(0.1);
  }

  private applyMix(time: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const silent = t < this.silenceUntil ? 0.25 : 1;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.mix.master, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(this.mix.sfx, t, 0.05);
    this.ambienceBus.gain.setTargetAtTime(this.mix.ambience * this.duckFactor * (0.6 + 0.4 * silent), t, time);
    this.creaturesBus.gain.setTargetAtTime(this.mix.creatures * this.duckFactor * silent, t, time);
    this.insectBus.gain.setTargetAtTime(this.mix.insects ? 1 : 0, t, 0.2);
  }

  private noiseBuffer(seconds: number, brown = false): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
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

  // ---------- Grundteppich ----------

  private buildAmbience(): void {
    const ctx = this.ctx!;
    // Wind: braunes Rauschen, Tiefpass; Böen heben Pegel und Rauschen in den Riesenblättern an
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuffer(6, true);
    wind.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const wg = ctx.createGain();
    wg.gain.value = 0.09; // deutlich leiser als zuvor (0,3)
    wind.connect(lp).connect(wg).connect(this.ambienceBus);
    wind.start();
    // Blätterrauschen der Böen (Bandpass), Pegel folgt der Böen-Hüllkurve
    const leaves = ctx.createBufferSource();
    leaves.buffer = this.noiseBuffer(4);
    leaves.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1300;
    bp.Q.value = 0.6;
    this.gustGain = ctx.createGain();
    this.gustGain.gain.value = 0;
    leaves.connect(bp).connect(this.gustGain).connect(this.ambienceBus);
    leaves.start();
    // tiefes Brummen der Welt
    for (const [f, g] of [[48, 0.08], [48.7, 0.07], [96.3, 0.02]] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(this.ambienceBus);
      o.start();
    }
  }

  /** Dichte, leise Insekten-/Dschungel-Klangfläche: drei nahtlose Loops unterschiedlicher Länge. */
  private buildInsectBed(): void {
    const ctx = this.ctx!;
    this.bedGain = ctx.createGain();
    this.bedGain.gain.value = 0;
    // Grundteppich durch einen Tiefpass (7 kHz): nimmt Zischeln/Hiss heraus, Zirpen bleibt erhalten
    const bedLp = ctx.createBiquadFilter();
    bedLp.type = 'lowpass';
    bedLp.frequency.value = 7000;
    bedLp.Q.value = 0.5;
    this.bedGain.connect(bedLp).connect(this.insectBus);
    const ambLp = ctx.createBiquadFilter();
    ambLp.type = 'lowpass';
    ambLp.frequency.value = 6500;
    ambLp.connect(this.ambienceBus);
    const loops: ['crickets' | 'hum' | 'trills', number, number, AudioNode][] = [
      ['crickets', 64, 1.0, this.bedGain],
      ['hum', 23, 0.7, ambLp], // Summen = Dschungel-Teppich (Umgebung), ebenfalls tiefpassgefiltert
      ['trills', 37, 0.8, this.bedGain],
    ];
    loops.forEach(([kind, sec, gain, dest], i) => {
      window.setTimeout(() => {
        if (!this.ctx) return;
        const loop = generateBedLoop(kind, sec, 11 + i);
        const buf = this.ctx.createBuffer(2, loop.left.length, BED_SAMPLE_RATE);
        buf.copyToChannel(loop.left as Float32Array<ArrayBuffer>, 0);
        buf.copyToChannel(loop.right as Float32Array<ArrayBuffer>, 1);
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const g = this.ctx.createGain();
        g.gain.value = gain;
        src.connect(g).connect(dest);
        src.start(this.ctx.currentTime + 0.05, Math.random() * sec);
        if (i === 0 && this.bedGain) this.bedGain.gain.setTargetAtTime(0.9, this.ctx.currentTime, 2);
      }, 400 + i * 350);
    });
  }

  /** Drei feste Stimmen: leises, tiefes Summen der nächsten Riesenpilze (nur in deren Nähe hörbar). */
  private buildHums(): void {
    const ctx = this.ctx!;
    for (let i = 0; i < 3; i++) {
      const panner = this.makePanner(1.2, 2.2);
      panner.connect(this.ambienceBus);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      for (const [f, a] of [[58 + i * 7, 0.12], [116 + i * 14, 0.04], [174 + i * 21, 0.015]] as const) {
        const o = ctx.createOscillator();
        o.frequency.value = f;
        const og = ctx.createGain();
        og.gain.value = a;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.15 + i * 0.07;
        const lg = ctx.createGain();
        lg.gain.value = a * 0.5;
        lfo.connect(lg).connect(og.gain);
        o.connect(og).connect(gain);
        o.start();
        lfo.start();
      }
      gain.connect(panner);
      this.hums.push({ panner, gain });
    }
  }

  /** Tiefes, samtiges Brummen (Sägezahn tief gefiltert, langsames Tremolo) – je Brummer in der Nähe eine Stimme. */
  private buildBrummer(): void {
    const ctx = this.ctx!;
    for (let i = 0; i < 3; i++) {
      const panner = this.makePanner(0.6, 2.4);
      panner.connect(this.insectBus);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 92 + i * 11;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      const trem = ctx.createGain();
      trem.gain.value = 0.7;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 18 + i * 3;
      const lg = ctx.createGain();
      lg.gain.value = 0.3;
      lfo.connect(lg).connect(trem.gain);
      o.connect(lp).connect(trem).connect(gain).connect(panner);
      o.start();
      lfo.start();
      this.brummer.push({ panner, gain, pos: null });
    }
  }

  /** Positionen der nächsten Brummer (≤ 3); Stimmen schwellen sanft an bzw. klingen ab. */
  setBrummers(list: V3[]): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.brummer.forEach((b, i) => {
      const p = list[i];
      if (p && this.mix.insects) {
        b.panner.positionX.value = p.x;
        b.panner.positionY.value = p.y;
        b.panner.positionZ.value = p.z;
        if (!b.pos) b.gain.gain.setTargetAtTime(0.07, now, 0.6); // sanft anschwellen
        b.pos = p;
      } else if (b.pos) {
        b.gain.gain.setTargetAtTime(0, now, 0.8); // sanft abklingen
        b.pos = null;
      }
    });
  }

  /**
   * Gluckern einer Lavalampen-Blase an ihrer Position (tief, weich, deutlich leiser als Insekten,
   * stark gedämpft mit der Entfernung). Höchstens 2 gleichzeitig.
   */
  playGlug(pos: V3, soft: boolean): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const now = ctx.currentTime;
    this.glugActive = this.glugActive.filter((t) => t > now);
    if (this.glugActive.length >= 2) return false;
    const res = this.playAt('glug', () => pos, soft ? 0.02 : 0.035, this.ambienceBus, 0.8, undefined, 2.6);
    if (res) this.glugActive.push(now + res.dur);
    return !!res;
  }

  setSoundSpots(s: SoundSpots): void {
    this.spots = s;
  }

  /** Windstärke 0..1 (Böen) – synchronisiert das Wiegen der Vegetation. */
  windLevel(): number {
    return this.wind;
  }

  intensity(): number {
    return this.ctx ? chorusIntensity(this.ctx.currentTime) : 0.6;
  }

  // ---------- Frame ----------

  /** Zuhörer = Kopf/Kamera (pro Frame). Bewegt räumliche Quellen und taktet die Umgebungs-Ebenen. */
  setListener(pos: V3, fwd: V3, up: V3): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.listener = { x: pos.x, y: pos.y, z: pos.z };
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
    for (const v of this.pool) {
      if (!v.getPos || v.busyUntil < ctx.currentTime) continue;
      const p = v.getPos();
      v.panner.positionX.value = p.x;
      v.panner.positionY.value = p.y;
      v.panner.positionZ.value = p.z;
    }
    const now = ctx.currentTime;
    const dt = Math.min(0.25, Math.max(0, now - this.lastTick));
    this.lastTick = now;
    this.tick(dt, now);
  }

  private near(list: V3[], maxDist: number): V3 | null {
    const c = list.filter((p) => Math.hypot(p.x - this.listener.x, p.z - this.listener.z) < maxDist);
    return c.length ? c[Math.floor(Math.random() * c.length)] : null;
  }

  private tick(dt: number, now: number): void {
    const T = this.timers;
    const k = this.intensity();
    // Dynamik (Dichte schwankt über Minuten) + Ende von Ducking/Stille
    if ((T.dyn -= dt) <= 0) {
      T.dyn = 0.5;
      this.bedGain?.gain.setTargetAtTime(0.3 + 0.7 * k, now, 3);
      if (this.duckUntil && now > this.duckUntil) {
        this.duckUntil = 0;
        this.duckFactor = 1;
        this.applyMix(0.5);
      }
      if (this.silenceUntil && now > this.silenceUntil) {
        this.silenceUntil = 0;
        this.applyMix(0.8);
      }
    }
    // Böen: selten (alle 25–60 s) und leise, 2 s an, 2–4 s halten, 3 s aus
    if ((T.gust -= dt) <= 0) {
      T.gust = 25 + Math.random() * 35;
      const hold = 2 + Math.random() * 2;
      this.gustUntil = now + 2 + hold;
      this.gustGain?.gain.setTargetAtTime(0.05 + 0.04 * Math.random(), now, 0.8);
      this.gustGain?.gain.setTargetAtTime(0, now + 2 + hold, 1.2);
    }
    const targetWind = now < this.gustUntil ? 1 : 0;
    this.wind += (targetWind - this.wind) * Math.min(1, dt * (targetWind ? 0.8 : 0.4));
    // Pflanzen: Blubbern/Ploppen der Blasen, Rascheln/Knistern in Ranken, Sporen-Puff
    if ((T.plant -= dt) <= 0) {
      T.plant = (2 + Math.random() * 4) / (0.6 + 0.6 * k);
      const r = Math.random();
      const spot = r < 0.45 ? this.near(this.spots.bubbles, 9) : r < 0.85 ? this.near(this.spots.vines, 9) : this.near(this.spots.leaves, 9);
      if (spot) this.playAt('plant', () => spot, 0.07, this.ambienceBus);
    }
    // Tropfen von den Pilzhüten
    if ((T.drip -= dt) <= 0) {
      T.drip = 3 + Math.random() * 7;
      const spot = this.near(this.spots.drips, 10);
      if (spot) this.playAt('drip', () => spot, 0.05, this.ambienceBus);
    }
    // Ferne Alien-Rufe (außerhalb der Senke), vorher ein kurzer Moment der Stille
    if ((T.call -= dt) <= 0) {
      T.call = 20 + Math.random() * 40;
      this.silenceUntil = now + 1.6;
      this.applyMix(0.4);
      window.setTimeout(() => {
        if (!this.ctx) return;
        const a = Math.random() * Math.PI * 2;
        const r = 26 + Math.random() * 16;
        const pos = { x: this.listener.x + Math.cos(a) * r, y: 3 + Math.random() * 5, z: this.listener.z + Math.sin(a) * r };
        this.playAt('call', () => pos, 0.16, this.creaturesBus, 6);
      }, 1300);
    }
    // Pilz-Summen: die drei festen Stimmen an die nächsten Riesenpilze hängen
    if ((T.hum -= dt) <= 0) {
      T.hum = 2;
      const sorted = [...this.spots.giants].sort((p, q) => Math.hypot(p.x - this.listener.x, p.z - this.listener.z) - Math.hypot(q.x - this.listener.x, q.z - this.listener.z));
      this.hums.forEach((h, i) => {
        const g = sorted[i];
        if (!g) return h.gain.gain.setTargetAtTime(0, now, 1);
        h.panner.positionX.value = g.x;
        h.panner.positionY.value = g.y;
        h.panner.positionZ.value = g.z;
        h.gain.gain.setTargetAtTime(0.5, now, 1.5);
      });
    }
  }

  // ---------- Räumliche Einzelklänge ----------

  private dist(p: V3): number {
    return Math.hypot(p.x - this.listener.x, p.y - this.listener.y, p.z - this.listener.z);
  }

  /**
   * Spielt ein zufälliges Rezept der Kategorie an einer (ggf. bewegten) Position. Stimmenvergabe mit
   * Priorität (nahe Klänge verdrängen ferne). Gibt die Detune-Parameter zurück (für Doppler) oder null.
   */
  private playAt(category: CreatureCategory, getPos: () => V3, vol: number, bus: GainNode, refDist = 1, durOverride?: number, rolloff = 1.3): { params: AudioParam[]; start: number; dur: number } | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.shortNoise) return null;
    const now = ctx.currentTime;
    const p0 = getPos();
    // Priorität: Abstand × Gewicht der Klangart (nahe Insekten vor Blasen vor Fernem)
    const d0 = this.dist(p0) * (PRIORITY_WEIGHT[category] ?? 1);
    const insect = category === 'flyby' || category === 'ground';
    if (insect && !this.mix.insects) return null;
    // Insekten: höchstens 8 gleichzeitig; insgesamt höchstens 12 (Pool)
    const insectActive = this.pool.filter((v, i) => v.busyUntil > now && this.voiceIsInsect[i]).length;
    const cap = insect && insectActive >= AudioEngine.MAX_INSECT_VOICES ? insectActive : AudioEngine.POOL_SIZE;
    const vi = chooseVoice(this.pool, now, d0, cap);
    if (vi < 0) return null;
    const voice = this.pool[vi];
    // laufende Stimme übernehmen → sanft ausblenden
    if (voice.busyUntil > now && voice.out) {
      voice.out.gain.cancelScheduledValues(now);
      voice.out.gain.setTargetAtTime(0, now, 0.03);
      const old = voice.out;
      window.setTimeout(() => old.disconnect(), 200);
    }
    const r = pickRecipe(recipesFor(category), Math.random());
    const dur = durOverride ?? r.duration[0] + Math.random() * (r.duration[1] - r.duration[0]);
    const pitch = 1 + (Math.random() * 2 - 1) * 0.12;
    const v = vol * (0.6 + Math.random() * 0.6);
    voice.busyUntil = now + dur + 0.2;
    voice.dist = d0;
    voice.getPos = getPos;
    this.voiceIsInsect[vi] = insect;
    voice.panner.refDistance = refDist;
    voice.panner.rolloffFactor = rolloff;
    voice.panner.disconnect();
    voice.panner.connect(insect ? this.insectBus : bus);
    voice.panner.positionX.value = p0.x;
    voice.panner.positionY.value = p0.y;
    voice.panner.positionZ.value = p0.z;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(v, now + Math.min(0.25, dur * 0.25));
    out.gain.setValueAtTime(v, now + dur * 0.75);
    out.gain.linearRampToValueAtTime(0, now + dur);
    out.connect(voice.panner);
    voice.out = out;
    const { params } = collectPitch(() => r.build(ctx, out, now, dur, pitch, this.shortNoise!));
    return { params, start: now, dur };
  }
  private voiceIsInsect: boolean[] = new Array(AudioEngine.POOL_SIZE).fill(false);

  /** Boden-Insektengeräusch (Zirpen aus Wall/Vegetation) an fester Position. */
  playCreature(category: 'ground' | 'flyby', getPos: () => V3): boolean {
    return !!this.playAt(category, getPos, category === 'ground' ? 0.06 : 0.09, this.insectBus);
  }

  /**
   * Insekten-Vorbeiflug: hörbar von einer Seite zur anderen am Kopf vorbei (≥ 0,8 m), mit
   * Lautstärke-An- und -Abstieg (Abstand), leichtem Doppler. Start nahe einem echten Insekt.
   */
  playFlyby(fwd: V3, nearInsect: V3 | null): boolean {
    const head = { ...this.listener };
    const path = flybyPath(head, fwd, Math.random);
    if (nearInsect) {
      // Bahn dort beginnen lassen, wo gerade ein Insekt fliegt (auf derselben Seite)
      const ds = Math.hypot(nearInsect.x - path.start.x, nearInsect.z - path.start.z);
      const de = Math.hypot(nearInsect.x - path.end.x, nearInsect.z - path.end.z);
      if (de < ds) [path.start, path.end] = [path.end, path.start];
    }
    const dur = 1.4 + Math.random() * 1.2;
    const t0 = this.ctx?.currentTime ?? 0;
    const res = this.playAt('flyby', () => lerp3(path.start, path.end, Math.min(1, ((this.ctx?.currentTime ?? 0) - t0) / dur)), 0.1, this.insectBus, 0.8, dur);
    if (!res) return false;
    const curve = dopplerCents(path.start, path.end, head, dur);
    for (const p of res.params) {
      try {
        p.setValueCurveAtTime(curve, res.start, res.dur);
      } catch {
        /* Param bereits automatisiert – Doppler hier auslassen */
      }
    }
    return true;
  }

  // ---------- Spiel-Sounds ----------

  /** Spielsound ertönt → Umgebung/Tiere um ~35 % absenken (Ducking), danach sanft zurück. */
  private duck(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.duckFactor = 0.65;
    this.duckUntil = ctx.currentTime + 1.2;
    this.applyMix(0.05);
  }

  play(sfx: Sfx): void {
    this.onSubtitle?.(`sfx.${sfx}` as I18nKey);
    const ctx = this.ctx;
    if (!ctx) return;
    this.duck();
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.connect(this.sfxBus);
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
      s.buffer = this.shortNoise;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t + start);
      g.gain.exponentialRampToValueAtTime(0.001, t + start + dur);
      s.connect(f).connect(g).connect(out);
      s.start(t + start);
      s.stop(t + start + dur + 0.05);
    };
    switch (sfx) {
      case 'move':
        tone(110, 0, 0.25, 0.5, 'sine', 60);
        noise(0, 0.08, 0.35, 1800);
        break;
      case 'capture':
        noise(0, 0.12, 0.25, 1200);
        [880, 1175, 1568, 2093, 2637].forEach((f, i) => tone(f, 0.04 + i * 0.05, 0.6, 0.08, 'triangle'));
        break;
      case 'check':
        [220, 440, 553, 660, 880].forEach((f, i) => tone(f, 0, 1.6 - i * 0.2, 0.18 / (i + 1)));
        break;
      case 'illegal':
        tone(140, 0, 0.18, 0.35, 'square', 90);
        break;
      case 'pickup':
        tone(620, 0, 0.09, 0.18, 'sine', 300);
        tone(2400, 0.02, 0.12, 0.03, 'triangle');
        break;
      case 'end':
        [261.6, 329.6, 392, 523.3].forEach((f, i) => tone(f, i * 0.12, 2.8, 0.12, 'sine'));
        break;
    }
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}
