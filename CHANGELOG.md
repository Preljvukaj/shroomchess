# Changelog

## 0.4.0 – Senke, Greifen, Kontrast, Klang, Fern-Pilze, Lichtung

- **Senke flacher und weicher:** Wall 1,2–1,8 m (vorher bis 4 m), Hangfuß ~1 m nach der Spielfläche, weiches Profil ohne Knick,
  überall ≤ 25° Steigung. Einstellbar über `terrain.basinHeight` / `terrain.basinSlopeWidth` (`src/render/world/terrainConfig.ts`).
- **Bodenkontakt:** Alle Pilze, Pflanzen, Myzelfäden und Ranken stehen auf dem Gelände (Grundfläche abgetastet, leicht versenkt,
  begrenzte Neigung). Debug: `?debug=ground` markiert Abweichler rot.
- **Spielflächen-Umrandung:** Moos-Lichtung in exakt der Form der Boundary bzw. der eingerichteten Fläche, schwaches Sporenleuchten,
  weicher Noise-Rand, Saum aus Moospolstern und Mini-Leuchtpilzen außerhalb.
- **Fern-Pilze:** Billboards entfernt. Stattdessen viele echte 3D-Pilze (neue Low-Poly-Stufe) in Büscheln.
- **Greifen:** Ist der Griffpunkt groß markiert, greift die Geste sofort, auch ohne genaue Berührung. Die Figur schnappt in ~100 ms in die Hand,
  bleibt aufrecht, mit Haptik, „Plopp“ und Aufleuchten. Hysterese 10/14 cm, die nächste Figur gewinnt.
- **Figurenkontrast:** Schwarze Figuren haben eine feine helle Kontur (Einstellung Aus/Normal/Hoch), optional eine dunkle Kontur für Weiß.
- **Insektenklang:** durchgehende Klangfläche aus drei Loops, 15 verschiedene Einzelgeräusche alle 1,5–6 s (bis 6 gleichzeitig),
  langsam schwankende Chor-Intensität, Ducking bei Spielsounds.
- **Tests:** 87 (vorher 66). Neu: Steigung/Höhe der Senke, Hangbreite, Bodenkontakt (3 cm), Lichtung = Boundary-Polygon,
  keine Billboards, Saum außerhalb der Fläche, Greif-Hysterese und Snap, Insektenklänge (Loop-Länge, Naht, Anzahl, Intervalle).


## 0.3.0 – Meilenstein 2: VR-Einzelspieler

### Neu
- **VR-Modus**: Knopf „VR betreten“ im Spiel (bei VR-fähigen Geräten; von der Landingpage über „In VR starten“).
  Foveated Rendering, Framebuffer-Skalierung je Qualitätsstufe.
- **Spielfläche**: Boundary (`bounded-floor`) wird gelesen, das Brett automatisch so groß wie möglich (0,5 m Abstand, Feld ≤ 0,6 m)
  platziert und gedreht, sodass die eigene Grundreihe zu dir zeigt. Die Senke wird um deine echte Spielfläche gebaut.
  Ohne Boundary: 4 Ecken auf dem Boden antippen. Ist der Raum zu klein oder der Sitzmodus an, gibt es ein Tischbrett vor dir.
- **Greifen** mit Controller (Trigger/Grip) und Handtracking (Pinch), mit Haptik. Hände und Controller erscheinen als leuchtende Sporen.
- **3D-Oberfläche**:
  - schwebende Schachuhr am Brettrand
  - Hinweis-Tafel (auch Untertitel)
  - Handgelenk-Menü (Blick auf die linke Handfläche oder Taste Y) mit Aufgeben, Remis, Zug zurück, Boundary anzeigen,
    Brett neu ausrichten, Sitzmodus, Brett kleiner/größer, Insekten, Koordinatengröße, Revanche, Neue Partie, VR verlassen
- **Grenzwarnung**: Rankengitter erscheint unter 0,4 m Abstand zur Boundary.
- **Tracking-Reset** wird erkannt, das Brett neu ausgerichtet bzw. die Einrichtung neu gestartet.
- **Debug-Modus** `?xremu=1` (IWER-Emulator), siehe README.

