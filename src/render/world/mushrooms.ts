import * as THREE from 'three';
import { GLSL_FOG, GLSL_NOISE, mulberry32, safeMerge, worldUniforms } from '../shared';

/**
 * Prozedurale Pilzarten (Seed-basiert). Pro Art eine zusammengeführte Geometrie
 * (Stiel + Hut + Lamellen [+ Manschette]) in Einheitshöhe 1, gerendert als InstancedMesh.
 *
 * Vertex-Attribute: aPart (0 Stiel, 1 Hutoberseite, 2 Hutunterseite, 3 Lamellen,
 * 4 Manschette, 5 Lamellen-Scheibe der Fern-LOD), aRad (radial 0..1 bzw. Stielhöhe 0..1).
 * Instanz-Attribute: aTint (Farbton ±), aPhase, aSeed.
 */

export type CapShape = 'hemi' | 'flat' | 'bell' | 'funnel' | 'umbo' | 'cone';
export type StemShape = 'straight' | 'bent' | 's' | 'bulb' | 'taper';
export type Rim = 'smooth' | 'wavy' | 'torn';

export interface SpeciesDef {
  id: string;
  cap: CapShape;
  capR: number; // Hutradius relativ zur Höhe
  capH: number; // Huthöhe relativ zur Höhe
  rim: Rim;
  stem: StemShape;
  stemR: number;
  annulus: boolean;
  /** 0 Fasern/Rillen, 1 Netz, 2 Schuppen */
  stemTex: 0 | 1 | 2;
  /** 0 Punkte, 1 Schuppen, 2 Flecken, 3 Maserung */
  pattern: 0 | 1 | 2 | 3;
  cluster: number; // >1: Büschel aus einer Basis
  gillA: string;
  gillB: string;
  capColor: string;
  patternColor: string;
  stemColor: string;
  glow: number;
}


export const SPECIES: SpeciesDef[] = [
  { id: 'glockenhut', cap: 'bell', capR: 0.22, capH: 0.18, rim: 'smooth', stem: 'straight', stemR: 0.035, annulus: true, stemTex: 0, pattern: 0, cluster: 1, gillA: '#2fd8ff', gillB: '#8b3dff', capColor: '#1a1030', patternColor: '#7fe8ff', stemColor: '#2a2238', glow: 1.0 },
  { id: 'schirmling', cap: 'flat', capR: 0.42, capH: 0.12, rim: 'wavy', stem: 'bent', stemR: 0.03, annulus: false, stemTex: 2, pattern: 1, cluster: 1, gillA: '#1de9c9', gillB: '#2fd8ff', capColor: '#141a26', patternColor: '#4dffe0', stemColor: '#232a33', glow: 0.9 },
  { id: 'trichterling', cap: 'funnel', capR: 0.3, capH: 0.16, rim: 'wavy', stem: 'taper', stemR: 0.05, annulus: false, stemTex: 0, pattern: 3, cluster: 1, gillA: '#ff2fb3', gillB: '#8b3dff', capColor: '#24102a', patternColor: '#ff7ad8', stemColor: '#2c1d33', glow: 1.1 },
  { id: 'buckelkappe', cap: 'umbo', capR: 0.34, capH: 0.16, rim: 'smooth', stem: 's', stemR: 0.032, annulus: false, stemTex: 0, pattern: 2, cluster: 1, gillA: '#9dff3a', gillB: '#2fd8ff', capColor: '#13201a', patternColor: '#c4ff7a', stemColor: '#1f2a24', glow: 1.0 },
  { id: 'knollenpilz', cap: 'hemi', capR: 0.3, capH: 0.24, rim: 'smooth', stem: 'bulb', stemR: 0.045, annulus: true, stemTex: 1, pattern: 0, cluster: 1, gillA: '#8b3dff', gillB: '#ff2fb3', capColor: '#1c0f2e', patternColor: '#d6a8ff', stemColor: '#2a2038', glow: 1.0 },
  { id: 'buschel', cap: 'bell', capR: 0.16, capH: 0.12, rim: 'wavy', stem: 'bent', stemR: 0.022, annulus: false, stemTex: 0, pattern: 2, cluster: 4, gillA: '#2fd8ff', gillB: '#9dff3a', capColor: '#10202a', patternColor: '#9dfff0', stemColor: '#20303a', glow: 1.1 },
  { id: 'riesenschirm', cap: 'flat', capR: 0.5, capH: 0.13, rim: 'torn', stem: 'straight', stemR: 0.055, annulus: true, stemTex: 0, pattern: 1, cluster: 1, gillA: '#1de9c9', gillB: '#8b3dff', capColor: '#160f28', patternColor: '#6af0ff', stemColor: '#2a2440', glow: 1.0 },
  { id: 'zunderling', cap: 'cone', capR: 0.24, capH: 0.2, rim: 'torn', stem: 'taper', stemR: 0.04, annulus: false, stemTex: 2, pattern: 3, cluster: 1, gillA: '#ff2fb3', gillB: '#2fd8ff', capColor: '#22101e', patternColor: '#ff9ad8', stemColor: '#2b1f2a', glow: 0.95 },
];

