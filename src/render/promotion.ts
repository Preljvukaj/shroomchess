import * as THREE from 'three';
import type { Color, PieceSymbol } from '../core/types';
import { PLAYER_GLOW, pieceGeometry, pieceMaterials } from './pieces';

const CHOICES: PieceSymbol[] = ['q', 'r', 'b', 'n'];

/**
 * Bauernumwandlung: vier schwebende Mini-Figuren über dem Zielfeld.
 * Auswahl per Strahl (Maus/Controller) oder Berührung (Hand).
 */
export class PromotionPicker {
  readonly root = new THREE.Group();
  private items: { mesh: THREE.Mesh; type: PieceSymbol; ring: THREE.Mesh }[] = [];
  private resolve: ((t: PieceSymbol) => void) | null = null;
  private hovered: PieceSymbol | null = null;

  constructor(private kingHeight: number, private segments: number, private high: boolean) {
    this.root.visible = false;
  }

  get active(): boolean {
    return this.resolve !== null;
  }

  /** `localPos` = Brett-lokale Position des Zielfelds; `yaw` = Blickrichtung des Spielers (Brett-lokal). */
  show(color: Color, localPos: THREE.Vector3, yaw: number): Promise<PieceSymbol> {
    this.clear();
    const s = this.kingHeight * 0.35;
    const spacing = this.kingHeight * 0.28;
    this.root.position.set(localPos.x, localPos.y + this.kingHeight * 0.95, localPos.z);
    this.root.rotation.y = yaw;
    CHOICES.forEach((type, i) => {
      const mesh = new THREE.Mesh(pieceGeometry(type, this.segments), pieceMaterials(this.high)[color]);
      mesh.scale.setScalar(s);
      mesh.position.set((i - 1.5) * spacing, -s * 0.4, 0);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(spacing * 0.42, spacing * 0.03, 6, 32),
        new THREE.MeshBasicMaterial({ color: PLAYER_GLOW[color], transparent: true, opacity: 0.4 }),
      );
      ring.position.copy(mesh.position).setY(mesh.position.y + s * 0.35);
      mesh.userData.promo = type;
      this.root.add(mesh, ring);
      this.items.push({ mesh, type, ring });
    });
    this.root.visible = true;
    return new Promise((res) => (this.resolve = res));
  }

  /** Strahl-Auswahl: gibt den getroffenen Typ zurück (für Hover). */
  hoverRay(ray: THREE.Raycaster): PieceSymbol | null {
    if (!this.active) return null;
    const hits = ray.intersectObjects(this.items.flatMap((i) => [i.mesh, i.ring]), false);
    const hit = hits[0]?.object;
    const item = this.items.find((i) => i.mesh === hit || i.ring === hit);
    this.hovered = item?.type ?? null;
    return this.hovered;
  }

  /** Berührungs-Auswahl (VR-Hand): nächstes Element innerhalb `radius`. */
  hoverPoint(world: THREE.Vector3, radius: number): PieceSymbol | null {
    if (!this.active) return null;
    let best: PieceSymbol | null = null;
    let bestD = radius;
    const p = new THREE.Vector3();
    for (const it of this.items) {
      const d = it.ring.getWorldPosition(p).distanceTo(world);
      if (d < bestD) {
        bestD = d;
        best = it.type;
      }
    }
    this.hovered = best;
    return best;
  }

  choose(type: PieceSymbol | null = this.hovered): boolean {
    if (!this.resolve || !type) return false;
    const r = this.resolve;
    this.resolve = null;
    this.clear();
    r(type);
    return true;
  }

  update(time: number): void {
    if (!this.active) return;
    this.items.forEach((it, i) => {
      it.mesh.rotation.y = time * 0.8 + i;
      it.mesh.position.y = -this.kingHeight * 0.35 * 0.4 + Math.sin(time * 2 + i) * 0.01 * this.kingHeight;
      const on = it.type === this.hovered;
      (it.ring.material as THREE.MeshBasicMaterial).opacity = on ? 1 : 0.35;
      it.ring.scale.setScalar(on ? 1.15 : 1);
    });
  }

  private clear(): void {
    for (const it of this.items) {
      it.mesh.removeFromParent();
      it.ring.removeFromParent();
      it.ring.geometry.dispose();
    }
    this.items = [];
    this.hovered = null;
    this.root.visible = false;
  }
}
