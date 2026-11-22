import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { safeMerge } from './shared';
import type { Color, PieceSymbol } from '../core/types';

/**
 * Prozedurale Staunton-Figuren. Alle Maße relativ zur Königshöhe (= 1).
 * Proportionen nach klassischem Staunton-Satz: K 1.00, D 0.89, L 0.74, S 0.63, T 0.60, B 0.53.
 * Die Geometrie wird einmal pro Typ gebaut und von allen Figuren geteilt.
 */

export const KING_HEIGHT_PER_SQUARE = 2.2; // Feld 0,5 m → König 1,1 m (hüfthoch)

type P = [number, number]; // [radius, y]

const BASE: P[] = [
  [0, 0], [0.165, 0], [0.172, 0.008], [0.172, 0.026], [0.162, 0.036], [0.15, 0.04],
  [0.152, 0.05], [0.146, 0.058], [0.132, 0.062],
];

function arc(cx: number, cy: number, r: number, a0: number, a1: number, n: number): P[] {
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([Math.max(0, cx + r * Math.cos(a)), cy + r * Math.sin(a)]);
  }
  return out;
}

function scaleBase(k: number): P[] {
  return BASE.map(([r, y]) => [r * k, y]);
}

const PROFILES: Record<Exclude<PieceSymbol, 'n'>, P[]> = {
  p: [
    ...scaleBase(0.82),
    [0.1, 0.075], [0.075, 0.1], [0.06, 0.16], [0.052, 0.24], [0.05, 0.28],
    [0.082, 0.292], [0.088, 0.305], [0.08, 0.318], [0.052, 0.326],
    ...arc(0, 0.405, 0.088, -Math.PI * 0.36, Math.PI / 2, 10),
  ],
  r: [
    ...scaleBase(0.9),
    [0.12, 0.08], [0.105, 0.11], [0.094, 0.2], [0.088, 0.36], [0.092, 0.42],
    [0.108, 0.44], [0.118, 0.46], [0.118, 0.47], [0.112, 0.48], [0.112, 0.535],
    [0.085, 0.535], [0.085, 0.51], [0, 0.51],
  ],
  b: [
    ...scaleBase(0.86),
    [0.11, 0.08], [0.085, 0.11], [0.06, 0.22], [0.045, 0.36], [0.042, 0.4],
    [0.085, 0.41], [0.09, 0.425], [0.06, 0.435], [0.075, 0.445], [0.058, 0.455],
    // Mitra
    [0.06, 0.47], [0.075, 0.5], [0.08, 0.54], [0.074, 0.58], [0.058, 0.62], [0.032, 0.65], [0.02, 0.66],
    ...arc(0, 0.69, 0.028, -Math.PI / 2, Math.PI / 2, 6),
  ],
  q: [
    ...scaleBase(0.97),
    [0.13, 0.08], [0.1, 0.12], [0.07, 0.25], [0.052, 0.45], [0.05, 0.53],
    [0.095, 0.545], [0.1, 0.56], [0.075, 0.572], [0.085, 0.585], [0.06, 0.6],
    // Kelch und Krone
    [0.065, 0.66], [0.085, 0.73], [0.105, 0.78], [0.11, 0.8], [0.098, 0.805],
    [0.075, 0.8], [0.06, 0.81], [0.045, 0.83], [0.025, 0.845],
    ...arc(0, 0.865, 0.03, -Math.PI / 2, Math.PI / 2, 6),
  ],
  k: [
    ...BASE,
    [0.135, 0.08], [0.105, 0.12], [0.075, 0.26], [0.058, 0.47], [0.056, 0.56],
    [0.1, 0.575], [0.105, 0.59], [0.08, 0.602], [0.09, 0.615], [0.066, 0.63],
    [0.07, 0.7], [0.09, 0.77], [0.105, 0.81], [0.1, 0.82], [0.08, 0.825],
    ...arc(0, 0.82, 0.055, 0, Math.PI / 2, 6),
    [0, 0.875],
  ],
};

/** Oberkante (ohne Griffpunkt) – dort sitzt der Griffpunkt. */
export const GRIP_HEIGHT: Record<PieceSymbol, number> = {
  p: 0.505, r: 0.545, b: 0.725, q: 0.9, k: 1.0, n: 0.63,
};

/** Anteil des Maximalradius, ab dem ein Querschnitt als „breit“ gilt (Fuß, Kragen, Wülste, Krone, Turmkopf). */
export const WIDE_THRESHOLD = 0.6;
/** Mehr Segmente an breiten Querschnitten (Vorgabe: +50 %). */
export const WIDE_FACTOR = 1.5;

