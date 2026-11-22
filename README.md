# Myzel-Schach

Riesenschach im Browser – auf dem Desktop und in WebXR. Die Figuren sind hüfthoch und stehen auf einer Lichtung in einem
biolumineszenten Weltraum-Dschungel.

**Stand: Meilensteine 1–4 + Änderungsrunde 6** (Online-Mehrspieler, zwei Brillen im selben Raum, Info-Steintafel,
langsame Gegner-Animation, dichter Fern-Dschungel mit Horizontring, Asteroiden) – siehe [Fortschritt](#fortschritt) und
[CHANGELOG.md](CHANGELOG.md).

## Schnellstart

Voraussetzung: Node.js ≥ 20 (getestet mit 24.22).

```bash
npm install          # kopiert per postinstall die Stockfish-Engine nach public/engine/
npm run dev          # https://localhost:5173 (selbstsigniertes Zertifikat, einmal bestätigen) + Signaling-Server
npm run server       # nur der Signaling-Server (ws://localhost:8787/signal)
npm test             # Unit-Tests
npm run build        # Typprüfung + Produktions-Build nach dist/
```

Debug-Abkürzung: `https://localhost:5173/?autostart=engine` bzw. `?autostart=hotseat` überspringt die Startseite.
Konsole: `window.myzel` enthält `game`, `board`, `ctx`, `interaction`, `controls`, `world`, `insects`, `audio`.

## Landingpage

| Bereich | Inhalt |
|---|---|
| **Lokales Spiel** | Zwei Brillen im selben Raum (Raum erstellen / mit Code beitreten) · Hot-Seat · Gegen Stockfish (Stärke 1–8) · Online per Link (Code, Link, QR-Code) |
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
- Für Online-Spiel und Co-Location braucht es zusätzlich den Signaling-Server (siehe unten).

### Signaling-Server deployen

`server/` ist ein kleiner Node.js-Server (Paket `ws`, keine Datenbank): Lobby-Codes, WebRTC-Signaling, Relay als Fallback,
Reconnect-Sessions (2 min). Er kennt den Spielzustand nicht – autoritativ ist der Host-Browser.

```bash
PORT=8787 TRUST_PROXY=1 ALLOWED_ORIGINS=https://shroomchess.msmr.co node server/index.js
curl http://localhost:8787/health      # {"ok":true,"rooms":0,"conns":0}
```

- **TLS:** Die Seite läuft über HTTPS, also muss der Server per `wss://` erreichbar sein. Am einfachsten hinter dem
  vorhandenen Webserver als Reverse-Proxy auf den Pfad `/signal` (nginx: `location /signal { proxy_pass http://127.0.0.1:8787;
  proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
  proxy_set_header X-Forwarded-For $remote_addr; }`). Dann findet der Client den Server automatisch unter
  `wss://<gleicher Host>/signal`.
- **Plesk:** „Node.js“-Erweiterung → Anwendungsstamm = Repo, Startdatei `server/index.js`, Umgebungsvariablen wie oben; die
  nginx-Direktive aus dem Punkt davor unter „Apache & nginx → Zusätzliche nginx-Direktiven“ eintragen.
- **Anderer Host:** beim Build `VITE_SIGNAL_URL=wss://signal.example.org/signal npm run build` setzen.
- **TURN (optional):** Für Netze, in denen P2P scheitert, ist das Relay über den WebSocket-Server eingebaut. Ein eigener
  TURN-Server (z. B. coturn) lässt sich per `VITE_ICE_SERVERS='[{"urls":"stun:…"},{"urls":"turn:…","username":"…","credential":"…"}]'`
  eintragen. Standard ist nur ein öffentlicher STUN-Server.
- **Sicherheit:** Größenlimit 32 KB, Schema-Prüfung, Rate-Limit (60 Nachrichten/s, Burst 120), max. 5 Räume und 10
  Erstellungen pro Minute je IP, Räume verfallen nach 30 min Inaktivität, Raumcodes sind zufällig (keine Daten darin).

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

### Bedienung in VR

| Aktion | Controller | Hände |
|---|---|---|
| VR starten | Im Spiel „VR betreten“ antippen (von der Landingpage: „In VR starten“) | |
| Figur ziehen | Hand bzw. Controller **über** die eigene Figur halten (jede Höhe bis 2 m, Sporenfaden zeigt die Figur) oder direkt an den Griffpunkt, Trigger/Grip drücken → Figur fliegt in die Hand; über dem Zielfeld loslassen | dasselbe mit Pinch |
| Greifen aus der Distanz | Einstellung **Greifstrahl** (Menü → „Greifstrahl an/aus“): Figur mit dem Strahl anpeilen, Trigger | Strahl aus der Hand, Pinch |
| Umwandlung | Mini-Figur antippen + Trigger | Mini-Figur pinchen |
| Menü | Taste **Y** (linker Controller) | **Blick auf die linke Handfläche** |
| Menüknopf | Mit der rechten Controllerspitze antippen + Trigger | Mit dem rechten Zeigefinger antippen |
| Aufgeben / Remis | im Menü zweimal tippen | |

Ohne eingerichtete Spielfläche fragt das Spiel nach den 4 Ecken deiner freien Fläche (auf dem Boden antippen).
Linkshänder-Option: Menü an der rechten Hand.

**Testen ohne Brille:** `…/?autostart=engine&xremu=1&bounds=4x3` simuliert eine Quest 3 (Metas IWER). `&hands=1` für
Handtracking, `&stereo=1` für echtes Stereo. Ohne `bounds` startet die manuelle Flächeneinrichtung. Steuerung in der
Konsole über `window.__myzelXR`.

**Netzwerkspiel ohne Startseite (zwei Fenster):**
`…/?autostart=online&netroom=ABCD5&role=host&color=w&tc=5%2B3` und `…/?autostart=online&netroom=ABCD5&role=guest`
(für Co-Location `autostart=coloc`). Andere Signaling-Adresse: `&signal=wss://…/signal`.

### Online spielen

1. Startseite → **Online** → **Erstellen**. Farbe und Zeitkontrolle legst du als Host fest. Den Code (5 Zeichen, ohne 0/O/1/I),
   den Link (`?room=CODE`) oder den QR-Code an deinen Gegner schicken.
2. Der Gegner öffnet den Link oder gibt den Code unter **Beitreten** ein. VR gegen VR, VR gegen Desktop und Desktop gegen Desktop
   gehen gemischt; jeder spielt auf seinem eigenen Brett in seiner eigenen Spielfläche.
3. Der Gegner erscheint als leuchtendes Sporenwesen (Kopf und Hände) auf der anderen Brettseite. Trägt er eine Figur, siehst du
   sie live in seiner Hand. Desktop-Spieler erscheinen als schwebender Kopf mit Zeiger-Licht über dem Feld, auf das sie zeigen.
4. Im Menü: Remis anbieten, Aufgeben, Zug zurücknehmen (nur mit Zustimmung), Revanche, kurze Nachrichten („Guter Zug!“, „Hmm …“)
   und optional Sprachchat (standardmäßig aus, nur bei direkter P2P-Verbindung).

Der Host prüft jeden Zug und führt die Uhr. Bei einem Verbindungsabbruch wird das Spiel pausiert (Uhren stehen); wer
innerhalb von 2 Minuten zurückkommt, macht mit derselben Stellung weiter. Ping und Verbindungsqualität stehen auf der Steintafel.

### Zwei Brillen im selben Raum (Co-Location)

1. Beide Brillen: dieselbe Spielfläche (Guardian) einrichten. Maßgeblich ist die Boundary des Hosts.
2. Host: **Zwei Brillen im selben Raum** → **Erstellen** → **In VR starten**. Gast: Code eingeben bzw. QR-Code scannen → **In VR starten**.
3. Rücken an Rücken in die Mitte der Fläche stellen, Fersen auf einer Linie, geradeaus schauen. Beide halten gleichzeitig Trigger
   bzw. Pinch 2 Sekunden → Countdown 3 s → Erfassung (nicht bewegen).
4. Jeder geht geradeaus zu seiner Grundreihe (Markierung am Boden) und dreht sich um.
5. Abklatsch-Check: einmal mit Controller oder Hand berühren. Liegen die virtuellen Hände mehr als 5 cm auseinander, bietet das
   Spiel Feinjustierung (Gast: linker Stick verschiebt, rechter dreht) oder eine neue Kalibrierung an.

Sicherheit: Avatare sind immer sichtbar; unter 1 m leuchtet der andere stärker, unter 0,5 m gibt es Warnton, Text und Vibration.
Nach Neuzentrieren oder Tracking-Verlust fordert das Spiel zur Neukalibrierung auf. Ausführliche Testanleitung:
[docs/TESTING_TWO_HEADSETS.md](docs/TESTING_TWO_HEADSETS.md). Der Abstand der Kopfmittelpunkte Rücken an Rücken ist im Menü
einstellbar („Rücken-an-Rücken-Abstand“, 25/30/35 cm, Standard 30 cm).

### Steintafel

Uhr, Zugrecht, Status (Schach, Matt, Patt, Remis-Angebot), die letzten 10 Halbzüge, geschlagene Figuren (als Relief), Namen und
der Verbindungsstatus stehen auf einer Steintafel neben dem Brett – nicht mehr schwebend über dem Brett. Sie steht an der
Längsseite (neben der a- oder h-Linie) zwischen beiden Grundreihen, bevorzugt knapp hinter der Boundary-Linie, und hat zwei
Schauflächen – jeder Spieler liest seine Seite richtig herum. Die Tafel ist virtuell: Wer näher als 0,3 m herankommt, sieht sie
durchscheinend und bekommt einen Hinweis. Am Desktop erscheint das 2D-Overlay automatisch, wenn die Tafel nicht im Bild ist; mit
„Infos als Overlay“ ist es immer an.

### Einstellungen im Spielmenü

Sprache · Qualität · Farbenblind-Palette · Figuren ohne legalen Zug markieren · Untertitel · Lautstärke (gesamt) ·
**Spiel-Sounds** · **Umgebung** · **Tiere / Insekten** (je eigene Lautstärke) · **Greifstrahl** (VR, aus) · **Insekten anzeigen** (aus = auch keine Insektengeräusche) ·
**Glühwürmchen landen auf der Hand** (VR) · **Koordinatengröße S/M/L** · **Koordinaten hoher Kontrast** ·
**Koordinaten auf den Feldern** · **Infos als Overlay** · **Gegner-Animation** Langsam/Normal/Schnell

**Gegner-Animation:** Züge, die nicht von deiner eigenen Hand kommen (Stockfish, Lichess-Gegner, Online-Gegner ohne live sichtbare
Hand), laufen langsam und gut verfolgbar ab: Der Griffpunkt leuchtet auf, die Figur hebt sich, gleitet im Bogen zum Ziel und setzt
mit einem Sporenwölkchen auf (1,8–2,4 s bei „Langsam“). Rochade erst König, dann Turm; die geschlagene Figur löst sich erst auf,
wenn der Angreifer über ihr ist. Du kannst währenddessen schon greifen; geprüft wird dein Zug danach. Die Animationszeit geht nicht
von deiner Bedenkzeit ab (die Uhr startet erst danach – außer auf Lichess, dort zählt die Lichess-Uhr). Bei Bullet/Blitz schlägt das
Spiel „Schnell“ vor.

Die Einstellungen „Figurenkontrast“ und „Dunkle Kontur für Weiß“ gibt es seit 0.6.0 nicht mehr. Die schwarzen Figuren heben sich jetzt
durch das Licht ab: Lichtinsel über dem Brett, farbiges Randlicht, Umgebungsreflexionen, weiche Kontaktschatten.

### Brettbeschriftung

Das Brett hat einen Steinrahmen (45 % einer Feldbreite). In ihn sind die Koordinaten eingelassen: flach liegend, kursiv (Cormorant
Garamond Italic, SDF-Text), warm golden-weiß leuchtend mit sehr langsamem Puls. Jede Seite ist für den Spieler auf ihrer Seite lesbar,
die Zahlen an den Seiten zeigen zur näheren Grundreihe. Gegen die Engine und auf Lichess richtet sich die ganze Beschriftung nach der
eigenen Farbe. Beim Tragen einer Figur leuchten Linie und Reihe im Rahmen auf. Die Größe S/M/L bezieht sich auf die Rahmenbreite
(Zeichenhöhe 48/56/62 %). Die Brettgröße wird inklusive Rahmen berechnet.

### Senke anpassen

Die Form der Senke steht zentral in `src/render/world/terrainConfig.ts`:

| Parameter | Standard | Bedeutung |
|---|---|---|
| `terrain.basinHeight` | 1,5 m | mittlere Wallhöhe (je Richtung begrenzt auf 1,2–1,8 m) |
| `terrain.basinSlopeWidth` | 5 m | gewünschte Hangbreite (wird verbreitert, falls sonst steiler als `maxSlopeDeg`) |
| `terrain.transition` | 1,0 m | Abstand Spielflächenrand → Hangfuß |
| `terrain.maxSlopeDeg` | 21° | höchste Steigung (inkl. Unebenheiten < 25°) |
| `terrain.clearingFade` | 0,3 m | weicher Übergang der Moos-Lichtung |

Debug: `?debug=ground` markiert Objekte rot, deren Basis mehr als 3 cm neben dem Gelände liegt.

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
  net/        Online/Co-Location: Protokoll, WebRTC-DataChannel + WS-Relay, Host-Autorität, Uhr-Abgleich, Posen-Puffer
server/       Signaling-Server (Node + ws): Lobby-Codes, Signaling, Relay, Reconnect-Sessions
scripts/sim/  Co-Location-Simulation mit zwei Browsern (Emulator, bekannte Posen)
tests/        Vitest
docs/         ARCHITECTURE.md, LICHESS_FEASIBILITY.md, TESTING_TWO_HEADSETS.md
```

## Dokumentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) – technische Architektur
- [docs/LICHESS_FEASIBILITY.md](docs/LICHESS_FEASIBILITY.md) – Machbarkeitsanalyse Lichess
- [DECISIONS.md](DECISIONS.md) – getroffene Entscheidungen mit Begründung
- [docs/TESTING_TWO_HEADSETS.md](docs/TESTING_TWO_HEADSETS.md) – Testanleitung für zwei Brillen im selben Raum

## Fortschritt

| Meilenstein | Status |
|---|---|
| 0 Machbarkeitsanalyse Lichess + Architektur | ✅ |
| 1 Desktop-Schach mit Regeln, Figuren und Welt | ✅ (siehe offene Punkte) |
| 2 VR-Einzelspieler (Roomscale, Boundary, Griffpunkte, Hand/Controller) | ✅ |
| 3 Online-Mehrspieler | ✅ im Browser end-to-end getestet (zwei Fenster, P2P); mit echten Brillen noch nicht |
| 4 Co-Location (Rücken an Rücken) | ✅ Simulation mit zwei Emulatoren bestanden (Abweichung < 1 mm); mit zwei echten Brillen noch nicht getestet |
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
- VR noch nicht auf echter Quest-Hardware getestet (Bildrate, Tracking, Haptik, Lesbarkeit der Tafeln).
- Teleport (optionale Komfortfunktion) noch nicht umgesetzt (Roomscale ist der Standard).
- Das Handgelenk-Menü ist funktional, aber noch schlicht. Einstellungen wie Qualität und Sprache gibt es nur am Desktop.
