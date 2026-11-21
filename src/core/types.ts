import type { Color, PieceSymbol, Square } from 'chess.js';

export type { Color, PieceSymbol, Square };

/** Art eines legalen Zuges – bestimmt die Markierungsfarbe des Zielfelds. */
export type MoveKind = 'normal' | 'capture' | 'castle' | 'enpassant' | 'promotion' | 'promotion-capture';

export interface MoveOption {
  from: Square;
  to: Square;
  kind: MoveKind;
}

export interface AppliedMove {
  from: Square;
  to: Square;
  san: string;
  color: Color;
  piece: PieceSymbol;
  captured?: PieceSymbol;
  /** Feld der geschlagenen Figur (weicht bei en passant vom Zielfeld ab). */
  capturedSquare?: Square;
  promotion?: PieceSymbol;
  /** Turmbewegung bei Rochade. */
  rookMove?: { from: Square; to: Square };
  check: boolean;
  fenAfter: string;
}

export type EndReason =
  | 'checkmate'
  | 'stalemate'
  | 'insufficient'
  | 'threefold'
  | 'fifty-moves'
  | 'resign'
  | 'timeout'
  | 'agreement'
  | 'aborted';

export interface GameResult {
  reason: EndReason;
  /** `null` = Remis. */
  winner: Color | null;
}

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

/** Feld → (file 0..7, rank 0..7). a1 = (0,0). */
export function squareToFR(sq: Square): [number, number] {
  return [sq.charCodeAt(0) - 97, sq.charCodeAt(1) - 49];
}

export function frToSquare(file: number, rank: number): Square {
  return (String.fromCharCode(97 + file) + String.fromCharCode(49 + rank)) as Square;
}

export function other(c: Color): Color {
  return c === 'w' ? 'b' : 'w';
}