/** Segmentzahl je Profilpunkt: breite Querschnitte × factor, schmale unverändert, Achspunkte (r = 0) = 1. */
export function ringSegments(profile: P[], segments: number, factor = WIDE_FACTOR): number[] {
  const rMax = Math.max(...profile.map(([r]) => r));
  const wide = Math.round(segments * factor);
  return profile.map(([r]) => (r < 1e-6 ? 1 : r > WIDE_THRESHOLD * rMax ? wide : segments));
}

/**
 * Drehkörper mit Segmentzahl pro Ring. Benachbarte Ringe gleicher Zahl → Vierecke; unterschiedlicher Zahl →
 * „Naht“: beide Ringe werden nach Winkel zusammen abgelaufen und mit Dreiecken verbunden (jede Kante
 * gehört genau zwei Dreiecken → kein Spalt, gemeinsame Vertices → kein Shading-Sprung). Achspunkte (r = 0)
 * sind ein einzelner Pol-Vertex mit Fächer. Die Profilpunkte (Silhouette) bleiben exakt erhalten.
 */
export function stitchedLathe(profile: P[], counts: number[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const ringStart: number[] = [];
  profile.forEach(([r, y], k) => {
    ringStart.push(pos.length / 3);
    const n = counts[k];
    if (n === 1) pos.push(0, y, 0);
    else for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2;
      pos.push(Math.sin(a) * r, y, Math.cos(a) * r);
    }
  });
  const idx: number[] = [];
  const v = (k: number, j: number) => ringStart[k] + (counts[k] === 1 ? 0 : ((j % counts[k]) + counts[k]) % counts[k]);
  for (let k = 0; k < profile.length - 1; k++) {
    const na = counts[k];
    const nb = counts[k + 1];
    if (na === 1 && nb === 1) continue;
    if (na === 1 || nb === 1) {
      // Fächer zum Pol
      const ring = na === 1 ? k + 1 : k;
      const pole = na === 1 ? k : k + 1;
      const n = counts[ring];
      for (let j = 0; j < n; j++) {
        if (pole === k) idx.push(v(pole, 0), v(ring, j), v(ring, j + 1));
        else idx.push(v(ring, j), v(pole, 0), v(ring, j + 1));
      }
      continue;
    }
    // Naht bzw. Vierecke: beide Ringe nach Winkel ablaufen
    let i = 0;
    let j = 0;
    while (i < na || j < nb) {
      const ai = (i + 1) / na;
      const bj = (j + 1) / nb;
      if (j >= nb || (i < na && ai <= bj - 1e-9)) {
        idx.push(v(k, i), v(k + 1, j), v(k, i + 1));
        i++;
      } else {
        idx.push(v(k, i), v(k + 1, j), v(k + 1, j + 1));
        j++;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // Orientierung: Normalen nach außen (Profil läuft von unten nach oben) – Vorzeichen per Volumen prüfen
  let vol = 0;
  const p = g.getAttribute('position');
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    A.fromBufferAttribute(p, idx[t]);
    B.fromBufferAttribute(p, idx[t + 1]);
    C.fromBufferAttribute(p, idx[t + 2]);
    vol += A.dot(B.clone().cross(C));
  }
  if (vol < 0) {
    for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
    g.setIndex(idx);
  }
  g.computeVertexNormals();
  return g;
}

function lathe(profile: P[], segments: number, factor = WIDE_FACTOR): THREE.BufferGeometry {
  return stitchedLathe(profile, ringSegments(profile, segments, factor));
}

/** Drehkörper-Teil einer Figur (für Tests: Segmentzahlen, geschlossene Hülle). */
export function pieceLathe(type: PieceSymbol, segments: number, factor = WIDE_FACTOR): { geo: THREE.BufferGeometry; profile: P[]; counts: number[] } {
  const profile = type === 'n' ? KNIGHT_BASE : PROFILES[type];
  const counts = ringSegments(profile, segments, factor);
  return { geo: stitchedLathe(profile, counts), profile, counts };
}

function rookMerlons(segments: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const g = new THREE.BoxGeometry(0.03, 0.04, 0.058);
    g.translate(0.098, 0.535 + 0.02, 0);
    g.rotateY(a + Math.PI / n);
    g.deleteAttribute('uv');
    parts.push(g);
  }
  void segments;
  return safeMerge(parts);
}

function queenCoronet(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const g = new THREE.SphereGeometry(0.016, 8, 6);
    g.translate(Math.cos(a) * 0.1, 0.815, Math.sin(a) * 0.1);
    g.deleteAttribute('uv');
    parts.push(g);
  }
  return safeMerge(parts);
}

function kingCross(): THREE.BufferGeometry {
  const v = new THREE.BoxGeometry(0.032, 0.11, 0.032);
  v.translate(0, 0.875 + 0.055, 0);
  const h = new THREE.BoxGeometry(0.09, 0.03, 0.032);
  h.translate(0, 0.93, 0);
  v.deleteAttribute('uv');
  h.deleteAttribute('uv');
  return safeMerge([v, h]);
}

