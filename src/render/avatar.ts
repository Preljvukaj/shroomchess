import * as THREE from 'three';
import { safeMerge } from './shared';

/**
 * Avatar des Gegners bzw. Mitspielers: leuchtendes Sporenwesen.
 *  - Kopf: Leuchtkugel mit kleinen Sporenknospen und zwei dunklen Augen (Blickrichtung erkennbar)
 *  - Hände: Leuchtkugeln mit drei Fingersporen (InstancedMesh, zusammen mit der Desktop-Laterne)
 *  - Desktop-Gegner: schwebender Kopf hinter seiner Grundreihe + Zeiger-Licht (Laterne + Lichtfleck) über dem Feld
 * Kein Echtzeitlicht. 3 Draw Calls. `proximity` (0..1) lässt ihn stärker leuchten (Co-Location-Sicherheit).
 */

function colorize(g: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(a, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  return g;
}

function glowMaterial(color: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    uniforms: { uColor: { value: color.clone() }, uGlow: { value: 0 }, uTime: { value: 0 }, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec3 color;
      varying vec3 vN; varying vec3 vV; varying vec3 vC;
      void main(){
        mat4 im = mat4(1.0);
        #ifdef USE_INSTANCING
          im = instanceMatrix;
        #endif
        vec4 w = modelMatrix * im * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * mat3(im) * normal);
        vV = normalize(cameraPosition - w.xyz);
        vC = color;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uGlow; uniform float uTime; uniform float uOpacity;
      varying vec3 vN; varying vec3 vV; varying vec3 vC;
      void main(){
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        float pulse = 0.85 + 0.15 * sin(uTime * 2.4);
        vec3 base = vC.r < 0.05 && vC.g < 0.05 ? vec3(0.02) : uColor * vC;   // Augen dunkel
        vec3 col = base * (0.45 + 0.35 * pulse) + uColor * fres * (0.9 + 1.6 * uGlow);
        col *= 1.0 + 1.2 * uGlow;
        gl_FragColor = vec4(col, uOpacity * (0.82 + 0.18 * fres));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export class Avatar {
  readonly root = new THREE.Group();
  readonly head: THREE.Mesh;
  /** Instanz 0/1: Hände, 2: Desktop-Laterne */
  readonly orbs: THREE.InstancedMesh;
  private disc: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private orbMat: THREE.ShaderMaterial;
  private m = new THREE.Matrix4();
  private hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  /** 0..1 – Nähe (stärkeres Leuchten) */
  proximity = 0;
  /** Weltmaßstab des Avatars (Online: eigener Brettmaßstab / Brettmaßstab des Gegners) */
  scale = 1;

  constructor(color: THREE.Color) {
    this.root.name = 'avatar';
    const parts: THREE.BufferGeometry[] = [colorize(new THREE.IcosahedronGeometry(0.11, 2), new THREE.Color(1, 1, 1))];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const g = new THREE.SphereGeometry(0.022, 6, 4);
      g.translate(Math.cos(a) * 0.09, 0.07 + (i % 2) * 0.02, Math.sin(a) * 0.09);
      parts.push(colorize(g, new THREE.Color(0.8, 0.9, 1)));
    }
    for (const sx of [-1, 1]) {
      const e = new THREE.SphereGeometry(0.018, 8, 6).scale(1, 1.2, 0.6);
      e.translate(sx * 0.038, 0.012, -0.1); // Blick nach −Z
      parts.push(colorize(e, new THREE.Color(0, 0, 0)));
    }
    this.mat = glowMaterial(color);
    this.head = new THREE.Mesh(safeMerge(parts), this.mat);
    const hand: THREE.BufferGeometry[] = [colorize(new THREE.IcosahedronGeometry(0.04, 1), new THREE.Color(1, 1, 1))];
    for (let i = 0; i < 3; i++) {
      const f = new THREE.SphereGeometry(0.014, 6, 4);
      f.translate((i - 1) * 0.022, 0.0, -0.045);
      hand.push(colorize(f, new THREE.Color(0.85, 0.95, 1)));
    }
    this.orbMat = glowMaterial(color);
    this.orbs = new THREE.InstancedMesh(safeMerge(hand), this.orbMat, 3);
    this.orbs.frustumCulled = false;
    for (let i = 0; i < 3; i++) this.orbs.setMatrixAt(i, this.hidden);
    this.disc = new THREE.Mesh(
      new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: color.clone() } },
        vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 uColor; varying vec2 vP; void main(){ float r = length(vP); float a = smoothstep(1.0, 0.2, r) * 0.55; gl_FragColor = vec4(uColor * a, a); }`,
      }),
    );
    this.disc.visible = false;
    this.root.add(this.head, this.orbs, this.disc);
    this.root.visible = false;
  }

  /** VR-Pose in Weltkoordinaten. Hände null = nicht verfolgt. */
  setVR(head: THREE.Matrix4, left: THREE.Vector3 | null, right: THREE.Vector3 | null): void {
    this.root.visible = true;
    this.head.matrixAutoUpdate = false;
    const s = new THREE.Vector3(this.scale, this.scale, this.scale);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    head.decompose(p, q, sc);
    this.head.matrix.compose(p, q, s);
    this.head.matrixWorldNeedsUpdate = true;
    [left, right].forEach((h, i) => {
      if (h) this.orbs.setMatrixAt(i, this.m.compose(h, q, s));
      else this.orbs.setMatrixAt(i, this.hidden);
    });
    this.orbs.setMatrixAt(2, this.hidden);
    this.orbs.instanceMatrix.needsUpdate = true;
    this.disc.visible = false;
  }

  /** Desktop-Gegner: Kopf an `head` mit Blick auf `lookAt`, Zeiger-Licht über `hover` (Weltpunkte). */
  setDesktop(head: THREE.Vector3, lookAt: THREE.Vector3, hover: THREE.Vector3 | null, discRadius: number): void {
    this.root.visible = true;
    this.head.matrixAutoUpdate = false;
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(head, lookAt, new THREE.Vector3(0, 1, 0)));
    const s = this.scale * 1.6;
    this.head.matrix.compose(head, q, new THREE.Vector3(s, s, s));
    this.head.matrixWorldNeedsUpdate = true;
    this.orbs.setMatrixAt(0, this.hidden);
    this.orbs.setMatrixAt(1, this.hidden);
    if (hover) {
      const lantern = hover.clone().setY(hover.y + discRadius * 2.2);
      this.orbs.setMatrixAt(2, this.m.compose(lantern, new THREE.Quaternion(), new THREE.Vector3(s, s, s)));
      this.disc.position.copy(hover).setY(hover.y + 0.004);
      this.disc.scale.setScalar(discRadius);
      this.disc.visible = true;
    } else {
      this.orbs.setMatrixAt(2, this.hidden);
      this.disc.visible = false;
    }
    this.orbs.instanceMatrix.needsUpdate = true;
  }

  hide(): void {
    this.root.visible = false;
  }

  update(time: number): void {
    for (const m of [this.mat, this.orbMat]) {
      m.uniforms.uTime.value = time;
      m.uniforms.uGlow.value = this.proximity;
    }
  }

  /** Weltposition des Kopfes */
  headWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return out.setFromMatrixPosition(this.head.matrix);
  }

  handWorld(i: 0 | 1, out = new THREE.Vector3()): THREE.Vector3 | null {
    this.orbs.getMatrixAt(i, this.m);
    if (this.m.elements[0] === 0 && this.m.elements[5] === 0) return null;
    return out.setFromMatrixPosition(this.m);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.head.geometry.dispose();
    this.orbs.geometry.dispose();
    this.disc.geometry.dispose();
  }
}
