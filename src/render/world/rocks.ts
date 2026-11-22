import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLSL_FOG, GLSL_NOISE, mulberry32, safeMerge, worldUniforms } from '../shared';

/**
 * Außerirdische Steine (prozedural mit Seed). 8 Arten:
 *   blob      knubbelig, wie geschmolzen (zu ~30 % im Moos versunken)
 *   stack     gestapelte Balance-Steine (oben größer – müsste eigentlich umfallen)
 *   arch      Ring-/Bogenstein mit Loch
 *   needle    lange, schräg aus dem Boden ragende Zacken-Nadel
 *   disc      flacher, gewellter Scheibenstein
 *   sponge    löchriger Schwamm-/Lavastein
 *   veined    Brocken mit leuchtenden Adern und Kristalleinschlüssen
 *   pebbles   glatte, polierte Kiesel-Gruppe (Pastell)
 *
 * Draw Calls: je Art und LOD-Stufe ein InstancedMesh mit Instanzfarbe. Auf Low/Medium nur die grobe
 * Stufe (8 Calls), auf High zusätzlich die feine Stufe für die nahen Steine am Hangfuß (≤ 16 Calls).
 * (Ein BatchedMesh wäre 1 Call, fällt aber ohne WEBGL_multi_draw auf einen Call pro Instanz zurück.)
 * Ursprung jeder Art = Bodenkontaktpunkt.
 */
export const ROCK_KINDS = ['blob', 'stack', 'arch', 'needle', 'disc', 'sponge', 'veined', 'pebbles'] as const;
export type RockKind = (typeof ROCK_KINDS)[number];

/** Grundfläche (Radius) und Höhe je Art bei Skalierung 1 – für Platzierung/Bodenkontakt. */
export const ROCK_FOOT: Record<RockKind, number> = { blob: 0.4, stack: 0.18, arch: 0.18, needle: 0.12, disc: 0.45, sponge: 0.38, veined: 0.4, pebbles: 0.35 };
export const ROCK_HEIGHT: Record<RockKind, number> = { blob: 0.45, stack: 1.0, arch: 1.05, needle: 1.3, disc: 0.15, sponge: 0.6, veined: 0.65, pebbles: 0.14 };

/** Kleines 3D-Value-Noise für die Verformung (deterministisch). */
function noise3(x: number, y: number, z: number): number {
  const h = (i: number, j: number, k: number) => {
    const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = (t: number) => t * t * (3 - 2 * t);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const x0 = lerp(lerp(h(xi, yi, zi), h(xi + 1, yi, zi), u(xf)), lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u(xf)), u(yf));
  const x1 = lerp(lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u(xf)), lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u(xf)), u(yf));
  return lerp(x0, x1, u(zf));
}

function displace(g: THREE.BufferGeometry, fn: (v: THREE.Vector3) => void): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    fn(v);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Klumpen: Icosphäre mit Noise-Radius, gestaucht und verschoben. */
function lump(detail: number, r: number, amp: number, seed: number, squashY = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, detail);
  g.deleteAttribute('uv');
  return displace(g, (v) => {
    const n = noise3(v.x * 3 + seed, v.y * 3, v.z * 3 - seed) * 0.7 + noise3(v.x * 7, v.y * 7 + seed, v.z * 7) * 0.3;
    v.multiplyScalar(1 + amp * (n - 0.5) * 2);
    v.y *= squashY;
  });
}

/** Art-Kennung + Adern-Maske ergänzen (nicht indiziert, damit alle Arten zusammengeführt werden können). */
function tag(g: THREE.BufferGeometry, kind: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  if (ng.getAttribute('uv')) ng.deleteAttribute('uv');
  const n = ng.getAttribute('position').count;
  ng.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(n).fill(kind), 1));
  if (!ng.getAttribute('aVein')) ng.setAttribute('aVein', new THREE.BufferAttribute(new Float32Array(n), 1));
  ng.computeVertexNormals();
  return ng;
}

