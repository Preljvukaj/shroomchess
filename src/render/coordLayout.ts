import { FILES } from '../core/types';

/**
 * Layout der Brett-Beschriftung (rein, testbar ohne WebGL).
 *
 * Wie bei einem echten Schachbrett liegt die Beschriftung FLACH in einem umlaufenden Steinrahmen
 * (Breite 45 % einer Feldbreite): a–h an unterer und oberer Kante, 1–8 an linker und rechter Kante,
 * jeweils mittig vor Feld bzw. Reihe.
 *
 * Brett-Konvention: Weiß steht bei +Z und blickt nach −Z. Eine Glyphe ist Text in der lokalen XY-Ebene
 * (oben = +Y, Vorderseite = +Z), gedreht mit Euler 'YXZ': pitch = −90° (flach, Normale nach oben),
 * yaw = 0 → für Weiß lesbar (Oberkante zeigt von Weiß weg), yaw = π → für Schwarz.
 *
 * Ausrichtung:
 *   'both' – jede Seite für den Spieler dort: untere Kante für Weiß, obere für Schwarz; die seitlichen
 *            Zahlen zur jeweils näheren Grundreihe (1–4 für Weiß, 5–8 für Schwarz). Für Hot-Seat/zwei Brillen.
 *   'w'/'b' – alles für die gewählte Farbe lesbar (Einzelspieler/online), wie ein gedrucktes Brett.
 */
export type CoordOrientation = 'both' | 'w' | 'b';

export interface CoordLabel {
  text: string;
  kind: 'file' | 'rank';
  /** 0..7 (a..h bzw. 1..8) */
  index: number;
  reader: 'w' | 'b';
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** Breite des Steinrahmens relativ zur Feldbreite (Vorgabe 40–50 %). */
export const FRAME_WIDTH_FACTOR = 0.45;

/** Zeichenhöhe relativ zur RAHMENbreite (Vorgabe 50–60 %; S/L als Einstellung). */
export const COORD_SIZE_FACTOR = { S: 0.48, M: 0.56, L: 0.62 } as const;

export const FLAT_PITCH = -Math.PI / 2;

export function coordinateLayout(squareSize: number, orient: CoordOrientation = 'both'): CoordLabel[] {
  const s = squareSize;
  const off = 4 * s + (FRAME_WIDTH_FACTOR * s) / 2; // Mitte des Rahmens
  const out: CoordLabel[] = [];
  const yawOf = (r: 'w' | 'b') => (r === 'w' ? 0 : Math.PI);
  const pick = (natural: 'w' | 'b'): 'w' | 'b' => (orient === 'both' ? natural : orient);
  for (let i = 0; i < 8; i++) {
    const c = (i - 3.5) * s;
    const rz = (3.5 - i) * s; // Reihe i+1
    const rankReader: 'w' | 'b' = i < 4 ? 'w' : 'b'; // zur näheren Grundreihe
    for (const [kind, natural, x, z] of [
      ['file', 'w', c, off], // untere Kante (Weiß)
      ['file', 'b', c, -off], // obere Kante (Schwarz)
      ['rank', rankReader, -off, rz], // linke Kante (aus Sicht von Weiß)
      ['rank', rankReader, off, rz], // rechte Kante
    ] as const) {
      const reader = pick(natural);
      out.push({ text: kind === 'file' ? FILES[i] : String(i + 1), kind, index: i, reader, x, z, yaw: yawOf(reader), pitch: FLAT_PITCH });
    }
  }
  return out;
}

/**
 * Kleine Feldbeschriftung wie bei Lichess (optional): Linienbuchstabe unten rechts auf der
 * ersten Reihe, Reihenzahl oben links auf der a-Linie – jeweils aus Sicht von `reader`.
 */
export function squareLabelLayout(squareSize: number, reader: 'w' | 'b'): CoordLabel[] {
  const s = squareSize;
  const out: CoordLabel[] = [];
  const inset = s * 0.36;
  const flip = reader === 'w' ? 1 : -1;
  const yaw = reader === 'w' ? 0 : Math.PI;
  const baseRank = reader === 'w' ? 0 : 7;
  const baseFile = reader === 'w' ? 0 : 7;
  for (let i = 0; i < 8; i++) {
    const fx = (i - 3.5) * s;
    const fz = (3.5 - baseRank) * s;
    out.push({ text: FILES[i], kind: 'file', index: i, reader, x: fx + flip * inset, z: fz + flip * inset, yaw, pitch: FLAT_PITCH });
    const rx = (baseFile - 3.5) * s;
    const rz = (3.5 - i) * s;
    out.push({ text: String(i + 1), kind: 'rank', index: i, reader, x: rx - flip * inset, z: rz - flip * inset, yaw, pitch: FLAT_PITCH });
  }
  return out;
}
