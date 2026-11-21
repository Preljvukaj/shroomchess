import * as THREE from 'three';
import type { QualityProfile } from '../scene';
import { GLSL_FOG, PALETTE, mulberry32, safeMerge, worldUniforms } from '../shared';
import { type Basin, regionRadius } from './basin';
import { DETAIL, SPECIES, type SpeciesDef, attachInstanceAttributes, createBillboards, speciesGeometry, speciesMaterial } from './mushrooms';

/**
 * Vegetation der Senke. Vegetation wächst NUR außerhalb der Spielfläche und außerhalb des
 * flachen Sicherheitsstreifens (rimStart ≥ 0,5 m): am Hang, über den Rand ragend, dahinter.
 *
 * Statische LOD nach Abstand zur Spielfläche (der Spieler verlässt sie in Roomscale nicht):
 *   Wall/Rand       → volle Pilzgeometrie mit Lamellen
 *   hinter dem Wall → Fern-LOD (leuchtende Lamellen-Scheibe statt Lamellen)
 *   weit weg        → Impostors (Billboards)
 * Pro Pilzart je ein InstancedMesh (nah + fern) → max. 16 Draw Calls + 1 Billboards.
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

interface Placement {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: number;
}

/** Zufallspunkt in einem Abstandsband außerhalb der Fläche, auf dem Gelände, mit Hangneigung. */
function samplePlacement(b: Basin, rng: () => number, dMin: number, dMax: number, opts: { tiltToSlope: number; leanInward?: number }): Placement | null {
  const theta = rng() * Math.PI * 2;
  const rb = regionRadius(b, theta);
  const d = dMin + (dMax - dMin) * rng();
  const x = b.center.x + Math.cos(theta) * (rb + d);
  const z = b.center.z + Math.sin(theta) * (rb + d);
  // Spielfläche und flachen Sicherheitsstreifen immer frei halten
  if (b.distOutside(x, z) < b.rimStart(b.thetaOf(x, z)) + 0.15) return null;
  const y = b.heightAt(x, z);
  const e = 0.25;
  const n = new THREE.Vector3(b.heightAt(x - e, z) - b.heightAt(x + e, z), 2 * e, b.heightAt(x, z - e) - b.heightAt(x, z + e)).normalize();
  const up = new THREE.Vector3(0, 1, 0).lerp(n, opts.tiltToSlope).normalize();
  if (opts.leanInward) up.addScaledVector(new THREE.Vector3(-Math.cos(theta), 0, -Math.sin(theta)), opts.leanInward).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2));
  return { pos: new THREE.Vector3(x, y - 0.03, z), quat: q, scale: 1 };
}

interface ShroomInstance {
  p: Placement;
  species: number;
}