### Tests
66 Unit-Tests (vorher 55): Brett-Platzierung (Roomscale, Tisch, Sitzmodus, manuelle Größe), Eckensortierung,
Handflächen-Erkennung, Insekten bei verschobenem/gedrehtem Brett.


## 0.2.0 – Landingpage, Senke, neue Pilze, lesbare Koordinaten, Insekten

### Neu
- **Landingpage** (`src/ui/landing/`):
  - zwei gleichwertige Einstiege „Lokales Spiel“ und „Lichess-Match“, Unterauswahl, gemeinsame Einstellungen
  - Start-Buttons mit Begründung, wenn gesperrt
  - Fußzeile mit Sprache, Grafik, Hilfe/Sicherheit und Lichess-Link
  - Routing `?room=CODE` → Beitrittsdialog
  - letzte Auswahl wird gemerkt
  - animierter Canvas-Hintergrund (Standbild bei reduzierter Bewegung)
  - Klickflächen ≥ 48 px, responsiv
  - 3D-Szene wird erst nach dem Start geladen (Startseite ~13 kB gzip)
- **Lichess**: Login per OAuth-PKCE, laufende Partien fortsetzen, Freund herausfordern (Blitz und langsamer), gegen die Lichess-KI
  spielen, offene Herausforderungen annehmen. Partien laufen über die Board API mit der Lichess-Uhr als maßgeblicher Uhr.
  Fair Play: keine Engine oder Analyse während der Partie.
- **Senke**: Das Brett liegt in einer organisch geformten Mulde mit 2,5–4 m hohen, bewachsenen Wällen (Moos, Wurzeln,
  Myzel-Adern, Ranken). Die Spielfläche bleibt exakt flach (getestet). Der Bodennebel sammelt sich in der Senke, und der Horizont ist verdeckt.
- **Pilze**:
  - 8 Arten mit eigenen Hutformen: Glocke, Schirm, Trichter, Buckel, Halbkugel, Kegel
  - gewellte oder eingerissene Ränder
  - Hutmuster: Punkte, Schuppen, Flecken, Maserung
  - Stiele gerade, gebogen, s-förmig, knollig oder verjüngt, mit Fasern, Netz oder Schuppen, Manschette (Annulus), Büscheln
  - **Lamellen** (lang/kurz im Wechsel), die zum Rand hin leuchten
  - Baby-Pilze und leuchtende Myzelfäden
  - LOD: Lamellen → Lamellen-Scheibe → Billboards
- **Koordinaten**:
  - SDF-Text (Inter Bold), 38–55 % der Feldbreite, um 25° zum Spieler geneigt, auf dunklen Plättchen
  - für beide Seiten richtig herum
  - Linie und Reihe leuchten unter der getragenen Figur auf
  - optional Beschriftung auf den Feldern
- **Insekten**:
  - Glühwürmchen, Mückenschwärme (Boids), Motten am Pilzlicht, Libellen mit schimmernden Flügeln
  - nie näher als 0,6 m am Kopf, nie im Brettraum
  - räumliche Geräusche ab und an

### Neue Einstellungen (Menü im Spiel)
Koordinatengröße S/M/L, Koordinaten hoher Kontrast, Koordinaten auf den Feldern, Lautstärke „Tiere / Umgebung“,
Insekten anzeigen (aus = auch keine Insektengeräusche), Glühwürmchen landen auf der Hand (VR).

### Geändert
- Griffpunkte werden gebündelt gezeichnet (2 statt 64 Draw Calls).
- Desktop-Kamera bleibt in der Senke (Orbit-Abstand begrenzt).
- Zeitkontrolle 3+2 ergänzt.
- Bloom-Schwelle 0,85 (Koordinaten verschmieren nicht).

### Behoben
- Eine veraltete globale CSS-Klasse (`.start`) des alten Startbildschirms legte sich über die neue Landingpage und schluckte alle Klicks.
- Strahlenförmiges Nebel-Artefakt am Zenit des Himmels.

### Tests
55 Unit-Tests (vorher 27), neu: Landingpage-Routing inkl. `?room=`, flacher begehbarer Bereich (Funktion und
Render-Gitter, 5 Flächenformen), Ausrichtung der Koordinaten pro Spielerseite, Mindestabstand der Insekten zum Kopf
(Simulation mit laufendem Spieler und ausgestreckter Hand), nur Glühwürmchen über dem Brett.
