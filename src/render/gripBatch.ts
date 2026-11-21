import * as THREE from 'three';
import type { PieceView } from './pieceView';

/**
 * Alle Griffpunkte in zwei Draw Calls: Kugeln (normal transparent) und Halos (additiv).
 * Farbe und Deckkraft pro Instanz. Die Anker-Objekte bleiben in den Figuren
 * (Interaktion misst Abstände zu ihnen), nur das Zeichnen ist gebündelt.
 */
export class GripBatch {
  readonly root = new THREE.Group();
  private orbs: THREE.InstancedMesh;
  private halos: THREE.InstancedMesh;
  private orbAlpha: THREE.InstancedBufferAttribute;
  private haloAlpha: THREE.InstancedBufferAttribute;
  private m = new THREE.Matrix4();
  private p = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();

  constructor(capacity = 40) {
    const mk = (additive: boolean) => {
      const geo = new THREE.SphereGeometry(1, 14, 10);
      const alpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
      geo.setAttribute('aAlpha', alpha);
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        vertexShader: `attribute float aAlpha; varying float vA; varying vec3 vC;
          void main(){ vA = aAlpha; vC = instanceColor; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying float vA; varying vec3 vC; void main(){ if (vA < 0.005) discard; gl_FragColor = vec4(vC, vA);
          #include <colorspace_fragment>
        }`,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, capacity);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.renderOrder = 6;
      return { mesh, alpha };
    };
    const o = mk(false);
    const h = mk(true);
    this.orbs = o.mesh;
    this.orbAlpha = o.alpha;
    this.halos = h.mesh;
    this.haloAlpha = h.alpha;
    this.root.add(this.orbs, this.halos);
  }

  /** Pro Frame nach PieceView.update(): Matrizen/Farben übernehmen. `parentInv` = Inverse der Weltmatrix von root.parent. */
  update(pieces: PieceView[]): void {
    const n = Math.min(pieces.length, this.orbs.instanceMatrix.count);
    const parentInv = new THREE.Matrix4();
    if (this.root.parent) parentInv.copy(this.root.parent.matrixWorld).invert();
    for (let i = 0; i < n; i++) {
      const pv = pieces[i];
      pv.grip.updateWorldMatrix(true, false);
      this.m.multiplyMatrices(parentInv, pv.grip.matrixWorld).decompose(this.p, this.q, this.s);
      this.m.compose(this.p, this.q, this.s.setScalar(pv.gripRadius));
      this.orbs.setMatrixAt(i, this.m);
      this.m.compose(this.p, this.q, this.s.setScalar(pv.gripRadius * 2.2));
      this.halos.setMatrixAt(i, this.m);
      this.orbs.setColorAt(i, pv.gripColor);
      this.halos.setColorAt(i, pv.gripColor);
      this.orbAlpha.setX(i, pv.gripOpacity);
      this.haloAlpha.setX(i, pv.haloOpacity);
    }
    for (const mesh of [this.orbs, this.halos]) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.orbAlpha.needsUpdate = true;
    this.haloAlpha.needsUpdate = true;
  }
}
