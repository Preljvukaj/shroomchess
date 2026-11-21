import * as THREE from 'three';
import { GLSL_FOG, mulberry32, safeMerge, worldUniforms } from '../shared';

/**
 * Alien-Flora (eigenständige, prozedurale Formen – kein Nachbau fremder Designs).
 * Jede Art: Geometrie mit Seed, 3 LOD-Stufen (0 nah … 2 fern), ein InstancedMesh pro Art und Stufe.
 *
 * Vertex-Attribute: aGlow (0..1 Leuchten), aPart (0 fest, 1 durchscheinend/Blase, 2 schwebend, 3 Pfütze),
 * aH (0..1 Höhe entlang der Pflanze, für Bewegung), aCenter (Kugelmittelpunkt für das Pulsieren).
 * Instanz-Attribute: aColA/aColB (Farbschwerpunkt der Senkenseite), aPhase, aLod (LOD-Überblendung).
 */

export type FloraKind = 'bubble' | 'tentacle' | 'fan' | 'coral' | 'leaf' | 'capsule' | 'clumpA' | 'clumpB';

/** Bewegungsart je Art (im Vertex-Shader). */
const MOTION: Record<FloraKind, number> = { bubble: 2, tentacle: 1, fan: 0, coral: 0, leaf: 0, capsule: 3, clumpA: 0, clumpB: 0 };
const AMP: Record<FloraKind, number> = { bubble: 0.04, tentacle: 0.28, fan: 0.06, coral: 0.015, leaf: 0.08, capsule: 0.05, clumpA: 0.04, clumpB: 0.0 };

interface B {
  pos: number[];
  glow: number[];
  part: number[];
  h: number[];
  center: number[];
  idx: number[];
}
const nb = (): B => ({ pos: [], glow: [], part: [], h: [], center: [], idx: [] });

function finish(b: B): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('aGlow', new THREE.Float32BufferAttribute(b.glow, 1));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(b.part, 1));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(b.h, 1));
  g.setAttribute('aCenter', new THREE.Float32BufferAttribute(b.center, 3));
  g.setIndex(b.idx);
  g.computeVertexNormals();
  return g;
}

/** Fremde Geometrie (z. B. Kugel) mit konstanten Attributen in den Builder übernehmen. */
function addGeo(b: B, g: THREE.BufferGeometry, attrs: { glow: number | ((p: THREE.Vector3) => number); part: number; h?: (p: THREE.Vector3) => number; center?: THREE.Vector3 }, height: number): void {
  const gi = g.index ? g : g;
  const pos = gi.getAttribute('position');
  const base = b.pos.length / 3;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    b.pos.push(v.x, v.y, v.z);
    b.glow.push(typeof attrs.glow === 'number' ? attrs.glow : attrs.glow(v));
    b.part.push(attrs.part);
    b.h.push(attrs.h ? attrs.h(v) : Math.min(1, Math.max(0, v.y / height)));
    const c = attrs.center ?? new THREE.Vector3();
    b.center.push(c.x, c.y, c.z);
  }
  if (gi.index) for (let i = 0; i < gi.index.count; i++) b.idx.push(base + gi.index.getX(i));
  else for (let i = 0; i < pos.count; i++) b.idx.push(base + i);
}

/** Röhre entlang einer Kurve mit Radiusfunktion und optionalen Rippen. */
function tube(b: B, curve: THREE.Curve<THREE.Vector3>, segs: number, radial: number, radius: (t: number) => number, glow: (t: number, a: number) => number, height: number): void {
  const frames = curve.computeFrenetFrames(segs, false);
  const base = b.pos.length / 3;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = curve.getPointAt(t);
    const N = frames.normals[i];
    const Bn = frames.binormals[i];
    for (let s = 0; s <= radial; s++) {
      const a = (s / radial) * Math.PI * 2;
      const r = radius(t);
      b.pos.push(p.x + (Math.cos(a) * N.x + Math.sin(a) * Bn.x) * r, p.y + (Math.cos(a) * N.y + Math.sin(a) * Bn.y) * r, p.z + (Math.cos(a) * N.z + Math.sin(a) * Bn.z) * r);
      b.glow.push(glow(t, a));
      b.part.push(0);
      b.h.push(Math.min(1, Math.max(0, p.y / height)));
      b.center.push(0, 0, 0);
    }
  }
  for (let i = 0; i < segs; i++) for (let s = 0; s < radial; s++) {
    const a0 = base + i * (radial + 1) + s;
    const b0 = base + (i + 1) * (radial + 1) + s;
    b.idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
  }
}