/** Profile (u = 0 Mitte … 1 Rand, y relativ zum Stielende, in Einheiten von capH). */
const CAP_TOP: Record<CapShape, [number, number][]> = {
  hemi: [[0, 1], [0.5, 0.87], [0.85, 0.5], [1, 0.05]],
  flat: [[0, 0.38], [0.5, 0.3], [0.9, 0.12], [1, 0]],
  bell: [[0, 1.25], [0.4, 1.05], [0.8, 0.45], [1, -0.3]],
  funnel: [[0, -0.05], [0.3, 0.06], [0.75, 0.32], [1, 0.48]],
  umbo: [[0, 0.75], [0.12, 0.62], [0.3, 0.36], [0.7, 0.25], [1, 0]],
  cone: [[0, 1.45], [0.35, 1.0], [0.75, 0.42], [1, 0.02]],
};
const CAP_UNDER: Record<CapShape, [number, number][]> = {
  hemi: [[1, 0.05], [0.6, -0.04], [0.12, -0.08]],
  flat: [[1, 0], [0.5, 0.04], [0.1, -0.03]],
  bell: [[1, -0.3], [0.7, 0.1], [0.12, 0.15]],
  funnel: [[1, 0.44], [0.6, 0.12], [0.12, -0.25]],
  umbo: [[1, 0], [0.5, -0.01], [0.1, -0.05]],
  cone: [[1, 0.02], [0.6, 0.14], [0.12, 0.2]],
};

function spline(pts: [number, number][], n: number): THREE.Vector2[] {
  const c = new THREE.SplineCurve(pts.map(([u, y]) => new THREE.Vector2(u, y)));
  return c.getPoints(n);
}

/** Unterseiten-Höhe bei radialem Anteil u (lineare Interpolation der Stützstellen). */
function underY(shape: CapShape, u: number): number {
  const p = [...CAP_UNDER[shape]].reverse(); // aufsteigend in u
  if (u <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    if (u <= p[i][0]) {
      const k = (u - p[i - 1][0]) / (p[i][0] - p[i - 1][0]);
      return p[i - 1][1] + (p[i][1] - p[i - 1][1]) * k;
    }
  }
  return p[p.length - 1][1];
}

interface Detail {
  capSeg: number;
  capRings: number;
  gills: number; // lange Lamellen (gleich viele kurze dazwischen)
  stemRad: number;
  stemRings: number;
  far: boolean; // Fern-LOD: keine Lamellen, leuchtende Scheibe stattdessen
}

export const DETAIL = {
  low: { capSeg: 14, capRings: 6, gills: 10, stemRad: 7, stemRings: 6, far: false },
  medium: { capSeg: 20, capRings: 8, gills: 16, stemRad: 9, stemRings: 8, far: false },
  high: { capSeg: 28, capRings: 10, gills: 24, stemRad: 12, stemRings: 10, far: false },
  far: { capSeg: 10, capRings: 4, gills: 0, stemRad: 5, stemRings: 3, far: true },
  /** Sehr weit: Low-Poly-Hut (8 Segmente) mit leuchtender Unterseite, Stiel 5 Segmente – ersetzt die früheren Billboards. */
  vfar: { capSeg: 8, capRings: 3, gills: 0, stemRad: 5, stemRings: 2, far: true },
} satisfies Record<string, Detail>;

type Builder = { pos: number[]; part: number[]; rad: number[]; idx: number[] };
const newBuilder = (): Builder => ({ pos: [], part: [], rad: [], idx: [] });