/** Springerkopf: Seitenprofil extrudiert und abgeschrägt, auf einen gedrechselten Sockel gesetzt. */
const KNIGHT_BASE: P[] = [...scaleBase(0.92), [0.125, 0.08], [0.1, 0.11], [0.095, 0.15], [0.11, 0.165], [0.1, 0.18], [0.07, 0.19], [0, 0.19]];

function knightGeometry(segments: number, factor: number): THREE.BufferGeometry {
  const base = lathe(KNIGHT_BASE, segments, factor);
  // Profil in X(vorne)/Y(oben); Einheiten wie Königshöhe
  const s = new THREE.Shape();
  const pts: P[] = [
    [-0.075, 0.18], [0.07, 0.18], [0.065, 0.24], [0.045, 0.3], [0.07, 0.34], [0.12, 0.37],
    [0.155, 0.4], [0.16, 0.43], [0.14, 0.455], [0.1, 0.47], [0.07, 0.5], [0.05, 0.55],
    [0.035, 0.6], [0.02, 0.63], [0.005, 0.6], [-0.015, 0.62], [-0.03, 0.585], [-0.065, 0.55],
    [-0.095, 0.48], [-0.11, 0.4], [-0.105, 0.3], [-0.09, 0.23],
  ];
  s.moveTo(pts[0][1] * 0 + pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) s.lineTo(x, y);
  s.closePath();
  const head = new THREE.ExtrudeGeometry(s, {
    depth: 0.07, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.018, bevelSegments: 3, curveSegments: 1,
  });
  head.translate(0, 0, -0.035);
  // Front (+X) zeigt nach −Z (zum Gegner für Weiß)
  head.rotateY(Math.PI / 2);
  head.deleteAttribute('uv');
  const merged = safeMerge([base, head]);
  return merged;
}

const cache = new Map<string, THREE.BufferGeometry>();

/**
 * Geometrie in Einheitshöhe (König = 1). Wird beim Erzeugen der Figur skaliert.
 * `factor`: Segment-Faktor für breite Querschnitte (Brettfiguren 1,5; ferne Stufen wie Schalen-Minis ≤ 1,25).
 */
export function pieceGeometry(type: PieceSymbol, segments = 28, factor = WIDE_FACTOR): THREE.BufferGeometry {
  const key = `${type}:${segments}:${factor}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let g: THREE.BufferGeometry;
  if (type === 'n') g = knightGeometry(segments, factor);
  else {
    const parts = [lathe(PROFILES[type], segments, factor)];
    if (type === 'r') parts.push(rookMerlons(segments));
    if (type === 'q') parts.push(queenCoronet());
    if (type === 'k') parts.push(kingCross());
    g = safeMerge(parts);
  }
  g = mergeVertices(g, 1e-5);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  cache.set(key, g);
  return g;
}

let materials: Record<Color, THREE.MeshPhysicalMaterial> | null = null;

/** Weiß: Elfenbein/Perlmutt mit Klarlack und Irisieren. Schwarz: Obsidian. */
export function pieceMaterials(high: boolean): Record<Color, THREE.MeshPhysicalMaterial> {
  if (materials) return materials;
  materials = {
    w: new THREE.MeshPhysicalMaterial({
      color: '#fff2da',
      roughness: 0.32,
      envMapIntensity: 0.35,
      metalness: 0,
      clearcoat: 0.8,
      clearcoatRoughness: 0.15,
      sheen: high ? 0.4 : 0,
      sheenColor: new THREE.Color('#fff6e8'),
      iridescence: high ? 0.35 : 0,
      iridescenceIOR: 1.4,
      emissive: new THREE.Color('#2a2418'),
      emissiveIntensity: 0.25,
    }),
    // Obsidian: keine Kontur mehr – Kontrast entsteht durch Licht (Hauptlicht, seitliches Kantenlicht,
    // Environment-Reflexe). Grundfarbe leicht angehoben (#1A1822), damit Schattierung sichtbar wird;
    // Rauheit 0,3 → weiche, formnachzeichnende Glanzlichter statt Spiegel.
    b: new THREE.MeshPhysicalMaterial({
      color: '#1a1822',
      roughness: 0.3,
      metalness: 0.15,
      clearcoat: 0.6,
      clearcoatRoughness: 0.28,
      envMapIntensity: 1.35,
      emissive: new THREE.Color('#0a0614'),
      emissiveIntensity: 0.4,
    }),
  };
  return materials;
}

/** Farbe des Griffpunkts / der Hervorhebung pro Spieler. */
export const PLAYER_GLOW: Record<Color, THREE.Color> = {
  w: new THREE.Color('#4dfff0'),
  b: new THREE.Color('#ff4fd8'),
};
