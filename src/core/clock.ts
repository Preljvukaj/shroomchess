import { Emitter } from './emitter';
import type { Color } from './types';

export interface TimeControl {
  /** Grundzeit in Sekunden; 0 = ohne Uhr. */
  initial: number;
  /** Inkrement (Fischer) in Sekunden. */
  increment: number;
}

export const TIME_CONTROLS: { id: string; tc: TimeControl }[] = [
  { id: 'none', tc: { initial: 0, increment: 0 } },
  { id: '3+2', tc: { initial: 180, increment: 2 } },
  { id: '5+3', tc: { initial: 300, increment: 3 } },
  { id: '10+5', tc: { initial: 600, increment: 5 } },
  { id: '15+10', tc: { initial: 900, increment: 10 } },
  { id: '30+0', tc: { initial: 1800, increment: 0 } },
  { id: '30+20', tc: { initial: 1800, increment: 20 } },
];

export interface ClockState {
  w: number;
  b: number;
  running: Color | null;
}

interface ClockEvents {
  flag: Color;
}

/**
 * Schachuhr mit Fischer-Inkrement. Zeit in Millisekunden.
 * Die Zeitquelle ist injizierbar (Tests, Netzwerk-Synchronisation).
 */
export class ChessClock extends Emitter<ClockEvents> {
  private remaining: Record<Color, number>;
  private running: Color | null = null;
  private startedAt = 0;
  private flagged = false;

  constructor(
    public readonly tc: TimeControl,
    private now: () => number = () => performance.now(),
  ) {
    super();
    this.remaining = { w: tc.initial * 1000, b: tc.initial * 1000 };
  }

  get enabled(): boolean {
    return this.tc.initial > 0;
  }

  /** Startet die Uhr für `color` (z. B. nach dem ersten Zug von Weiß für Schwarz). */
  start(color: Color): void {
    if (!this.enabled || this.flagged) return;
    this.running = color;
    this.startedAt = this.now();
  }

  /** `color` hat gezogen: Zeit abziehen, Inkrement gutschreiben, Gegneruhr starten. */
  press(color: Color): void {
    if (!this.enabled || this.flagged) return;
    if (this.running === color) {
      this.remaining[color] -= this.now() - this.startedAt;
      this.remaining[color] += this.tc.increment * 1000;
    }
    this.start(color === 'w' ? 'b' : 'w');
  }

  stop(): void {
    if (this.running) this.remaining[this.running] -= this.now() - this.startedAt;
    this.running = null;
  }

  /** Aktueller Stand; löst bei Zeitüberschreitung einmalig `flag` aus. */
  read(): ClockState {
    const s: ClockState = { w: this.remaining.w, b: this.remaining.b, running: this.running };
    if (this.running) s[this.running] -= this.now() - this.startedAt;
    if (this.running && s[this.running] <= 0 && !this.flagged) {
      const loser = this.running;
      s[loser] = 0;
      this.remaining[loser] = 0;
      this.running = null;
      this.flagged = true;
      this.emit('flag', loser);
    }
    s.w = Math.max(0, s.w);
    s.b = Math.max(0, s.b);
    return s;
  }

  /** Übernimmt einen fremden Stand (Netzwerk-Host, Lichess). */
  sync(state: ClockState): void {
    this.remaining = { w: state.w, b: state.b };
    this.running = state.running;
    this.startedAt = this.now();
  }
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (ms < 10_000 && ms > 0) return `${(ms / 1000).toFixed(1)}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
