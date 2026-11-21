# Lichess-Anbindung – Machbarkeitsanalyse

Stand: 21.11.2026. Quellen: offizielle OpenAPI-Spezifikation der Lichess-API (v2.0.180, Repo
[lichess-org/api](https://github.com/lichess-org/api/blob/master/doc/specs/lichess-api.yaml), gerendert unter
[lichess.org/api](https://lichess.org/api)) sowie eigene CORS-Preflight-Prüfungen gegen `lichess.org`.

## 1. Authentifizierung: OAuth2 mit PKCE direkt aus dem Browser

**Ergebnis: machbar, ohne eigenes Backend.**

- Lichess unterstützt laut API-Doku „unregistered and public clients (no client authentication, choose any unique
  client id)“. Eine App-Registrierung ist nicht nötig. Als `client_id` nehmen wir `myzel-schach`.
- Code-Challenge-Methode: nur `S256`. Autorisierung über `https://lichess.org/oauth`, Token über `POST https://lichess.org/api/token`.
- Access Tokens gelten lange (etwa 1 Jahr). Refresh Tokens gibt es nicht. Der Token wird lokal gespeichert (`localStorage`),
  beim Abmelden per `DELETE /api/token` widerrufen.
- Benötigte Scopes:

  | Scope | Wofür |
  |---|---|
  | `board:play` | Board API: Spiel-Stream, Züge, Remis, Aufgabe, Chat, Seeks, KI-Herausforderung |
  | `challenge:write` | Herausforderungen erstellen/annehmen (Konto ↔ Konto) |
  | `challenge:read` | eingehende Herausforderungen im Event-Stream sehen |

  Für das Ansehen von Übertragungen ist zusätzlich `study:read` sinnvoll (siehe 5e).
- **CORS geprüft** (Preflight `OPTIONS` mit `Origin` und `Authorization`): `/api/account`, `/api/token`,
  `/api/board/game/stream/*` und `/api/import` antworten mit `access-control-allow-origin: *` und erlauben den Header
  `Authorization` sowie die Methoden GET/POST/PUT/DELETE. Das offizielle Beispiel
  [api-demo](https://github.com/lichess-org/api-demo) läuft rein clientseitig auf GitHub Pages. Damit ist belegt, dass der Weg funktioniert.
- Kleiner Haken: Lichess verlangt einen `User-Agent` mit App-Namen oder URL. Browser verbieten, den Header per `fetch` zu setzen.
  Der Browser schickt immer seinen eigenen User-Agent, die Origin wird mitgesendet. Das ist bei allen Browser-Clients so und
  wird von Lichess toleriert. Wir dokumentieren App-Name und URL im OAuth-Dialog (die `client_id` ist sichtbar).

## 2. Board API aus dem Browser

**Ergebnis: machbar.**

| Funktion | Endpunkt | Format |
|---|---|---|
| Ereignisse (Spielstart, Herausforderungen) | `GET /api/stream/event` | NDJSON-Stream, Keep-Alive alle 7 s; nur **ein** Event-Stream pro Token |
| Spielzustand streamen | `GET /api/board/game/stream/{gameId}` | NDJSON (`gameFull`, `gameState`, `chatLine`, `opponentGone`) |
| Zug senden | `POST /api/board/game/{gameId}/move/{uci}` | |
| Remis anbieten/annehmen | `POST /api/board/game/{gameId}/draw/{yes\|no}` | |
| Zugrücknahme | `POST /api/board/game/{gameId}/takeback/{yes\|no}` | |
| Aufgeben / Abbrechen | `POST …/resign`, `POST …/abort` | |
| Chat | `POST /api/board/game/{gameId}/chat` (`room=player\|spectator`) | |
| Sieg/Remis reklamieren (Gegner weg) | `POST …/claim-victory`, `…/claim-draw` | |
| Gegner suchen | `POST /api/board/seek` | Verbindung bleibt offen, solange gesucht wird |

NDJSON lesen wir mit `fetch()` + `ReadableStream` + `TextDecoderStream`, zeilenweise geteilt. Das funktioniert in allen
Ziel-Browsern, auch im Meta Quest Browser (Chromium). Ein Stream bleibt nur offen, solange der Tab lebt.
Bei Abbruch verbinden wir neu (der erste Stream-Eintrag `gameFull` liefert den ganzen Zustand).

## 3. Einschränkungen der Board API

- **Zeitkontrollen** (Originaltext): „Time controls: Rapid, Classical and Correspondence only. For direct challenges,
  games vs AI, and bulk pairing, Blitz is also possible.“
  → Über den Seek-Pool (`/api/board/seek`): nur Rapid (ab ca. 8 min geschätzter Dauer), Classical und Fernschach.
  Direkte Herausforderungen und Partien gegen die KI: zusätzlich Blitz. **Bullet ist nie erlaubt.**
  Das gilt für gewertete und ungewertete Partien gleich. Die Wertung ändert nichts an der Zeitkontrolle.
  Gültige `clock.limit`-Werte bei Herausforderungen: 0, 15, 30, 45, 60, 90 s und Vielfache von 60 bis 10800 s, Inkrement 0–60 s.
- **Engine-Hilfe**: „Engine assistance, or any kind of outside help, is forbidden“ ([Fair-Play](https://lichess.org/page/fair-play)).
  → Während einer laufenden Lichess-Partie sind Stockfish, Zughinweise, Markierungen „Figur ohne legalen Zug“
  (unkritisch, sie zeigen nur Regeln) und das Analysebrett **gesperrt**. Die Markierung legaler Zielfelder zeigt nur
  Regelwissen, keine Bewertung. Das tun offizielle Lichess-Clients selbst auch, deshalb bleibt sie erlaubt.
- **Rate Limits**: „Only make one request at a time.“ Bei HTTP 429 mindestens 60 s warten.
  Wir serialisieren alle schreibenden Requests über eine Warteschlange. Import: 200 Partien/h mit OAuth, 100/h anonym.
  Zuschauen: höchstens 8 gleichzeitige `/api/stream/game/{id}`-Streams pro IP.
- **Nutzungsbedingungen**: Drittanbieter-Clients sind ausdrücklich vorgesehen (Board API = „physical boards and third-party
  clients“). Es gelten die [Lichess ToS](https://lichess.org/terms-of-service), also kein Sandbagging, kein
  ständiges Abbrechen und kein Boosting. Ein Bot-Konto ist nicht nötig und nicht erwünscht. Bot-Konten sind nur für Engines gedacht.
- Herausforderungen für Echtzeitpartien verfallen nach 20 s, wenn niemand annimmt.

## 4. Lichess-Uhr

Der `gameState`-Event enthält `wtime`/`btime`/`winc`/`binc` in Millisekunden. Die lokale Uhr wird bei jedem Event per
`ChessClock.sync()` darauf gesetzt und läuft dazwischen nur zur Anzeige weiter. Bei einer Lichess-Partie
löst die lokale Uhr **nie** selbst eine Zeitüberschreitung aus. Das Ende kommt immer aus dem Lichess-Stream (`status: outoftime`).

## 5. Bewertung der Funktionen

| | Funktion | Urteil | Begründung |
|---|---|---|---|
| a | Eigene Lichess-Partien in VR spielen | **machbar** | OAuth-PKCE + Board API + CORS funktionieren aus dem Browser. Seek nur Rapid/Classical, Blitz nur per direkter Herausforderung. |
| b | Zwei lokale Spieler spielen eine Lichess-Partie gegeneinander | **eingeschränkt** | Machbar, wenn beide eigene Lichess-Konten haben und sich **auf ihrem jeweiligen Gerät** anmelden. Spieler A fordert B per `POST /api/challenge/{username}` heraus, B nimmt per `POST /api/challenge/{id}/accept` an. Beide Brillen streamen dieselbe Partie. Einschränkungen: zwei Konten Pflicht. Hot-Seat auf *einer* Brille würde zwei Tokens auf einem Gerät bedeuten, das ist technisch möglich, aber leicht als Boosting-Muster auffällig. Deshalb erlauben wir es nur **ungewertet**. Nur Blitz und langsamer. |
| c | Gegen die Lichess-KI spielen | **machbar** | `POST /api/challenge/ai` (Scope `board:play`), Stärke 1–8, Uhr optional (Blitz erlaubt). Danach normale Board-API-Partie. |
| d | PGN exportieren/importieren | **machbar** | Export: `POST /api/import` (form `pgn=…`) legt die Partie auf Lichess an und liefert die URL, **auch anonym** (100/h). Lokaler Download als `.pgn` immer. Import einer Lichess-Partie: `GET /game/export/{id}` (PGN) und das Analysebrett lokal. |
| e | Laufende Partien / Übertragungen als Zuschauer | **machbar** | `GET /api/stream/game/{id}` (NDJSON, ohne Login, max. 8 Streams/IP), `GET /api/tv/feed` (Lichess TV), Übertragungen per `GET /api/stream/broadcast/round/{id}.pgn` (PGN-Stream). Die Doku warnt, dass unauthentifizierte Broadcast-Endpunkte stark limitiert sind → mit Login (`study:read`) nutzen. |

## 6. Umsetzungsplan (Meilenstein 5)

1. `lichess/auth.ts`: PKCE-Flow (Redirect zurück auf die App), Token in `localStorage`, Logout mit Widerruf.
2. `lichess/ndjson.ts`: Stream-Reader mit Abbruch (`AbortController`) und Reconnect.
3. `lichess/board.ts`: Adapter, der eine Lichess-Partie als `RemoteGameSource` an den lokalen `ChessGame` hängt
   (Lichess ist autoritativ, lokale Züge werden erst nach Bestätigung übernommen). Das ist dasselbe Muster wie beim Netzwerk-Host.
4. Modi: Seek (Rapid/Classical), Herausforderung an Benutzernamen, KI-Partie, Zuschauen (TV/Partie-ID/Broadcast).
5. Stockfish und Analysebrett werden in Lichess-Partien hart deaktiviert, bis `status` ≠ `started`.

**Umgesetzt:** PGN-Download und PGN-Export (`POST /api/import`) seit M1. Mit Änderungsrunde 2 dazu: OAuth-PKCE-Login,
(a) laufende Partien fortsetzen, (b) Freund herausfordern, (c) Lichess-KI, offene Herausforderungen annehmen (Punkte 1–3 und 5
des Plans). Es fehlt noch (e) Zuschauen (TV/Übertragungen).