function kindGeometry(kind: RockKind, lod: 0 | 1, seed: number): THREE.BufferGeometry {
  const d = lod === 0 ? 2 : 1;
  const r = mulberry32(seed);
  switch (kind) {
    case 'blob': {
      const g = lump(d, 0.5, 0.25, seed, 0.6);
      // geschmolzen: unten breiter, und ~30 % unter der Bodenlinie (halb im Moos versunken)
      displace(g, (v) => { if (v.y < 0) v.multiplyScalar(1 + (-v.y) * 0.5); });
      g.translate(0, 0.12, 0);
      return g;
    }
    case 'stack': {
      const parts: THREE.BufferGeometry[] = [];
      let y = -0.03;
      const sizes = [0.13, 0.16, 0.22, 0.17];
      sizes.forEach((sz, i) => {
        const s = lump(Math.max(0, d - 1), sz, 0.18, seed + i * 3, 0.55);
        s.rotateZ((r() - 0.5) * 0.35);
        s.translate((r() - 0.5) * 0.08, y + sz * 0.55, (r() - 0.5) * 0.08);
        y += sz * 1.05;
        parts.push(s);
      });
      return safeMerge(parts);
    }
    case 'arch': {
      const g = new THREE.TorusGeometry(0.42, 0.13, lod === 0 ? 10 : 6, lod === 0 ? 28 : 14);
      g.deleteAttribute('uv');
      displace(g, (v) => v.multiplyScalar(1 + 0.12 * (noise3(v.x * 4 + seed, v.y * 4, v.z * 4) - 0.5)));
      g.translate(0, 0.42 + 0.13 - 0.08, 0); // steht aufrecht, unten leicht versenkt
      return g;
    }
    case 'needle': {
      const g = new THREE.ConeGeometry(0.12, 1.4, lod === 0 ? 7 : 5, lod === 0 ? 8 : 3);
      g.deleteAttribute('uv');
      displace(g, (v) => {
        const k = 1 + 0.35 * (noise3(v.x * 9, v.y * 3 + seed, v.z * 9) - 0.5) * 2;
        v.x *= k;
        v.z *= k;
      });
      g.translate(0, 0.7 - 0.06, 0);
      g.rotateZ(0.42); // schräg aus dem Boden
      const spur = new THREE.ConeGeometry(0.05, 0.45, 5, 1);
      spur.deleteAttribute('uv');
      spur.translate(0, 0.22, 0);
      spur.rotateZ(-0.6);
      spur.translate(0.12, 0, 0.05);
      return safeMerge([g, spur]);
    }
    case 'disc': {
      const g = new THREE.CylinderGeometry(0.5, 0.46, 0.08, lod === 0 ? 24 : 12, 1);
      g.deleteAttribute('uv');
      displace(g, (v) => {
        const a = Math.atan2(v.z, v.x);
        v.y += Math.sin(a * 5 + seed) * 0.025 * Math.hypot(v.x, v.z) * 2;
      });
      g.translate(0, 0.02, 0);
      return g;
    }
    case 'sponge': {
      const g = lump(d, 0.4, 0.2, seed, 0.8);
      // Löcher/Poren: Vertices dort nach innen ziehen, wo das Noise hoch ist
      displace(g, (v) => {
        const n = noise3(v.x * 11 + seed, v.y * 11, v.z * 11);
        if (n > 0.6) v.multiplyScalar(1 - (n - 0.6) * 0.9);
      });
      g.translate(0, 0.22, 0);
      return g;
    }
    case 'veined': {
      const lb = lump(d, 0.42, 0.22, seed, 0.75);
      const base = lb.index ? lb.toNonIndexed() : lb;
      base.translate(0, 0.22, 0);
      base.setAttribute('aVein', new THREE.BufferAttribute(new Float32Array(base.getAttribute('position').count), 1));
      const parts: THREE.BufferGeometry[] = [base];
      for (let i = 0; i < 4; i++) {
        const c = new THREE.CylinderGeometry(0.035, 0.05, 0.3 + r() * 0.2, 6, 1);
        c.deleteAttribute('uv');
        c.translate(0, 0.15, 0);
        c.rotateZ((r() - 0.5) * 1.4);
        c.rotateY(r() * Math.PI * 2);
        c.translate((r() - 0.5) * 0.3, 0.3 + r() * 0.15, (r() - 0.5) * 0.3);
        const cn = c.index ? c.toNonIndexed() : c;
        cn.setAttribute('aVein', new THREE.BufferAttribute(new Float32Array(cn.getAttribute('position').count).fill(1), 1)); // Kristalle leuchten
        parts.push(cn);
      }
      return safeMerge(parts);
    }
    case 'pebbles': {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 6; i++) {
        const sz = 0.05 + r() * 0.06;
        const s = new THREE.SphereGeometry(sz, lod === 0 ? 10 : 6, lod === 0 ? 7 : 4).scale(1.2, 0.7, 1);
        s.deleteAttribute('uv');
        s.translate((r() - 0.5) * 0.5, sz * 0.5, (r() - 0.5) * 0.5);
        parts.push(s);
      }
      return safeMerge(parts);
    }
  }
}

/** Geometrie einer Art und LOD-Stufe (indiziert, mit Art-Kennung und Adern-Maske). */
export function rockGeometry(kind: RockKind, lod: 0 | 1, seed = 5): THREE.BufferGeometry {
  const i = ROCK_KINDS.indexOf(kind);
  const g = tag(kindGeometry(kind, lod, seed + i * 17), i);
  const merged = mergeVertices(g, 1e-5);
  merged.computeVertexNormals();
  return merged;
}

