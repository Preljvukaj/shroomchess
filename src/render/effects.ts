import * as THREE from 'three';

/**
 * Kurzlebige Effekte: Auflösen in leuchtende Sporen + einfache Tweens.
 * Alles läuft über `update(dt)` aus der Render-Schleife.
 */

export type Ease = (t: number) => number;
export const easeInOut: Ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOutBack: Ease = (t) => {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

interface Tween {
  t: number;
  dur: number;
  step: (k: number) => void;
  done?: () => void;
}

export class Effects {
  private tweens: Tween[] = [];
  private bursts: { pts: THREE.Points; t: number; dur: number }[] = [];

  constructor(private parent: THREE.Object3D) {}

  tween(dur: number, step: (k: number) => void, done?: () => void): void {
    this.tweens.push({ t: 0, dur, step, done });
  }

  tweenAsync(dur: number, step: (k: number) => void): Promise<void> {
    return new Promise((res) => this.tween(dur, step, res));
  }

  /** Bewegt ein Objekt in einem Bogen (Springer höher) von a nach b. */
  moveArc(obj: THREE.Object3D, to: THREE.Vector3, dur: number, hop: number): Promise<void> {
    const from = obj.position.clone();
    return this.tweenAsync(dur, (k) => {
      const e = easeInOut(k);
      obj.position.lerpVectors(from, to, e);
      obj.position.y = THREE.MathUtils.lerp(from.y, to.y, e) + Math.sin(e * Math.PI) * hop;
    });
  }

  /**
   * Figur löst sich in Sporen auf: Partikel aus dem Volumen der Figur steigen
   * spiralförmig auf und verblassen; die Figur selbst schrumpft und verblasst.
   */
  dissolve(mesh: THREE.Mesh, color: THREE.Color, height: number, dur = 0.7): Promise<void> {
    const count = 260;
    const world = new THREE.Vector3();
    mesh.getWorldPosition(world);
    const local = this.parent.worldToLocal(world.clone());
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 4);
    const radius = height * 0.12;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      const y = Math.random() * height * 0.9;
      pos.set([local.x + Math.cos(a) * r, local.y + y, local.z + Math.sin(a) * r], i * 3);
      seed.set([Math.random(), Math.random(), Math.random(), a], i * 4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uK: { value: 0 }, uColor: { value: color.clone() }, uH: { value: height }, uCenter: { value: local.clone() } },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed; uniform float uK; uniform float uH; uniform vec3 uCenter; varying float vA;
        void main(){
          vec3 p = position;
          float k = uK;
          float ang = aSeed.w + k * (2.0 + aSeed.x * 4.0);
          float out_ = k * uH * (0.15 + aSeed.y * 0.35);
          p.x += cos(ang) * out_; p.z += sin(ang) * out_;
          p.y += k * k * uH * (0.6 + aSeed.z * 0.9);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          vA = (1.0 - k) * (0.6 + 0.4 * aSeed.x);
          gl_PointSize = (0.025 * uH + 0.01) * (400.0 / max(-mv.z, 0.3)) * (1.0 - 0.5 * k);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA; gl_FragColor = vec4(uColor * a * 2.0, a); }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.parent.add(pts);
    this.bursts.push({ pts, t: 0, dur: Math.max(1.6, dur * 2.2) });

    // Figur verblassen lassen (Material klonen, damit andere Figuren unberührt bleiben)
    const m = (mesh.material as THREE.MeshPhysicalMaterial).clone();
    m.transparent = true;
    mesh.material = m;
    const s0 = mesh.scale.x;
    return this.tweenAsync(dur, (k) => {
      m.opacity = 1 - k;
      m.emissive.copy(color).multiplyScalar(k * 2);
      mesh.scale.set(s0 * (1 - 0.3 * k), s0 * (1 - 0.6 * k), s0 * (1 - 0.3 * k));
    });
  }

  /** Kleines Sporen-Staubwölkchen am Boden (weiches Aufsetzen). `local` in Koordinaten des Eltern-Objekts. */
  dust(local: THREE.Vector3, color: THREE.Color, radius: number): void {
    const count = 70;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      pos.set([local.x + Math.cos(a) * radius * 0.4, local.y + 0.01, local.z + Math.sin(a) * radius * 0.4], i * 3);
      seed.set([Math.random(), Math.random(), Math.random(), a], i * 4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uK: { value: 0 }, uColor: { value: color.clone().lerp(new THREE.Color('#e8ffd8'), 0.5) }, uR: { value: radius } },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed; uniform float uK; uniform float uR; varying float vA;
        void main(){
          vec3 p = position;
          float e = 1.0 - (1.0 - uK) * (1.0 - uK);
          p.x += cos(aSeed.w) * e * uR * (0.6 + aSeed.x);
          p.z += sin(aSeed.w) * e * uR * (0.6 + aSeed.x);
          p.y += sin(e * 3.14159) * uR * 0.25 * aSeed.y;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          vA = (1.0 - uK) * (0.4 + 0.6 * aSeed.z);
          gl_PointSize = (0.02 * uR * 10.0 + 0.006) * (300.0 / max(-mv.z, 0.3));
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA * 0.6; gl_FragColor = vec4(uColor * a, a); }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.parent.add(pts);
    this.bursts.push({ pts, t: 0, dur: 0.9 });
  }

  update(dt: number): void {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.step(k);
      if (k >= 1) {
        this.tweens.splice(i, 1);
        tw.done?.();
      }
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.t += dt;
      (b.pts.material as THREE.ShaderMaterial).uniforms.uK.value = Math.min(1, b.t / b.dur);
      if (b.t >= b.dur) {
        b.pts.removeFromParent();
        b.pts.geometry.dispose();
        (b.pts.material as THREE.Material).dispose();
        this.bursts.splice(i, 1);
      }
    }
  }
}
