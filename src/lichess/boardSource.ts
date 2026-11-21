import type { ChessClock } from '../core/clock';
import type { ChessGame } from '../core/game';
import type { Color, GameResult } from '../core/types';
import { boardDraw, boardMove, boardResign, stream } from './api';

/**
 * Verbindet eine Lichess-Board-API-Partie mit dem lokalen ChessGame.
 * Lichess ist autoritativ: Eigene Züge werden lokal sofort (optimistisch) gezeigt und
 * an Lichess geschickt. Weicht der Stream ab (Fehler, Reconnect), wird die Stellung
 * aus der Zugliste des Streams neu aufgebaut. Die Lichess-Uhr ist maßgeblich – die
 * lokale Uhr wird nur synchronisiert und löst nie selbst eine Zeitüberschreitung aus.
 */

interface PlayerInfo {
  id?: string;
  name?: string;
  aiLevel?: number;
  rating?: number;
}

interface GameState {
  type: 'gameState';
  moves: string;
  wtime: number;
  btime: number;
  status: string;
  winner?: 'white' | 'black';
  wdraw?: boolean;
  bdraw?: boolean;
}

type StreamEvent =
  | { type: 'gameFull'; id: string; white: PlayerInfo; black: PlayerInfo; initialFen: string; state: GameState }
  | GameState
  | { type: 'chatLine'; username: string; text: string; room: string }
  | { type: 'opponentGone'; gone: boolean; claimWinInSeconds?: number };

export interface LichessHooks {
  onInfo(info: { myColor: Color | null; names: Record<Color, string> }): void;
  onDrawOffer(): void;
  onMessage(text: string): void;
  onError(err: Error): void;
}

export class LichessBoard {
  myColor: Color | null = null;
  private cancel: (() => void) | null = null;
  private ended = false;
  private retries = 0;
  private lastDrawOffer = false;

  constructor(
    readonly gameId: string,
    private myId: string,
    private game: ChessGame,
    private clock: ChessClock,
    private hooks: LichessHooks,
  ) {}

  start(): void {
    this.cancel = stream<StreamEvent>(
      `/api/board/game/stream/${this.gameId}`,
      (e) => this.onEvent(e),
      (err) => {
        if (this.ended) return;
        // Stream abgerissen → mit Backoff neu verbinden; gameFull liefert den ganzen Zustand
        if (err) this.hooks.onError(err);
        if (this.retries++ < 8) setTimeout(() => this.start(), Math.min(15_000, 1000 * 2 ** this.retries));
      },
    );
  }

  stop(): void {
    this.ended = true;
    this.cancel?.();
  }

  private onEvent(e: StreamEvent): void {
    this.retries = 0;
    if (e.type === 'gameFull') {
      if (e.white.id === this.myId) this.myColor = 'w';
      else if (e.black.id === this.myId) this.myColor = 'b';
      const name = (p: PlayerInfo) => (p.aiLevel ? `Lichess-KI (${p.aiLevel})` : `${p.name ?? '?'}${p.rating ? ` (${p.rating})` : ''}`);
      this.hooks.onInfo({ myColor: this.myColor, names: { w: name(e.white), b: name(e.black) } });
      this.game.setHeaders({ White: name(e.white), Black: name(e.black), Site: `https://lichess.org/${this.gameId}` });
      this.applyState(e.state, true);
    } else if (e.type === 'gameState') {
      this.applyState(e, false);
    } else if (e.type === 'chatLine') {
      this.hooks.onMessage(`${e.username}: ${e.text}`);
    } else if (e.type === 'opponentGone' && e.gone) {
      this.hooks.onMessage('Gegner hat die Partie verlassen');
    }
  }

  private applyState(s: GameState, full: boolean): void {
    const moves = s.moves ? s.moves.split(' ') : [];
    const local = this.game.historyUci();
    const isPrefix = local.length <= moves.length && local.every((m, i) => m === moves[i]);
    if (isPrefix && !full) {
      for (const m of moves.slice(local.length)) this.game.tryMoveNotation(m);
    } else if (!isPrefix || moves.length !== local.length) {
      this.game.loadMoves(moves);
    }
    // Uhr: Lichess startet sie erst nach dem jeweils ersten Zug beider Seiten
    const running: Color | null = s.status === 'started' && moves.length >= 2 ? (moves.length % 2 === 0 ? 'w' : 'b') : null;
    this.clock.sync({ w: s.wtime, b: s.btime, running });

    const offer = this.myColor === 'w' ? !!s.bdraw : this.myColor === 'b' ? !!s.wdraw : false;
    if (offer && !this.lastDrawOffer) this.hooks.onDrawOffer();
    this.lastDrawOffer = offer;

    if (s.status !== 'started' && s.status !== 'created') {
      this.ended = true;
      this.game.setExternalResult(mapResult(s));
    }
  }

  /** Eigener Zug (UCI). Lokal ist er schon ausgeführt; bei Fehler wird neu synchronisiert. */
  async sendMove(uci: string): Promise<void> {
    try {
      await boardMove(this.gameId, uci);
    } catch (e) {
      this.hooks.onError(e as Error);
      // Stellung aus dem Stream wiederherstellen: Stream neu öffnen (gameFull)
      this.cancel?.();
      this.ended = false;
      this.start();
    }
  }

  resign(): Promise<unknown> {
    return boardResign(this.gameId);
  }

  offerDraw(accept = true): Promise<unknown> {
    return boardDraw(this.gameId, accept);
  }
}

export function mapResult(s: Pick<GameState, 'status' | 'winner'>): GameResult {
  const winner: Color | null = s.winner === 'white' ? 'w' : s.winner === 'black' ? 'b' : null;
  switch (s.status) {
    case 'mate':
      return { reason: 'checkmate', winner };
    case 'resign':
      return { reason: 'resign', winner };
    case 'stalemate':
      return { reason: 'stalemate', winner: null };
    case 'outoftime':
    case 'timeout':
      return { reason: 'timeout', winner };
    case 'draw':
      return { reason: 'agreement', winner: null };
    case 'aborted':
    case 'noStart':
      return { reason: 'aborted', winner: null };
    default:
      return { reason: winner ? 'resign' : 'agreement', winner };
  }
}
