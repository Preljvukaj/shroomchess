import * as THREE from 'three';
import { Chess } from 'chess.js';
import type { ChessGame } from '../core/game';
import type { AppliedMove, Color, PieceSymbol, Square } from '../core/types';
import { BoardView, squareCenter } from './board';
import { Coordinates } from './coordinates';
import { GripBatch } from './gripBatch';
import { PieceBatch } from './pieceBatch';
import { CaptureBowl } from './captureBowl';
import { Effects } from './effects';
import { Highlights } from './highlights';
import { PieceView } from './pieceView';
import { KING_HEIGHT_PER_SQUARE, PLAYER_GLOW } from './pieces';
import { PromotionPicker } from './promotion';

export interface BoardSceneOptions {
  squareSize: number;
  segments: number;
  high: boolean;
}

/**
 * Alles, was auf dem Brett passiert: Figuren, Markierungen, Schalen, Effekte.
 * Folgt strikt dem ChessGame (Ereignisse) – siehe ARCHITECTURE.md.
 */
export class BoardScene {
  /** Pose des Bretts in der Welt (aus Boundary/Kalibrierung bzw. Desktop: Ursprung). */
  readonly root = new THREE.Group();
  readonly board: BoardView;
  readonly highlights: Highlights;
  readonly effects: Effects;
  readonly promotion: PromotionPicker;
  readonly bowls: Record<Color, CaptureBowl>;
  readonly coords: Coordinates;
  readonly grips = new GripBatch();
  readonly pieceBatch: PieceBatch;
  readonly squareSize: number;
  readonly kingHeight: number;
  private pieces = new Map<Square, PieceView>();
  private piecesRoot = new THREE.Group();
  private animating = 0;
  /** Feld, auf dem eine per Drag abgelegte Figur bereits steht (keine Flug-Animation). */
  private droppedAt: Square | null = null;
  /** true, solange eine Analyse-Stellung statt des Live-Spiels gezeigt wird. */
  private viewingFen: string | null = null;
  colorblind = false;
  markNoLegalMoves = false;

  constructor(private game: ChessGame, private opts: BoardSceneOptions) {
    this.squareSize = opts.squareSize;
    this.kingHeight = opts.squareSize * KING_HEIGHT_PER_SQUARE;
    this.board = new BoardView(opts.squareSize);
    this.highlights = new Highlights(opts.squareSize, this.board.surfaceY);
    this.effects = new Effects(this.root);
    this.promotion = new PromotionPicker(this.kingHeight, opts.segments, opts.high);
    this.piecesRoot.position.y = this.board.surfaceY;
    this.coords = new Coordinates(opts.squareSize, this.board.surfaceY);
    this.pieceBatch = new PieceBatch(opts.segments, opts.high);
    this.root.add(this.board.root, this.highlights.mesh, this.coords.root, this.piecesRoot, this.promotion.root, this.grips.root, this.pieceBatch.root);

    // Schalen: rechts neben dem jeweiligen Spieler (Weiß steht bei +Z und schaut nach −Z → rechts = +X)
    const s = opts.squareSize;
    const off = 4 * s + s * 1.9; // außerhalb des Rahmens (Rahmenbreite 0,8 s)
    this.bowls = {
      w: new CaptureBowl(s, this.kingHeight, opts.segments, opts.high, '#2fd8ff'),
      b: new CaptureBowl(s, this.kingHeight, opts.segments, opts.high, '#ff4fd8'),
    };
    this.bowls.w.root.position.set(off, 0, 2.5 * s);
    this.bowls.b.root.position.set(-off, 0, -2.5 * s);
    this.root.add(this.bowls.w.root, this.bowls.b.root);

    game.on('move', (m) => void this.onMove(m));
    game.on('undo', () => this.syncAll());
    game.on('reset', () => this.syncAll());
    this.syncAll();
  }

  get busy(): boolean {
    return this.animating > 0 || this.promotion.active;
  }

  get isAnalysis(): boolean {
    return this.viewingFen !== null;
  }

  allPieces(): PieceView[] {
    return [...this.pieces.values()];
  }

  pieceAt(sq: Square): PieceView | undefined {
    return this.pieces.get(sq);
  }

  squareWorld(sq: Square, out = new THREE.Vector3()): THREE.Vector3 {
    squareCenter(sq, this.squareSize, out);
    out.y = this.board.surfaceY;
    return this.root.localToWorld(out);
  }

  private createPiece(type: PieceSymbol, color: Color, sq: Square): PieceView {
    const pv = new PieceView(type, color, sq, this.kingHeight, this.opts.segments, this.opts.high);
    squareCenter(sq, this.squareSize, pv.root.position);
    this.piecesRoot.add(pv.root);
    this.pieces.set(sq, pv);
    return pv;
  }

  private clearPieces(): void {
    for (const p of this.pieces.values()) p.dispose();
    this.pieces.clear();
  }