function toGeometry(b: Builder): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(b.part, 1));
  g.setAttribute('aRad', new THREE.Float32BufferAttribute(b.rad, 1));
  g.setIndex(b.idx);
  g.computeVertexNormals();
  return g;
}

/** Hut (Ober- + Unterseite) als eigenes Lathe mit Randverformung (gewellt/eingerissen). */
function buildCap(sp: SpeciesDef, d: Detail, top: THREE.Vector3, rng: () => number, scale = 1): { geo: THREE.BufferGeometry; rimR: (a: number) => number } {
  const R = sp.capR * scale;
  const H = sp.capH * scale;
  const ph = rng() * Math.PI * 2;
  const rimR = (a: number) => {
    if (sp.rim !== 'torn') return 1;
    const n = Math.max(0, Math.sin(5 * a + ph) - 0.72) / 0.28 + Math.max(0, Math.sin(3 * a + ph * 1.7) - 0.85) / 0.15;
    return 1 - 0.14 * Math.min(1, n);
  };
  const rimY = (a: number, u: number) => (sp.rim === 'wavy' ? 0.1 * Math.sin(6 * a + ph) * u * u * u : 0);
  const topProf = spline(CAP_TOP[sp.cap], d.capRings);
  const underProf = d.far ? [] : spline(CAP_UNDER[sp.cap], Math.max(3, d.capRings >> 1)).slice(1);
  const prof = [...topProf.map((p) => ({ u: p.x, y: p.y, part: 1 })), ...underProf.map((p) => ({ u: p.x, y: p.y, part: 2 }))];
  if (d.far) prof.push({ u: 0.05, y: CAP_UNDER[sp.cap][0][1] * 0.6, part: 5 });
  const b = newBuilder();
  const S = d.capSeg;
  for (let s = 0; s <= S; s++) {
    const a = (s / S) * Math.PI * 2;
    const rr = rimR(a);
    for (const p of prof) {
      const k = p.u >= 0.999 ? rr : 1 - (1 - rr) * Math.pow(p.u, 4);
      const r = p.u * R * k;
      b.pos.push(top.x + Math.cos(a) * r, top.y + (p.y + rimY(a, p.u)) * H, top.z + Math.sin(a) * r);
      b.part.push(p.part === 2 && d.far ? 5 : p.part);
      b.rad.push(p.u);
    }
  }
  const P = prof.length;
  for (let s = 0; s < S; s++) {
    for (let i = 0; i < P - 1; i++) {
      const a0 = s * P + i;
      const b0 = (s + 1) * P + i;
      b.idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
    }
  }
  // Fern-LOD: Unterseite als flache Scheibe mit Lamellen-Shader (Teil 5)
  if (d.far) {
    const base = b.pos.length / 3;
    const cy = top.y + CAP_UNDER[sp.cap][0][1] * H;
    b.pos.push(top.x, cy - 0.01 * H, top.z);
    b.part.push(5);
    b.rad.push(0);
    for (let s = 0; s <= S; s++) {
      const a = (s / S) * Math.PI * 2;
      b.pos.push(top.x + Math.cos(a) * R * rimR(a) * 0.98, cy, top.z + Math.sin(a) * R * rimR(a) * 0.98);
      b.part.push(5);
      b.rad.push(1);
    }
    for (let s = 0; s < S; s++) b.idx.push(base, base + 1 + s + 1, base + 1 + s);
  }
  return { geo: toGeometry(b), rimR: (a) => R * rimR(a) };
}