const LODS = [
  { seg: 1, rad: 1, ico: 2 },
  { seg: 0.6, rad: 0.7, ico: 1 },
  { seg: 0.35, rad: 0.5, ico: 0 },
];

/** Geometrie einer Art in Einheitsgröße (Höhe ≈ 1 m bei Skalierung 1). */
export function floraGeometry(kind: FloraKind, lod: 0 | 1 | 2, seed = 1): THREE.BufferGeometry {
  const r = mulberry32(seed + kind.length * 101);
  const L = LODS[lod];
  const b = nb();
  const S = (n: number) => Math.max(2, Math.round(n * L.seg));
  const R = (n: number) => Math.max(3, Math.round(n * L.rad));
  switch (kind) {
    case 'bubble': {
      // Knollen-/Blasenpflanze: gebogene Stängel mit prallen, durchscheinenden Leuchtkugeln
      const n = 3;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r();
        const hgt = 0.5 + r() * 0.45;
        const top = new THREE.Vector3(Math.cos(a) * 0.15, hgt, Math.sin(a) * 0.15);
        const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a) * 0.02, hgt * 0.5, Math.sin(a) * 0.02), top);
        tube(b, curve, S(6), R(5), (t) => 0.018 * (1 - t * 0.5), (t) => 0.1 + t * 0.2, 1);
        const rad = 0.09 + r() * 0.08;
        const sph = new THREE.IcosahedronGeometry(rad, L.ico).translate(top.x, top.y + rad * 0.8, top.z);
        addGeo(b, sph, { glow: 1, part: 1, h: () => 1, center: new THREE.Vector3(top.x, top.y + rad * 0.8, top.z) }, 1);
      }
      break;
    }
    case 'tentacle': {
      // Gerippte Tentakel-Ranken, die aus dem Boden ragen (winden sich im Shader)
      const n = 4;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r() * 0.8;
        const hgt = 0.55 + r() * 0.5;
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k <= 5; k++) {
          const t = k / 5;
          pts.push(new THREE.Vector3(Math.cos(a) * (0.05 + t * 0.12) + Math.sin(t * 4 + a) * 0.05, t * hgt, Math.sin(a) * (0.05 + t * 0.12) + Math.cos(t * 3 + a) * 0.05));
        }
        tube(b, new THREE.CatmullRomCurve3(pts), S(14), R(7), (t) => 0.045 * (1 - t * 0.85) * (1 + 0.18 * Math.max(0, Math.sin(t * 40))), (t) => (Math.sin(t * 40) > 0.6 ? 0.8 : 0.08) + (t > 0.9 ? 1 : 0), 1);
      }
      break;
    }
    case 'fan': {
      // Flacher, gewellter Fächer auf kurzem Stiel, leuchtende Rippen
      const stem = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.01, 0.15, 0), new THREE.Vector3(0, 0.3, 0.01)]);
      tube(b, stem, S(4), R(5), () => 0.02, () => 0.1, 1);
      const ns = S(14);
      const nr = S(6);
      const base = b.pos.length / 3;
      for (let i = 0; i <= nr; i++) for (let j = 0; j <= ns; j++) {
        const rr = 0.03 + (i / nr) * 0.6;
        const ang = (-0.6 + (j / ns) * 1.2) * Math.PI * 0.5;
        const wave = Math.sin(rr * 14 + ang * 5) * 0.04 * (i / nr);
        b.pos.push(Math.sin(ang) * rr, 0.3 + Math.cos(ang) * rr * 0.9, wave);
        const rib = Math.abs(Math.sin(ang * 9)) < 0.15 ? 1 : 0.15;
        b.glow.push(Math.max(rib, i === nr ? 0.9 : 0));
        b.part.push(0);
        b.h.push(i / nr);
        b.center.push(0, 0, 0);
      }
      for (let i = 0; i < nr; i++) for (let j = 0; j < ns; j++) {
        const a0 = base + i * (ns + 1) + j;
        const b0 = base + (i + 1) * (ns + 1) + j;
        b.idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
      }
      break;
    }
    case 'coral': {
      // Verzweigte, korallenartige Struktur (rekursiv), leuchtende Spitzen
      const branch = (from: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, depth: number) => {
        const to = from.clone().addScaledVector(dir, len);
        const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3((r() - 0.5) * len * 0.3, 0, (r() - 0.5) * len * 0.3));
        tube(b, new THREE.QuadraticBezierCurve3(from, mid, to), S(5), R(5), (t) => rad * (1 - t * 0.35), (t) => (depth === 0 && t > 0.8 ? 1 : 0.12), 1);
        if (depth > 0) {
          const kids = 2 + (r() < 0.4 ? 1 : 0);
          for (let k = 0; k < kids; k++) {
            const d = dir.clone().add(new THREE.Vector3((r() - 0.5) * 1.2, 0.3 + r() * 0.4, (r() - 0.5) * 1.2)).normalize();
            branch(to, d, len * 0.68, rad * 0.65, depth - 1);
          }
        } else {
          const tip = new THREE.IcosahedronGeometry(rad * 1.6, Math.max(0, L.ico - 1)).translate(to.x, to.y, to.z);
          addGeo(b, tip, { glow: 1, part: 0 }, 1);
        }
      };
      branch(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 0.35, 0.045, lod === 2 ? 1 : 2);
      break;
    }
    case 'leaf': {
      // Überdimensionales, gezacktes Blatt auf Stiel, mit leuchtenden Adern (Mittelrippe + Seitenadern)
      const stalk = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.35, 0.05), new THREE.Vector3(0, 0.55, 0.22));
      tube(b, stalk, S(6), R(5), (t) => 0.03 * (1 - t * 0.4), () => 0.15, 1);
      const nu = S(16);
      const nv = S(8);
      const base = b.pos.length / 3;
      for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
        const u = i / nu;
        const v = j / nv * 2 - 1;
        const width = Math.sin(Math.PI * Math.min(1, u * 1.1)) * 0.28 * (1 + 0.18 * Math.sign(Math.sin(u * 34)) * Math.abs(v)); // gezackter Rand
        const x = v * width;
        const along = u * 0.95;
        const bend = Math.sin(u * Math.PI * 0.8) * 0.25;
        b.pos.push(x, 0.55 + along * 0.55 + bend * 0.3 - Math.abs(v) * 0.05, 0.22 + along * 0.7 - bend * 0.2);
        const mid = Math.abs(v) < 0.06 ? 1 : 0;
        const lateral = Math.abs(Math.sin((u * 7 - Math.abs(v) * 1.2) * Math.PI)) < 0.12 ? 0.75 : 0;
        b.glow.push(Math.max(mid, lateral, 0.06));
        b.part.push(0);
        b.h.push(0.4 + u * 0.6);
        b.center.push(0, 0, 0);
      }
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        const a0 = base + i * (nv + 1) + j;
        const b0 = base + (i + 1) * (nv + 1) + j;
        b.idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
      }
      break;
    }
    case 'capsule': {
      // Pflanze mit kleinen, darüber schwebenden Sporenkapseln
      const stem = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.03, 0.2, 0), new THREE.Vector3(-0.02, 0.4, 0.02)]);
      tube(b, stem, S(5), R(5), (t) => 0.025 * (1 - t * 0.5), (t) => 0.1 + t * 0.4, 1);
      const cup = new THREE.SphereGeometry(0.07, R(8), 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(-0.02, 0.44, 0.02);
      addGeo(b, cup, { glow: 0.6, part: 0, h: () => 0.4 }, 1);
      for (let k = 0; k < 4; k++) {
        const c = new THREE.Vector3((r() - 0.5) * 0.2, 0.55 + r() * 0.3, (r() - 0.5) * 0.2);
        const sph = new THREE.IcosahedronGeometry(0.025 + r() * 0.02, Math.max(0, L.ico - 1)).translate(c.x, c.y, c.z);
        addGeo(b, sph, { glow: 1, part: 2, h: () => 1, center: c }, 1);
      }
      break;
    }
    case 'clumpA': {
      // Bodendetail: Alien-Grasbüschel mit Leuchtspitzen, kugelige Moosbüsche, Mini-Pilzkolonie (≤ 25 cm)
      for (let k = 0; k < S(10); k++) {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r()) * 0.4;
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        const hgt = 0.1 + r() * 0.14;
        const lean = new THREE.Vector3((r() - 0.5) * 0.08, hgt, (r() - 0.5) * 0.08);
        tube(b, new THREE.QuadraticBezierCurve3(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, hgt * 0.5, z), new THREE.Vector3(x + lean.x, lean.y, z + lean.z)), 3, 3, (t) => 0.006 * (1 - t), (t) => (t > 0.8 ? 1 : 0.1), 0.25);
      }
      for (let k = 0; k < 3; k++) {
        const c = new THREE.Vector3((r() - 0.5) * 0.6, 0, (r() - 0.5) * 0.6);
        const rad = 0.05 + r() * 0.05;
        const ball = new THREE.IcosahedronGeometry(rad, L.ico).scale(1, 0.75, 1).translate(c.x, rad * 0.6, c.z);
        addGeo(b, ball, { glow: (p) => (p.y > rad * 1.0 ? 0.35 : 0.08), part: 0, h: () => 0.2 }, 0.25);
      }
      for (let k = 0; k < 5; k++) {
        const x = (r() - 0.5) * 0.5;
        const z = (r() - 0.5) * 0.5;
        const hgt = 0.03 + r() * 0.05;
        const st = new THREE.CylinderGeometry(0.004, 0.006, hgt, 4, 1, true).translate(x, hgt / 2, z);
        const cap = new THREE.SphereGeometry(0.014 + r() * 0.01, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, hgt, z);
        addGeo(b, st, { glow: 0.1, part: 0 }, 0.25);
        addGeo(b, cap, { glow: 1, part: 0 }, 0.25);
      }
      break;
    }
    case 'clumpB': {
      // Bodendetail: Steine mit leuchtenden Flechten, glänzende Sporenpfütze, Kiesel
      for (let k = 0; k < 3; k++) {
        const c = new THREE.Vector3((r() - 0.5) * 0.7, 0, (r() - 0.5) * 0.7);
        const rad = 0.06 + r() * 0.08;
        const st = new THREE.IcosahedronGeometry(rad, Math.max(0, L.ico - 1));
        const pos = st.getAttribute('position');
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          v.multiplyScalar(0.8 + 0.4 * Math.abs(Math.sin(v.x * 40 + v.z * 30 + k)));
          v.y *= 0.6;
          pos.setXYZ(i, v.x + c.x, v.y + rad * 0.35, v.z + c.z);
        }
        addGeo(b, st, { glow: (p) => (Math.sin(p.x * 70) * Math.sin(p.z * 60) > 0.55 && p.y > rad * 0.4 ? 0.9 : 0.04), part: 0, h: () => 0 }, 0.25);
      }
      // Sporenpfütze: flache Scheibe knapp über dem Boden (glänzender Shader-Teil)
      const pud = new THREE.CircleGeometry(0.22, R(14)).rotateX(-Math.PI / 2).translate(0.15, 0.006, -0.1);
      addGeo(b, pud, { glow: 0, part: 3, h: () => 0 }, 0.25);
      for (let k = 0; k < 6; k++) {
        const peb = new THREE.IcosahedronGeometry(0.015 + r() * 0.02, 0).scale(1, 0.6, 1).translate((r() - 0.5) * 0.8, 0.008, (r() - 0.5) * 0.8);
        addGeo(b, peb, { glow: 0.03, part: 0, h: () => 0 }, 0.25);
      }
      break;
    }
  }
  return finish(b);
}

