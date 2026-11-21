# Myzel-Schach

Riesenschach im Browser – auf dem Desktop und (ab Meilenstein 2) in WebXR. Die Figuren sind
hüfthoch und stehen auf einer Lichtung in einem biolumineszenten Weltraum-Dschungel.

**Stand: Meilenstein 1 + Änderungsrunde 2** (Landingpage, Lichess-Partien, Senke, neue Pilze, lesbare Koordinaten, Insekten) – siehe [Fortschritt](#fortschritt) und [CHANGELOG.md](CHANGELOG.md).

## Schnellstart

Voraussetzung: Node.js ≥ 20 (getestet mit 24.22).

```bash
npm install          # kopiert per postinstall die Stockfish-Engine nach public/engine/
npm run dev          # https://localhost:5173 (selbstsigniertes Zertifikat, einmal bestätigen)
npm test             # Unit-Tests (Regeln, Uhr, Brettgröße, Kalibrierung)
npm run build        # Typprüfung + Produktions-Build nach dist/
```

Debug-Abkürzung: `https://localhost:5173/?autostart=engine` bzw. `?autostart=hotseat` überspringt die Startseite.
Konsole: `window.myzel` enthält `game`, `board`, `ctx`, `interaction`, `controls`, `world`, `insects`, `audio`.

## Landingpage

| Bereich | Inhalt |
|---|---|
| **Lokales Spiel** | Zwei Brillen im selben Raum (Raum erstellen / mit Code beitreten, folgt M4) · Hot-Seat · Gegen Stockfish (Stärke 1–8) · Online per Link (folgt M3) |
| **Lichess-Match** | „Mit Lichess anmelden“ (OAuth-PKCE). Danach: laufende Partie fortsetzen, Freund herausfordern (Benutzername, Zeitkontrolle, gewertet ja/nein), gegen die Lichess-KI (Stufe 1–8), offene Herausforderungen annehmen |
| Einstellungen | Name, Farbe (Weiß/Schwarz/Zufall), Zeitkontrolle, ggf. Stärke |
| Start | „In VR starten“ (nur aktiv, wenn `immersive-vr` unterstützt wird **und** der VR-Modus verfügbar ist – ab M2) · „Im Browser spielen“ |
| Fußzeile | Sprache DE/EN, Grafikqualität, „So funktioniert's“ + Sicherheitshinweis, Link zu lichess.org |

- `https://…/?room=ABCD` öffnet direkt den Beitrittsdialog.
- Die letzte Auswahl wird lokal gespeichert.
- Lichess-Login: Die Seite muss unter der Adresse erreichbar sein, zu der Lichess zurückleitet (`redirect_uri` = aktuelle Seite).
  Lokal funktioniert `https://localhost:5173/`. Der Token liegt in `localStorage` und wird beim Abmelden widerrufen.

## HTTPS

WebXR läuft nur in einem sicheren Kontext.

- **Lokal**: `@vitejs/plugin-basic-ssl` erzeugt ein selbstsigniertes Zertifikat. `localhost` gilt zwar auch ohne
  HTTPS als sicher, die Brille greift aber über die LAN-IP zu – deshalb ist HTTPS immer aktiv.
- **Quest im LAN**: `npm run dev` zeigt die Netzwerk-Adresse (`https://192.168.x.y:5173`). Im Meta Quest Browser öffnen
  und die Zertifikatswarnung bestätigen („Erweitert“ → „Weiter zu …“). Die Adresse darf auch **ohne** `https://` eingetippt
  werden: `scripts/dev.mjs` nimmt auf Port 5173 HTTP und HTTPS an und leitet HTTP automatisch auf HTTPS um.
  (Ein reiner Vite-Server würde auf `http://` gar nicht antworten → „Seite kann nicht erreicht werden“.)
  Reiner Vite-Server ohne Weiche: `npm run dev:vite`.
- **Seite trotzdem nicht erreichbar?** Brille und PC müssen im selben WLAN sein. Gast-, Hotel- und Uni-Netze trennen
  Geräte oft voneinander („Client Isolation“). Dann hilft ein Handy-Hotspot oder USB.
- **Per USB ohne Zertifikatswarnung**: Entwicklermodus auf der Quest aktivieren, `adb` installieren
  (Fedora: `sudo dnf install android-tools`), Brille verbinden, `adb reverse tcp:5173 tcp:5173`, dann auf der Brille
  `https://localhost:5173` öffnen.

## Deployment

`npm run build` erzeugt eine rein statische Seite in `dist/`. Sie läuft auf jedem HTTPS-Webspace.

**netcup/Plesk (aktuell: https://shroomchess.msmr.co/):** Der Branch **`deploy`** enthält nur den fertigen Build
(plus `.htaccess` für die Dateitypen und den GPL-Hinweis für Stockfish). In Plesk unter Git das Repo mit Branch `deploy`
eintragen und als Ziel `httpdocs` wählen. Ein Update geht so:

```bash
npm run deploy      # baut neu und pusht den Build in den Branch deploy
```

danach in Plesk „Jetzt abrufen“ klicken. Branch `main` (Quellcode) darf **nicht** ins Webroot: Browser können `src/main.ts`
nicht ausführen, die Seite bliebe leer.

Allgemein:
- `.wasm` muss als `application/wasm` ausgeliefert werden.
- Keine COOP/COEP-Header nötig (Stockfish läuft single-threaded, siehe DECISIONS.md).
- Unterverzeichnis: `vite build --base=/pfad/`.
- Ab Meilenstein 3 kommt der Signaling-Server (`server/`, Node + WebSocket) dazu und braucht `wss://`.

## Bedienung (Desktop)

| Aktion | Eingabe |
|---|---|
| Figur ziehen | Linke Maustaste auf Figur/Griffpunkt halten, ziehen, loslassen |
| Klick-Klick | Figur anklicken, dann Zielfeld anklicken (erneuter Klick auf die Figur hebt die Auswahl auf) |
| Kamera drehen / zoomen / verschieben | Rechte Maustaste / Mausrad / mittlere Maustaste |
| Ego-Perspektive | Menü → Ego-Perspektive, dann WASD gehen, Q/E drehen, rechte Maustaste halten zum Umsehen, Shift = schneller |
| Brett drehen | `F` |
| Menü | `Esc` oder ☰ |
| Analysebrett | Am Partieende → Analysebrett, dann ◀ ▶ bzw. Pfeiltasten, Pos1/Ende |

### Einstellungen im Spielmenü

Sprache · Qualität · Farbenblind-Palette · Figuren ohne legalen Zug markieren · Untertitel · Lautstärke ·
**Tiere / Umgebung** (eigene Lautstärke) · **Insekten anzeigen** (aus = auch keine Insektengeräusche) ·
**Glühwürmchen landen auf der Hand** (VR) · **Koordinatengröße S/M/L** · **Koordinaten hoher Kontrast** ·
**Koordinaten auf den Feldern**

## Projektstruktur

```
src/
  core/       Spielzustand (chess.js-Wrapper), Uhr, Einstellungen
  xr/         WebXR: Erkennung, math/ (Brettgröße im Boundary-Polygon, Rücken-an-Rücken-Kalibrierung)
  render/     Szene, Brett, Koordinaten (SDF-Text), Staunton-Figuren, Griffpunkte (gebündelt), Interaktion, Effekte,
              world/ (Himmel, Senke/Gelände, Pilzarten mit LOD, Vegetation, Insekten, Partikel)
  desktop/    Orbit-/Ego-Kamera, Maus-Zeiger
  ui/         landing/ (Landingpage, Routing, Hintergrund), Overlay, i18n (de/en)
  audio/      prozeduraler Ambient-Sound und Effekte (Web Audio, mit Untertiteln)
  engine/     Stockfish 19 Lite im Web Worker
  lichess/    OAuth-PKCE, API-Warteschlange, Board-API-Partie, PGN-Export
  net/        (M3) WebRTC + Signaling
server/       (M3) Signaling-Server
tests/        Vitest
docs/         ARCHITECTURE.md, LICHESS_FEASIBILITY.md, TESTING_TWO_HEADSETS.md
```

## Dokumentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) – technische Architektur
- [docs/LICHESS_FEASIBILITY.md](docs/LICHESS_FEASIBILITY.md) – Machbarkeitsanalyse Lichess
- [DECISIONS.md](DECISIONS.md) – getroffene Entscheidungen mit Begründung
- [docs/TESTING_TWO_HEADSETS.md](docs/TESTING_TWO_HEADSETS.md) – Testanleitung für zwei Brillen im selben Raum (Entwurf, wird in M4 vervollständigt)

## Fortschritt

| Meilenstein | Status |
|---|---|
| 0 Machbarkeitsanalyse Lichess + Architektur | ✅ |
| 1 Desktop-Schach mit Regeln, Figuren und Welt | ✅ (siehe offene Punkte) |
| 2 VR-Einzelspieler (Roomscale, Boundary, Griffpunkte, Hand/Controller) | ⏳ Mathematik für Brettgröße fertig und getestet |
| 3 Online-Mehrspieler | ⏳ |
| 4 Co-Location (Rücken an Rücken) | ⏳ Kalibrierungs-Mathematik fertig und getestet |
| 5 Lichess, Feinschliff, Performance | 🟡 Login, Partien (fortsetzen/herausfordern/KI/annehmen) und PGN-Export fertig. Zuschauen (TV/Übertragungen) fehlt noch |

### Offene Punkte nach Meilenstein 1

- Zielfeld-Markierungen auf hellen Mondstein-Feldern noch etwas blass – Kontrast nachschärfen.
- Figuren sind noch einzelne Meshes (32 Draw Calls). Die Griffpunkte sind gebündelt. Gesamt: Low 75 / Medium 75 Draw Calls.
- FPS auf echter Quest-Hardware noch nicht gemessen (nur Draw Calls/Dreiecke im Headless-Browser, siehe DECISIONS.md D29).
- Lichess: Login-Weiterleitung geprüft. Code-Tausch und echte Partien sind mangels Testkonto noch nicht end-to-end getestet.
- Landen der Glühwürmchen auf der Hand ist erst mit VR-Händen (M2) testbar.
- Remis-Angebot gegen Stockfish wird immer abgelehnt (keine Bewertungslogik).
- Hot-Seat dreht die Kamera nicht automatisch zum Spieler am Zug (manuell mit `F`).
- Rücknahme setzt die Uhr nicht zurück.
- Schachuhr ist nur im 2D-Overlay. Die schwebende 3D-Uhr am Brettrand kommt mit M2 (wird in VR gebraucht).
- „In VR starten“ ist bis Meilenstein 2 deaktiviert (VR-Erkennung läuft bereits).