/** Lamellen: radial, abwechselnd lang (ab Stiel) und kurz (ab halbem Radius). */
function buildGills(sp: SpeciesDef, d: Detail, top: THREE.Vector3, rimR: (a: number) => number, stemTopR: number, scale = 1): THREE.BufferGeometry {
  const b = newBuilder();
  const H = sp.capH * scale;
  const n = d.gills * 2;
  const K = 4;
  const depth = 0.55 * H;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const R = rimR(a) * 0.97;
    const r0 = i % 2 === 0 ? stemTopR * 1.15 : R * 0.5;
    const base = b.pos.length / 3;
    for (let k = 0; k <= K; k++) {
      const r = r0 + ((R - r0) * k) / K;
      const u = r / (sp.capR * scale);
      const y = top.y + underY(sp.cap, u) * H - 0.004 * scale;
      const f = k / K;
      const dd = depth * Math.pow(1 - f, 0.7) * (0.6 + 0.4 * Math.sin(Math.PI * f)); // am Rand → 0
      const cx = top.x + Math.cos(a) * r;
      const cz = top.z + Math.sin(a) * r;
      // Lamellen enden auf Höhe des Hutrands – sie hängen nicht wie Zähne darunter
      const rimLevel = top.y + CAP_UNDER[sp.cap][0][1] * H - 0.03 * H;
      const bottom = Math.min(y - 0.002, Math.max(y - dd, rimLevel));
      b.pos.push(cx, y, cz, cx, bottom, cz);
      b.part.push(3, 3);
      b.rad.push(u, u);
    }
    for (let k = 0; k < K; k++) {
      const p = base + k * 2;
      b.idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3);
    }
  }
  return toGeometry(b);
}

/** Stiel als Röhre entlang einer Bezier-Kurve mit Radiusprofil, Fasern und Ausbuchtungen. */
function buildStem(sp: SpeciesDef, d: Detail, rng: () => number, height: number, lean: THREE.Vector3): { geo: THREE.BufferGeometry; top: THREE.Vector3; topR: number } {
  const Y = height;
  const end = new THREE.Vector3(lean.x, Y, lean.z);
  let c1: THREE.Vector3;
  let c2: THREE.Vector3;
  switch (sp.stem) {
    case 'bent':
      c1 = new THREE.Vector3(0, Y * 0.45, 0);
      c2 = new THREE.Vector3(lean.x * 0.4 + 0.06, Y * 0.8, lean.z * 0.4);
      break;
    case 's':
      c1 = new THREE.Vector3(0.11, Y * 0.33, 0.02);
      c2 = new THREE.Vector3(-0.11, Y * 0.66, -0.02);
      break;
    default:
      c1 = new THREE.Vector3(lean.x * 0.33, Y * 0.33, lean.z * 0.33);
      c2 = new THREE.Vector3(lean.x * 0.66, Y * 0.66, lean.z * 0.66);
  }
  const curve = new THREE.CubicBezierCurve3(new THREE.Vector3(0, 0, 0), c1, c2, end);
  const T = d.stemRings;
  const S = d.stemRad;
  const frames = curve.computeFrenetFrames(T, false);
  const fibers = sp.stemTex === 0 ? 14 : 0;
  const ph = rng() * 10;
  const radius = (t: number, a: number) => {
    let r = sp.stemR * (height / 0.85);
    if (sp.stem === 'taper') r *= 1.35 - 0.65 * t;
    else r *= 1.12 - 0.22 * t;
    if (sp.stem === 'bulb') r *= 1 + 1.3 * Math.exp(-Math.pow(t / 0.13, 2));
    r *= 1 + 0.35 * THREE.MathUtils.smoothstep(t, 0.88, 1); // Ansatz am Hut
    if (fibers) r *= 1 + 0.035 * Math.sin(a * fibers + t * 3);
    r *= 1 + 0.07 * Math.sin(t * 9 + ph) * Math.sin(a * 2 + ph); // unregelmäßige Ausbuchtungen
    return r;
  };
  const b = newBuilder();
  for (let i = 0; i <= T; i++) {
    const t = i / T;
    const p = curve.getPointAt(t);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    for (let s = 0; s <= S; s++) {
      const a = (s / S) * Math.PI * 2;
      const r = radius(t, a);
      b.pos.push(p.x + (Math.cos(a) * N.x + Math.sin(a) * B.x) * r, p.y + (Math.cos(a) * N.y + Math.sin(a) * B.y) * r, p.z + (Math.cos(a) * N.z + Math.sin(a) * B.z) * r);
      b.part.push(0);
      b.rad.push(t);
    }
  }
  for (let i = 0; i < T; i++) {
    for (let s = 0; s < S; s++) {
      const a0 = i * (S + 1) + s;
      const b0 = (i + 1) * (S + 1) + s;
      b.idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
    }
  }
  const geo = toGeometry(b);
  const parts = [geo];
  // Manschette (Annulus): hängender, gewellter Ring unterhalb des Huts
  if (sp.annulus && !d.far) {
    const t = 0.8;
    const p = curve.getPointAt(t);
    const r0 = radius(t, 0);
    const ring = newBuilder();
    const SS = Math.max(10, S * 2);
    for (let s = 0; s <= SS; s++) {
      const a = (s / SS) * Math.PI * 2;
      const wob = 1 + 0.12 * Math.sin(a * 7 + ph);
      for (const [rk, yk] of [[1.0, 0], [1.9 * wob, -0.035], [2.3 * wob, -0.075 * wob]] as const) {
        ring.pos.push(p.x + Math.cos(a) * r0 * rk, p.y + yk * height, p.z + Math.sin(a) * r0 * rk);
        ring.part.push(4);
        ring.rad.push(rk / 2.3);
      }
    }
    for (let s = 0; s < SS; s++) for (let k = 0; k < 2; k++) {
      const a0 = s * 3 + k;
      const b0 = (s + 1) * 3 + k;
      ring.idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
    }
    parts.push(toGeometry(ring));
  }
  return { geo: parts.length > 1 ? safeMerge(parts) : geo, top: end, topR: radius(1, 0) * 0.75 };
}