/** Bayer-4×4-Dithering + LOD-Überblendung (gemeinsam für Flora und Pilze). */
export const GLSL_LOD_DITHER = /* glsl */ `
float bayer4(vec2 p){
  ivec2 i = ivec2(mod(p, 4.0));
  int idx = i.x + i.y * 4;
  int m[16] = int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);
  return (float(m[idx]) + 0.5) / 16.0;
}
// role 0: keine Überblendung; 1: Kopie der nahen Stufe (blendet bei Entfernung aus); 2: Kopie der fernen Stufe (blendet ein)
bool lodDiscard(vec2 aLod, float camDist){
  if (aLod.y < 0.5) return false;
  float a = 1.0 - smoothstep(aLod.x - 0.75, aLod.x + 0.75, camDist);
  float b = bayer4(gl_FragCoord.xy);
  return aLod.y < 1.5 ? (a < b) : (a >= b); // komplementär → kein Loch, keine Doppelung
}
`;

export function floraMaterial(kind: FloraKind): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...worldUniforms, uMotion: { value: MOTION[kind] }, uAmp: { value: AMP[kind] } },
    vertexShader: /* glsl */ `
      attribute float aGlow; attribute float aPart; attribute float aH; attribute vec3 aCenter;
      attribute vec3 aColA; attribute vec3 aColB; attribute float aPhase; attribute vec2 aLod;
      uniform float uTime; uniform float uWind; uniform int uMotion; uniform float uAmp;
      varying float vGlow; varying float vPart; varying float vH; varying vec3 vColA; varying vec3 vColB; varying float vPhase;
      varying vec3 vNormal; varying float vDist; varying vec2 vLod; varying float vCamDist; varying vec3 vView;
      void main(){
        vec3 p = position;
        float ph = aPhase * 6.283;
        float wind = 1.0 + 2.5 * uWind;
        if (uMotion == 0) {            // Wiegen
          float s = uAmp * aH * aH * wind;
          p.x += sin(uTime * 0.8 + ph) * s; p.z += cos(uTime * 0.6 + ph) * s * 0.7;
        } else if (uMotion == 1) {     // langsames Winden (Tentakel)
          float s = uAmp * aH * aH;
          p.x += sin(uTime * 0.7 + ph + aH * 3.0) * s * wind;
          p.z += cos(uTime * 0.55 + ph + aH * 2.4) * s * wind;
          p.y *= 1.0 + 0.04 * sin(uTime * 0.9 + ph);
        } else if (uMotion == 2) {     // Pulsieren der Blasen (Atmen)
          if (aPart > 0.5 && aPart < 1.5) p = aCenter + (p - aCenter) * (1.0 + 0.07 * sin(uTime * 1.6 + ph + aCenter.x * 9.0));
          float s = uAmp * aH * aH * wind; p.x += sin(uTime * 0.7 + ph) * s;
        } else {                       // schwebende Kapseln
          if (aPart > 1.5 && aPart < 2.5) { p.y += sin(uTime * 1.3 + ph + aCenter.x * 20.0) * 0.04; p.x += cos(uTime * 0.9 + aCenter.z * 15.0) * 0.02; }
          float s = uAmp * aH * aH * wind; p.x += sin(uTime * 0.8 + ph) * s;
        }
        vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vec3 c = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vCamDist = distance(cameraPosition, c);
        vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vView = normalize(cameraPosition - w.xyz);
        vec4 mv = viewMatrix * w; vDist = length(mv.xyz);
        vGlow = aGlow; vPart = aPart; vH = aH; vColA = aColA; vColB = aColB; vPhase = aPhase; vLod = aLod;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uTint; uniform float uTintAmt;
      varying float vGlow; varying float vPart; varying float vH; varying vec3 vColA; varying vec3 vColB; varying float vPhase;
      varying vec3 vNormal; varying float vDist; varying vec2 vLod; varying float vCamDist; varying vec3 vView;
      ${GLSL_FOG}
      ${GLSL_LOD_DITHER}
      void main(){
        if (lodDiscard(vLod, vCamDist)) discard;
        vec3 n = normalize(vNormal);
        if (!gl_FrontFacing) n = -n;
        float moonL = clamp(dot(n, normalize(vec3(-0.5, 0.8, -0.4))), 0.0, 1.0);
        float pulse = 0.65 + 0.35 * sin(uTime * (0.6 + vPhase * 0.8) + vPhase * 40.0);
        vec3 a = mix(vColA, uTint, uTintAmt);
        vec3 b = mix(vColB, uTint, uTintAmt);
        vec3 base = a * 0.06 + vec3(0.02, 0.02, 0.04) + vec3(0.04, 0.05, 0.1) * moonL;
        vec3 glow = mix(a, b, vH) * vGlow * pulse;
        vec3 col = base + glow;
        float fres = pow(1.0 - abs(dot(n, normalize(vView))), 2.0);
        if (vPart > 0.5 && vPart < 1.5) {
          // durchscheinende Blase: gedithert statt echter Transparenz, innen leuchtend, Rand heller
          if (bayer4(gl_FragCoord.xy + 1.0) > 0.62 + 0.3 * fres) discard;
          col = b * (0.35 + 0.7 * pulse) + a * fres * 0.8;
        } else if (vPart > 2.5) {
          // Sporenpfütze: dunkel glänzend, Himmelsreflex am Rand, Leuchtpunkte
          col = vec3(0.01, 0.015, 0.03) + vec3(0.12, 0.1, 0.25) * fres + b * 0.08 * step(0.92, fract(sin(dot(floor(gl_FragCoord.xy * 0.25), vec2(12.9, 78.2))) * 43758.5));
        }
        gl_FragColor = vec4(applyFog(col, vDist), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Instanz-Attribute für Flora. */
export function floraInstanceAttributes(geo: THREE.BufferGeometry, count: number): { colA: Float32Array; colB: Float32Array; phase: Float32Array; lod: Float32Array } {
  const colA = new Float32Array(count * 3);
  const colB = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const lod = new Float32Array(count * 2);
  geo.setAttribute('aColA', new THREE.InstancedBufferAttribute(colA, 3));
  geo.setAttribute('aColB', new THREE.InstancedBufferAttribute(colB, 3));
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  geo.setAttribute('aLod', new THREE.InstancedBufferAttribute(lod, 2));
  return { colA, colB, phase, lod };
}

/** Höhe der Art bei Skalierung 1 (für Grundfläche/Versenkung und Knöchel-Test). */
export const FLORA_HEIGHT: Record<FloraKind, number> = { bubble: 1.1, tentacle: 1.05, fan: 0.95, coral: 0.9, leaf: 1.2, capsule: 0.85, clumpA: 0.25, clumpB: 0.16 };
export const FLORA_FOOT: Record<FloraKind, number> = { bubble: 0.15, tentacle: 0.17, fan: 0.05, coral: 0.08, leaf: 0.05, capsule: 0.04, clumpA: 0.4, clumpB: 0.45 };

/** Hängende Leuchtfäden/Lianen von Pilzhüten (ein zusammengeführtes Mesh). */
export function hangingStrands(caps: { pos: THREE.Vector3; radius: number }[], rng: () => number): THREE.Mesh | null {
  const b = nb();
  for (const c of caps) {
    const n = 5 + Math.floor(rng() * 6);
    for (let k = 0; k < n; k++) {
      const a = rng() * Math.PI * 2;
      const rr = c.radius * (0.55 + rng() * 0.4);
      const top = new THREE.Vector3(c.pos.x + Math.cos(a) * rr, c.pos.y, c.pos.z + Math.sin(a) * rr);
      const len = 0.5 + rng() * Math.min(2.2, c.pos.y * 0.6);
      const curve = new THREE.QuadraticBezierCurve3(top, top.clone().add(new THREE.Vector3((rng() - 0.5) * 0.15, -len * 0.5, (rng() - 0.5) * 0.15)), top.clone().add(new THREE.Vector3((rng() - 0.5) * 0.25, -len, (rng() - 0.5) * 0.25)));
      const start = b.pos.length;
      tube(b, curve, 8, 3, (t) => 0.008 * (1 - t * 0.5), (t) => (Math.floor(t * 8) % 3 === 0 ? 0.9 : 0.2), 1);
      // aH = Abstand vom Aufhängepunkt (0 oben … 1 unten) → nur das freie Ende schwingt
      for (let i = start / 3, j = 0; i < b.pos.length / 3; i++, j++) b.h[i] = Math.min(1, Math.floor(j / 4) / 8);
    }
  }
  if (!b.idx.length) return null;
  const geo = finish(b);
  const count = 1;
  const attrs = floraInstanceAttributes(geo, count);
  attrs.colA.set([0.2, 1.0, 0.85]);
  attrs.colB.set([0.7, 0.35, 1.0]);
  attrs.phase[0] = 0.3;
  const mesh = new THREE.InstancedMesh(geo, floraMaterial('fan'), 1);
  mesh.setMatrixAt(0, new THREE.Matrix4());
  mesh.name = 'hanging-strands';
  return mesh;
}

export { safeMerge };
