import * as THREE from 'three';
import type { ChessGame } from '../core/game';
import type { Color, MoveOption, PieceSymbol, Square } from '../core/types';
import { squareAt } from './board';
import type { BoardScene } from './boardScene';
import { columnConfig, grabConfig, heldFootY, pickColumnTarget, pickGrabTarget, snapOffset } from './grab';
import type { PieceView } from './pieceView';
import { PLAYER_GLOW } from './pieces';

/**
 * Abstrakter Zeiger. Desktop-Maus und VR-Controller liefern einen Strahl,
 * Handtracking (M2) liefert einen Punkt (Pinch-Position).
 */
export interface Pointer {
  id: string;
  ray?: THREE.Ray;
  point?: THREE.Vector3;
  pressed: boolean;
  /** Optional: kurzer haptischer Impuls (VR-Controller). */
  haptic?: (intensity: number, ms: number) => void;
}

export interface InteractionHooks {
  /** Darf dieses Gerät gerade für `color` ziehen? (Hot-Seat: immer am Zug; Engine/Netz: nur eigene Farbe) */
  canControl(color: Color): boolean;
  /** Blickrichtung des Spielers im Brett-System (für die Ausrichtung der Umwandlungsauswahl). */
  viewerYaw(): number;
  submitMove(from: Square, to: Square, promo: PieceSymbol): boolean;
  onIllegal(): void;
  onPickup?(): void;
  /** Feld unter der gerade getragenen Figur (oder null) – für die Koordinaten-Hervorhebung. */
  onHeldOverSquare?(sq: Square | null): void;
}

interface PointerState {
  held: PieceView | null;
  selected: PieceView | null;
  pressStart: THREE.Vector2 | null;
  pressPiece: PieceView | null;
  wasPressed: boolean;
  dragged: boolean;
  lastCandidate: PieceView | null;
  hoverSquare: Square | null;
  /** greifbare Figur (Hysterese) */
  grabTarget: PieceView | null;
  /** Snap in die Hand: Startversatz Griffpunkt − Hand (Welt) und Startzeit */
  snapStart: THREE.Vector3 | null;
  snapT0: number;
  snapDur: number;
  /** Figur, über der die Hand gerade in der Greif-Säule ist */
  columnTarget: PieceView | null;
}

export class InteractionController {
  private states = new Map<string, PointerState>();
  private outline: THREE.Mesh;
  private plane = new THREE.Plane();
  private raycaster = new THREE.Raycaster();
  private targets: MoveOption[] = [];
  enabled = true;
  /** Skalierung der Greif-Abstände (Tischmodus: kleines Brett → kleinere Zonen). */
  distanceScale = 1;
  /** Sporenfäden von der Hand senkrecht hinunter zum Griffpunkt (Säulen-Greifen), einer pro Zeiger. */
  readonly beams = new THREE.Group();
  private beamMeshes = new Map<string, THREE.Mesh>();

