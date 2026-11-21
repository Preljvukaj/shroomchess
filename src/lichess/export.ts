/**
 * PGN-Export zu Lichess (Minimum laut LICHESS_FEASIBILITY.md).
 * `POST https://lichess.org/api/import` funktioniert anonym (100 Partien/h) oder
 * mit OAuth-Token (200/h). CORS ist für alle Origins freigegeben.
 */
export async function importPgnToLichess(pgn: string, token?: string): Promise<string> {
  const body = new URLSearchParams({ pgn });
  const res = await fetch('https://lichess.org/api/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
  });
  if (res.status === 429) throw new Error('Rate limit (429) – bitte eine Minute warten');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { id: string; url: string };
  return json.url;
}

/** Lokaler Download als .pgn-Datei. */
export function downloadPgn(pgn: string, filename = 'myzel-schach.pgn'): void {
  const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
