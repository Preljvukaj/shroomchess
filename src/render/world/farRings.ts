import * as THREE from 'three';
import { GLSL_NOISE, GLSL_SKY_BASE, mulberry32, worldUniforms } from '../shared';
import { type Basin, regionRadius } from './basin';

/**
 * Fernbereich der Welt (Punkt „kein sichtbarer Geländerand“):
 *
 *  - Dschungelwall: 3 gestaffelte Reihen sehr großer, sehr polygonarmer Pilze und Pflanzenkronen (5–20 m) mit
 *    überlappenden Hüten und leicht versetzten Höhen → durchgehende Silhouette ohne Lücken. Alle Reihen in EINEM
 *    gemergten Mesh (1 Draw Call), statische Beleuchtung + Emissive, nur ganz langsames Wiegen im Vertex-Shader.
 *  - Horizontring: ein geschlossener Ring (echtes 3D-Mesh, fest in der Welt, kein Billboard) aus Hut- und
 *    Kronenformen mit verstreuten Leuchtpunkten. Er reicht unter den Boden und verdeckt das Geländeende vollständig;
 *    oben geht er über die Fern-Atmosphäre in die Farbe des unteren Himmels über (1 Draw Call).
 *  - Fern-Atmosphäre: Entfernungs-/Höhennebel zur Himmelsfarbe in Blickrichtung (GLSL_SKY_BASE). Leuchtpunkte
 *    werden schwächer gedämpft und bleiben im Dunst sichtbar (Tiefe).
 * Keine Schatten, kein Echtzeitlicht.
 */

export interface FarRingLayout {
  /** größter Abstand Mitte → Wallkrone (Senkenrand) */
  rim: number;
  /** Radien der drei Wallreihen */
  rows: [number, number, number];
  /** Radius des Horizontrings */
  horizon: number;
  /** Mindesthöhe der Ring-Silhouette über dem Boden */
  horizonMinHeight: number;
  /** Gelände muss mindestens bis hierhin reichen (unter dem Ring durch) */
  terrainOuter: number;
}

/** Radien der Fern-Ringe aus der Senke (alle um die Mitte der Spielfläche). */
export function farRingLayout(b: Basin): FarRingLayout {
  let rim = 0;
  for (let i = 0; i < 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    rim = Math.max(rim, regionRadius(b, t) + b.rimDistance(t));
  }
  const rows: [number, number, number] = [rim + 10, rim + 17, rim + 25];
  const horizon = rim + 36;
  return { rim, rows, horizon, horizonMinHeight: 7, terrainOuter: horizon + 12 };
}

const profileCache = new Map<number, { c: number; w: number; top: number; cap: boolean }[]>();

function horizonElements(seed: number): { c: number; w: number; top: number; cap: boolean }[] {
  let els = profileCache.get(seed);
  if (els) return els;
  const rng = mulberry32(seed);
  const n = 70; // ~70 Elemente rundum: breite Hüte (flacher Buckel) und runde Kronen, überlappend
  els = [];
  for (let i = 0; i < n; i++) {
    const c = ((i + rng() * 0.6) / n) * Math.PI * 2;
    const cap = rng() < 0.55;
    const w = (0.08 + rng() * 0.07) * (cap ? 1.4 : 1);
    els.push({ c, w, top: 9 + rng() * 9, cap });
  }
  profileCache.set(seed, els);
  return els;
}

