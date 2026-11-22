import * as THREE from 'three';
import { GLSL_FOG, GLSL_NOISE, worldUniforms } from '../shared';
import { type Basin, regionRadius } from './basin';
import { footprintMin } from './vegetation';
import { LAVA_MIN_CLEARANCE, type LavaEvent, LavaSim, type LavaSource } from './lavaSim';

/**
 * Lavalampen-Blasen: verformte Kugeln (Vertex-Shader: Streckung entlang der Aufstiegsrichtung,
 * oben breiter, unten Einschnürung beim Hervorquellen, Noise-Wabern) als EIN InstancedMesh.
 * Milchig-halbtransparent mit innerem Leuchten und Fresnel-Rand; ≤ 20 Instanzen werden jedes Frame
 * von hinten nach vorne sortiert (korrekte Transparenz, ein Draw Call). Kein Echtzeitlicht.
 */
const COLORS = ['#ff2fb3', '#ff8a3d', '#1de9c9', '#8b3dff'].map((c) => new THREE.Color(c));

/** Quellen auf dem Boden, nur außerhalb der Spielfläche (Hangfuß, Hänge, hinter dem Rand). */
export function createLavaSources(b: Basin, n: number, rng: () => number): LavaSource[] {
  const out: LavaSource[] = [];
  for (let k = 0; k < n * 30 && out.length < n; k++) {
    const t = rng() * Math.PI * 2;
    const rb = regionRadius(b, t);
    const d = b.rimStart(t) + 0.6 + rng() * (b.wallWidth(t) + 8);
    const x = b.center.x + Math.cos(t) * (rb + d);
    const z = b.center.z + Math.sin(t) * (rb + d);
    const dOut = b.distOutside(x, z);
    const maxR = Math.min(1.0, Math.max(0.15, (dOut - LAVA_MIN_CLEARANCE) * 0.35));
    if (dOut < LAVA_MIN_CLEARANCE + maxR) continue;
    if (out.some((s) => Math.hypot(s.x - x, s.z - z) < 2.5)) continue;
    out.push({ x, y: footprintMin(b, x, z, 0), z, maxR, nextAt: rng() * 8, busy: false });
  }
  return out;
}

export class LavaBubbles {
  readonly mesh: THREE.InstancedMesh;
  readonly sim: LavaSim;
  private blobAttr: THREE.InstancedBufferAttribute;
  private colorAttr: THREE.InstancedBufferAttribute;
  private m = new THREE.Matrix4();
  onEvent: ((e: LavaEvent) => void) | null = null;

  constructor(private basin: Basin, count: number, rng: () => number) {
    this.sim = new LavaSim(createLavaSources(basin, Math.max(8, count), rng), count, rng);
    const geo = new THREE.IcosahedronGeometry(1, 3);
    const cap = count + 4;
    this.blobAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.blobAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aBlob', this.blobAttr);
    geo.setAttribute('aCol', this.colorAttr);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { ...worldUniforms },
      vertexShader: /* glsl */ `
        attribute vec4 aBlob; // phase, stretch, pinch, alpha
        attribute vec3 aCol;
        uniform float uTime;
        varying vec3 vN; varying vec3 vView; varying vec3 vCol; varying float vA; varying float vDist; varying float vY;
        ${GLSL_NOISE}
        void main(){
          vec3 p = position;
          float stretch = aBlob.y, pinch = aBlob.z;
          p.y *= stretch;                                                // in die Länge
          p.xz *= 1.0 + 0.22 * clamp(position.y, 0.0, 1.0) * (stretch - 0.9); // oben breiter
          p.xz *= mix(1.0, 0.3 + 0.7 * smoothstep(-1.0, -0.15, position.y), pinch); // Einschnürung unten
          float n = vnoise3(position * 1.8 + vec3(0.0, uTime * 0.35, aBlob.x * 10.0)) - 0.5;
          p += normal * n * 0.2;                                         // zähes Wabern
          vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
          vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
          vView = normalize(cameraPosition - w.xyz);
          vCol = aCol; vA = aBlob.w; vY = position.y;
          vec4 mv = viewMatrix * w; vDist = length(mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uTint; uniform float uTintAmt;
        varying vec3 vN; varying vec3 vView; varying vec3 vCol; varying float vA; varying float vDist; varying float vY;
        ${GLSL_FOG}
        void main(){
          float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 2.2);
          vec3 c = mix(vCol, uTint, uTintAmt);
          float inner = 0.55 + 0.45 * (1.0 - fres);
          vec3 col = c * (0.35 + 0.55 * inner) + mix(c, vec3(1.0), 0.4) * fres * 0.9 + c * 0.25 * smoothstep(0.2, 1.0, vY);
          float a = (0.32 + 0.5 * fres) * vA;
          gl_FragColor = vec4(applyFog(col, vDist * 0.5), a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.name = 'lava-bubbles';
  }

  update(dt: number, camera: THREE.Vector3, heads: THREE.Vector3[]): void {
    const events = this.sim.step(Math.min(dt, 0.05), { distOutside: (x, z) => this.basin.distOutside(x, z), center: this.basin.center, heads });
    for (const e of events) this.onEvent?.(e);
    // von hinten nach vorne sortieren (korrekte Transparenz)
    const list = this.sim.blobs
      .filter((b) => b.r > 0.01)
      .map((b) => ({ b, d: (b.x - camera.x) ** 2 + (b.y - camera.y) ** 2 + (b.z - camera.z) ** 2 }))
      .sort((p, q) => q.d - p.d);
    const n = Math.min(list.length, this.mesh.instanceMatrix.count);
    for (let i = 0; i < n; i++) {
      const { b } = list[i];
      this.m.makeScale(b.r, b.r, b.r).setPosition(b.x, b.y, b.z);
      this.mesh.setMatrixAt(i, this.m);
      this.blobAttr.setXYZW(i, b.phase, b.stretch, b.pinch, Math.max(0, Math.min(1, b.alpha)));
      const c = COLORS[b.color];
      this.colorAttr.setXYZ(i, c.r, c.g, c.b);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.blobAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }
}