  constructor(private scene: BoardScene, private game: ChessGame, private hooks: InteractionHooks) {
    this.outline = new THREE.Mesh(
      new THREE.BufferGeometry(),
      // Umriss (Inverted Hull) leicht nach hinten versetzt → kein Z-Fighting mit der Figur
      new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.BackSide, transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }),
    );
    this.outline.visible = false;
    this.outline.renderOrder = 1;
  }

  get outlineMesh(): THREE.Mesh {
    return this.outline;
  }

  private state(id: string): PointerState {
    let s = this.states.get(id);
    if (!s) {
      s = { held: null, selected: null, pressStart: null, pressPiece: null, wasPressed: false, dragged: false, lastCandidate: null, hoverSquare: null, grabTarget: null, snapStart: null, snapT0: 0, snapDur: grabConfig.snapSeconds, columnTarget: null };
      this.states.set(id, s);
    }
    return s;
  }

  private isMovable(p: PieceView): boolean {
    return (
      this.enabled &&
      !this.scene.isAnalysis &&
      !this.game.result() &&
      p.color === this.game.turn &&
      this.hooks.canControl(p.color) &&
      this.game.hasLegalMove(p.square)
    );
  }

  /** Abstand Zeiger ↔ Griffpunkt (Strahl: kürzester Abstand zur Geraden; Punkt: euklidisch). */
  private distanceTo(ptr: Pointer, p: PieceView, tmp: THREE.Vector3): number {
    const g = p.gripWorld(tmp);
    if (ptr.point) return ptr.point.distanceTo(g);
    if (ptr.ray) return ptr.ray.distanceToPoint(g);
    return Infinity;
  }

  /** Brett-lokaler Schnittpunkt Strahl ↔ Brettebene. */
  private rayToBoard(ray: THREE.Ray, height = 0): THREE.Vector3 | null {
    const root = this.scene.root;
    const n = new THREE.Vector3(0, 1, 0).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
    const o = root.localToWorld(new THREE.Vector3(0, this.scene.board.surfaceY + height, 0));
    this.plane.setFromNormalAndCoplanarPoint(n, o);
    const hit = ray.intersectPlane(this.plane, new THREE.Vector3());
    return hit ? root.worldToLocal(hit) : null;
  }

  private showTargets(p: PieceView | null): void {
    this.targets = p ? this.game.legalMovesFrom(p.square) : [];
    this.scene.highlights.setTargets(this.targets);
  }

  /** Pro Frame mit allen aktiven Zeigern aufrufen. `screen` = Mausposition (Klick-vs-Drag-Unterscheidung). */
  update(pointers: Pointer[], screen?: THREE.Vector2): void {
    const pieces = this.scene.allPieces();
    const tmp = new THREE.Vector3();

    // Umwandlungsauswahl hat Vorrang
    if (this.scene.promotion.active) {
      for (const ptr of pointers) {
        const st = this.state(ptr.id);
        if (ptr.ray) {
          this.raycaster.ray.copy(ptr.ray);
          this.scene.promotion.hoverRay(this.raycaster);
        } else if (ptr.point) this.scene.promotion.hoverPoint(ptr.point, this.scene.kingHeight * 0.15 * this.scene.root.scale.x);
        if (ptr.pressed && !st.wasPressed) this.scene.promotion.choose();
        st.wasPressed = ptr.pressed;
      }
      return;
    }

    // Nähe-Zustände zurücksetzen
    for (const p of pieces) {
      if (p.state !== 'held') {
        p.state = this.markIdle(p);
        p.proximity = 0;
      }
    }

    let outlineTarget: PieceView | null = null;

    for (const ptr of pointers) {
      const st = this.state(ptr.id);
      const justPressed = ptr.pressed && !st.wasPressed;
      const justReleased = !ptr.pressed && st.wasPressed;
      st.wasPressed = ptr.pressed;

      // --- Getragene Figur folgt dem Zeiger ---
      if (st.held) {
        const p = st.held;
        let local: THREE.Vector3 | null = null;
        if (ptr.ray) local = this.rayToBoard(ptr.ray);
        else if (ptr.point) local = this.scene.root.worldToLocal(ptr.point.clone()).setY(0);
        if (local) {
          const lift = this.scene.kingHeight * 0.12;
          p.root.position.set(local.x, lift, local.z);
          if (ptr.point && p.root.parent) {
            // Hand: Griffpunkt schnappt in ~100 ms (ease-out) an den Greifpunkt und hängt dann fest
            // daran – nur Position, keine Drehung (Figur bleibt aufrecht).
            const off = st.snapStart ? snapOffset(st.snapStart, performance.now() / 1000 - st.snapT0, { ...grabConfig, snapSeconds: st.snapDur }) : { x: 0, y: 0, z: 0 };
            const target = ptr.point.clone().add(new THREE.Vector3(off.x, off.y, off.z));
            const inParent = p.root.parent.worldToLocal(target);
            // exakt an der Hand (kein Versatz); Fuß nie unter der Brettoberfläche (hohe Figur in Hüfthöhe)
            p.root.position.set(inParent.x - p.grip.position.x, heldFootY(inParent.y, p.grip.position.y), inParent.z - p.grip.position.z);
          }
          const sq = squareAt(p.root.position.x, p.root.position.z, this.scene.squareSize);
          this.hooks.onHeldOverSquare?.(sq);
          if (screen && st.pressStart && st.pressStart.distanceTo(screen) > 6) st.dragged = true;
          if (ptr.point) st.dragged = true;
          this.setHoverSquare(st, sq && this.targets.some((t) => t.to === sq) ? sq : null);
        }
        outlineTarget = p;
        if (justReleased) this.release(st, ptr);
        continue;
      }

      // --- Kandidat suchen: nächster Griffpunkt; bei Strahl auch Treffer auf die Figur selbst ---
      let best: PieceView | null = null;
      let bestD = Infinity;
      for (const p of pieces) {
        const d = this.distanceTo(ptr, p, tmp);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      let meshHit: PieceView | null = null;
      if (ptr.ray) {
        this.raycaster.ray.copy(ptr.ray);
        const hit = this.raycaster.intersectObjects(pieces.map((p) => p.mesh), false)[0];
        meshHit = (hit?.object.userData.piece as PieceView | undefined) ?? null;
      }

      // Greifbar (mit Hysterese < 10 cm an / > 14 cm aus): die nächste Figur gewinnt, nur sie ist markiert.
      // Sonst bei Strahl die getroffene Figur, sonst der nächste Griffpunkt in Annäherungsweite.
      const NEAR = grabConfig.near * this.distanceScale;
      st.grabTarget = pickGrabTarget(pieces, st.grabTarget, (p) => this.distanceTo(ptr, p, tmp), this.distanceScale);
      // Greif-Säule (nur Hand/Controller-Punkt): Hand horizontal klar über einer Figur, in jeder Höhe bis 2 m
      if (ptr.point && !st.grabTarget) {
        const sqWorld = this.scene.squareSize * this.scene.root.scale.x;
        const cands = pieces.map((p) => {
          const base = p.root.getWorldPosition(new THREE.Vector3());
          return { item: p, x: base.x, z: base.z, gripY: p.gripWorld(new THREE.Vector3()).y };
        });
        st.columnTarget = pickColumnTarget(cands, st.columnTarget, ptr.point, sqWorld);
      } else st.columnTarget = null;
      const target = st.grabTarget ?? st.columnTarget;
      const cand = target ?? meshHit ?? (bestD < NEAR ? best : null);
      if (cand) {
        const d = cand === target ? this.distanceTo(ptr, cand, tmp) : meshHit === cand ? 0 : bestD;
        const prox = THREE.MathUtils.clamp(1 - d / NEAR, 0, 1);
        cand.proximity = Math.max(cand.proximity, cand === target ? 1 : prox);
        if (!this.isMovable(cand)) cand.state = 'blocked';
        else if (cand === target || meshHit === cand) cand.state = 'grabbable';
        else if (cand.state !== 'grabbable') cand.state = 'near';
        if (cand.state === 'grabbable') {
          outlineTarget = cand;
          if (st.lastCandidate !== cand) ptr.haptic?.(0.3, 30);
        }
      }
      st.lastCandidate = cand;

      // Ausgewählte Figur (Klick-Klick) bleibt markiert
      if (st.selected) {
        st.selected.state = 'held';
        outlineTarget ??= st.selected;
        if (ptr.ray) {
          const local = this.rayToBoard(ptr.ray);
          const sq = local ? squareAt(local.x, local.z, this.scene.squareSize) : null;
          this.setHoverSquare(st, sq && this.targets.some((t) => t.to === sq) ? sq : null);
        }
      }

      if (justPressed) {
        st.pressStart = screen?.clone() ?? null;
        st.dragged = false;
        // Erneuter Klick auf die ausgewählte Figur hebt die Auswahl auf
        if (st.selected && cand === st.selected) {
          this.deselect(st);
          continue;
        }
        // Zielfeld für Klick-Klick?
        if (st.selected && ptr.ray) {
          const local = this.rayToBoard(ptr.ray);
          const sq = local ? squareAt(local.x, local.z, this.scene.squareSize) : null;
          const clickedOwn = cand && cand !== st.selected && this.isMovable(cand) && cand.state === 'grabbable';
          if (sq && this.targets.some((t) => t.to === sq) && !clickedOwn) {
            const from = st.selected;
            this.deselect(st);
            void this.submit(from, sq, false);
            continue;
          }
          if (!clickedOwn && cand !== st.selected) {
            this.deselect(st);
            continue;
          }
        }
        if (cand && cand.state === 'grabbable') {
          if (st.selected && st.selected !== cand) this.deselect(st);
          this.grab(st, cand, ptr);
          outlineTarget = cand;
        } else if (cand && cand.state === 'blocked') {
          this.hooks.onIllegal();
        }
      }
    }

    this.updateOutline(outlineTarget);
    this.updateBeams(pointers);
  }

  /** Sporenfaden: von der Hand senkrecht nach unten zum Griffpunkt der markierten Säulen-Figur. */
  private updateBeams(pointers: Pointer[]): void {
    const used = new Set<string>();
    for (const ptr of pointers) {
      const st = this.states.get(ptr.id);
      const t = st?.columnTarget;
      if (!ptr.point || !t || st?.held || !this.isMovable(t)) continue;
      used.add(ptr.id);
      let m = this.beamMeshes.get(ptr.id);
      if (!m) {
        const g = new THREE.CylinderGeometry(0.003, 0.006, 1, 6, 1, true).translate(0, 0.5, 0);
        m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
        m.renderOrder = 9;
        this.beamMeshes.set(ptr.id, m);
        this.beams.add(m);
      }
      const g = t.gripWorld(new THREE.Vector3());
      const len = Math.max(0.01, ptr.point.y - g.y);
      m.position.set(g.x, g.y, g.z);
      m.scale.set(1, len, 1);
      (m.material as THREE.MeshBasicMaterial).color.copy(PLAYER_GLOW[t.color]);
      m.visible = true;
    }
    for (const [id, m] of this.beamMeshes) if (!used.has(id)) m.visible = false;
  }

  /** Hat dieser Zeiger gerade eine greifbare Figur (Nah- oder Säulen-Greifen)? */
  hasTarget(id: string): boolean {
    const st = this.states.get(id);
    return !!st && (!!st.grabTarget || !!st.columnTarget || !!st.held);
  }

  private markIdle(p: PieceView): PieceView['state'] {
    if (this.scene.isAnalysis || this.game.result()) return 'idle';
    const own = p.color === this.game.turn && this.hooks.canControl(p.color);
    if (own && this.scene.markNoLegalMoves && !this.game.hasLegalMove(p.square)) return 'nomoves';
    return 'idle';
  }

  private setHoverSquare(st: PointerState, sq: Square | null): void {
    if (st.hoverSquare === sq) return;
    st.hoverSquare = sq;
    this.scene.highlights.setHover(sq);
  }

  private grab(st: PointerState, p: PieceView, ptr: Pointer): void {
    st.held = p;
    st.pressPiece = p;
    p.state = 'held';
    p.flash = 1; // kurzes Aufleuchten des Griffpunkts
    // aus der Säule fliegt die Figur etwas länger (150 ms) nach oben in die Hand
    st.snapDur = st.columnTarget === p ? columnConfig.snapSeconds : grabConfig.snapSeconds;
    if (ptr.point) {
      // Greifen klappt im ganzen „greifbar“-Bereich – die Figur schnappt dann in die Hand
      st.snapStart = p.gripWorld(new THREE.Vector3()).sub(ptr.point);
      st.snapT0 = performance.now() / 1000;
    } else st.snapStart = null;
    this.showTargets(p);
    ptr.haptic?.(0.6, 50);
    this.hooks.onPickup?.();
  }

  private deselect(st: PointerState): void {
    if (st.selected) {
      const p = st.selected;
      st.selected = null;
      p.state = 'idle';
      void this.scene.returnPiece(p);
    }
    this.showTargets(null);
    this.setHoverSquare(st, null);
  }

  private release(st: PointerState, ptr: Pointer): void {
    const p = st.held!;
    this.hooks.onHeldOverSquare?.(null);
    st.held = null;
    // Klick ohne Ziehen → Auswahlmodus (Klick-Klick-Bedienung)
    if (!st.dragged && ptr.ray) {
      st.selected = p;
      p.state = 'held';
      p.root.position.set(p.root.position.x, this.scene.kingHeight * 0.08, p.root.position.z);
      const back = this.scene.squareWorld(p.square);
      const local = this.scene.root.worldToLocal(back);
      p.root.position.x = local.x;
      p.root.position.z = local.z;
      return;
    }
    const sq = squareAt(p.root.position.x, p.root.position.z, this.scene.squareSize);
    this.setHoverSquare(st, null);
    if (sq && sq !== p.square && this.targets.some((t) => t.to === sq)) {
      void this.submit(p, sq, true);
    } else {
      if (sq !== p.square) this.hooks.onIllegal();
      p.state = 'idle';
      this.showTargets(null);
      void this.scene.returnPiece(p);
    }
    ptr.haptic?.(0.4, 40);
  }

  private async submit(p: PieceView, to: Square, dropped: boolean): Promise<void> {
    const from = p.square;
    this.showTargets(null);
    if (dropped) {
      // Figur in die Feldmitte einrasten lassen
      this.scene.markDropped(to);
    }
    const ok = await this.scene.requestMove(from, to, this.hooks.viewerYaw(), (f, t, promo) =>
      this.hooks.submitMove(f, t, promo),
    );
    p.state = 'idle';
    if (!ok) {
      this.hooks.onIllegal();
      void this.scene.returnPiece(p);
    }
  }

  /** Umriss um die ganze Figur (Inverted Hull), Farbe des Spielers. */
  private updateOutline(p: PieceView | null): void {
    if (!p) {
      this.outline.visible = false;
      return;
    }
    if (this.outline.parent !== p.root) p.root.add(this.outline);
    this.outline.geometry = p.mesh.geometry;
    this.outline.rotation.copy(p.mesh.rotation);
    const s = p.mesh.scale.x;
    this.outline.scale.set(s * 1.06, s * 1.025, s * 1.06);
    this.outline.position.y = -s * 0.012;
    (this.outline.material as THREE.MeshBasicMaterial).color.copy(PLAYER_GLOW[p.color]);
    this.outline.visible = true;
  }

  /** Bricht laufende Interaktionen ab (z. B. Gegner hat gezogen, Spiel zurückgesetzt). */
  cancelAll(): void {
    for (const st of this.states.values()) {
      if (st.held) {
        st.held.state = 'idle';
        void this.scene.returnPiece(st.held);
      }
      st.held = null;
      if (st.selected) {
        st.selected.state = 'idle';
        st.selected = null;
      }
      st.hoverSquare = null;
      st.columnTarget = null;
    }
    this.showTargets(null);
    this.scene.highlights.setHover(null);
    this.outline.visible = false;
  }
}
