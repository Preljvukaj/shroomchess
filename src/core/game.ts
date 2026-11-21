import { Chess, type Move } from 'chess.js';
import { Emitter } from './emitter';
import {
  type AppliedMove,
  type Color,
  type GameResult,
  type MoveKind,
  type MoveOption,
  type PieceSymbol,
  type Square,
  other,
} from './types';

export interface GameEvents {
  move: AppliedMove;
  undo: { fen: string };
  reset: { fen: string };
  end: GameResult;
}

function kindOf(m: Move): MoveKind {
  if (m.isKingsideCastle() || m.isQueensideCastle()) return 'castle';
  if (m.isEnPassant()) return 'enpassant';
  if (m.isPromotion()) return m.isCapture() ? 'promotion-capture' : 'promotion';
  if (m.isCapture()) return 'capture';
  return 'normal';
}

/**
 * Autoritativer Spielzustand. Dünne Schicht über chess.js, die
 * (a) Ereignisse für Renderer/Netzwerk liefert und
 * (b) Spielenden außerhalb der Brettregeln (Aufgabe, Zeit, Einigung) verwaltet.
 */
export class ChessGame extends Emitter<GameEvents> {
  private chess = new Chess();
  private externalResult: GameResult | null = null;
  private headers: Record<string, string> = {};

  get fen(): string {
    return this.chess.fen();
  }
  get turn(): Color {
    return this.chess.turn();
  }
  get inCheck(): boolean {
    return this.chess.inCheck();
  }
  get plyCount(): number {
    return this.chess.history().length;
  }

  pieceAt(sq: Square): { type: PieceSymbol; color: Color } | undefined {
    return this.chess.get(sq) ?? undefined;
  }

  /** Alle Figuren mit Feld (für den Aufbau der 3D-Szene). */
  pieces(): { square: Square; type: PieceSymbol; color: Color }[] {
    const out: { square: Square; type: PieceSymbol; color: Color }[] = [];
    for (const row of this.chess.board()) for (const p of row) if (p) out.push(p);
    return out;
  }

  legalMovesFrom(sq: Square): MoveOption[] {
    if (this.result()) return [];
    const ms = this.chess.moves({ square: sq, verbose: true });
    const seen = new Set<string>();
    const out: MoveOption[] = [];
    for (const m of ms) {
      if (seen.has(m.to)) continue; // vier Umwandlungsvarianten → ein Zielfeld
      seen.add(m.to);
      out.push({ from: m.from, to: m.to, kind: kindOf(m) });
    }
    return out;
  }

  hasLegalMove(sq: Square): boolean {
    return !this.result() && this.chess.moves({ square: sq }).length > 0;
  }

  isPromotion(from: Square, to: Square): boolean {
    return this.chess.moves({ square: from, verbose: true }).some((m) => m.to === to && m.isPromotion());
  }

  isLegal(from: Square, to: Square): boolean {
    return this.chess.moves({ square: from, verbose: true }).some((m) => m.to === to);
  }

  /** Führt einen Zug aus. Gibt `null` zurück, wenn er illegal ist. */
  tryMove(from: Square, to: Square, promotion: PieceSymbol = 'q'): AppliedMove | null {
    if (this.result()) return null;
    let m: Move;
    try {
      m = this.chess.move({ from, to, promotion });
    } catch {
      return null;
    }
    const applied = this.toApplied(m);
    this.emit('move', applied);
    const r = this.result();
    if (r) this.emit('end', r);
    return applied;
  }

