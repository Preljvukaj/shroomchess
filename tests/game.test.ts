import { describe, expect, it } from 'vitest';
import { ChessGame } from '../src/core/game';
import { ChessClock } from '../src/core/clock';
import type { Square } from '../src/core/types';

function play(g: ChessGame, moves: string[]): void {
  for (const m of moves) expect(g.tryMoveNotation(m), m).not.toBeNull();
}

describe('ChessGame', () => {
  it('erkennt Matt (Narrenmatt) und meldet den Sieger', () => {
    const g = new ChessGame();
    let ended: unknown = null;
    g.on('end', (r) => (ended = r));
    play(g, ['f3', 'e5', 'g4', 'Qh4#']);
    expect(g.result()).toEqual({ reason: 'checkmate', winner: 'b' });
    expect(ended).toEqual({ reason: 'checkmate', winner: 'b' });
    expect(g.tryMoveNotation('a3')).toBeNull();
  });

  it('lehnt illegale Züge ab', () => {
    const g = new ChessGame();
    expect(g.tryMove('e2', 'e5')).toBeNull();
    expect(g.tryMove('e7', 'e5')).toBeNull(); // Schwarz ist nicht am Zug
    expect(g.isLegal('g1', 'f3')).toBe(true);
  });

  it('klassifiziert Rochade und liefert die Turmbewegung', () => {
    const g = new ChessGame();
    play(g, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']);
    const opts = g.legalMovesFrom('e1');
    expect(opts.find((o) => o.to === 'g1')?.kind).toBe('castle');
    const m = g.tryMove('e1', 'g1')!;
    expect(m.san).toBe('O-O');
    expect(m.rookMove).toEqual({ from: 'h1', to: 'f1' });
  });

  it('en passant: Zielfeld ≠ Feld der geschlagenen Figur', () => {
    const g = new ChessGame();
    play(g, ['e4', 'a6', 'e5', 'd5']);
    expect(g.legalMovesFrom('e5').find((o) => o.to === 'd6')?.kind).toBe('enpassant');
    const m = g.tryMove('e5', 'd6')!;
    expect(m.captured).toBe('p');
    expect(m.capturedSquare).toBe('d5');
  });

  it('Bauernumwandlung', () => {
    const g = new ChessGame();
    g.reset('8/P7/8/8/8/8/8/k6K w - - 0 1');
    expect(g.isPromotion('a7', 'a8')).toBe(true);
    expect(g.legalMovesFrom('a7')).toHaveLength(1); // vier Varianten → ein Zielfeld
    const m = g.tryMove('a7', 'a8', 'n')!;
    expect(m.promotion).toBe('n');
    expect(g.pieceAt('a8' as Square)).toEqual({ type: 'n', color: 'w' });
  });

  it('Patt', () => {
    const g = new ChessGame();
    g.reset('k7/8/2Q5/8/8/8/8/7K w - - 0 1');
    play(g, ['Qb6']);
    expect(g.result()).toEqual({ reason: 'stalemate', winner: null });
  });

  it('dreifache Stellungswiederholung', () => {
    const g = new ChessGame();
    play(g, ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']);
    expect(g.result()?.reason).toBe('threefold');
  });

  it('50-Züge-Regel', () => {
    const g = new ChessGame();
    g.reset('k7/8/8/8/8/8/8/KR6 w - - 99 80');
    play(g, ['Rb2']);
    expect(g.result()?.reason).toBe('fifty-moves');
  });

  it('Aufgabe, Remis, Zeit (mit ungenügendem Material → Remis)', () => {
    const g = new ChessGame();
    g.resign('w');
    expect(g.result()).toEqual({ reason: 'resign', winner: 'b' });
    expect(g.pgn()).toContain('0-1');

    const d = new ChessGame();
    d.agreeDraw();
    expect(d.pgn()).toContain('1/2-1/2');

    const t = new ChessGame();
    t.reset('kr6/8/8/8/8/8/8/KN6 b - - 0 1');
    t.timeout('b'); // Weiß hat nur König+Springer
    expect(t.result()).toEqual({ reason: 'timeout', winner: null });
  });

  it('Rücknahme und FEN-Zeitleiste', () => {
    const g = new ChessGame();
    play(g, ['e4', 'e5']);
    expect(g.fenTimeline()).toHaveLength(3);
    expect(g.undo()).toBe(true);
    expect(g.history()).toEqual(['e4']);
  });

  it('PGN-Rundreise', () => {
    const g = new ChessGame();
    g.setHeaders({ White: 'Ada', Black: 'Bob' });
    play(g, ['d4', 'd5', 'c4']);
    const pgn = g.pgn();
    const h = new ChessGame();
    h.loadPgn(pgn);
    expect(h.history()).toEqual(['d4', 'd5', 'c4']);
    expect(pgn).toContain('[White "Ada"]');
  });
});

describe('ChessClock', () => {
  it('zieht Zeit ab, schreibt Inkrement gut und meldet Zeitüberschreitung', () => {
    let now = 0;
    const c = new ChessClock({ initial: 10, increment: 2 }, () => now);
    const flags: string[] = [];
    c.on('flag', (col) => flags.push(col));
    c.start('w');
    now = 3000;
    c.press('w'); // Weiß: 10 − 3 + 2 = 9 s
    expect(c.read().w).toBe(9000);
    expect(c.read().running).toBe('b');
    now = 3000 + 11_000;
    expect(c.read().b).toBe(0);
    expect(flags).toEqual(['b']);
    c.read();
    expect(flags).toEqual(['b']); // nur einmal
  });
});