function buildOne(sp: SpeciesDef, d: Detail, rng: () => number, height: number, lean: THREE.Vector3, capScale: number): THREE.BufferGeometry {
  const stem = buildStem(sp, d, rng, height, lean);
  const cap = buildCap(sp, d, stem.top, rng, capScale);
  const parts = [stem.geo, cap.geo];
  if (!d.far && d.gills > 0) parts.push(buildGills(sp, d, stem.top, cap.rimR, stem.topR, capScale));
  return safeMerge(parts);
}

/** Geometrie einer Art in Einheitshöhe (≈ 1). Büschel: mehrere Stiele aus einer Basis. */
export function speciesGeometry(sp: SpeciesDef, d: Detail, seed: number): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  if (sp.cluster <= 1) return buildOne(sp, d, rng, 0.85, new THREE.Vector3((rng() - 0.5) * 0.06, 0, (rng() - 0.5) * 0.06), 1);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < sp.cluster; i++) {
    const a = (i / sp.cluster) * Math.PI * 2 + rng();
    const h = 0.55 + rng() * 0.32;
    const out = 0.08 + rng() * 0.08;
    parts.push(buildOne(sp, d, rng, h, new THREE.Vector3(Math.cos(a) * out, 0, Math.sin(a) * out), 0.75 + rng() * 0.35));
  }
  return safeMerge(parts);
}

