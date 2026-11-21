import * as THREE from 'three';
import { distanceToPolygonEdge, pointInPolygon } from '../../xr/math/vec2';
import type { QualityProfile } from '../scene';
import { GLSL_FOG, PALETTE, mulberry32, safeMerge, worldUniforms } from '../shared';
import { type Basin, regionRadius } from './basin';
import { FLORA_FOOT, FLORA_HEIGHT, type FloraKind, floraGeometry, floraInstanceAttributes, floraMaterial, hangingStrands } from './flora';
import { DETAIL, SPECIES, type SpeciesDef, attachInstanceAttributes, speciesGeometry, speciesMaterial } from './mushrooms';

/**
 * Vegetation der Senke.
 *
 * Bodenkontakt (Änderung 7): Jedes Objekt wird EINMAL bei der Generierung auf die Geländehöhe
 * gesetzt – aus derselben Höhenfunktion wie das Terrain. Die Grundfläche wird an mehreren Punkten
 * abgetastet, der niedrigste Wert gilt, dazu wird die Basis leicht versenkt (3 % der Höhe, max. 3 cm).
 * Pilze/Pflanzen wachsen fast senkrecht (höchstens 15° zur Hangnormalen hin + ≤ 5° Zufall),
 * Moospolster richten sich ganz an der Geländenormalen aus.
 *
 * LOD (statisch nach Abstand zur Spielfläche, der Spieler verlässt sie in Roomscale nicht →
 * es gibt zur Laufzeit keine LOD-Wechsel und damit kein „Ploppen“):
 *   Hang/Rand       → volle Geometrie mit Lamellen
 *   hinter dem Wall → Fern-LOD (leuchtende Lamellen-Scheibe)
 *   weit weg        → Low-Poly-LOD (8-Segment-Hut, 5-Segment-Stiel), in Gruppen – KEINE Billboards
 * Pro Pilzart und Stufe ein InstancedMesh.
 */

