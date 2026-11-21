import * as THREE from 'three';
import type { AudioEngine } from '../../audio/audio';
import type { QualityProfile } from '../scene';
import { nextFlybyInterval, nextInterval } from '../../audio/insectSounds';
import { mulberry32, safeMerge, worldUniforms } from '../shared';
import { regionRadius } from './basin';
import type { World } from './index';
import { type Agent, type InsectEnv, type InsectKind, MIN_HEAD_DIST, createAgents, stepAgents } from './insectBrain';

/**
 * Fliegende Insekten: Glühwürmchen + Mückenschwärme (Leuchtpunkte, 1 Draw Call),
 * Libellen und Motten (InstancedMesh, Flügelschlag im Vertex-Shader, je 1 Draw Call).
 * Bewegung: leichtes CPU-Update (insectBrain.ts). Geräusche: räumlich, „ab und an“.
 */

export interface Insects {
  root: THREE.Group;
  dispose(): void;
  setEnabled(on: boolean, landing: boolean): void;
  /** `hands`: Positionen ruhig gehaltener Hände (VR) für das Lande-Easter-Egg. */
  update(dt: number, time: number, head: THREE.Vector3, fwd: THREE.Vector3, hands: THREE.Vector3[]): void;
}

const FLAP_SHADER = (bodyGlow: string, wingTint: string, flapHz: number, flapAmp: number) => ({
  vertexShader: /* glsl */ `
    attribute float aWing;   // 0 Körper, ±1 Flügel links/rechts
    attribute float aPhase;
    uniform float uTime;
    varying float vWing; varying vec2 vUvW; varying float vDist;
    void main(){
      vec3 p = position;
      if (abs(aWing) > 0.5) {
        float a = sin(uTime * ${flapHz.toFixed(1)} + aPhase * 6.283) * ${flapAmp.toFixed(2)};
        float side = sign(aWing);
        // Flügel um die Längsachse (Z) schlagen: Spitze hebt/senkt sich
        float r = abs(p.x);
        p.y += sin(a) * r;
        p.x = side * cos(a) * r;
      }
      vWing = aWing; vUvW = position.xz;
      vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
      vDist = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime; uniform vec3 uTint; uniform float uTintAmt;
    varying float vWing; varying vec2 vUvW; varying float vDist;
    void main(){
      vec3 body = mix(vec3(${bodyGlow}), uTint, uTintAmt);
      if (abs(vWing) > 0.5) {
        // schimmernde, halbtransparente Flügel (Interferenzfarben)
        float s = 0.5 + 0.5 * sin(vUvW.x * 120.0 + vUvW.y * 80.0 + uTime * 2.0);
        vec3 iri = mix(vec3(${wingTint}), vec3(0.6, 0.3, 1.0), s);
        gl_FragColor = vec4(iri * 0.9, 0.35);
      } else {
        gl_FragColor = vec4(body * 1.3, 1.0);
      }
      float fade = clamp(1.0 - vDist / 30.0, 0.0, 1.0);
      gl_FragColor.a *= fade;
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});

/** Libelle ≈ 8–10 cm: schlanker Körper, vier lange Flügel. */
function dragonflyGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.004, 0.0025, 0.09, 5, 1);
  body.rotateX(Math.PI / 2);
  const head = new THREE.SphereGeometry(0.007, 6, 4).translate(0, 0, -0.048);
  const parts: THREE.BufferGeometry[] = [];
  for (const g of [body, head]) {
    g.deleteAttribute('uv');
    g.setAttribute('aWing', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count), 1));
    parts.push(g);
  }
  for (const side of [-1, 1]) for (const zOff of [-0.018, 0.0]) {
    const w = new THREE.PlaneGeometry(0.05, 0.011).rotateX(-Math.PI / 2).translate(side * 0.027, 0.002, zOff);
    w.deleteAttribute('uv');
    w.setAttribute('aWing', new THREE.Float32BufferAttribute(new Float32Array(w.getAttribute('position').count).fill(side), 1));
    parts.push(w);
  }
  return safeMerge(parts);
}

/** Motte ≈ 3–4 cm: kurzer Körper, zwei breite Flügel. */
function mothGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.006, 6, 4).scale(1, 1, 2.2);
  body.deleteAttribute('uv');
  body.setAttribute('aWing', new THREE.Float32BufferAttribute(new Float32Array(body.getAttribute('position').count), 1));
  const parts: THREE.BufferGeometry[] = [body];
  for (const side of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.006).quadraticCurveTo(0.02, -0.018, 0.022, 0.0).quadraticCurveTo(0.018, 0.014, 0, 0.008).closePath();
    const w = new THREE.ShapeGeometry(shape, 3).rotateX(-Math.PI / 2);
    if (side < 0) w.scale(-1, 1, 1);
    w.translate(side * 0.003, 0.001, 0);
    w.deleteAttribute('uv');
    w.setAttribute('aWing', new THREE.Float32BufferAttribute(new Float32Array(w.getAttribute('position').count).fill(side), 1));
    parts.push(w);
  }
  return safeMerge(parts);
}

/** Leuchtpunkte (Glühwürmchen und Mücken) als kamera-ausgerichtete Quads. */
function createGlowPoints(count: number): { mesh: THREE.Mesh; pos: Float32Array; attr: THREE.InstancedBufferAttribute; size: Float32Array; color: Float32Array } {
  const geo = new THREE.InstancedBufferGeometry();
  const q = new THREE.PlaneGeometry(1, 1);
  geo.index = q.index;
  geo.setAttribute('position', q.getAttribute('position'));
  geo.setAttribute('uv', q.getAttribute('uv'));
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const color = new Float32Array(count * 4);
  const attr = new THREE.InstancedBufferAttribute(pos, 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPos', attr);
  geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 1));
  geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(color, 4)); // rgb + Blinkart
  geo.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { ...worldUniforms },
    vertexShader: /* glsl */ `
      attribute vec3 aPos; attribute float aSize; attribute vec4 aCol;
      uniform float uTime; uniform vec3 uTint; uniform float uTintAmt;
      varying vec2 vUv; varying vec3 vCol; varying float vA;
      void main(){
        vUv = uv;
        vec4 mv = viewMatrix * vec4(aPos, 1.0);
        mv.xy += position.xy * aSize;
        gl_Position = projectionMatrix * mv;
        float ph = aPos.x * 3.1 + aPos.z * 1.7;
        float blink = aCol.a > 0.5 ? pow(max(0.0, sin(uTime * 1.1 + ph)), 4.0) * 0.9 + 0.1 : 0.55 + 0.25 * sin(uTime * 7.0 + ph);
        vA = blink * clamp(1.0 - (-mv.z) / 35.0, 0.0, 1.0);
        vCol = mix(aCol.rgb, uTint, uTintAmt);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vCol; varying float vA;
      void main(){ float d = length(vUv - 0.5); float core = smoothstep(0.12, 0.0, d); float halo = smoothstep(0.5, 0.0, d) * 0.35;
        float a = (core + halo) * vA; if (a < 0.01) discard; gl_FragColor = vec4(vCol * a * 1.6, a); }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = 'insects-glow';
  return { mesh, pos, attr, size, color };
}

export function createInsects(
  profile: QualityProfile,
  world: World,
  audio: AudioEngine,
  board: { boardHalf: number; pieceTop: number; pose?: { x: number; z: number; yaw: number; baseY: number } },
): Insects {
  const root = new THREE.Group();
  root.name = 'insects';
  const rng = mulberry32(99);
  const b = world.basin;
  const total = profile.insects;
  const counts: Record<InsectKind, number> = {
    firefly: Math.round(total * 0.35),
    midge: Math.round(total * 0.35),
    moth: Math.round(total * 0.18),
    dragonfly: Math.max(2, Math.round(total * 0.12)),
  };
  const rimR = b.extent + b.rimDistance(0);
  const env: InsectEnv = {
    head: { x: 0, y: 1.65, z: 4 },
    headFwd: { x: 0, y: 0, z: -1 },
    minHeadDist: MIN_HEAD_DIST,
    softHeadDist: 1.3,
    groundAt: (x, z) => b.heightAt(x, z),
    // bevorzugt am Hang der Senke (Wall), in Flughöhe über dem Gelände
    wallPoint: (r, minH, maxH) => {
      const t = r() * Math.PI * 2;
      const rb = regionRadius(b, t);
      const d = b.rimStart(t) + 0.3 + r() * (b.wallWidth(t) * 0.9);
      const x = b.center.x + Math.cos(t) * (rb + d);
      const z = b.center.z + Math.sin(t) * (rb + d);
      return { x, y: b.heightAt(x, z) + minH + r() * (maxH - minH), z };
    },
    center: { x: b.center.x, y: 0, z: b.center.z },
    maxRadius: rimR + 1.5,
    boardHalf: board.boardHalf,
    pieceTop: board.pieceTop,
    board: board.pose,
    attractors: world.attractors.map((a) => ({ x: a.x, y: a.y, z: a.z })),
    swarmCenters: Array.from({ length: Math.max(1, Math.round(counts.midge / 14)) }, () => ({ x: 0, y: 0, z: 0 })),
    landing: null,
  };
  env.swarmCenters.forEach((c) => Object.assign(c, env.wallPoint(rng, 0.6, 1.0)));
  const agents: Agent[] = createAgents(counts, env, rng);

  // --- Darstellung ---
  const glowAgents = agents.filter((a) => a.kind === 'firefly' || a.kind === 'midge');
  const glow = createGlowPoints(glowAgents.length);
  glowAgents.forEach((a, i) => {
    const ff = a.kind === 'firefly';
    glow.size[i] = ff ? 0.03 + rng() * 0.02 : 0.012; // Glühwürmchen 3–5 cm Leuchthof, Mücken ~1 cm
    const c = ff ? (rng() < 0.6 ? [0.83, 1, 0.42] : [0.42, 1, 0.85]) : [0.6, 0.55, 1];
    glow.color.set([...c, ff ? 1 : 0], i * 4);
  });
  root.add(glow.mesh);

  const mkMesh = (kind: InsectKind, geo: THREE.BufferGeometry, shader: ReturnType<typeof FLAP_SHADER>) => {
    const list = agents.filter((a) => a.kind === kind);
    const ph = new Float32Array(list.length).map(() => rng());
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
    const mesh = new THREE.InstancedMesh(geo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { ...worldUniforms }, ...shader }), list.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.name = `insects-${kind}`;
    root.add(mesh);
    return { list, mesh };
  };
  const dragon = mkMesh('dragonfly', dragonflyGeometry(), FLAP_SHADER('0.2, 0.9, 1.0', '0.3, 1.0, 0.9', 55, 0.6));
  const moths = mkMesh('moth', mothGeometry(), FLAP_SHADER('1.0, 0.55, 0.9', '0.9, 0.7, 1.0', 22, 0.9));

  // --- Ton: Vorbeiflug alle 5–20 s, Zirpen aus den Wällen alle 8–20 s ---
  let enabled = true;
  let landingOn = true;
  // Vorbeiflüge alle 0,5–3 s (bis 8 gleichzeitig), Zirpen aus Wall/Vegetation alle 1,5–6 s
  let nextFlyby = 1 + rng();
  let nextSound = 2 + rng() * 2;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const look = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  const p3 = new THREE.Vector3();
  const v3 = new THREE.Vector3();
  const upV = new THREE.Vector3(0, 1, 0);
  const zero = new THREE.Vector3();
  const writeMatrices = (set: { list: Agent[]; mesh: THREE.InstancedMesh }) => {
    set.list.forEach((a, i) => {
      p3.set(a.p.x, a.p.y, a.p.z);
      v3.set(a.v.x, a.v.y * 0.3, a.v.z);
      if (v3.lengthSq() < 1e-6) v3.set(0, 0, 1);
      look.lookAt(zero, v3.normalize(), upV); // lokale −Z-Achse (Kopf) zeigt in Flugrichtung
      q.setFromRotationMatrix(look);
      m.compose(p3, q, one);
      set.mesh.setMatrixAt(i, m);
    });
    set.mesh.instanceMatrix.needsUpdate = true;
  };

  // Ruhig gehaltene Hand erkennen (Easter Egg, VR)
  let stillFor = 0;
  const lastHand = new THREE.Vector3();

  return {
    root,
    dispose() {
      root.removeFromParent();
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose?.();
      });
    },
    setEnabled(on, landing) {
      enabled = on;
      landingOn = landing;
      root.visible = on;
    },
    update(dt, time, head, fwd, hands) {
      if (!enabled) return;
      env.head.x = head.x;
      env.head.y = head.y;
      env.head.z = head.z;
      env.headFwd = { x: fwd.x, y: fwd.y, z: fwd.z };
      // Landung nur auf einer Hand, die ≥ 0,6 m vom Kopf weg ist und 2 s still gehalten wird
      env.landing = null;
      if (landingOn && hands.length) {
        const h = hands[0];
        stillFor = h.distanceTo(lastHand) < 0.02 * Math.max(dt * 60, 1) ? stillFor + dt : 0;
        lastHand.copy(h);
        if (stillFor > 2 && h.distanceTo(head) > MIN_HEAD_DIST + 0.05) env.landing = { x: h.x, y: h.y + 0.02, z: h.z };
      }
      stepAgents(agents, env, Math.min(dt, 0.05), rng, time);

      glowAgents.forEach((a, i) => glow.pos.set([a.p.x, a.p.y, a.p.z], i * 3));
      glow.attr.needsUpdate = true;
      writeMatrices(dragon);
      writeMatrices(moths);

      nextFlyby -= dt;
      if (nextFlyby <= 0) {
        nextFlyby = nextFlybyInterval(rng(), audio.intensity());
        // hörbar am Kopf vorbei (≥ 0,8 m), Start dort, wo gerade ein echtes Insekt in der Nähe fliegt
        const cands = agents.filter((a) => a.kind !== 'firefly' && Math.hypot(a.p.x - head.x, a.p.z - head.z) < 7);
        const a = cands.length ? cands[Math.floor(rng() * cands.length)] : null;
        audio.playFlyby({ x: fwd.x, y: fwd.y, z: fwd.z }, a ? { ...a.p } : null);
      }
      nextSound -= dt;
      if (nextSound <= 0) {
        nextSound = nextInterval(rng(), audio.intensity());
        // Zirpen: aus der Vegetation am Boden oder aus dem Wall (Geländehöhe aus der Höhenfunktion)
        const spots = world.chirpSpots;
        const w = spots.length && rng() < 0.6 ? spots[Math.floor(rng() * spots.length)].clone() : (() => {
          const p = env.wallPoint(rng, 0.05, 0.4);
          return new THREE.Vector3(p.x, p.y, p.z);
        })();
        audio.playCreature('ground', () => w);
      }
    },
  };
}