/** Material einer Art (eigene Farben/Muster als Uniforms; Variation per Instanz). */
export function speciesMaterial(sp: SpeciesDef, sway: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide, // Lamellen/Hutunterseite von unten sichtbar
    uniforms: {
      ...worldUniforms,
      uGillA: { value: new THREE.Color(sp.gillA) },
      uGillB: { value: new THREE.Color(sp.gillB) },
      uCap: { value: new THREE.Color(sp.capColor) },
      uPat: { value: new THREE.Color(sp.patternColor) },
      uStem: { value: new THREE.Color(sp.stemColor) },
      uPattern: { value: sp.pattern },
      uStemTex: { value: sp.stemTex },
      uGlow: { value: sp.glow },
    },
    vertexShader: /* glsl */ `
      attribute float aPart; attribute float aRad;
      attribute vec3 aTint; attribute float aPhase; attribute float aSeed;
      uniform float uTime;
      varying float vPart; varying float vRad; varying vec3 vLocal; varying vec3 vNormal; varying float vDist;
      varying vec3 vTint; varying float vPhase; varying float vSeed;
      void main(){
        vec3 p = position;
        float sway = ${sway.toFixed(4)} * p.y * p.y;
        p.x += sin(uTime * 0.7 + aPhase * 6.283) * sway;
        p.z += cos(uTime * 0.53 + aPhase * 4.0) * sway * 0.7;
        vLocal = position; vPart = aPart; vRad = aRad; vTint = aTint; vPhase = aPhase; vSeed = aSeed;
        vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vec4 mv = viewMatrix * w; vDist = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uTint; uniform float uTintAmt;
      uniform vec3 uGillA; uniform vec3 uGillB; uniform vec3 uCap; uniform vec3 uPat; uniform vec3 uStem;
      uniform int uPattern; uniform int uStemTex; uniform float uGlow;
      varying float vPart; varying float vRad; varying vec3 vLocal; varying vec3 vNormal; varying float vDist;
      varying vec3 vTint; varying float vPhase; varying float vSeed;
      ${GLSL_NOISE}
      ${GLSL_FOG}
      void main(){
        int part = int(vPart + 0.5);
        vec3 n = normalize(vNormal);
        if (!gl_FrontFacing) n = -n;
        float moonL = clamp(dot(n, normalize(vec3(-0.5, 0.8, -0.4))), 0.0, 1.0);
        float lightK = 0.35 + 0.75 * moonL;
        float pulse = 0.65 + 0.35 * sin(uTime * (0.5 + vPhase * 0.7) + vPhase * 40.0);
        vec3 gA = mix(uGillA * vTint, uTint, uTintAmt);
        vec3 gB = mix(uGillB * vTint, uTint, uTintAmt);
        float ang = atan(vLocal.z, vLocal.x);
        vec3 col;
        if (part == 0) {                       // Stiel
          vec3 base = uStem;
          if (uStemTex == 0) base *= 0.8 + 0.25 * sin(ang * 40.0 + vLocal.y * 6.0 + vSeed * 10.0); // Längsfasern
          else if (uStemTex == 1) { vec2 q = vec2(ang * 3.0, vLocal.y * 18.0); float e = abs(fract(q.x + 0.5 * floor(q.y)) - 0.5) + abs(fract(q.y) - 0.5); base *= 0.7 + 0.5 * smoothstep(0.35, 0.5, e); } // Netz
          else { float sc = step(0.6, vnoise(vec2(ang * 5.0, vLocal.y * 22.0) + vSeed * 7.0)); base = mix(base, base * 1.8, sc); } // Schuppen
          col = base * lightK + gA * 0.18 * (1.0 - smoothstep(0.0, 0.18, vRad)); // Basis glimmt (Myzel)
          col += gB * 0.05;
        } else if (part == 1) {                // Hutoberseite
          vec2 q = vLocal.xz * 22.0 + vSeed * 13.0;
          float m = 0.0;
          if (uPattern == 0) m = step(0.78, vnoise(q * 0.9));                              // Punkte
          else if (uPattern == 1) { vec2 f = fract(q * vec2(0.5, 0.8)) - 0.5; m = smoothstep(0.32, 0.18, length(f)) * step(0.25, vRad); } // Schuppen
          else if (uPattern == 2) m = smoothstep(0.55, 0.7, fbm(q * 0.25));               // Flecken
          else m = 0.5 + 0.5 * sin(ang * 70.0 + fbm(q * 0.2) * 6.0);                       // Maserung
          col = uCap * lightK * (0.85 + 0.3 * fbm(q * 0.15));
          float glowM = (uPattern == 3) ? m * 0.25 : m;
          col += uPat * vTint * glowM * 0.55 * pulse * uGlow;
          col += gB * smoothstep(0.9, 1.0, vRad) * 0.45 * pulse;                            // leuchtender Rand
        } else if (part == 2) {                // Hutunterseite zwischen den Lamellen
          col = mix(gA, gB, vRad) * 0.22 * pulse * uGlow + uCap * 0.3;
        } else if (part == 3) {                // Lamellen: Haupt-Leuchteffekt, zum Rand stärker
          float k = 0.25 + 1.15 * pow(clamp(vRad, 0.0, 1.0), 1.4);
          col = mix(gA, gB, smoothstep(0.1, 1.0, vRad)) * k * pulse * uGlow;
        } else if (part == 4) {                // Manschette
          col = uStem * lightK * 1.2 + gA * 0.12;
        } else {                               // Fern-LOD: Lamellen-Scheibe
          float stripes = 0.55 + 0.45 * sin(ang * 64.0);
          col = mix(gA, gB, vRad) * (0.25 + 0.9 * vRad) * stripes * pulse * uGlow;
        }
        gl_FragColor = vec4(applyFog(col, vDist), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Instanz-Attribute für eine Art anlegen. */
export function attachInstanceAttributes(geo: THREE.BufferGeometry, count: number): { tint: Float32Array; phase: Float32Array; seed: Float32Array } {
  const tint = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const seed = new Float32Array(count);
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
  return { tint, phase, seed };
}
