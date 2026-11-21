import * as THREE from 'three';
import type { Color, PieceSymbol } from '../core/types';
import type { PieceView } from './pieceView';
import { pieceGeometry, pieceMaterials } from './pieces';

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

  constructor(private segments: number, private high: boolean, private capacity = 10) {}

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
    for (const pv of pieces) {
      pv.mesh.visible = false; // Stellvertreter – gezeichnet wird gebündelt
      const mesh = this.meshFor(pv.type, pv.color);
      if (mesh.count >= this.capacity) continue;
      pv.mesh.updateWorldMatrix(true, false);
      this.m.multiplyMatrices(this.inv, pv.mesh.matrixWorld);
      mesh.setMatrixAt(mesh.count++, this.m);
    }
    for (const mesh of this.meshes.values()) mesh.instanceMatrix.needsUpdate = true;
  }
}
