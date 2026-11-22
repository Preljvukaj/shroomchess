/**
 * Routing der Einstiegsseite (reine Funktionen, ohne DOM → testbar).
 *
 *   ?room=ABCD            → direkt in den Beitrittsdialog (Co-Location / Online)
 *   ?code=…&state=…       → Rückkehr aus dem Lichess-OAuth-Dialog
 *   ?error=…              → Lichess-Login abgebrochen
 *   ?autostart=engine|hotseat → Debug: Startseite überspringen
 *   ?autostart=online|coloc&netroom=ABCD&role=host|guest&color=w&tc=5+3&name=…
 *                         → Debug/Simulation: Netzwerkspiel ohne Startseite (zwei Fenster)
 *   sonst                 → Landingpage
 */
export type Route =
  | { view: 'landing' }
  | { view: 'join'; room: string }
  | { view: 'oauth-callback'; code: string; state: string }
  | { view: 'oauth-error'; error: string }
  | { view: 'autostart'; mode: 'engine' | 'hotseat' }
  | { view: 'autostart-net'; kind: 'online' | 'coloc'; room: string; role: 'host' | 'guest'; color: 'w' | 'b' | 'random'; tc: string; name: string; vr: boolean };

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
  if (auto === 'online' || auto === 'coloc') {
    const r = normalizeRoomCode(p.get('netroom') ?? '');
    const col = p.get('color');
    if (r)
      return {
        view: 'autostart-net',
        kind: auto,
        room: r,
        role: p.get('role') === 'guest' ? 'guest' : 'host',
        color: col === 'b' || col === 'random' ? col : 'w',
        tc: p.get('tc') ?? 'none',
        name: (p.get('name') ?? '').slice(0, 24),
        vr: p.get('vr') === '1',
      };
  }
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
