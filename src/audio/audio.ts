import type { I18nKey } from '../ui/i18n';

/**
 * Prozeduraler Klang mit Web Audio – keine Audio-Assets nötig (Ladezeit!).
 *  Ambient: gefiltertes Rauschen (Insekten/Wind), tiefes Brummen, zufällige Tierrufe
 *           aus wechselnden Richtungen (PannerNode → räumlich in VR).
 *  Effekte: Zug, Schlag, Schach, ungültig, Spielende – jeweils mit Untertitel-Schlüssel.
 */
export type Sfx = 'move' | 'capture' | 'check' | 'illegal' | 'end';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private ambientGain!: GainNode;
  /** Insekten-Bus (Schalter „Insekten aus“) – hängt am Umgebungs-Bus. */
  private insectGain!: GainNode;
  private creaturesVolume = 0.6;
  private insectsOn = true;
  /** Pool räumlicher Quellen (max. 5 Panner, max. 3 Insektengeräusche gleichzeitig). */
  private pool: { panner: PannerNode; busyUntil: number; getPos: (() => { x: number; y: number; z: number }) | null }[] = [];
  static readonly MAX_CREATURE_VOICES = 3;
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
    for (let i = 0; i < 5; i++) {
      const panner = this.ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1;
      panner.rolloffFactor = 1.3;
      panner.maxDistance = 30;
      panner.connect(this.ambientGain);
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

    // Insekten-Zirpen: hohes Bandpass-Rauschen, amplitudenmoduliert
    const ins = ctx.createBufferSource();
    ins.buffer = this.noiseBuffer(3);
    ins.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 5200;
    bp.Q.value = 8;
    const am = ctx.createGain();
    am.gain.value = 0;
    const amOsc = ctx.createOscillator();
    amOsc.frequency.value = 23;
    const amDepth = ctx.createGain();
    amDepth.gain.value = 0.04;
    amOsc.connect(amDepth).connect(am.gain);
    // Zirp-Teppich läuft über den Insekten-Bus und setzt immer wieder aus („ab und an“)
    const gate = ctx.createGain();
    gate.gain.value = 0;
    ins.connect(bp).connect(am).connect(gate).connect(this.insectGain);
    ins.start();
    amOsc.start();
    const toggle = () => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const on = gate.gain.value < 0.5;
      gate.gain.setTargetAtTime(on ? 0.8 : 0, t, 1.5);
      window.setTimeout(toggle, (on ? 4000 + Math.random() * 6000 : 6000 + Math.random() * 12000));
    };
    window.setTimeout(toggle, 3000);

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

  /**
   * Räumliches Tiergeräusch an einer (bewegten) Position. Nutzt den Panner-Pool; gibt false
   * zurück, wenn schon 3 Insektengeräusche laufen oder Insekten aus sind. Pegel bewusst
   * deutlich unter den Spielgeräuschen.
   */
  playCreature(kind: 'buzz' | 'whirr' | 'flutter' | 'chirp', getPos: () => { x: number; y: number; z: number }, duration: number): boolean {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.insectsOn) return false;
    const now = ctx.currentTime;
    const active = this.pool.filter((v) => v.busyUntil > now).length;
    const voice = this.pool.find((v) => v.busyUntil <= now);
    if (!voice || active >= AudioEngine.MAX_CREATURE_VOICES) return false;
    voice.busyUntil = now + duration + 0.2;
    voice.getPos = getPos;
    const p0 = getPos();
    voice.panner.positionX.value = p0.x;
    voice.panner.positionY.value = p0.y;
    voice.panner.positionZ.value = p0.z;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(kind === 'chirp' ? 0.07 : 0.1, now + duration * 0.3);
    out.gain.linearRampToValueAtTime(0, now + duration);
    // über den Insekten-Bus in den Panner
    const bus = ctx.createGain();
    bus.gain.value = 1;
    out.connect(bus).connect(voice.panner);
    const stopAt = now + duration + 0.1;
    if (kind === 'buzz' || kind === 'flutter') {
      // Summen: Sägezahn mit Flügelschlag-Tremolo durch Bandpass
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = kind === 'buzz' ? 190 + Math.random() * 80 : 70 + Math.random() * 30;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = kind === 'buzz' ? 900 : 400;
      bp.Q.value = 2;
      const trem = ctx.createGain();
      trem.gain.value = 0.6;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = kind === 'buzz' ? 40 : 14;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.4;
      lfo.connect(lfoG).connect(trem.gain);
      o.connect(bp).connect(trem).connect(out);
      o.start(now);
      lfo.start(now);
      o.stop(stopAt);
      lfo.stop(stopAt);
    } else if (kind === 'whirr') {
      // Libellen-Schwirren: Rauschen, schnell amplitudenmoduliert
      const s = ctx.createBufferSource();
      s.buffer = this.noiseBuffer(duration + 0.2);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 450;
      bp.Q.value = 1.5;
      const am = ctx.createGain();
      am.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 32;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.5;
      lfo.connect(lfoG).connect(am.gain);
      s.connect(bp).connect(am).connect(out);
      s.start(now);
      lfo.start(now);
      lfo.stop(stopAt);
    } else {
      // Zirpen aus dem Wall: kurze, hohe Pulsfolge
      for (let i = 0; i < 6; i++) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const t = now + i * 0.11;
        o.frequency.value = 4200 + Math.random() * 600;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.5, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + 0.09);
      }
    }
    return true;
  }

  play(sfx: Sfx): void {
    this.onSubtitle?.(`sfx.${sfx}` as I18nKey);
    const ctx = this.ctx;
    if (!ctx) return;
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
