import * as THREE from 'three';
import type { Color, PieceSymbol } from '../core/types';
import type { PieceView } from './pieceView';
import { pieceGeometry, pieceMaterials } from './pieces';

/** Fußradius je Figur relativ zur Königshöhe (für die Größe des Kontaktschattens). */
const BASE_RADIUS: Record<PieceSymbol, number> = { k: 0.17, q: 0.165, b: 0.148, n: 0.158, r: 0.155, p: 0.14 };

/**
 * Alle Figuren in höchstens 12 Draw Calls (ein InstancedMesh pro Typ × Farbe) statt 32.
 * Die einzelnen Figuren-Meshes bleiben als unsichtbare Stellvertreter erhalten (Raycasts,
 * Umriss-Geometrie, Auflöse-Effekt); jedes Frame werden ihre Weltmatrizen übernommen.
 */
export class PieceBatch {
  readonly root = new THREE.Group();
  private meshes = new Map<string, THREE.InstancedMesh>();
  private m = new THREE.Matrix4();
  private inv = new THREE.Matrix4();
  /** Weiche Kontaktschatten (Blob) unter allen Figuren – ein Draw Call. */
  private shadows: THREE.InstancedMesh;
  private shadowAlpha: THREE.InstancedBufferAttribute;

  constructor(private segments: number, private high: boolean, private kingHeight = 1.1, private surfaceY = 0.05, private capacity = 10) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.shadowAlpha = new THREE.InstancedBufferAttribute(new Float32Array(40), 1);
    geo.setAttribute('aAlpha', this.shadowAlpha);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      vertexShader: `attribute float aAlpha; varying vec2 vUv; varying float vA;
        void main(){ vUv = uv; vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec2 vUv; varying float vA;
        void main(){ float d = length(vUv - 0.5) * 2.0; float a = (1.0 - smoothstep(0.35, 1.0, d)) * vA; gl_FragColor = vec4(0.0, 0.0, 0.02, a); }`,
    });
    this.shadows = new THREE.InstancedMesh(geo, mat, 40);
    this.shadows.frustumCulled = false;
    this.shadows.count = 0;
    this.shadows.renderOrder = 2;
    this.root.add(this.shadows);
  }

  private meshFor(type: PieceSymbol, color: Color): THREE.InstancedMesh {
    const key = `${color}${type}`;
    let mesh = this.meshes.get(key);
    if (!mesh) {
      mesh = new THREE.InstancedMesh(pieceGeometry(type, this.segments), pieceMaterials(this.high)[color], this.capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.name = `piece-${key}`;
      this.meshes.set(key, mesh);
      this.root.add(mesh);
    }
    return mesh;
  }

  update(pieces: PieceView[]): void {
    for (const mesh of this.meshes.values()) mesh.count = 0;
    if (this.root.parent) this.inv.copy(this.root.parent.matrixWorld).invert();
    else this.inv.identity();
    let si = 0;
    const p = new THREE.Vector3();
    for (const pv of pieces) {
      pv.mesh.visible = false; // Stellvertreter – gezeichnet wird gebündelt
      const mesh = this.meshFor(pv.type, pv.color);
      if (mesh.count >= this.capacity) continue;
      pv.mesh.updateWorldMatrix(true, false);
      this.m.multiplyMatrices(this.inv, pv.mesh.matrixWorld);
      mesh.setMatrixAt(mesh.count++, this.m);
      // Kontaktschatten: auf der Brettoberfläche unter der Figur, verblasst und wächst beim Anheben
      if (si < 40) {
        p.setFromMatrixPosition(this.m);
        const lift = Math.max(0, p.y - this.surfaceY);
        const k = Math.max(0, 1 - lift / (this.kingHeight * 0.9));
        const r = this.kingHeight * (BASE_RADIUS[pv.type] ?? 0.15) * 2 * 1.35 * (1 + (1 - k) * 0.6);
        this.m.makeScale(r, 1, r).setPosition(p.x + this.kingHeight * 0.03, this.surfaceY + 0.0015, p.z + this.kingHeight * 0.02);
        this.shadows.setMatrixAt(si, this.m);
        this.shadowAlpha.setX(si, 0.62 * k);
        si++;
      }
    }
    this.shadows.count = si;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.shadowAlpha.needsUpdate = true;
    for (const mesh of this.meshes.values()) mesh.instanceMatrix.needsUpdate = true;
  }
}
