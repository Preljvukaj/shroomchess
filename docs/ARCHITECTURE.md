# Architektur

```
                ┌──────────────────────── Browser (ein Code-Stand) ────────────────────────┐
                │                                                                           │
 Startseite ──► │ ui/ (Start, Overlay, i18n)  ──► App (main.ts) ◄── desktop/ (Orbit, FPS,  │
                │                                  │   │   │          Maus-Picking)         │
                │                                  │   │   └──────► xr/ (Session, Input,   │
                │                                  │   │             Boundary, Kalibrierung)│
                │        core/ ChessGame (chess.js)│   │                                    │
                │        core/ ChessClock  ◄───────┘   └──────► render/ (Welt, Brett,       │
                │              ▲                                 Figuren, Effekte)          │
                │              │ Zugwunsch / Zustand                                        │
                │   ┌──────────┴───────────┬───────────────────┬──────────────────┐        │
                │   │ LocalSource (Hotseat)│ EngineSource      │ NetSource        │ Lichess│
                │   │                      │ (Stockfish Worker)│ (WebRTC/WS-Relay)│ Source │
                └───┴──────────────────────┴───────────────────┴──────────────────┴────────┘
                                                                  │
                                                     server/ Signaling + Lobby + Relay (Node, ws)
```

## Grundprinzipien

1. **Ein autoritativer Spielzustand** (`core/ChessGame`). Renderer, Overlay, Netzwerk und Engine hören auf seine Ereignisse
   (`move`, `undo`, `reset`, `end`). Niemand verändert die 3D-Szene „auf Verdacht“. Die Szene folgt immer dem Zustand.
   Im Netzwerk prüft nur der Host mit chess.js. Clients senden *Zugwünsche* und spielen erst den bestätigten Zug ab.
2. **Eingabe ist vom Modus entkoppelt.** Desktop-Maus, VR-Controller und Handtracking liefern dieselben abstrakten
   „Zeiger“ (Position + Zustand greifen/loslassen). `render/Interaction` macht daraus Griffpunkt-Nähe, Greifen,
   Zielfelder und Ablegen. So verhalten sich Desktop-Hover und VR-Annäherung identisch (Spezifikation 5).
3. **Reine Mathematik ist DOM- und Three-frei** (`xr/math/*`), damit Brettgröße und Kalibrierung per Unit-Test prüfbar sind.
4. **Ein Welt-Koordinatensystem pro Gerät.** Das Brett ist eine `THREE.Group` (`boardRoot`), deren Pose aus Boundary bzw.
   Kalibrierung kommt. Alle Figuren, Markierungen und Brett-UI hängen darunter. Brett-lokal gilt: Feld (f, r) liegt bei
   `x = (f − 3,5)·s`, `z = (3,5 − r)·s`. Weiß steht bei +Z.

## Module

| Ordner | Inhalt |
|---|---|
| `core/` | `ChessGame` (chess.js-Wrapper mit Ereignissen, Spielenden, PGN, FEN-Zeitleiste), `ChessClock` (Fischer-Uhr, injizierbare Zeit), `settings`, Typen |
| `xr/` | `math/` (Brettgröße, Kalibrierung, Vektoren). Ab M2: `session.ts` (Feature-Erkennung, `bounded-floor` → `local-floor`-Fallback, Foveation, Framebuffer-Skalierung), `input.ts` (Controller + Hände → Zeiger), `boundary.ts` (Polygon lesen, Warn-Ranken), `calibration.ts` (Ablauf Rücken an Rücken), `wristMenu.ts` |
| `render/` | `scene.ts` (Renderer, Kamera, Licht, Env-Map, Qualitätsstufen, Bloom), `world/` (Himmel, Monde, Gasriese, instanzierte Pilze/Farne mit Wiege-Shader, Sporen, Bodennebel), `board.ts`, `pieces.ts` (prozedurale Staunton-Figuren), `pieceView.ts` (Griffpunkt), `highlights.ts`, `effects.ts` (Sporen-Auflösung), `captureBowl.ts`, `promotion.ts`, `interaction.ts` |
| `desktop/` | Orbit-Kamera (Rechtsklick drehen, Rad zoomen), First-Person (WASD), Maus → Zeiger |
| `ui/` | Startseite, 2D-Overlay (Zugliste, Uhr, geschlagene Figuren, Menü), `i18n` (de/en), Untertitel |
| `audio/` | prozedurales Ambient (Web Audio, keine Assets), Effekte mit Untertiteln |
| `engine/` | Stockfish 19 Lite (WASM, Single-Thread) im Worker, UCI-Adapter mit Stärkestufen |
| `net/` (M3) | Signaling-Client, WebRTC-DataChannel, WS-Relay-Fallback, Host-Autorität, Pose-Sync 15 Hz mit Interpolation, Reconnect über Session-ID |
| `lichess/` | M1: PGN-Export. M5: OAuth-PKCE, NDJSON, Board-API-Adapter |
| `server/` (M3) | Node + `ws`: Lobby-Codes, Signaling, Relay, Session-Tabelle für Reconnect |

## Spielzustands-Quellen

`GameController` verbindet den `ChessGame` mit einer Zugquelle pro Seite:

- `local`: Mensch an diesem Gerät (Desktop/VR)
- `engine`: Stockfish-Worker
- `remote` (M3): Gegner über das Netzwerk
- `lichess` (M5): Lichess-Stream (auch für die eigene Seite autoritativ)

## Netzwerkprotokoll (M3, Entwurf)

JSON-Nachrichten über DataChannel `game` (zuverlässig, geordnet) und `pose` (unzuverlässig, ungeordnet):

```
game:  hello{sessionId,name,color?} · state{pgn,clock,result} · moveRequest{from,to,promo} · move{san,from,to,clock}
       offer{type:'draw'|'takeback'} · answer{type,accept} · resign · calib{phase,pose} · boundary{points}
pose:  {t, head:[x,y,z,qx,qy,qz,qw], l:[…], r:[…], held?:{square, pose}}  @15 Hz, Empfänger interpoliert 100 ms verzögert
```

Co-Location (M4): Die Posen des Gastes werden vor dem Senden mit der Kalibrierungs-Transformation in das Host-System gebracht.
Alles über das Netz ist im Host-Raum ausgedrückt.

## Ablauf eines Zuges

```
Zeiger nahe Griffpunkt ─► Hervorhebung (Abstand → Helligkeit, < 8 cm greifbar + Haptik)
greifen ─► Figur folgt dem Zeiger (angehoben), legalMovesFrom() ─► Zielfeld-Marker
loslassen ─► Feld unter der Figur? legal ─► Umwandlung? Auswahl ─► ChessGame.tryMove()
                                  illegal ─► Rückkehr-Animation
ChessGame 'move' ─► Renderer animiert (Schlag: Sporen + Pilzschale, Rochade: Turm) ─► Uhr ─► Sound/Untertitel ─► nächste Quelle
```