export function rockMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...worldUniforms },
    vertexShader: /* glsl */ `
      attribute float aKind; attribute float aVein;
      varying vec3 vLocal; varying vec3 vNormal; varying float vVein; varying vec3 vColA; varying vec3 vColB;
      varying float vDist; varying float vKind; varying float vSeed; varying vec3 vView;
      // zweite Farbe (Bänder) aus der Palette, gewählt per Hash der Instanzposition
      const vec3 PAL[8] = vec3[8](vec3(0.48,0.3,0.75), vec3(0.17,0.7,0.66), vec3(0.78,0.58,0.18), vec3(0.72,0.33,0.16),
                                  vec3(0.88,0.48,0.71), vec3(0.12,0.44,0.47), vec3(0.91,0.87,0.78), vec3(0.36,0.23,0.56));
      void main(){
        mat4 bm = mat4(1.0);
        vec3 colA = vec3(0.6);
        #ifdef USE_INSTANCING
          bm = instanceMatrix;
        #endif
        #ifdef USE_INSTANCING_COLOR
          colA = instanceColor;
        #endif
        vec3 c = bm[3].xyz;
        vSeed = fract(sin(dot(c.xz, vec2(12.9898, 78.233))) * 43758.5453);
        vColA = colA;
        vColB = aKind > 6.5 ? mix(colA, vec3(1.0), 0.35) : PAL[int(vSeed * 7.99)];
        vec4 w = modelMatrix * bm * vec4(position, 1.0);
        vLocal = position; vVein = aVein; vKind = aKind;
        vNormal = normalize(mat3(modelMatrix * bm) * normal);
        vView = normalize(cameraPosition - w.xyz);
        vec4 mv = viewMatrix * w; vDist = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uTint; uniform float uTintAmt;
      varying vec3 vLocal; varying vec3 vNormal; varying float vVein; varying vec3 vColA; varying vec3 vColB;
      varying float vDist; varying float vKind; varying float vSeed; varying vec3 vView;
      ${GLSL_NOISE}
      ${GLSL_FOG}
      void main(){
        vec3 n = normalize(vNormal);
        float moonL = clamp(dot(n, normalize(vec3(-0.5, 0.8, -0.4))), 0.0, 1.0);
        vec3 p = vLocal * 4.0 + vSeed * 9.0;
        // Schichtgestein: Bänder entlang der Höhe, leicht verwellt
        float bands = 0.5 + 0.5 * sin(vLocal.y * 22.0 + fbm3(p) * 4.0);
        vec3 col = mix(vColA, vColB, smoothstep(0.35, 0.65, bands));
        int kind = int(vKind + 0.5);
        float gloss = 0.0;
        if (kind == 7) { col = mix(vColA, vColB, fbm3(p * 0.5)); gloss = 1.0; }                     // polierte Kiesel
        if (kind == 5) col *= 0.45 + 0.55 * smoothstep(0.62, 0.45, vnoise3(vLocal * 11.0 + vSeed)); // Poren
        col *= 0.35 + 0.65 * fbm3(p * 1.7);
        vec3 lit = col * (0.16 + 0.55 * moonL);
        float fres = pow(1.0 - abs(dot(n, normalize(vView))), 3.0);
        lit += vec3(0.1, 0.12, 0.2) * fres * (0.4 + gloss);
        // leuchtende Adern (Art 'veined' kräftig, sonst zart) + Kristalle
        float vn = abs(fbm3(vLocal * 6.0 + vSeed) - 0.5);
        float vein = (1.0 - smoothstep(0.0, kind == 6 ? 0.035 : 0.012, vn)) * (kind == 6 ? 1.0 : 0.25);
        vec3 glow = mix(vColB * 1.6 + vec3(0.1, 0.3, 0.3), uTint, uTintAmt);
        float pulse = 0.7 + 0.3 * sin(uTime * 0.8 + vSeed * 30.0);
        lit += glow * max(vein, vVein) * pulse * 0.9;
        gl_FragColor = vec4(applyFog(lit, vDist), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Alle Steine: je (Art, LOD-Stufe) ein InstancedMesh mit Instanzfarbe. */
export function createRockMeshes(items: { kind: RockKind; lod: 0 | 1; matrix: THREE.Matrix4; color: THREE.Color }[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'rocks';
  const mat = rockMaterial();
  const byKey = new Map<string, typeof items>();
  for (const it of items) {
    const key = `${it.kind}:${it.lod}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(it);
  }
  for (const [key, list] of byKey) {
    const [kind, lod] = key.split(':');
    const mesh = new THREE.InstancedMesh(rockGeometry(kind as RockKind, Number(lod) as 0 | 1), mat, list.length);
    list.forEach((it, i) => {
      mesh.setMatrixAt(i, it.matrix);
      mesh.setColorAt(i, it.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = `rocks-${key}`;
    group.add(mesh);
  }
  return group;
}

/** Farbpalette der Steine (Weltpalette, teils Pastell für Kiesel). */
export const ROCK_COLORS = ['#7b4dbf', '#2bb3a8', '#c8952e', '#b8542a', '#e07bb5', '#1f6f78', '#e8dfc8', '#5b3a8f'].map((c) => new THREE.Color(c));
export const PEBBLE_COLORS = ['#d9c4f2', '#bfeee6', '#f2d9b8', '#f5c6dd', '#c9e3f2'].map((c) => new THREE.Color(c));
