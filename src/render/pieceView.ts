import * as THREE from 'three';
import type { Color, PieceSymbol, Square } from '../core/types';
import { GRIP_HEIGHT, PLAYER_GLOW, pieceGeometry, pieceMaterials } from './pieces';

/**
 * Zustand des Griffpunkts – identische Logik für Desktop-Maus und VR-Hand.
 *  idle      kaum sichtbar, glimmt
 *  near      Hand < 30 cm: leuchtet in Spielerfarbe, pulsiert, heller je näher
 *  grabbable Hand < 8 cm: kräftig, Outline, Haptik
 *  blocked   gegnerische Figur / nicht am Zug: gedämpft rot/grau, nicht greifbar
 *  held      wird getragen
 */
export type GripState = 'idle' | 'near' | 'grabbable' | 'blocked' | 'held' | 'nomoves';

// Abstände für Annäherung/Greifen: siehe grab.ts (grabConfig, mit Hysterese)


export class PieceView {
  readonly root = new THREE.Group();
  readonly mesh: THREE.Mesh;
  /**
   * Position des Griffpunkts (unsichtbarer Anker). Gezeichnet werden alle Griffpunkte
   * gesammelt in GripBatch (2 Draw Calls statt 64) – siehe gripBatch.ts.
   */
  readonly grip = new THREE.Object3D();
  /** Darstellungswerte für GripBatch (pro Frame aus Zustand + Nähe berechnet). */
  readonly gripColor = new THREE.Color();
  gripOpacity = 0.2;
  haloOpacity = 0;
  gripRadius = 0.04;
  state: GripState = 'idle';
  /** 0..1 Nähe der Hand (1 = berührt). */
  proximity = 0;
  /** Kurzes Aufleuchten beim Greifen (1 → 0). */
  flash = 0;
  /** Vorwarnung vor einem gegnerischen Zug: Griffpunkt leuchtet anhaltend in der Figurenfarbe (0..1). */
  preGlow = 0;
  readonly height: number;

  constructor(
    public type: PieceSymbol,
    public readonly color: Color,
    public square: Square,
    kingHeight: number,
    segments: number,
    high: boolean,
  ) {
    this.height = kingHeight;
    this.root.name = `piece-${color}${type}-${square}`;
    this.mesh = new THREE.Mesh(pieceGeometry(type, segments), pieceMaterials(high)[color]);
    this.mesh.scale.setScalar(kingHeight);
    // Schwarze Figuren schauen zur weißen Seite (Springer!)
    if (color === 'b') this.mesh.rotation.y = Math.PI;
    this.root.add(this.mesh);

    // Griffpunkt: 8–10 cm, auf der Spitze (König: auf dem Kreuz, Springer: auf dem Kopf)
    const r = Math.min(0.05, kingHeight * 0.045);
    this.gripRadius = r;
    this.gripColor.copy(PLAYER_GLOW[color]);
    this.placeGrip();
    this.root.add(this.grip);
    this.grip.userData.piece = this;
    this.mesh.userData.piece = this;
  }

  /** Griffpunkt in Weltkoordinaten. */
  gripWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return this.grip.getWorldPosition(out);
  }

  setType(type: PieceSymbol, segments: number): void {
    this.type = type;
    this.mesh.geometry = pieceGeometry(type, segments);
    this.placeGrip();
  }

  private placeGrip(): void {
    const r = Math.min(0.05, this.height * 0.045);
    this.grip.position.set(0, GRIP_HEIGHT[this.type] * this.height + r * 0.6, 0);
    // Springer: Griffpunkt auf dem Kopf (zwischen den Ohren), nicht über dem Sockel
    if (this.type === 'n') this.grip.position.z = (this.color === 'w' ? -0.01 : 0.01) * this.height;
  }

  /** Pro Frame: Darstellung aus Zustand + Nähe. */
  update(time: number, colorblind: boolean): void {
    const pulse = 0.5 + 0.5 * Math.sin(time * 5);
    let opacity = 0.18 + 0.06 * Math.sin(time * 1.3 + this.square.charCodeAt(0));
    let halo = 0;
    let scale = 1;
    const base = PLAYER_GLOW[this.color];
    let col = base;
    switch (this.state) {
      case 'near':
        opacity = 0.35 + 0.55 * this.proximity;
        halo = (0.1 + 0.35 * this.proximity) * (0.7 + 0.3 * pulse);
        scale = 1 + 0.25 * this.proximity;
        break;
      case 'grabbable':
      case 'held':
        opacity = 1;
        halo = 0.55 + 0.2 * pulse;
        scale = 1.35;
        break;
      case 'blocked':
        col = colorblind ? GREY : MUTED_RED;
        opacity = 0.15 + 0.35 * this.proximity;
        break;
      case 'nomoves':
        col = GREY;
        opacity = 0.12 + 0.2 * this.proximity;
        break;
      default:
        break;
    }
    if (this.preGlow > 0) {
      halo = Math.max(halo, 0.75 * this.preGlow);
      opacity = Math.max(opacity, this.preGlow);
      scale *= 1 + 0.45 * this.preGlow;
      col = base;
    }
    if (this.flash > 0) {
      // Snap-Feedback: Griffpunkt leuchtet kurz kräftig auf
      halo = Math.max(halo, this.flash);
      opacity = 1;
      scale *= 1 + 0.6 * this.flash;
      this.flash = Math.max(0, this.flash - 0.07);
    }
    this.gripColor.copy(col);
    this.gripOpacity = opacity;
    this.haloOpacity = halo;
    const r = Math.min(0.05, this.height * 0.045);
    this.gripRadius = r * scale;
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}

const MUTED_RED = new THREE.Color('#a0303a');
const GREY = new THREE.Color('#707080');
