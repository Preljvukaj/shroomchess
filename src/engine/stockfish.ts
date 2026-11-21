/**
 * Stockfish 19 Lite (WASM, Single-Thread) im Web Worker über UCI.
 * Single-Thread braucht kein SharedArrayBuffer → keine COOP/COEP-Header nötig.
 * Lizenz: GPL-3.0 (siehe DECISIONS.md).
 */

export interface EngineLevel {
  skill: number; // UCI "Skill Level" 0..20
  movetime: number; // ms
  depth?: number;
}

/** Stärke 1–8 (wie die Lichess-KI-Stufen): von „Anfänger“ bis „volle Kraft“. */
export const ENGINE_LEVELS: EngineLevel[] = [
  { skill: 0, movetime: 80, depth: 1 },
  { skill: 2, movetime: 120, depth: 2 },
  { skill: 5, movetime: 200, depth: 4 },
  { skill: 8, movetime: 350, depth: 6 },
  { skill: 11, movetime: 500, depth: 9 },
  { skill: 14, movetime: 800, depth: 12 },
  { skill: 17, movetime: 1200 },
  { skill: 20, movetime: 2000 },
];

export class StockfishEngine {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private pending: ((uci: string | null) => void) | null = null;

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(`${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`);
      } catch (e) {
        reject(e);
        return;
      }
      const onLine = (line: string) => {
        if (line === 'uciok') this.worker!.postMessage('isready');
        else if (line === 'readyok') resolve();
        else if (line.startsWith('bestmove')) {
          const mv = line.split(' ')[1];
          const cb = this.pending;
          this.pending = null;
          cb?.(mv && mv !== '(none)' ? mv : null);
        }
      };
      this.worker.onmessage = (e: MessageEvent) => {
        const data = typeof e.data === 'string' ? e.data : String(e.data);
        for (const l of data.split('\n')) onLine(l.trim());
      };
      this.worker.onerror = (e) => reject(e);
      this.worker.postMessage('uci');
    });
    return this.ready;
  }

  /** Bester Zug als UCI-String (z. B. "e2e4", "e7e8q") oder null. */
  async bestMove(fen: string, level: number): Promise<string | null> {
    await this.start();
    const L = ENGINE_LEVELS[Math.max(0, Math.min(ENGINE_LEVELS.length - 1, level - 1))];
    if (this.pending) this.stop();
    return new Promise((resolve) => {
      this.pending = resolve;
      const w = this.worker!;
      w.postMessage(`setoption name Skill Level value ${L.skill}`);
      w.postMessage(`position fen ${fen}`);
      w.postMessage(L.depth ? `go depth ${L.depth} movetime ${L.movetime}` : `go movetime ${L.movetime}`);
    });
  }

  stop(): void {
    this.worker?.postMessage('stop');
  }

  newGame(): void {
    this.worker?.postMessage('ucinewgame');
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
  }
}