/** Höhe der Ring-Silhouette (über dem Boden) bei Winkel t – Vereinigung von Hut- und Kronen-Buckeln, nie unter 7 m. */
export function horizonProfile(t: number, seed = 3): number {
  let h = 0;
  for (const e of horizonElements(seed)) {
    const d = Math.abs(((t - e.c + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (d > e.w) continue;
    const u = d / e.w;
    const shape = e.cap ? Math.sqrt(1 - u * u) * (0.75 + 0.25 * (1 - u)) : 1 - u * u * 0.9;
    h = Math.max(h, e.top * (0.62 + 0.38 * shape));
  }
  return Math.max(7, h);
}

function farMaterial(density: number, sway: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...worldUniforms, uDensity: { value: density } },
    vertexShader: /* glsl */ `
      attribute vec3 color; attribute float aGlow; attribute float aSway;
      uniform float uTime;
      varying vec3 vC; varying float vGlow; varying vec3 vW; varying vec3 vN; varying vec2 vP;
      void main(){
        vec3 p = position;
        ${sway ? 'p.x += sin(uTime * 0.18 + position.z * 0.05) * aSway * 0.35; p.z += cos(uTime * 0.15 + position.x * 0.05) * aSway * 0.35;' : ''}
        vec4 w = modelMatrix * vec4(p, 1.0);
        vW = w.xyz; vC = color; vGlow = aGlow; vN = normalize(mat3(modelMatrix) * normal);
        vP = vec2(atan(position.z, position.x), position.y);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uTint; uniform float uTintAmt; uniform float uDensity;
      varying vec3 vC; varying float vGlow; varying vec3 vW; varying vec3 vN; varying vec2 vP;
      ${GLSL_NOISE}
      ${GLSL_SKY_BASE}
      void main(){
        vec3 n = normalize(vN);
        // statische Beleuchtung: Mondlicht von oben + kühler Himmel
        float lit = 0.3 + 0.25 * abs(dot(n, normalize(vec3(-0.4, 0.85, -0.3))));
        vec3 col = vC * lit;
        col = applySkyFog(col, vW, uDensity);
        // Leuchtpunkte/Leuchtränder: im Dunst schwächer, aber sichtbar
        vec3 glowC = mix(vec3(0.3, 1.0, 0.85), vec3(1.0, 0.35, 0.9), hash12(floor(vW.xz * 0.2)));
        glowC = mix(glowC, uTint, uTintAmt);
        float dist = distance(vW, cameraPosition);
        float keep = exp(-dist * 0.012);
        float pulse = 0.75 + 0.25 * sin(uTime * 0.5 + vW.x * 0.3 + vW.z * 0.2);
        col += glowC * vGlow * pulse * (0.25 + 0.55 * keep);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

interface Part {
  pos: number[];
  nor: number[];
  col: number[];
  glow: number[];
  sway: number[];
  idx: number[];
}

function addGeo(out: Part, g: THREE.BufferGeometry, col: THREE.Color, glowFn: (y: number, ny: number) => number, sway: number): void {
  const ng = g.index ? g : g;
  if (!ng.getAttribute('normal')) ng.computeVertexNormals();
  const p = ng.getAttribute('position');
  const n = ng.getAttribute('normal');
  const base = out.pos.length / 3;
  for (let i = 0; i < p.count; i++) {
    out.pos.push(p.getX(i), p.getY(i), p.getZ(i));
    out.nor.push(n.getX(i), n.getY(i), n.getZ(i));
    out.col.push(col.r, col.g, col.b);
    out.glow.push(glowFn(p.getY(i), n.getY(i)));
    out.sway.push(sway * Math.max(0, p.getY(i)) / 20);
  }
  const idx = ng.index;
  if (idx) for (let i = 0; i < idx.count; i++) out.idx.push(base + idx.getX(i));
  else for (let i = 0; i < p.count; i++) out.idx.push(base + i);
}

function toGeometry(part: Part): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(part.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(part.nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(part.col, 3));
  g.setAttribute('aGlow', new THREE.Float32BufferAttribute(part.glow, 1));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(part.sway, 1));
  g.setIndex(part.idx);
  g.computeBoundingSphere();
  return g;
}

/** Dschungelwall: 3 Reihen, dicht, überlappend, 5–20 m hoch, Fuß unter dem Gelände. */
export function createJungleWall(b: Basin, density: number, seed = 11): THREE.Mesh {
  const L = farRingLayout(b);
  const rng = mulberry32(seed);
  const part: Part = { pos: [], nor: [], col: [], glow: [], sway: [], idx: [] };
  const stemCol = new THREE.Color('#0d0a14');
  const capCols = ['#1a0f2e', '#0c2228', '#26102a', '#102a1c'].map((c) => new THREE.Color(c));
  L.rows.forEach((R, row) => {
    const circumference = Math.PI * 2 * R;
    // Abstand < Hutdurchmesser → Überlappung; Dichte je Qualitätsstufe
    const spacing = (row === 0 ? 3.2 : row === 1 ? 3.8 : 4.6) / Math.max(0.5, density);
    const n = Math.ceil(circumference / spacing);
    for (let i = 0; i < n; i++) {
      const t = ((i + (rng() - 0.5) * 0.7) / n) * Math.PI * 2;
      const r = R + (rng() - 0.5) * 3;
      const x = b.center.x + Math.cos(t) * r;
      const z = b.center.z + Math.sin(t) * r;
      const ground = b.heightAt(x, z);
      // Reihen gestaffelt: vorne 5–9 m, Mitte 8–13 m, hinten 12–20 m → durchgehende Silhouette ohne Lücken
      const height = row === 0 ? 5 + rng() * 4 : row === 1 ? 8 + rng() * 5 : 12 + rng() * 8;
      const kind = rng();
      const capCol = capCols[Math.floor(rng() * capCols.length)];
      if (kind < 0.62) {
        // Riesenpilz: Stiel (5 Segmente) + flacher Hut (Kegelstumpf/Kuppel, 7 Segmente) mit leuchtender Unterseite
        const capR = height * (0.26 + rng() * 0.14);
        const stem = new THREE.CylinderGeometry(height * 0.045, height * 0.07, height + 2, 5, 1, true);
        stem.translate(x, ground + height / 2 - 1, z);
        addGeo(part, stem, stemCol, () => 0, 1);
        const cap = new THREE.SphereGeometry(capR, 12, 5, 0, Math.PI * 2, 0, Math.PI * (0.32 + rng() * 0.12));
        cap.scale(1, 0.55 + rng() * 0.3, 1);
        cap.translate(x, ground + height - capR * 0.18, z);
        addGeo(part, cap, capCol, (y, ny) => (ny < 0.2 || y < ground + height - capR * 0.15 ? 0.22 : 0.02), 1);
        // Unterseite (Lamellen-Glimmen): flache Scheibe
        const gill = new THREE.CircleGeometry(capR * 0.92, 10).rotateX(Math.PI / 2);
        gill.translate(x, ground + height - capR * 0.2, z);
        addGeo(part, gill, capCol.clone().multiplyScalar(1.2), () => 0.32, 1);
      } else {
        // Pflanzenkrone: knollige Krone (Ikosaeder) auf kurzem Stamm, Fächerblätter als Kegel
        const crownR = height * (0.22 + rng() * 0.12);
        const trunk = new THREE.CylinderGeometry(height * 0.04, height * 0.06, height * 0.7 + 2, 5, 1, true);
        trunk.translate(x, ground + height * 0.35 - 1, z);
        addGeo(part, trunk, stemCol, () => 0, 1);
        const crown = new THREE.IcosahedronGeometry(crownR, 0);
        crown.scale(1.3, 0.85, 1.3);
        crown.translate(x, ground + height - crownR * 0.6, z);
        addGeo(part, crown, capCol.clone().lerp(new THREE.Color('#0a3020'), 0.5), () => (rng() < 0.3 ? 0.35 : 0.03), 1);
        for (let k = 0; k < 3; k++) {
          const a = rng() * Math.PI * 2;
          const leaf = new THREE.ConeGeometry(crownR * 0.35, crownR * 1.6, 4, 1, true);
          leaf.rotateZ(Math.PI / 2 - 0.5);
          leaf.rotateY(a);
          leaf.translate(x + Math.cos(a) * crownR, ground + height - crownR * 0.4, z - Math.sin(a) * crownR);
          addGeo(part, leaf, capCol, () => 0.02, 1.4);
        }
      }
      // Bodendecker: dunkle Polster zwischen den Stämmen (kein leerer Boden)
      if (rng() < 0.85) {
        const bush = new THREE.IcosahedronGeometry(1.4 + rng() * 1.6, 0);
        bush.scale(1.6, 0.6, 1.6);
        bush.translate(x + (rng() - 0.5) * spacing, ground + 0.2, z + (rng() - 0.5) * spacing);
        addGeo(part, bush, new THREE.Color('#081410'), () => (rng() < 0.15 ? 0.4 : 0), 0);
      }
    }
  });
  const mesh = new THREE.Mesh(toGeometry(part), farMaterial(0.03, true));
  (mesh.material as THREE.ShaderMaterial).side = THREE.DoubleSide; // offene Stiele/Blätter
  mesh.name = 'jungle-wall';
  mesh.frustumCulled = false;
  return mesh;
}

/** Horizontring: geschlossener Silhouettenring, reicht 3 m unter den Boden, 1 Draw Call. */
export function createHorizonRing(b: Basin, segments = 360): THREE.Mesh {
  const L = farRingLayout(b);
  const part: Part = { pos: [], nor: [], col: [], glow: [], sway: [], idx: [] };
  // zwei leicht versetzte Bänder (vorne/hinten) → echte Tiefe, Silhouette wirkt gestaffelt
  for (const [dr, hScale, seed] of [[0, 1, 3], [6, 1.25, 8]] as const) {
    const R = L.horizon + dr;
    const base = part.pos.length / 3;
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      const x = b.center.x + Math.cos(t) * R;
      const z = b.center.z + Math.sin(t) * R;
      const ground = b.heightAt(x, z);
      const top = ground + horizonProfile(t, seed) * hScale;
      const nx = -Math.cos(t), nz = -Math.sin(t); // Normale zur Mitte
      for (const [y, g] of [[ground - 3, 0], [ground + 1.2, 0], [top, 0]] as const) {
        part.pos.push(x, y, z);
        part.nor.push(nx, 0.25, nz);
        part.col.push(0.03, 0.02, 0.05);
        part.glow.push(g);
        part.sway.push(0);
      }
    }
    for (let i = 0; i < segments; i++) {
      const a = base + i * 3;
      const c = base + (i + 1) * 3;
      for (let k = 0; k < 2; k++) part.idx.push(a + k, c + k, a + k + 1, a + k + 1, c + k, c + k + 1);
    }
  }
  const geo = toGeometry(part);
  const mat = farMaterial(0.026, false);
  mat.side = THREE.DoubleSide;
  // verstreute Leuchtpunkte (Pilze/Sporen) auf der Silhouette, prozedural im Fragment-Shader
  mat.fragmentShader = mat.fragmentShader.replace(
    'gl_FragColor = vec4(col, 1.0);',
    `vec2 q = vec2(vP.x * 140.0, vP.y * 1.3);
        vec2 cell = floor(q);
        float rnd = hash12(cell);
        float dots = 0.0;
        if (rnd > 0.86) { vec2 f = fract(q) - 0.5; dots = smoothstep(0.22, 0.0, length(f * vec2(1.0, 1.6))) * (0.5 + 0.5 * sin(uTime * (0.4 + rnd) + rnd * 40.0)); }
        vec3 dc = mix(vec3(0.3, 1.0, 0.8), vec3(1.0, 0.4, 0.9), hash12(cell + 7.0));
        col += mix(dc, uTint, uTintAmt) * dots * 0.55;
        gl_FragColor = vec4(col, 1.0);`,
  );
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'horizon-ring';
  mesh.frustumCulled = false;
  return mesh;
}