  /** Komplettes Neuaufbauen aus dem Spielzustand (Start, Rücknahme, Reconnect). */
  syncAll(): void {
    this.viewingFen = null;
    this.clearPieces();
    for (const p of this.game.pieces()) this.createPiece(p.type, p.color, p.square);
    const cap = this.game.capturedBy();
    for (const c of ['w', 'b'] as Color[]) {
      this.bowls[c].clear();
      for (const t of cap[c]) this.bowls[c].add(t, c === 'w' ? 'b' : 'w');
    }
    this.refreshBaseHighlights();
    this.highlights.setTargets([]);
  }

  /** Analysebrett: beliebige Stellung anzeigen, ohne den Spielzustand zu ändern. */
  showFen(fen: string | null): void {
    if (fen === null) {
      this.syncAll();
      return;
    }
    this.viewingFen = fen;
    this.clearPieces();
    const c = new Chess(fen);
    for (const row of c.board()) for (const p of row) if (p) this.createPiece(p.type, p.color, p.square);
    this.highlights.setBase(null, null, null);
    this.highlights.setTargets([]);
  }

  refreshBaseHighlights(): void {
    const last = this.game.lastMove();
    const checkSq = this.game.inCheck ? this.game.kingSquare(this.game.turn) : null;
    this.highlights.setBase(last?.from ?? null, last?.to ?? null, checkSq);
  }

  /** Vom Interaction-Controller: Figur wurde bereits sichtbar auf `to` abgelegt. */
  markDropped(to: Square): void {
    this.droppedAt = to;
  }

  /**
   * Zugwunsch eines lokalen Spielers. Fragt bei Umwandlung nach der Figur.
   * Gibt false zurück, wenn der Zug illegal war oder abgebrochen wurde.
   */
  async requestMove(
    from: Square,
    to: Square,
    viewerYaw: number,
    submit: (from: Square, to: Square, promo: PieceSymbol) => boolean,
  ): Promise<boolean> {
    if (!this.game.isLegal(from, to)) return false;
    let promo: PieceSymbol = 'q';
    if (this.game.isPromotion(from, to)) {
      const color = this.game.turn;
      const pos = squareCenter(to, this.squareSize);
      promo = await this.promotion.show(color, pos, viewerYaw);
    }
    return submit(from, to, promo);
  }

  private async onMove(m: AppliedMove): Promise<void> {
    if (this.viewingFen) this.syncAll();
    const mover = this.pieces.get(m.from);
    this.animating++;
    try {
      // 1. Schlagen: Figur löst sich auf, Mini erscheint in der Schale
      if (m.capturedSquare && m.captured) {
        const victim = this.pieces.get(m.capturedSquare);
        if (victim && victim !== mover) {
          this.pieces.delete(m.capturedSquare);
          const where = victim.mesh.getWorldPosition(new THREE.Vector3());
          victim.mesh.visible = true; // nicht mehr im Bündel → für den Auflöse-Effekt selbst zeichnen
          void this.effects.dissolve(victim.mesh, PLAYER_GLOW[victim.color], this.kingHeight).then(() => victim.dispose());
          this.bowls[m.color].add(m.captured, victim.color, where.setY(where.y + this.kingHeight * 0.4), this.effects);
        }
      }
      // 2. Ziehende Figur
      if (mover) {
        this.pieces.delete(m.from);
        this.pieces.set(m.to, mover);
        mover.square = m.to;
        const target = squareCenter(m.to, this.squareSize);
        if (this.droppedAt === m.to) {
          await this.effects.moveArc(mover.root, target, 0.18, 0);
        } else {
          const hop = m.piece === 'n' ? this.kingHeight * 0.5 : this.kingHeight * 0.12;
          const dist = mover.root.position.distanceTo(target) / this.squareSize;
          await this.effects.moveArc(mover.root, target, 0.35 + Math.min(dist, 7) * 0.06, hop);
        }
      }
      this.droppedAt = null;
      // 3. Rochade: Turm mitziehen
      if (m.rookMove) {
        const rook = this.pieces.get(m.rookMove.from);
        if (rook) {
          this.pieces.delete(m.rookMove.from);
          this.pieces.set(m.rookMove.to, rook);
          rook.square = m.rookMove.to;
          await this.effects.moveArc(rook.root, squareCenter(m.rookMove.to, this.squareSize), 0.45, this.kingHeight * 0.3);
        }
      }
      // 4. Umwandlung: Geometrie tauschen (Bündel wechselt automatisch), mit Aufleuchten des Griffpunkts
      if (m.promotion && mover) {
        mover.setType(m.promotion, this.opts.segments);
        mover.flash = 1;
        await this.effects.tweenAsync(0.4, () => undefined);
      }
    } finally {
      this.animating--;
      this.refreshBaseHighlights();
    }
  }

  /** Figur animiert auf ihr Feld zurückschicken (illegaler Zug). */
  returnPiece(pv: PieceView): Promise<void> {
    this.animating++;
    return this.effects
      .moveArc(pv.root, squareCenter(pv.square, this.squareSize), 0.35, this.kingHeight * 0.1)
      .finally(() => this.animating--);
  }

  update(dt: number, time: number): void {
    this.effects.update(dt);
    this.promotion.update(time);
    for (const p of this.pieces.values()) p.update(time, this.colorblind);
    this.grips.update(this.allPieces());
    this.pieceBatch.update(this.allPieces());
    this.bowls.w.update();
    this.bowls.b.update();
  }
}
