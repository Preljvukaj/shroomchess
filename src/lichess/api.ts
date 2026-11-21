import { LICHESS, forgetToken, getToken } from './auth';

/**
 * Lichess-API-Client. Alle normalen Anfragen laufen über eine Warteschlange
 * („Only make one request at a time“). Streams (NDJSON) laufen daneben, weil sie
 * dauerhaft offen bleiben. Bei HTTP 429 wird 60 s gewartet.
 */

export class LichessError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let queue: Promise<unknown> = Promise.resolve();
let blockedUntil = 0;

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = blockedUntil - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return fn();
  });
  queue = run.catch(() => undefined);
  return run;
}

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function check(res: Response): Promise<Response> {
  if (res.status === 429) {
    blockedUntil = Date.now() + 60_000;
    throw new LichessError(429, 'Lichess-Rate-Limit erreicht – bitte eine Minute warten');
  }
  if (res.status === 401) {
    forgetToken();
    throw new LichessError(401, 'Lichess-Anmeldung abgelaufen – bitte erneut anmelden');
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string | Record<string, string[]> };
      if (typeof j.error === 'string') msg = j.error;
      else if (j.error) msg = Object.values(j.error).flat().join(', ');
    } catch {
      /* kein JSON */
    }
    throw new LichessError(res.status, msg);
  }
  return res;
}

export function get<T>(path: string): Promise<T> {
  return enqueue(async () => (await check(await fetch(`${LICHESS}${path}`, { headers: { Accept: 'application/json', ...authHeaders() } }))).json() as Promise<T>);
}

export function post<T>(path: string, form?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(form ?? {})) if (v !== undefined) body.set(k, String(v));
  return enqueue(async () => {
    const res = await check(
      await fetch(`${LICHESS}${path}`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', ...authHeaders() },
        body,
      }),
    );
    const txt = await res.text();
    return (txt ? JSON.parse(txt) : {}) as T;
  });
}

/**
 * NDJSON-Stream lesen (fetch + ReadableStream). Leere Zeilen sind Keep-Alives.
 * Gibt eine Funktion zum Abbrechen zurück. `onEnd` wird bei Ende oder Fehler aufgerufen.
 */
export function stream<T>(path: string, onEvent: (e: T) => void, onEnd: (err?: Error) => void): () => void {
  const ctrl = new AbortController();
  (async () => {
    const res = await check(await fetch(`${LICHESS}${path}`, { headers: { Accept: 'application/x-ndjson', ...authHeaders() }, signal: ctrl.signal }));
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) onEvent(JSON.parse(line) as T);
      }
    }
    onEnd();
  })().catch((e: Error) => {
    if (e.name !== 'AbortError') onEnd(e);
  });
  return () => ctrl.abort();
}

// ---------- Typen (Ausschnitt der Lichess-Antworten) ----------

export interface Account {
  id: string;
  username: string;
  title?: string;
  perfs?: Record<string, { rating: number }>;
}

export interface PlayingGame {
  gameId: string;
  color: 'white' | 'black';
  isMyTurn: boolean;
  speed: string;
  opponent: { id?: string; username: string; rating?: number; ai?: number };
}

export interface Challenge {
  id: string;
  url: string;
  status: string;
  challenger: { id: string; name: string; rating?: number };
  destUser: { id: string; name: string } | null;
  rated: boolean;
  speed: string;
  timeControl: { type: string; limit?: number; increment?: number; show?: string };
  color: string;
  variant: { key: string };
}

export const account = () => get<Account>('/api/account');
export const playing = () => get<{ nowPlaying: PlayingGame[] }>('/api/account/playing').then((r) => r.nowPlaying);
export const challenges = () => get<{ in: Challenge[]; out: Challenge[] }>('/api/challenge');
export const acceptChallenge = (id: string) => post(`/api/challenge/${id}/accept`);
export const cancelChallenge = (id: string) => post(`/api/challenge/${id}/cancel`);

export interface ClockOpts {
  limit?: number; // Sekunden
  increment?: number;
}

export function challengeUser(username: string, clock: ClockOpts, color: 'white' | 'black' | 'random', rated: boolean) {
  return post<{ id: string; url: string }>(`/api/challenge/${encodeURIComponent(username)}`, {
    rated,
    color,
    variant: 'standard',
    'clock.limit': clock.limit,
    'clock.increment': clock.limit !== undefined ? clock.increment ?? 0 : undefined,
  });
}

export function challengeAI(level: number, clock: ClockOpts, color: 'white' | 'black' | 'random') {
  return post<{ id: string }>('/api/challenge/ai', {
    level,
    color,
    variant: 'standard',
    'clock.limit': clock.limit,
    'clock.increment': clock.limit !== undefined ? clock.increment ?? 0 : undefined,
    days: clock.limit === undefined ? 3 : undefined,
  });
}

export const boardMove = (gameId: string, uci: string) => post(`/api/board/game/${gameId}/move/${uci}`);
export const boardResign = (gameId: string) => post(`/api/board/game/${gameId}/resign`);
export const boardAbort = (gameId: string) => post(`/api/board/game/${gameId}/abort`);
export const boardDraw = (gameId: string, accept: boolean) => post(`/api/board/game/${gameId}/draw/${accept ? 'yes' : 'no'}`);

/**
 * Board-API-Regel: Seek nur Rapid/Classical, direkte Herausforderungen und KI zusätzlich Blitz,
 * Bullet nie. Lichess schätzt die Dauer als limit + 40·increment (Sekunden).
 */
export function speedOf(limit: number, increment: number): 'ultraBullet' | 'bullet' | 'blitz' | 'rapid' | 'classical' {
  const est = limit + 40 * increment;
  if (est < 30) return 'ultraBullet';
  if (est < 180) return 'bullet';
  if (est < 480) return 'blitz';
  if (est < 1500) return 'rapid';
  return 'classical';
}

export function allowedForChallenge(limit: number, increment: number): boolean {
  if (limit === 0 && increment === 0) return true; // unbegrenzt / Fernschach
  const s = speedOf(limit, increment);
  return s !== 'bullet' && s !== 'ultraBullet';
}