  /** Zug in SAN oder UCI (z. B. aus Stockfish/Lichess). */
  tryMoveNotation(notation: string): AppliedMove | null {
    if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(notation)) {
      return this.tryMove(
        notation.slice(0, 2) as Square,
        notation.slice(2, 4) as Square,
        (notation[4] as PieceSymbol | undefined) ?? 'q',
      );
    }
    const legal = this.chess.moves({ verbose: true }).find((m) => m.san === notation);
    return legal ? this.tryMove(legal.from, legal.to, legal.promotion ?? 'q') : null;
  }

  private toApplied(m: Move): AppliedMove {
    let capturedSquare: Square | undefined;
    if (m.captured) {
      capturedSquare = m.isEnPassant() ? ((m.to[0] + m.from[1]) as Square) : m.to;
    }
    let rookMove: AppliedMove['rookMove'];
    const rank = m.color === 'w' ? '1' : '8';
    if (m.isKingsideCastle()) rookMove = { from: `h${rank}` as Square, to: `f${rank}` as Square };
    if (m.isQueensideCastle()) rookMove = { from: `a${rank}` as Square, to: `d${rank}` as Square };
    return {
      from: m.from,
      to: m.to,
      san: m.san,
      color: m.color,
      piece: m.piece,
      captured: m.captured,
      capturedSquare,
      promotion: m.promotion,
      rookMove,
      check: m.san.includes('+') || m.san.includes('#'),
      fenAfter: m.after,
    };
  }

  undo(): boolean {
    if (this.externalResult) this.externalResult = null;
    const m = this.chess.undo();
    if (!m) return false;
    this.emit('undo', { fen: this.fen });
    return true;
  }

  reset(fen?: string): void {
    this.externalResult = null;
    if (fen) this.chess.load(fen);
    else this.chess.reset();
    this.emit('reset', { fen: this.fen });
  }

  /** Spielstand aus PGN wiederherstellen (Reconnect, Import). */
  loadPgn(pgn: string): void {
    this.externalResult = null;
    this.chess.loadPgn(pgn);
    this.emit('reset', { fen: this.fen });
  }

  /** Züge als UCI (z. B. "e2e4", "e7e8q") – Vergleich mit Lichess-Streams. */
  historyUci(): string[] {
    return this.chess.history({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? ''));
  }

  /**
   * Stellung still (ohne Zug-Ereignisse/Animationen) aus einer UCI-Zugliste aufbauen,
   * danach ein einziges 'reset'. Für Reconnect/Lichess-Resync.
   */
  loadMoves(uci: string[], startFen?: string): void {
    this.externalResult = null;
    if (startFen && startFen !== 'startpos') this.chess.load(startFen);
    else this.chess.reset();
    for (const m of uci) {
      try {
        this.chess.move({ from: m.slice(0, 2) as Square, to: m.slice(2, 4) as Square, promotion: (m[4] as PieceSymbol | undefined) ?? 'q' });
      } catch {
        break; // ungültig → bis hierhin übernehmen
      }
    }
    this.emit('reset', { fen: this.fen });
  }

  /** Ergebnis von außen setzen (Lichess-Status, Netzwerk-Host). */
  setExternalResult(r: GameResult): void {
    this.finishExternally(r);
  }

  resign(color: Color): void {
    this.finishExternally({ reason: 'resign', winner: other(color) });
  }

  agreeDraw(): void {
    this.finishExternally({ reason: 'agreement', winner: null });
  }

  /** Zeitüberschreitung. Nach FIDE ist es Remis, wenn der Gegner nicht mehr mattsetzen kann. */
  timeout(color: Color): void {
    const winner = other(color);
    this.finishExternally({ reason: 'timeout', winner: this.canStillMate(winner) ? winner : null });
  }

  /** Grobe Prüfung auf „genug Material zum Mattsetzen“ (nur König bzw. König + Leichtfigur reicht nicht). */
  private canStillMate(color: Color): boolean {
    const own = this.pieces().filter((p) => p.color === color && p.type !== 'k');
    if (own.length === 0) return false;
    if (own.length === 1 && (own[0].type === 'n' || own[0].type === 'b')) return false;
    return true;
  }

  private finishExternally(r: GameResult): void {
    if (this.result()) return;
    this.externalResult = r;
    this.emit('end', r);
  }

  result(): GameResult | null {
    if (this.externalResult) return this.externalResult;
    const c = this.chess;
    if (c.isCheckmate()) return { reason: 'checkmate', winner: other(c.turn()) };
    if (c.isStalemate()) return { reason: 'stalemate', winner: null };
    if (c.isInsufficientMaterial()) return { reason: 'insufficient', winner: null };
    if (c.isThreefoldRepetition()) return { reason: 'threefold', winner: null };
    if (c.isDrawByFiftyMoves()) return { reason: 'fifty-moves', winner: null };
    return null;
  }

  history(): string[] {
    return this.chess.history();
  }

  /** Von `color` geschlagene Figuren (also Figuren der Gegenfarbe). */
  capturedBy(): Record<Color, PieceSymbol[]> {
    const out: Record<Color, PieceSymbol[]> = { w: [], b: [] };
    for (const m of this.chess.history({ verbose: true })) if (m.captured) out[m.color].push(m.captured);
    return out;
  }

  lastMove(): { from: Square; to: Square } | null {
    const h = this.chess.history({ verbose: true });
    const m = h[h.length - 1];
    return m ? { from: m.from, to: m.to } : null;
  }

  kingSquare(color: Color): Square | null {
    return this.pieces().find((p) => p.type === 'k' && p.color === color)?.square ?? null;
  }

  /** FEN nach jedem Halbzug (Index 0 = Startstellung) – für das Analysebrett. */
  fenTimeline(): string[] {
    const verbose = this.chess.history({ verbose: true });
    if (verbose.length === 0) return [this.fen];
    return [verbose[0].before, ...verbose.map((m) => m.after)];
  }

  setHeaders(h: Record<string, string>): void {
    this.headers = { ...this.headers, ...h };
  }

  pgn(): string {
    const r = this.result();
    const resultTag = !r || r.reason === 'aborted' ? '*' : r.winner === 'w' ? '1-0' : r.winner === 'b' ? '0-1' : '1/2-1/2';
    const d = new Date();
    const date = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
    const tags: Record<string, string> = {
      Event: 'Myzel-Schach',
      Site: 'Myzel-Schach (WebXR)',
      Date: date,
      White: '?',
      Black: '?',
      ...this.headers,
      Result: resultTag,
    };
    if (r && (r.reason === 'resign' || r.reason === 'timeout' || r.reason === 'agreement')) {
      tags.Termination = r.reason === 'timeout' ? 'time forfeit' : 'normal';
    }
    for (const [k, v] of Object.entries(tags)) this.chess.setHeader(k, v);
    let pgn = this.chess.pgn();
    // chess.js hängt das Ergebnis nur bei Brettende an – bei Aufgabe/Zeit/Einigung selbst ergänzen.
    if (!pgn.trimEnd().endsWith(resultTag)) pgn = `${pgn.trimEnd()} ${resultTag}`;
    return pgn;
  }
}
