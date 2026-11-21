/**
 * Routing der Einstiegsseite (reine Funktionen, ohne DOM → testbar).
 *
 *   ?room=ABCD            → direkt in den Beitrittsdialog (Co-Location / Online)
 *   ?code=…&state=…       → Rückkehr aus dem Lichess-OAuth-Dialog
 *   ?error=…              → Lichess-Login abgebrochen
 *   ?autostart=engine|hotseat → Debug: Startseite überspringen
 *   sonst                 → Landingpage
 */
export type Route =
  | { view: 'landing' }
  | { view: 'join'; room: string }
  | { view: 'oauth-callback'; code: string; state: string }
  | { view: 'oauth-error'; error: string }
  | { view: 'autostart'; mode: 'engine' | 'hotseat' };

/** Raumcodes: 4–8 Zeichen, nur gut unterscheidbare Großbuchstaben/Ziffern. */
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_RE = new RegExp(`^[${ROOM_ALPHABET}]{4,8}$`);

export function normalizeRoomCode(raw: string): string | null {
  const c = raw.trim().toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/I/g, '1');
  // 0/1 sind nicht im Alphabet (Verwechslungsgefahr) → nach dem Ersetzen ungültig
  return ROOM_RE.test(c) ? c : null;
}

export function parseRoute(search: string): Route {
  const p = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const code = p.get('code');
  const state = p.get('state');
  if (code && state) return { view: 'oauth-callback', code, state };
  const error = p.get('error');
  if (error) return { view: 'oauth-error', error };
  const room = p.get('room');
  if (room !== null) {
    const r = normalizeRoomCode(room);
    if (r) return { view: 'join', room: r };
  }
  const auto = p.get('autostart');
  if (auto === 'engine' || auto === 'hotseat') return { view: 'autostart', mode: auto };
  return { view: 'landing' };
}

export function generateRoomCode(rand: () => number = Math.random, len = 5): string {
  let s = '';
  for (let i = 0; i < len; i++) s += ROOM_ALPHABET[Math.floor(rand() * ROOM_ALPHABET.length)];
  return s;
}

/** Beitrittslink für einen Raumcode, relativ zur aktuellen Seite. */
export function roomLink(origin: string, pathname: string, room: string): string {
  return `${origin}${pathname}?room=${encodeURIComponent(room)}`;
}
