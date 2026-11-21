# Changelog

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