function buildSpeciesMeshes(list: ShroomInstance[], detail: (typeof DETAIL)[keyof typeof DETAIL], sway: number, seedBase: number, rng: () => number): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  SPECIES.forEach((sp: SpeciesDef, si) => {
    const mine = list.filter((x) => x.species === si);
    if (mine.length === 0) return;
    const geo = speciesGeometry(sp, detail, seedBase + si * 101);
    const attrs = attachInstanceAttributes(geo, mine.length);
    const mesh = new THREE.InstancedMesh(geo, speciesMaterial(sp, sway), mine.length);
    const m = new THREE.Matrix4();
    mine.forEach((it, i) => {
      const s = it.p.scale;
      m.compose(it.p.pos, it.p.quat, new THREE.Vector3(s * (0.9 + rng() * 0.2), s, s * (0.9 + rng() * 0.2)));
      mesh.setMatrixAt(i, m);
      const h = (rng() - 0.5) * 0.25; // Farbton ±
      attrs.tint.set([1 + h, 1 - Math.abs(h) * 0.5, 1 - h], i * 3);
      attrs.phase[i] = rng();
      attrs.seed[i] = rng();
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = `shroom-${sp.id}${detail.far ? '-far' : ''}`;
    out.push(mesh);
  });
  return out;
}

export interface Vegetation {
  group: THREE.Group;
  /** Leuchtende Hüte (Weltpositionen) – Motten werden davon angezogen. */
  attractors: THREE.Vector3[];
}

export function createVegetation(profile: QualityProfile, b: Basin): Vegetation {
  const group = new THREE.Group();
  group.name = 'vegetation';
  const rng = mulberry32(1234);
  const attractors: THREE.Vector3[] = [];
  const avgStart = 0.75;
  const avgRim = avgStart + b.wallWidth(0);

  const tryPlace = (n: number, dMin: number, dMax: number, opts: { tiltToSlope: number; leanInward?: number }) => {
    const out: Placement[] = [];
    for (let k = 0; k < n * 20 && out.length < n; k++) {
      const p = samplePlacement(b, rng, dMin, dMax, opts);
      if (p) out.push(p);
    }
    return out;
  };

  // --- Pilze an den Wällen (nah, volle Geometrie mit Lamellen) ---
  const near: ShroomInstance[] = [];
  const nearSpecies = SPECIES.map((s, i) => ({ s, i })).filter((x) => x.s.id !== 'riesenschirm');
  for (const p of tryPlace(profile.nearShrooms, avgStart + 0.2, avgRim + 1.2, { tiltToSlope: 0.55 })) {
    p.scale = 0.25 + Math.pow(rng(), 1.8) * 1.6;
    near.push({ p, species: nearSpecies[Math.floor(rng() * nearSpecies.length)].i });
  }
  // Riesenpilze am Rand, nach innen geneigt → bilden teilweise ein Dach über der Senke
  const giantSpecies = ['riesenschirm', 'schirmling', 'glockenhut', 'buckelkappe'].map((id) => SPECIES.findIndex((s) => s.id === id));
  for (const p of tryPlace(profile.rimGiants, avgRim - 1.2, avgRim + 1.5, { tiltToSlope: 0.15, leanInward: 0.12 + rng() * 0.15 })) {
    p.scale = 3 + rng() * 3.8;
    near.push({ p, species: giantSpecies[Math.floor(rng() * giantSpecies.length)] });
  }
  // Baby-Pilze rund um größere Exemplare. Sie sind so klein, dass Lamellen unsichtbar wären →
  // sie nutzen die Fern-LOD-Geometrie derselben Art (keine zusätzlichen Draw Calls).
  const babies: ShroomInstance[] = [];
  const parents = near.filter((x) => x.p.scale > 0.8);
  for (let k = 0; k < profile.babies && parents.length; k++) {
    const par = parents[Math.floor(rng() * parents.length)];
    const a = rng() * Math.PI * 2;
    const r = 0.15 + rng() * 0.45 * Math.min(2, par.p.scale);
    const x = par.p.pos.x + Math.cos(a) * r;
    const z = par.p.pos.z + Math.sin(a) * r;
    if (b.distOutside(x, z) < b.rimStart(b.thetaOf(x, z)) + 0.15) continue;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 0.3, rng() * 6.28, (rng() - 0.5) * 0.3));
    babies.push({ p: { pos: new THREE.Vector3(x, b.heightAt(x, z) - 0.01, z), quat: q, scale: 0.05 + rng() * 0.14 }, species: par.species });
  }
  for (const m of buildSpeciesMeshes(near, DETAIL[profile.shroomDetail], 0.025, 77, rng)) group.add(m);
  for (const it of near) {
    if (it.p.scale >= 0.6 && attractors.length < 48) {
      attractors.push(it.p.pos.clone().add(new THREE.Vector3(0, 0.85 * it.p.scale, 0).applyQuaternion(it.p.quat)));
    }
  }

  // --- hinter dem Wall: Fern-LOD ---
  const far: ShroomInstance[] = [...babies];
  for (const p of tryPlace(profile.farShrooms, avgRim + 1.5, avgRim + 13, { tiltToSlope: 0.1 })) {
    p.scale = 1.5 + rng() * 3.5;
    far.push({ p, species: Math.floor(rng() * SPECIES.length) });
  }
  for (const m of buildSpeciesMeshes(far, DETAIL.far, 0.006, 177, rng)) group.add(m);

  // --- weit entfernt: Impostors ---
  const bb: { x: number; y: number; z: number; h: number; color: THREE.Color }[] = [];
  const glowCols = [PALETTE.turquoise, PALETTE.violet, PALETTE.magenta, PALETTE.cyan];
  for (const p of tryPlace(profile.billboards, avgRim + 12, avgRim + 32, { tiltToSlope: 0 })) {
    bb.push({ x: p.pos.x, y: p.pos.y, z: p.pos.z, h: 4 + rng() * 9, color: glowCols[Math.floor(rng() * glowCols.length)] });
  }
  if (bb.length) group.add(createBillboards(bb));

  // --- Farne und Sporenkapseln am Hang ---
  const scatter = (geo: THREE.BufferGeometry, mat: THREE.Material, pts: Placement[], scale: [number, number], colors: THREE.Color[]) => {
    const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
    const col = new Float32Array(pts.length * 3);
    const ph = new Float32Array(pts.length);
    const m = new THREE.Matrix4();
    pts.forEach((p, i) => {
      const s = scale[0] + (scale[1] - scale[0]) * Math.pow(rng(), 2);
      m.compose(p.pos, p.quat, new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(i, m);
      const c = colors[Math.floor(rng() * colors.length)];
      col.set([c.r, c.g, c.b], i * 3);
      ph[i] = rng();
    });
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3));
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
    mesh.computeBoundingSphere();
    return mesh;
  };
  group.add(scatter(fernGeometry(), makeMaterial(0.12), tryPlace(profile.ferns, avgStart + 0.15, avgRim + 2, { tiltToSlope: 0.7 }), [0.4, 1.6], [PALETTE.cyan, PALETTE.turquoise, PALETTE.toxic]));
  group.add(scatter(podGeometry(), makeMaterial(0.08), tryPlace(profile.pods, avgStart + 0.4, avgRim + 1.5, { tiltToSlope: 0.4 }), [0.5, 2], [PALETTE.magenta, PALETTE.toxic, PALETTE.violet]));

  const vines = createVines(b, profile.vines, rng);
  if (vines) group.add(vines);
  const myc = createMycelium(b, near.filter((x) => x.p.scale > 0.45).slice(0, profile.mycelium), rng);
  if (myc) group.add(myc);

  return { group, attractors };
}

/** Leuchtende Ranken vom Rand den Hang hinunter (ein zusammengeführtes Mesh). */
function createVines(b: Basin, count: number, rng: () => number): THREE.Mesh | null {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const theta = rng() * Math.PI * 2;
    const rb = regionRadius(b, theta);
    const dTop = b.rimDistance(theta) - 0.1;
    const dBot = b.rimStart(theta) + 0.35 + rng() * 0.6;
    const pts: THREE.Vector3[] = [];
    const wig = rng() * 6;
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      const d = dTop + (dBot - dTop) * t;
      const th = theta + Math.sin(t * 5 + wig) * 0.04;
      const x = b.center.x + Math.cos(th) * (rb + d);
      const z = b.center.z + Math.sin(th) * (rb + d);
      pts.push(new THREE.Vector3(x, b.heightAt(x, z) + 0.04, z));
    }
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.02 + rng() * 0.018, 4, false);
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
