/**
 * Lichess-Login per OAuth2 Authorization Code + PKCE (S256), komplett im Browser.
 * Lichess akzeptiert nicht registrierte, öffentliche Clients (beliebige eindeutige client_id).
 * Siehe docs/LICHESS_FEASIBILITY.md.
 */
export const LICHESS = 'https://lichess.org';
export const CLIENT_ID = 'myzel-schach';
export const SCOPES = ['board:play', 'challenge:read', 'challenge:write'];

const TOKEN_KEY = 'myzel-schach.lichess.token';
const PKCE_KEY = 'myzel-schach.lichess.pkce';

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(n = 48): string {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return b64url(a);
}

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

export function redirectUri(): string {
  return `${location.origin}${location.pathname}`;
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(t: string | null): void {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* Speicher nicht verfügbar – dann nur für diese Sitzung angemeldet */
  }
}

/** Leitet zum Lichess-Autorisierungsdialog weiter. */
export async function login(): Promise<void> {
  const verifier = randomString(64);
  const state = randomString(16);
  const challenge = b64url(await sha256(verifier));
  try {
    sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  } catch {
    throw new Error('sessionStorage nicht verfügbar – Login nicht möglich');
  }
  const url = new URL(`${LICHESS}/oauth`);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SCOPES.join(' '),
    state,
  }).toString();
  location.assign(url.toString());
}

/** Rückkehr aus dem OAuth-Dialog: Code gegen Token tauschen. */
export async function handleCallback(code: string, state: string): Promise<string> {
  let stored: { verifier: string; state: string } | null = null;
  try {
    stored = JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? 'null');
    sessionStorage.removeItem(PKCE_KEY);
  } catch {
    stored = null;
  }
  if (!stored || stored.state !== state) throw new Error('Ungültiger OAuth-Status (state) – bitte erneut anmelden');
  const res = await fetch(`${LICHESS}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: stored.verifier,
      redirect_uri: redirectUri(),
      client_id: CLIENT_ID,
    }),
  });
  if (!res.ok) throw new Error(`Token-Tausch fehlgeschlagen (HTTP ${res.status})`);
  const json = (await res.json()) as { access_token: string };
  setToken(json.access_token);
  return json.access_token;
}

/** Abmelden: Token bei Lichess widerrufen und lokal löschen. */
export async function logout(): Promise<void> {
  const t = getToken();
  setToken(null);
  if (t) {
    try {
      await fetch(`${LICHESS}/api/token`, { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } });
    } catch {
      /* Widerruf fehlgeschlagen – lokal ist der Token trotzdem weg */
    }
  }
}

/** Token verworfen (z. B. HTTP 401). */
export function forgetToken(): void {
  setToken(null);
}
