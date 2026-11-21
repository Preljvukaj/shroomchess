import { Emitter } from './emitter';

export type Quality = 'low' | 'medium' | 'high';
export type Lang = 'de' | 'en';

export interface Settings {
  lang: Lang;
  /** `null` = automatisch (Quest → low/medium, Desktop → high). */
  quality: Quality | null;
  colorblind: boolean;
  markNoLegalMoves: boolean;
  leftHanded: boolean;
  seated: boolean;
  teleport: boolean;
  subtitles: boolean;
  volume: number;
  backToBackOffset: number;
  playerName: string;
  /** Koordinaten-Glyphen: Größe relativ zur Feldbreite. */
  coordSize: 'S' | 'M' | 'L';
  coordHighContrast: boolean;
  /** Zusätzliche kleine Beschriftung auf den Randfeldern (wie bei Lichess). */
  coordsOnSquares: boolean;
  /** Lautstärke „Tiere / Umgebung“ (unabhängig von Spielgeräuschen). */
  creaturesVolume: number;
  /** Insekten komplett aus (z. B. bei Insektenphobie). */
  insects: boolean;
  /** Easter Egg: Glühwürmchen landet auf ruhig gehaltener Hand (VR). */
  insectLanding: boolean;
  /** Figurenkontrast: helle Kontur der schwarzen Figuren (Aus/Normal/Hoch). */
  pieceContrast: 'off' | 'normal' | 'high';
  /** Optional: dunkle Kontur für die weißen Figuren. */
  whiteOutline: boolean;
}

const DEFAULTS: Settings = {
  lang: typeof navigator !== 'undefined' && navigator.language?.startsWith('de') ? 'de' : 'en',
  quality: null,
  colorblind: false,
  markNoLegalMoves: false,
  leftHanded: false,
  seated: false,
  teleport: false,
  subtitles: true,
  volume: 0.7,
  backToBackOffset: 0.3,
  playerName: '',
  coordSize: 'M',
  coordHighContrast: false,
  coordsOnSquares: false,
  creaturesVolume: 0.6,
  insects: true,
  insectLanding: true,
  pieceContrast: 'normal',
  whiteOutline: false,
};

const KEY = 'myzel-schach.settings.v1';

class SettingsStore extends Emitter<{ change: Settings }> {
  private s: Settings;

  constructor() {
    super();
    let stored: Partial<Settings> = {};
    try {
      stored = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    } catch {
      /* Speicher nicht verfügbar – Standardwerte */
    }
    this.s = { ...DEFAULTS, ...stored };
  }

  get(): Readonly<Settings> {
    return this.s;
  }

  set(patch: Partial<Settings>): void {
    this.s = { ...this.s, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.s));
    } catch {
      /* ignorieren */
    }
    this.emit('change', this.s);
  }
}

export const settings = new SettingsStore();

/** Grobe Erkennung von Standalone-Brillen (Quest/Pico) für die automatische Qualitätsstufe. */
export function isStandaloneHeadset(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /OculusBrowser|Quest|Pico|PicoBrowser|Wolvic/i.test(navigator.userAgent);
}

export function effectiveQuality(): Quality {
  const q = settings.get().quality;
  if (q) return isStandaloneHeadset() && q === 'high' ? 'medium' : q;
  return isStandaloneHeadset() ? 'low' : 'high';
}
