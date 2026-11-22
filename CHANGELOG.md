# Changelog

## 0.6.0 – Licht statt Konturen, Steinrahmen, Steine, Lavalampen-Blasen, Brummer, ruhigerer Klang

- **Himmel ohne Naht:** Die Naht kam vom Nebel. Er war als 2D-Noise über den Azimut (`atan`) berechnet, und der springt in −X von +π
  auf −π. Jetzt ist es 3D-Noise über die Blickrichtung, und der Himmel wird „im Unendlichen“ gezeichnet (nur Rotation der Kamera),
  also in beiden Augen identisch. Gasriese, Monde, Sterne und Nebel bleiben.
- **Licht statt weißer Kontur:** Kontur und Einstellung „Figurenkontrast“ (inkl. dunkler Kontur für Weiß) entfernt. Neu: Lichtinsel
  über dem Brett (Key-Light schräg von oben), farbiges Randlicht von der Seite, PMREM-Umgebungsreflexionen, Schwarz #1A1822 mit
  Klarlack (Rauheit 0,3), weiche Kontaktschatten unter jeder Figur. Genau 2 Echtzeit-Lichter, die Umgebung bleibt dunkler als das Brett.
  Die Spielerfarben-Markierung beim Greifen bleibt.
- **Steinrahmen mit eingelassener Beschriftung:** Rahmen 45 % einer Feldbreite, Koordinaten flach, kursiv, warm leuchtend mit
  langsamem Puls. Jede Seite ist für ihren Spieler lesbar, gegen Engine/Lichess folgt die Beschriftung der eigenen Farbe.
  Die Brettgröße rechnet den Rahmen mit ein. Die alten Moosring-Beschriftungen sind entfernt.
- **Steine:** 8 Arten (geschmolzene Klumpen, Balance-Türme, Ringe/Bögen, Nadeln, gewellte Scheiben, Schwamm-/Lavasteine, geäderte
  Kristallsteine, Pastell-Kiesel). Violett, Türkis, Ocker, Rostorange, Pink, Petrol, Elfenbein, teils mit Schichtbändern und
  leuchtenden Adern. Sie liegen nur außerhalb der Spielfläche, teils halb versunken, die großen weiter draußen, alle mit Bodenkontakt.
- **Lavalampen-Blasen:** weich leuchtende, wabernde Formen (0,3–2 m). Sie wölben sich an Quellen außerhalb der Spielfläche hervor,
  lösen sich ab, steigen taumelnd auf, teilen oder vereinen sich und lösen sich hoch oben auf. Abstand zur Spielfläche und zu Köpfen
  immer mindestens 1,5 m. 8/14/20 Blasen je Qualitätsstufe. Auch im Hintergrund der Startseite.
- **Mehr Insekten und Brummer:** 60/180/400 statt 30/80/200, mehr Mückenschwärme und Motten. Neu sind die „Brummer“: dick, samtig,
  2–5 cm, orange-violett gestreift oder petrol, taumeln von Pilz zu Pilz und Stein zu Stein und landen kurz. Jeder in der Nähe hat sein
  eigenes tiefes Brummen. Bei zu wenig FPS wird die Insektenzahl automatisch reduziert (und später wieder erhöht).
- **Klang ruhiger:** Wind etwa 3× leiser und Böen nur noch alle 25–60 s. Der Grundteppich läuft durch einen Tiefpass (7 kHz), das Summen
  hat weniger Rauschanteil, das Mückensirren kommt seltener. Neu ist weiches, tiefes Gluckern beim Ablösen der Blasen und gelegentlich
  beim Teilen/Vereinen: 8 Varianten, höchstens 2 gleichzeitig, mindestens 2–4 s Pause je Quelle, starke Entfernungsdämpfung.
  Vorrang der Stimmen: nahe Insekten/Brummer, dann Blasen, dann Fernes.
- **Tests:** 114 (vorher 100). Neu: Beschriftung flach mit Normale nach oben und richtig orientiert, Brett plus Rahmen passt mit
  Abstand, Blasenquellen und -bahnen nie in der Spielfläche oder in Kopfnähe, Bodenkontakt von Steinen und Quellen, Himmel als eine
  Geometrie ohne Azimut-Naht, Brummer-Landungen, Gluckervarianten, weniger Rauschen. Die alten Tests zur gekippten Beschriftung und
  zur weißen Kontur sind entfernt.

## 0.5.0 – Greif-Säule, ruhige Kontur, Erde & Moos, Alien-Flora, dichte Geräuschkulisse

- **Greifen ohne Bücken:** Hand irgendwo über der eigenen Figur (bis 2 m Höhe) → greifbar, mit Sporenfaden zur Figur. Greifen lässt sie in
  150 ms in die Hand fliegen, Ablegen zählt das Feld unter der Hand. Optional gibt es den **Greifstrahl** für Sitzmodus bzw. eingeschränkte Beweglichkeit (Einstellung).
- **Kontur ruhig:** MSAA immer an (auch auf der Quest), Kantenbreite mindestens ~1,5 px, weicher Fresnel auf Distanz, weniger scharfe Glanzlichter.
- **Bodenfarben:** Lichtung aus warm-brauner Erde (Humus, Nadeln, Blättchen, Steinchen), Umgebung in vielen Grüntönen, Moos wächst
  unregelmäßig in die Erde.
- **Alien-Flora:** Blasenpflanzen, Tentakel, Fächer, Korallen, Riesenblätter, Sporenkapsel-Pflanzen, Bodenbüschel, Etagen-, Spiral- und
  Gallertpilze, hängende Leuchtfäden. Jede Senkenseite hat ihren eigenen Farbschwerpunkt, dazu Wiegen, Pulsieren und Winden. 3 LOD-Stufen mit gedithertem Crossfade.
- **Geräuschkulisse:** viel mehr Insekten-Vorbeiflüge (0,5–3 s, bis 8 gleichzeitig) mit Doppler, 22 Insektenklänge, dazu Pflanzen-Blubbern,
  Rascheln, Tropfen, Pilz-Summen, Windböen und ferne Alien-Rufe. Neue getrennte Regler: **Spiel-Sounds**, **Umgebung**, **Tiere / Insekten**.
- **Performance:** Figuren und Schalen-Minis gebündelt (bis zu 20 Draw Calls gespart).
- **Tests:** 100 (vorher 87). Neu: Greif-Säule (Höhen, Nachbarfeld, Hysterese), Ablegen nach horizontaler Position, Fuß nie unter 0,
  neue Pflanzen auf dem Boden, nichts über Knöchelhöhe am Rand der Spielfläche, LOD-Überblendung, Vorbeiflug-Bahn und -Intervalle, Doppler, Stimmen-Priorität.


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