const vegetationShader = (swayAmount: number) => ({
  vertexShader: /* glsl */ `
    attribute float aGlow; attribute vec3 aColor; attribute float aPhase;
    uniform float uTime;
    varying float vGlow; varying vec3 vColor; varying float vPhase; varying vec3 vNormal; varying float vDist;
    void main(){
      vec3 p = position;
      float sway = ${swayAmount.toFixed(3)} * p.y * p.y;
      p.x += sin(uTime * 0.7 + aPhase * 6.283) * sway;
      p.z += cos(uTime * 0.53 + aPhase * 4.0) * sway * 0.7;
      #ifdef USE_INSTANCING
        mat4 im = instanceMatrix;
      #else
        mat4 im = mat4(1.0);
      #endif
      vec4 w = modelMatrix * im * vec4(p, 1.0);
      vNormal = normalize(mat3(modelMatrix * im) * normal);
      vec4 mv = viewMatrix * w; vDist = length(mv.xyz);
      vGlow = aGlow; vColor = aColor; vPhase = aPhase;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime; uniform vec3 uTint; uniform float uTintAmt;
    varying float vGlow; varying vec3 vColor; varying float vPhase; varying vec3 vNormal; varying float vDist;
    ${GLSL_FOG}
    void main(){
      vec3 n = normalize(vNormal);
      float moonL = clamp(dot(n, normalize(vec3(-0.5, 0.8, -0.4))), 0.0, 1.0);
      vec3 base = vec3(0.025, 0.02, 0.045) + vec3(0.05, 0.06, 0.12) * moonL;
      float pulse = 0.6 + 0.4 * sin(uTime * (0.6 + vPhase * 0.8) + vPhase * 40.0);
      vec3 glowCol = mix(vColor, uTint, uTintAmt);
      vec3 col = base + glowCol * vGlow * pulse * 0.95 + glowCol * 0.03;
      gl_FragColor = vec4(applyFog(col, vDist), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});

function makeMaterial(sway: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ uniforms: { ...worldUniforms }, side: THREE.DoubleSide, ...vegetationShader(sway) });
}

function setGlow(geo: THREE.BufferGeometry, fn: (p: THREE.Vector3, i: number) => number): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const glow = new Float32Array(pos.count);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) glow[i] = fn(v.fromBufferAttribute(pos, i), i);
  geo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
  return geo;
}

function fernGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const fronds = 6;
  for (let f = 0; f < fronds; f++) {
    const seg = 7;
    const positions: number[] = [];
    const glow: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const w = 0.09 * Math.sin(t * Math.PI) + 0.01;
      const x = t * 0.75;
      const y = Math.sin(t * Math.PI * 0.75) * 0.55;
      positions.push(x, y, -w, x, y + 0.02, 0, x, y, w);
      glow.push(0.15, 1.0, 0.15);
    }
    for (let i = 0; i < seg; i++) {
      const a = i * 3;
      const b = a + 3;
      idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(glow, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.rotateY((f / fronds) * Math.PI * 2 + (f % 2) * 0.3);
    parts.push(g);
  }
  return safeMerge(parts);
}

function podGeometry(): THREE.BufferGeometry {
  const stalk = new THREE.CylinderGeometry(0.012, 0.02, 0.8, 5, 1, true);
  stalk.translate(0, 0.4, 0);
  setGlow(stalk, () => 0.1);
  const ball = new THREE.IcosahedronGeometry(0.07, 1);
  ball.translate(0, 0.84, 0);
  setGlow(ball, () => 1.0);
  stalk.deleteAttribute('uv');
  ball.deleteAttribute('uv');
  return safeMerge([stalk, ball]);
}

/** Saum am Rand der Lichtung: flaches Moospolster mit zwei winzigen Leuchtpilzen (Einheit ≈ 1 → skaliert auf 3–6 cm). */
function saumGeometry(): THREE.BufferGeometry {
  const pad = new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.35, 1);
  pad.deleteAttribute('uv');
  setGlow(pad, (p) => (p.y > 0.25 ? 0.35 : 0.15));
  const parts: THREE.BufferGeometry[] = [pad];
  for (const [x, z, h] of [[0.35, 0.2, 0.9], [-0.3, -0.25, 0.65]]) {
    const stem = new THREE.CylinderGeometry(0.06, 0.08, h, 5, 1, true).translate(x, h / 2, z);
    stem.deleteAttribute('uv');
    setGlow(stem, () => 0.2);
    const cap = new THREE.SphereGeometry(0.28, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.5, 1).translate(x, h, z);
    cap.deleteAttribute('uv');
    setGlow(cap, () => 1.0);
    parts.push(stem, cap);
  }
  return safeMerge(parts);
}

/** Datensatz für die Bodenkontakt-Prüfung (Test + Debug-Modus). */
export interface GroundedObject {
  kind: string;
  base: THREE.Vector3;
  footRadius: number;
  /** ungefähre Objekthöhe (m) – für den Knöchel-Test am Rand der Spielfläche */
  height?: number;
}

interface Placement {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: number;
  foot: number;
}

const UP = new THREE.Vector3(0, 1, 0);

export function groundNormal(b: Basin, x: number, z: number): THREE.Vector3 {
  const e = 0.2;
  return new THREE.Vector3(b.heightAt(x - e, z) - b.heightAt(x + e, z), 2 * e, b.heightAt(x, z - e) - b.heightAt(x, z + e)).normalize();
}

/** Niedrigste Geländehöhe unter einer kreisförmigen Grundfläche (Mitte + 8 Randpunkte). */
export function footprintMin(b: Basin, x: number, z: number, r: number): number {
  let m = b.heightAt(x, z);
  if (r > 0.005) for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    m = Math.min(m, b.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r));
  }
  return m;
}

/** Versenkung der Basis: 3 % der Objekthöhe, mindestens 5 mm, höchstens 3 cm. */
export function sinkDepth(height: number): number {
  return Math.min(0.03, Math.max(0.005, height * 0.03));
}

/**
 * Objekt am Punkt (x, z) auf den Boden setzen.
 *  align 'normal': ganz an der Geländenormalen (Moos, Polster)
 *  sonst: fast senkrecht, höchstens `maxTiltDeg` zur Hangnormalen + `jitterDeg` Zufall, optional nach innen gelehnt
 */
function groundPlace(
  b: Basin,
  rng: () => number,
  x: number,
  z: number,
  height: number,
  foot: number,
  opts: { align?: 'normal'; maxTiltDeg?: number; jitterDeg?: number; leanInwardDeg?: number },
): Placement {
  const n = groundNormal(b, x, z);
  let up: THREE.Vector3;
  if (opts.align === 'normal') up = n.clone();
  else {
    const slope = UP.angleTo(n);
    const tilt = Math.min(slope, ((opts.maxTiltDeg ?? 15) * Math.PI) / 180);
    const axis = new THREE.Vector3().crossVectors(UP, n);
    up = axis.lengthSq() > 1e-9 ? UP.clone().applyAxisAngle(axis.normalize(), tilt) : UP.clone();
    if (opts.leanInwardDeg) {
      const th = b.thetaOf(x, z);
      const inAxis = new THREE.Vector3(-Math.sin(th), 0, Math.cos(th)); // Drehachse: kippt die Spitze nach innen (Richtung Spielfläche)
      up.applyAxisAngle(inAxis, (opts.leanInwardDeg * Math.PI) / 180);
    }
    const j = (((opts.jitterDeg ?? 5) * Math.PI) / 180) * rng();
    const ja = rng() * Math.PI * 2;
    up.applyAxisAngle(new THREE.Vector3(Math.cos(ja), 0, Math.sin(ja)), j);
  }
  const q = new THREE.Quaternion().setFromUnitVectors(UP, up.normalize());
  q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, rng() * Math.PI * 2));
  const y = footprintMin(b, x, z, foot) - sinkDepth(height);
  return { pos: new THREE.Vector3(x, y, z), quat: q, scale: height, foot };
}

/** Abstand-Band außerhalb der Fläche → Zufallspunkt (x, z) oder null (Sicherheitsstreifen frei halten). */
function bandPoint(b: Basin, rng: () => number, dMin: number, dMax: number, minOut: (t: number) => number): { x: number; z: number } | null {
  const theta = rng() * Math.PI * 2;
  const rb = regionRadius(b, theta);
  const d = dMin + (dMax - dMin) * rng();
  const x = b.center.x + Math.cos(theta) * (rb + d);
  const z = b.center.z + Math.sin(theta) * (rb + d);
  if (b.distOutside(x, z) < minOut(b.thetaOf(x, z))) return null;
  return { x, z };
}

interface ShroomInstance {
  p: Placement;
  species: number;
  /** feste LOD-Stufe (z. B. Baby-Pilze) statt Zonen-Zuordnung */
  fixedLod?: 0 | 1 | 2;
}

const debugGround = () => !!(globalThis as unknown as { __myzelDebugGround?: boolean }).__myzelDebugGround;

/**
 * LOD-Zuordnung nach Abstand zur Spielfläche: Zone 0 (Hang), 1 (Rand/dahinter), 2 (fern).
 * Objekte im Band ±1 m um eine Zonengrenze liegen in BEIDEN Stufen und werden abhängig vom
 * Kameraabstand komplementär gedithert überblendet (role 1 = nahe Stufe, role 2 = ferne Stufe).
 * Alle anderen bleiben ohne Überblendung in ihrer Stufe (kein Mehraufwand).
 */
export interface LodSlot {
  lod: 0 | 1 | 2;
  role: 0 | 1 | 2;
  fade: number;
}

export function lodSlots(b: Basin, x: number, z: number, maxLod: 0 | 1 | 2 = 2, band = 1.0): LodSlot[] {
  const t = b.thetaOf(x, z);
  const d = b.distOutside(x, z);
  const f = Math.hypot(x - b.center.x, z - b.center.z); // Überblend-Abstand (Kamera steht in der Fläche)
  const b1 = b.rimDistance(t) + 0.5;
  const b2 = b.rimDistance(t) + 9;
  let slots: LodSlot[];
  if (d < b1 - band) slots = [{ lod: 0, role: 0, fade: f }];
  else if (d <= b1 + band) slots = [{ lod: 0, role: 1, fade: f }, { lod: 1, role: 2, fade: f }];
  else if (d < b2 - band) slots = [{ lod: 1, role: 0, fade: f }];
  else if (d <= b2 + band) slots = [{ lod: 1, role: 1, fade: f }, { lod: 2, role: 2, fade: f }];
  else slots = [{ lod: 2, role: 0, fade: f }];
  // Arten ohne ferne Stufen: auf die höchste verfügbare begrenzen (Überblendung entfällt dann)
  const clamped = slots.map((s) => ({ ...s, lod: Math.min(s.lod, maxLod) as 0 | 1 | 2 }));
  if (clamped.length === 2 && clamped[0].lod === clamped[1].lod) return [{ lod: clamped[0].lod, role: 0, fade: f }];
  return clamped;
}

/** Farbschwerpunkt je Seite der Senke (Orientierung): vier Sektoren mit weichem, verrauschtem Übergang. */
const SIDE_PALETTES: [THREE.Color, THREE.Color][] = [
  [new THREE.Color('#1de9c9'), new THREE.Color('#8b3dff')], // Türkis / Violett
  [new THREE.Color('#ff2fb3'), new THREE.Color('#ff8a3d')], // Magenta / Orange
  [new THREE.Color('#2fd8ff'), new THREE.Color('#9dff3a')], // Cyan / Giftgrün
  [new THREE.Color('#b04dff'), new THREE.Color('#ff6bd5')], // Violett / Rosa
];

export function sidePalette(theta: number, jitter: number): [THREE.Color, THREE.Color] {
  const u = (((theta + Math.PI) / (Math.PI * 2)) * 4 + jitter * 0.6 + 4) % 4;
  const i = Math.floor(u);
  const k = THREE.MathUtils.smoothstep(u - i, 0.75, 1); // weicher Übergang zum Nachbarsektor
  const [a0, b0] = SIDE_PALETTES[i];
  const [a1, b1] = SIDE_PALETTES[(i + 1) % 4];
  return [a0.clone().lerp(a1, k), b0.clone().lerp(b1, k)];
}

function buildSpeciesMeshes(list: ShroomInstance[], sway: number, rng: () => number, b: Basin, profileDetail: 'low' | 'medium' | 'high'): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  const details = [DETAIL[profileDetail], DETAIL.far, DETAIL.vfar];
  SPECIES.forEach((sp: SpeciesDef, si) => {
    // neue Riesenarten haben nur zwei Stufen (nah, fern) → begrenzt Draw Calls
    const maxLod: 0 | 1 | 2 = sp.tiers || sp.jelly || sp.stem === 'spiral' ? 1 : 2;
    const perLod: { it: ShroomInstance; slot: LodSlot }[][] = [[], [], []];
    for (const it of list) {
      if (it.species !== si) continue;
      const slots = it.fixedLod !== undefined ? [{ lod: it.fixedLod, role: 0 as const, fade: 0 }] : lodSlots(b, it.p.pos.x, it.p.pos.z, maxLod);
      for (const slot of slots) perLod[slot.lod].push({ it, slot });
    }
    perLod.forEach((items, lod) => {
      if (!items.length) return;
      const geo = speciesGeometry(sp, details[lod], 77 + si * 101 + lod * 7);
      const attrs = attachInstanceAttributes(geo, items.length);
      const mesh = new THREE.InstancedMesh(geo, speciesMaterial(sp, lod === 2 ? 0 : sway), items.length);
      const m = new THREE.Matrix4();
      items.forEach(({ it, slot }, i) => {
        const s = it.p.scale;
        const r1 = 0.9 + ((it.p.pos.x * 13.7 + it.p.pos.z * 7.1) % 1 + 1) % 1 * 0.2; // deterministisch je Instanz (beide LOD-Kopien gleich)
        m.compose(it.p.pos, it.p.quat, new THREE.Vector3(s * r1, s, s * (2 - r1)));
        mesh.setMatrixAt(i, m);
        const [ca] = sidePalette(b.thetaOf(it.p.pos.x, it.p.pos.z), Math.sin(it.p.pos.x * 0.7) * Math.cos(it.p.pos.z * 0.6));
        // Farbschwerpunkt der Senkenseite leicht in die Leuchtfarben mischen
        attrs.tint.set([0.75 + ca.r * 0.45, 0.75 + ca.g * 0.45, 0.75 + ca.b * 0.45], i * 3);
        if (debugGround() && groundError(b, it.p.pos, it.p.foot) > 0.03) attrs.tint.set([6, 0, 0], i * 3);
        attrs.phase[i] = (Math.abs(Math.sin(it.p.pos.x * 12.9 + it.p.pos.z * 78.2)) * 43758.5) % 1;
        attrs.seed[i] = (attrs.phase[i] * 7.3) % 1;
        attrs.lod.set([slot.fade, slot.role], i * 2);
      });
      void rng;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.name = `shroom-${sp.id}-${['near', 'far', 'vfar'][lod]}`;
      out.push(mesh);
    });
  });
  return out;
}

/**
 * Abweichung der Basis vom Gelände: > 0 bedeutet Schweben (über der niedrigsten Stelle der
 * Grundfläche) bzw. zu tiefes Versinken (mehr als 3 cm unter ihr).
 */
export function groundError(b: Basin, base: THREE.Vector3, foot: number): number {
  const m = footprintMin(b, base.x, base.z, foot);
  const gap = base.y - m; // ≤ 0 erwartet (leicht versenkt)
  return gap > 0 ? gap : Math.max(0, -gap - 0.03);
}

export interface Vegetation {
  group: THREE.Group;
  /** Leuchtende Hüte (Weltpositionen) – Motten werden davon angezogen. */
  attractors: THREE.Vector3[];
  /** Bodennahe Punkte in der Vegetation (Zirp-Quellen der Insekten). */
  chirpSpots: THREE.Vector3[];
  /** Klangquellen der Pflanzen und Pilze (für die Geräuschkulisse). */
  soundSpots: { bubbles: THREE.Vector3[]; vines: THREE.Vector3[]; giants: THREE.Vector3[]; drips: THREE.Vector3[]; leaves: THREE.Vector3[] };
  /** Alle platzierten Objekte (für Bodenkontakt-Test/Debug). */
  grounded: GroundedObject[];
}

export function createVegetation(profile: QualityProfile, b: Basin): Vegetation {
  const group = new THREE.Group();
  group.name = 'vegetation';
  const rng = mulberry32(1234);
  const attractors: THREE.Vector3[] = [];
  const grounded: GroundedObject[] = [];
  const avgStart = b.rimStart(0);
  const avgRim = b.rimDistance(0);
  const keepOut = (pad: number) => (t: number) => b.rimStart(t) + pad;

  const record = (kind: string, p: Placement, height?: number) => grounded.push({ kind, base: p.pos.clone(), footRadius: p.foot, height });

  /** Punkte in Gruppen (Büscheln) statt gleichmäßig verteilt; `minOut` = Mindestabstand außerhalb der Fläche. */
  const clustered = (n: number, dMin: number, dMax: number, spread: number, perCluster: number, pad: number, minOut?: (t: number) => number) => {
    const out = minOut ?? keepOut(pad);
    const pts: { x: number; z: number }[] = [];
    let guard = 0;
    while (pts.length < n && guard++ < n * 40) {
      const c = bandPoint(b, rng, dMin, dMax, out);
      if (!c) continue;
      const k = 1 + Math.floor(rng() * perCluster);
      for (let i = 0; i < k && pts.length < n; i++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * spread;
        const x = c.x + Math.cos(a) * r;
        const z = c.z + Math.sin(a) * r;
        if (b.distOutside(x, z) >= out(b.thetaOf(x, z))) pts.push({ x, z });
      }
    }
    return pts;
  };

  const footOf = (sp: SpeciesDef, scale: number) => scale * (sp.cluster > 1 ? 0.2 : sp.stemR * (sp.stem === 'bulb' ? 2.2 : 1.5));
  const idx = (id: string) => SPECIES.findIndex((s) => s.id === id);

  // --- Hang: mittelhohe Pilze (volle Geometrie mit Lamellen) ---
  const all: ShroomInstance[] = [];
  const nearSpecies = SPECIES.map((s, i) => ({ s, i })).filter((x) => !['riesenschirm', 'etagenpilz', 'spiralpilz', 'gallertpilz'].includes(x.s.id));
  for (const pt of clustered(profile.nearShrooms, avgStart + 0.2, avgRim + 1.2, 1.2, 5, 0.15)) {
    const si = nearSpecies[Math.floor(rng() * nearSpecies.length)].i;
    const scale = 0.25 + Math.pow(rng(), 1.8) * 1.6;
    all.push({ p: groundPlace(b, rng, pt.x, pt.z, scale, footOf(SPECIES[si], scale), { maxTiltDeg: 15 }), species: si });
  }
  // Oben am Rand und dahinter: Riesenpilze (inkl. gestapelte Hüte, Spiralstiele, Gallerthüte), leicht nach innen geneigt
  const giantSpecies = ['riesenschirm', 'schirmling', 'glockenhut', 'buckelkappe', 'etagenpilz', 'spiralpilz', 'gallertpilz'].map(idx);
  const giants: ShroomInstance[] = [];
  for (const pt of clustered(profile.rimGiants, avgRim - 1.5, avgRim + 3, 2.5, 3, 0.3)) {
    const si = giantSpecies[Math.floor(rng() * giantSpecies.length)];
    const scale = 3 + rng() * 3.5;
    const it = { p: groundPlace(b, rng, pt.x, pt.z, scale, footOf(SPECIES[si], scale), { maxTiltDeg: 8, jitterDeg: 3, leanInwardDeg: 4 + rng() * 6 }), species: si };
    all.push(it);
    giants.push(it);
  }
  // Baby-Pilze / Mini-Kolonien rund um größere Exemplare (feste Fern-Geometrie, Lamellen wären unsichtbar)
  const parents = all.filter((x) => x.p.scale > 0.8);
  for (let k = 0; k < profile.babies && parents.length; k++) {
    const par = parents[Math.floor(rng() * parents.length)];
    const a = rng() * Math.PI * 2;
    const r = 0.15 + rng() * 0.45 * Math.min(2, par.p.scale);
    const x = par.p.pos.x + Math.cos(a) * r;
    const z = par.p.pos.z + Math.sin(a) * r;
    if (b.distOutside(x, z) < keepOut(0.15)(b.thetaOf(x, z))) continue;
    const scale = 0.05 + rng() * 0.14;
    all.push({ p: groundPlace(b, rng, x, z, scale, footOf(SPECIES[par.species], scale), { maxTiltDeg: 15 }), species: par.species, fixedLod: 1 });
  }
  // Hinter dem Wall und weit weg: dichte Büschel (Fern-LOD bzw. Low-Poly, automatisch per Zone)
  for (const pt of clustered(profile.farShrooms, avgRim + 1.5, avgRim + 12, 3, 6, 0.3)) {
    const si = Math.floor(rng() * SPECIES.length);
    const scale = 1.2 + rng() * 3.5;
    all.push({ p: groundPlace(b, rng, pt.x, pt.z, scale, footOf(SPECIES[si], scale), { maxTiltDeg: 12 }), species: si });
  }
  for (const pt of clustered(profile.vfarShrooms, avgRim + 10, avgRim + 32, 4, 9, 0.3)) {
    const si = nearSpecies[Math.floor(rng() * nearSpecies.length)].i;
    const scale = 1.5 + rng() * 5.5;
    all.push({ p: groundPlace(b, rng, pt.x, pt.z, scale, footOf(SPECIES[si], scale), { maxTiltDeg: 10 }), species: si });
  }
  for (const m of buildSpeciesMeshes(all, 0.025, rng, b, profile.shroomDetail)) group.add(m);
  for (const it of all) {
    record(it.fixedLod !== undefined ? 'shroom-baby' : 'shroom', it.p, it.p.scale);
    if (it.p.scale >= 0.6 && it.p.scale < 3 && attractors.length < 48) attractors.push(it.p.pos.clone().add(new THREE.Vector3(0, 0.85 * it.p.scale, 0).applyQuaternion(it.p.quat)));
  }

  // --- Neue Alien-Flora ---
  const floraKinds: FloraKind[] = ['bubble', 'tentacle', 'fan', 'coral', 'leaf', 'capsule', 'clumpA', 'clumpB'];
  const MAXLOD: Record<FloraKind, 0 | 1 | 2> = { bubble: 1, tentacle: 1, fan: 1, coral: 2, leaf: 2, capsule: 1, clumpA: 0, clumpB: 0 };
  const floraInst: Record<FloraKind, Placement[]> = { bubble: [], tentacle: [], fan: [], coral: [], leaf: [], capsule: [], clumpA: [], clumpB: [] };
  const placeFlora = (kind: FloraKind, n: number, dMin: number, dMax: number, s0: number, s1: number, spread: number, per: number, minOut?: (t: number) => number) => {
    for (const pt of clustered(n, dMin, dMax, spread, per, 0.15, minOut)) {
      const s = s0 + (s1 - s0) * Math.pow(rng(), 1.6);
      const pl = groundPlace(b, rng, pt.x, pt.z, s * FLORA_HEIGHT[kind], s * FLORA_FOOT[kind], kind.startsWith('clump') ? { align: 'normal' } : { maxTiltDeg: 15 });
      pl.scale = s; // Instanz-Skalierung (Geometrie ist auf Einheitsgröße gebaut)
      floraInst[kind].push(pl);
      record(`flora-${kind}`, pl, s * FLORA_HEIGHT[kind]);
    }
  };
  const fl = profile.flora;
  // Direkt am Rand der braunen Fläche: nur niedrige Büschel (≤ 30 cm), im flachen Streifen vor dem Hangfuß
  const stripOut = () => 0.15;
  placeFlora('clumpA', Math.round(fl.clumpA * 0.6), 0.15, avgStart, 0.6, 1.1, 0.6, 3, stripOut);
  placeFlora('clumpB', Math.round(fl.clumpB * 0.5), 0.2, avgStart, 0.6, 1.2, 0.6, 2, stripOut);
  // Hänge: mittelhohe Pflanzen
  placeFlora('clumpA', Math.round(fl.clumpA * 0.4), avgStart + 0.2, avgRim + 2, 0.8, 1.8, 1.0, 4);
  placeFlora('clumpB', Math.round(fl.clumpB * 0.5), avgStart + 0.2, avgRim + 2, 0.8, 2.0, 1.0, 3);
  placeFlora('bubble', fl.bubble, avgStart + 0.3, avgRim + 2, 0.6, 1.6, 1.2, 4);
  placeFlora('tentacle', fl.tentacle, avgStart + 0.3, avgRim + 1.5, 0.6, 1.5, 1.0, 4);
  placeFlora('fan', fl.fan, avgStart + 0.4, avgRim + 3, 0.7, 1.8, 1.4, 5);
  placeFlora('capsule', fl.capsule, avgStart + 0.3, avgRim + 2, 0.7, 1.5, 1.0, 4);
  // Rand und dahinter: Korallen und Riesenblätter in Riesengröße, dichteste Vegetation
  placeFlora('coral', Math.round(fl.coral * 0.5), avgStart + 0.5, avgRim + 2, 0.8, 1.8, 1.2, 4);
  placeFlora('coral', Math.round(fl.coral * 0.5), avgRim - 0.5, avgRim + 14, 2.0, 4.5, 3.0, 6);
  placeFlora('leaf', Math.round(fl.leaf * 0.5), avgStart + 0.5, avgRim + 2, 0.9, 1.8, 1.2, 3);
  placeFlora('leaf', Math.round(fl.leaf * 0.5), avgRim - 0.5, avgRim + 14, 2.0, 4.0, 3.0, 5);

  for (const kind of floraKinds) {
    const perLod: { p: Placement; slot: LodSlot }[][] = [[], [], []];
    for (const p of floraInst[kind]) for (const slot of lodSlots(b, p.pos.x, p.pos.z, MAXLOD[kind])) perLod[slot.lod].push({ p, slot });
    perLod.forEach((items, lod) => {
      if (!items.length) return;
      const geo = floraGeometry(kind, lod as 0 | 1 | 2, 31);
      const attrs = floraInstanceAttributes(geo, items.length);
      const mesh = new THREE.InstancedMesh(geo, floraMaterial(kind), items.length);
      const m = new THREE.Matrix4();
      items.forEach(({ p, slot }, i) => {
        m.compose(p.pos, p.quat, new THREE.Vector3(p.scale, p.scale, p.scale));
        mesh.setMatrixAt(i, m);
        const jitter = Math.sin(p.pos.x * 0.7) * Math.cos(p.pos.z * 0.6);
        let [ca, cb] = sidePalette(b.thetaOf(p.pos.x, p.pos.z), jitter);
        // Korallen/Fächer: kräftiges Magenta/Orange/Cyan, unabhängig vom Sektor etwas variieren
        if ((kind === 'coral' || kind === 'fan') && ((p.pos.x * 3.1 + p.pos.z) % 3 + 3) % 3 < 1) [ca, cb] = [new THREE.Color('#ff8a3d'), new THREE.Color('#ff2fb3')];
        if (debugGround() && groundError(b, p.pos, p.foot) > 0.03) [ca, cb] = [new THREE.Color(6, 0, 0), new THREE.Color(6, 0, 0)];
        attrs.colA.set([ca.r, ca.g, ca.b], i * 3);
        attrs.colB.set([cb.r, cb.g, cb.b], i * 3);
        attrs.phase[i] = (Math.abs(Math.sin(p.pos.x * 12.9 + p.pos.z * 78.2)) * 43758.5) % 1;
        attrs.lod.set([slot.fade, slot.role], i * 2);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.name = `flora-${kind}-${lod}`;
      group.add(mesh);
    });
  }

  // Hängende Leuchtfäden von den Riesenpilzhüten
  const capsForStrands = giants.slice(0, profile.hangingCaps).map((g) => ({
    pos: g.p.pos.clone().add(new THREE.Vector3(0, 0.86 * g.p.scale, 0).applyQuaternion(g.p.quat)),
    radius: SPECIES[g.species].capR * g.p.scale,
  }));
  const strands = hangingStrands(capsForStrands, rng);
  if (strands) group.add(strands);

  // --- Farne und Sporenkapseln am Hang ---
  const scatter = (kind: string, geo: THREE.BufferGeometry, mat: THREE.Material, pts: Placement[], colors: THREE.Color[]) => {
    const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
    const col = new Float32Array(pts.length * 3);
    const ph = new Float32Array(pts.length);
    const m = new THREE.Matrix4();
    pts.forEach((p, i) => {
      m.compose(p.pos, p.quat, new THREE.Vector3(p.scale, p.scale, p.scale));
      mesh.setMatrixAt(i, m);
      const c = debugGround() && groundError(b, p.pos, p.foot) > 0.03 ? new THREE.Color(6, 0, 0) : colors[Math.floor(rng() * colors.length)];
      col.set([c.r, c.g, c.b], i * 3);
      ph[i] = rng();
      record(kind, p, p.scale);
    });
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3));
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
    mesh.computeBoundingSphere();
    mesh.name = kind;
    return mesh;
  };
  const sized = (pts: { x: number; z: number }[], s0: number, s1: number, footK: number, opts: Parameters<typeof groundPlace>[6]) =>
    pts.map((pt) => {
      const s = s0 + (s1 - s0) * Math.pow(rng(), 2);
      return groundPlace(b, rng, pt.x, pt.z, s, s * footK, opts);
    });
  group.add(scatter('ferns', fernGeometry(), makeMaterial(0.12), sized(clustered(profile.ferns, avgStart + 0.15, avgRim + 2, 1.0, 4, 0.12), 0.4, 1.6, 0.3, { maxTiltDeg: 15 }), [PALETTE.cyan, PALETTE.turquoise, PALETTE.toxic]));
  group.add(scatter('pods', podGeometry(), makeMaterial(0.08), sized(clustered(profile.pods, avgStart + 0.4, avgRim + 1.5, 1.0, 5, 0.3), 0.5, 2, 0.03, { maxTiltDeg: 15 }), [PALETTE.magenta, PALETTE.toxic, PALETTE.violet]));

  // --- Saum am Rand der Spielfläche: flache Moospolster + Mini-Leuchtpilze, NIE in der Fläche ---
  const saumPts: Placement[] = [];
  const poly = b.region.pts;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const c = poly[(i + 1) % poly.length];
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    const n = Math.max(1, Math.round(len * profile.saumPerMeter));
    let nx = (c.z - a.z) / (len || 1);
    let nz = -(c.x - a.x) / (len || 1);
    const mid = { x: (a.x + c.x) / 2 + nx * 0.05, z: (a.z + c.z) / 2 + nz * 0.05 };
    if (pointInPolygon(mid, poly)) {
      nx = -nx;
      nz = -nz;
    }
    for (let k = 0; k < n; k++) {
      const t = (k + rng()) / n;
      const out = 0.08 + rng() * 0.3;
      const x = a.x + (c.x - a.x) * t + nx * out;
      const z = a.z + (c.z - a.z) * t + nz * out;
      const s = 0.03 + rng() * 0.035;
      if (pointInPolygon({ x, z }, poly) || distanceToPolygonEdge({ x, z }, poly) < s + 0.03) continue;
      saumPts.push(groundPlace(b, rng, x, z, s, s, { align: 'normal' }));
    }
  }
  if (saumPts.length) group.add(scatter('saum', saumGeometry(), makeMaterial(0.0), saumPts, [PALETTE.turquoise, PALETTE.cyan, PALETTE.toxic]));

  const vines = createVines(b, profile.vines, rng);
  if (vines) group.add(vines);
  const myc = createMycelium(b, all.filter((x) => x.p.scale > 0.45 && x.fixedLod === undefined).slice(0, profile.mycelium), rng);
  if (myc) group.add(myc);

  // Klangquellen (für die Geräuschkulisse)
  const chirpSpots = all.filter((x) => x.p.scale < 1.5).slice(0, 40).map((x) => x.p.pos.clone().add(new THREE.Vector3(0, 0.1, 0)));
  const soundSpots = {
    bubbles: floraInst.bubble.slice(0, 24).map((p) => p.pos.clone().add(new THREE.Vector3(0, 0.6 * p.scale, 0))),
    vines: floraInst.tentacle.slice(0, 24).map((p) => p.pos.clone().add(new THREE.Vector3(0, 0.4 * p.scale, 0))),
    giants: giants.map((g) => g.p.pos.clone().add(new THREE.Vector3(0, 0.86 * g.p.scale, 0).applyQuaternion(g.p.quat))),
    drips: capsForStrands.map((c) => c.pos.clone().add(new THREE.Vector3(0, -0.2, 0))),
    leaves: floraInst.leaf.slice(0, 24).map((p) => p.pos.clone().add(new THREE.Vector3(0, 1.0 * p.scale, 0))),
  };

  return { group, attractors, chirpSpots, soundSpots, grounded };
}

/** Leuchtende Ranken vom Rand den Hang hinunter, dem Gelände folgend. */
function createVines(b: Basin, count: number, rng: () => number): THREE.Mesh | null {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const theta = rng() * Math.PI * 2;
    const rb = regionRadius(b, theta);
    const dTop = b.rimDistance(theta) - 0.1;
    const dBot = b.rimStart(theta) + 0.35 + rng() * 0.6;
    const pts: THREE.Vector3[] = [];
    const wig = rng() * 6;
    for (let k = 0; k <= 14; k++) {
      const t = k / 14;
      const d = dTop + (dBot - dTop) * t;
      const th = theta + Math.sin(t * 5 + wig) * 0.04;
      const x = b.center.x + Math.cos(th) * (rb + d);
      const z = b.center.z + Math.sin(th) * (rb + d);
      pts.push(new THREE.Vector3(x, b.heightAt(x, z) + 0.025, z));
    }
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.02 + rng() * 0.012, 4, false);
    tube.deleteAttribute('uv');
    setGlow(tube, (_p, idx) => ((idx >> 2) % 7 === 0 ? 1 : 0.18));
    const c = [PALETTE.toxic, PALETTE.turquoise, PALETTE.magenta][Math.floor(rng() * 3)];
    const n = tube.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let j = 0; j < n; j++) col.set([c.r, c.g, c.b], j * 3);
    tube.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    tube.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(n).fill(rng()), 1));
    parts.push(tube);
  }
  if (!parts.length) return null;
  const mesh = new THREE.Mesh(safeMerge(parts), makeMaterial(0.0));
  mesh.name = 'vines';
  return mesh;
}

/** Leuchtende Myzelfäden: flache Bänder von der Pilzbasis über das Gelände (nie in die Spielfläche). */
function createMycelium(b: Basin, roots: ShroomInstance[], rng: () => number): THREE.Mesh | null {
  const pos: number[] = [];
  const fade: number[] = [];
  const idx: number[] = [];
  for (const r of roots) {
    const strands = 2 + Math.floor(rng() * 3);
    for (let s = 0; s < strands; s++) {
      let a = rng() * Math.PI * 2;
      let x = r.p.pos.x;
      let z = r.p.pos.z;
      const len = (0.4 + rng() * 1.0) * Math.min(2.5, 0.6 + r.p.scale);
      const steps = 8;
      const w = 0.008 + rng() * 0.008;
      const base = pos.length / 3;
      let made = 0;
      for (let k = 0; k <= steps; k++) {
        if (k > 0) {
          a += (rng() - 0.5) * 0.7;
          x += Math.cos(a) * (len / steps);
          z += Math.sin(a) * (len / steps);
          if (b.distOutside(x, z) < b.rimStart(b.thetaOf(x, z)) + 0.05) break;
        }
        const y = b.heightAt(x, z) + 0.012;
        const sx = -Math.sin(a) * w;
        const sz = Math.cos(a) * w;
        pos.push(x + sx, y, z + sz, x - sx, y, z - sz);
        fade.push(1 - k / steps, 1 - k / steps);
        made++;
      }
      for (let k = 0; k < made - 1; k++) {
        const p = base + k * 2;
        idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3);
      }
    }
  }
  if (!idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aFade', new THREE.Float32BufferAttribute(fade, 1));
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { ...worldUniforms },
    vertexShader: `attribute float aFade; varying float vF; varying vec3 vW; void main(){ vF = aFade; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; uniform vec3 uTint; uniform float uTintAmt; varying float vF; varying vec3 vW;
      void main(){ float p = 0.5 + 0.5 * sin(uTime * 1.6 - vF * 6.0 + vW.x * 2.0);
        vec3 c = mix(vec3(0.3, 1.0, 0.9), uTint, uTintAmt);
        gl_FragColor = vec4(c * vF * (0.25 + 0.5 * p), vF * 0.8); }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'mycelium';
  return mesh;
}
