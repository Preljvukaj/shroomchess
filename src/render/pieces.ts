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

function lathe(profile: P[], segments: number): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, segments);
  g.deleteAttribute('uv');
  return g;
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
function knightGeometry(segments: number): THREE.BufferGeometry {
  const base = lathe([...scaleBase(0.92), [0.125, 0.08], [0.1, 0.11], [0.095, 0.15], [0.11, 0.165], [0.1, 0.18], [0.07, 0.19], [0, 0.19]], segments);
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

/** Geometrie in Einheitshöhe (König = 1). Wird beim Erzeugen der Figur skaliert. */
export function pieceGeometry(type: PieceSymbol, segments = 28): THREE.BufferGeometry {
  const key = `${type}:${segments}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let g: THREE.BufferGeometry;
  if (type === 'n') g = knightGeometry(segments);
  else {
    const parts = [lathe(PROFILES[type], segments)];
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

/**
 * Dauerhafte Kontur der Figuren als Rim-Light (Fresnel) im Material: eine schmale helle Kante an der
 * Silhouette – bei Schwarz kühles Weiß (#E8F4FF), bei Weiß optional dunkel. Kostet keinen
 * zusätzlichen Draw Call (Inverted Hull bräuchte 16 weitere). Helligkeit unter der Bloom-Schwelle.
 * Reihenfolge im Hervorhebungs-Zustand: Figur → heller Rand (innen) → farbige Outline (außen).
 */
export const CONTRAST_WIDTH = { off: 0, normal: 0.2, high: 0.34 } as const;
export type PieceContrast = keyof typeof CONTRAST_WIDTH;

const rimUniforms: Record<Color, { uRimColor: { value: THREE.Color }; uRimWidth: { value: number } }> = {
  b: { uRimColor: { value: new THREE.Color('#e8f4ff').multiplyScalar(0.72) }, uRimWidth: { value: CONTRAST_WIDTH.normal } },
  w: { uRimColor: { value: new THREE.Color('#120e1c') }, uRimWidth: { value: 0 } },
};

/** Rim-Light in ein (ggf. geklontes) Figurenmaterial einbauen. */
export function applyRim(mat: THREE.MeshPhysicalMaterial, color: Color): void {
  const u = rimUniforms[color];
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = u.uRimColor;
    shader.uniforms.uRimWidth = u.uRimWidth;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimWidth;')
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        if (uRimWidth > 0.0) {
          float ndv = clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0);
          float f = 1.0 - ndv;
          // Anti-Flimmern: Kantenbreite über die Bildschirmableitung → Übergang nie schmaler als ~1,5 px
          float fw = max(fwidth(f), 1e-4);
          float lo = min(1.0 - uRimWidth, 1.0 - 1.5 * fw);
          float hi = max(lo + 1.5 * fw, 1.0 - uRimWidth * 0.45);
          float sharp = smoothstep(lo - fw, hi, f);
          // In der Ferne weicher, stabiler Fresnel statt schmaler Kante (Subpixel-Bereich)
          float dist = length(vViewPosition);
          float soft = pow(f, 2.5) * 0.55;
          float rim = mix(sharp, soft, smoothstep(4.0, 9.0, dist));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uRimColor, clamp(rim, 0.0, 1.0));
        }`,
      );
  };
  mat.customProgramCacheKey = () => `piece-rim-${color}`;
  mat.needsUpdate = true;
}

/** Einstellung „Figurenkontrast“ (Aus/Normal/Hoch) und optional dunkle Kontur für Weiß. */
export function setPieceContrast(level: PieceContrast, whiteOutline: boolean): void {
  rimUniforms.b.uRimWidth.value = CONTRAST_WIDTH[level];
  rimUniforms.w.uRimWidth.value = whiteOutline ? CONTRAST_WIDTH[level] * 0.8 : 0;
}

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
    b: new THREE.MeshPhysicalMaterial({
      color: '#100c16',
      // etwas rauer als zuvor (0,12/0,05): sehr scharfe Glanzpunkte flimmern auf kleinen Rundungen (Specular-Aliasing)
      roughness: 0.2,
      metalness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.14,
      emissive: new THREE.Color('#0d0420'),
      emissiveIntensity: 0.5,
    }),
  };
  applyRim(materials.w, 'w');
  applyRim(materials.b, 'b');
  return materials;
}

/** Farbe des Griffpunkts / der Hervorhebung pro Spieler. */
export const PLAYER_GLOW: Record<Color, THREE.Color> = {
  w: new THREE.Color('#4dfff0'),
  b: new THREE.Color('#ff4fd8'),
};
