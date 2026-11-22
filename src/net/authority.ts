import type { ChessGame } from '../core/game';
import type { ChessClock } from '../core/clock';
import type { Color, Square, PieceSymbol } from '../core/types';
import type { ClockWire, PeerMsg } from './protocol';

/**
 * Host-Autorität (Online/Co-Location): Nur der Host prüft Züge mit chess.js und verteilt Zug, Stellung und Uhr.
 * Der Gast schickt Zugwünsche; ungültige werden abgelehnt (der Gast setzt die Figur zurück).
 */

/** Prüft einen Zugwunsch des Gastes. Gibt einen Ablehnungsgrund oder null zurück. */
export function checkMoveRequest(game: ChessGame, guestColor: Color, uci: string, paused = false): string | null {
  if (paused) return 'paused';
  if (game.result()) return 'game-over';
  if (game.turn !== guestColor) return 'not-your-turn';
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return 'bad-format';
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  if (!game.isLegal(from, to)) return 'illegal';
  const p = game.pieceAt(from);
  if (!p || p.color !== guestColor) return 'not-your-piece';
  if (game.isPromotion(from, to) && !uci[4]) return 'promotion-missing';
  return null;
}

/** Uhrstand für die Leitung (Host-Zeit `hostNow`). */
export function clockWire(clock: ChessClock, hostNow: number, graceUntil?: number): ClockWire | null {
  if (!clock.enabled) return null;
  const s = clock.read();
  return { w: s.w, b: s.b, running: s.running, h: hostNow, graceUntil };
}

/**
 * Wendet beim Gast eine Host-Nachricht 'move' bzw. 'state' an.
 *  - passt der Zug auf die aktuelle Stellung (seq = eigene Zuganzahl) → normal ziehen (Animation)
 *  - sonst (verpasste Züge, Reconnect) → stilles Neuladen aus der UCI-Liste
 */
export function applyHostMessage(game: ChessGame, msg: Extract<PeerMsg, { t: 'move' } | { t: 'state' }>): 'moved' | 'resynced' | 'ignored' {
  if (msg.t === 'move') {
    if (msg.seq === game.plyCount) {
      const m = game.tryMove(msg.uci.slice(0, 2) as Square, msg.uci.slice(2, 4) as Square, (msg.uci[4] as PieceSymbol | undefined) ?? 'q');
      return m ? 'moved' : 'ignored';
    }
    return msg.seq < game.plyCount ? 'ignored' : 'resynced';
  }
  const mine = game.historyUci();
  const same = mine.length === msg.uci.length && mine.every((u, i) => u === msg.uci[i]);
  if (!same) {
    // genau ein Zug fehlt → normal animiert nachziehen, sonst still neu laden
    if (msg.uci.length === mine.length + 1 && mine.every((u, i) => u === msg.uci[i])) {
      const u = msg.uci[msg.uci.length - 1];
      game.tryMove(u.slice(0, 2) as Square, u.slice(2, 4) as Square, (u[4] as PieceSymbol | undefined) ?? 'q');
      return 'moved';
    }
    game.loadMoves(msg.uci);
  }
  if (msg.result && !game.result()) game.setExternalResult(msg.result);
  return same ? 'ignored' : 'resynced';
}
