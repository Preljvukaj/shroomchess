import * as THREE from 'three';
import type { V2 } from './math/vec2';

/**
 * Leuchtendes Rankengitter entlang der Boundary. Unsichtbar, solange niemand in der Nähe ist.
 * Nähert sich Kopf oder Hand der Grenze auf unter 0,4 m, wird es rund um diese Stelle sichtbar
 * (Abstand pro Pixel im Shader). Steht direkt auf der Boundary, also VOR dem Wall der Senke
 * (der beginnt ≥ 0,5 m außerhalb) und ist damit immer gut zu sehen.
 */
export const WARN_DISTANCE = 0.4;

export class BoundaryWarning {
  readonly mesh: THREE.Mesh;
  private uniforms: { uPts: { value: THREE.Vector3[] }; uTime: { value: number }; uForce: { value: number } };

  constructor(polygon: V2[], height = 2.4) {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    let run = 0;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const base = pos.length / 3;
      pos.push(a.x, 0, a.z, b.x, 0, b.z, b.x, height, b.z, a.x, height, a.z);
      uv.push(run, 0, run + len, 0, run + len, height, run, height);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      run += len;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.uniforms = {
      uPts: { value: [new THREE.Vector3(1e3, 0, 0), new THREE.Vector3(1e3, 0, 0), new THREE.Vector3(1e3, 0, 0)] },
      uTime: { value: 0 },
      uForce: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { ...this.uniforms, uWarn: { value: WARN_DISTANCE } },
      vertexShader: `varying vec3 vW; varying vec2 vUv; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uPts[3]; uniform float uTime; uniform float uForce; uniform float uWarn;
        varying vec3 vW; varying vec2 vUv;
        void main(){
          float d = 1e3;
          for (int i = 0; i < 3; i++) d = min(d, distance(vW, uPts[i]));
          // sichtbar im Umkreis der nahen Körperteile, stärker je näher
          // erst unter 0,4 m sichtbar, am kräftigsten bei Berührung
          float near = smoothstep(uWarn, 0.05, d);
          float a = max(near, uForce * 0.6);
          if (a < 0.01) discard;
          // Rankengitter: zwei schräge, leicht gewellte Strangscharen + Knoten
          vec2 p = vUv * 6.0;
          float w1 = abs(fract(p.x + p.y * 0.8 + 0.08 * sin(p.y * 3.0 + uTime)) - 0.5);
          float w2 = abs(fract(p.x - p.y * 0.8 + 0.08 * sin(p.y * 2.5 - uTime)) - 0.5);
          float vine = smoothstep(0.06, 0.0, min(w1, w2));
          float leaf = smoothstep(0.12, 0.0, length(fract(p * 0.5) - 0.5)) * 0.6;
          vec3 col = mix(vec3(0.15, 1.0, 0.75), vec3(1.0, 0.35, 0.6), smoothstep(0.35, 0.05, d));
          gl_FragColor = vec4(col * (vine + leaf) * a * 1.4, (vine + leaf) * a);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.mesh.name = 'boundary-warning';
  }

  /** Kopf + bis zu zwei Hände; `force` > 0 zeigt das ganze Gitter (Menü „Boundary anzeigen“). */
  update(time: number, points: THREE.Vector3[], force: number): void {
    this.uniforms.uTime.value = time;
    this.uniforms.uForce.value = force;
    for (let i = 0; i < 3; i++) this.uniforms.uPts.value[i].copy(points[i] ?? new THREE.Vector3(1e3, 0, 0));
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** Kürzester Abstand eines Punkts (XZ) zum Polygonrand – für Hinweis/Haptik. */
export function distanceToBoundary(p: { x: number; z: number }, poly: V2[]): number {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const l2 = abx * abx + abz * abz;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2));
    d = Math.min(d, Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t)));
  }
  return d;
}
