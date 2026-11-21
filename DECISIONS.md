# Entscheidungen

Wo die Spezifikation Spielraum lässt, steht hier, was gewählt wurde und warum.

## Technik

**D1 – Three.js 0.187, TypeScript, Vite 8, Vitest.** Wie vorgegeben. Vitest teilt sich die Vite-Konfiguration, und
die reine Mathematik (`xr/math`) läuft ohne DOM in Node.

**D2 – chess.js 1.4 als einzige Regelquelle.** `ChessGame` ergänzt nur, was chess.js nicht kennt: Aufgabe,
Zeitüberschreitung, Remis durch Einigung, Ereignisse und die FEN-Zeitleiste fürs Analysebrett.
Bei Zeitüberschreitung gibt es Remis, wenn der Gegner kein Mattmaterial mehr hat (FIDE 6.9). Die Prüfung ist bewusst einfach:
nur König bzw. König + eine Leichtfigur zählt als „kann nicht mattsetzen“.

**D3 – Stockfish 19 *Lite, Single-Thread* (WASM, ~1,8 MB).** Die volle Engine wiegt ~100 MB und würde das Ladeziel
(< 10 s) sprengen. Die Multi-Thread-Variante bräuchte `SharedArrayBuffer`, also COOP/COEP-Header. Die würden auf
vielen Hostern das Deployment erschweren und könnten später WebRTC/Lichess-Popups stören. Lite ist für Menschen immer noch
übermenschlich stark. Stufen 1–8 regeln „Skill Level“ (0–20) plus Zeit-/Tiefenlimit.
**Lizenz:** Stockfish steht unter GPL-3.0. Wer die App mit der Engine verbreitet, muss die GPL-Pflichten erfüllen
(Quellcode-Angebot). Die Engine ist ein separates Worker-Script und wird nicht in das Bundle gelinkt. Die Projektlizenz
ist noch offen (`UNLICENSED`) und muss vor einer Veröffentlichung entschieden werden.

**D4 – Keine Asset-Dateien in M1: Figuren, Welt und Sound sind prozedural.** Die Spezifikation nennt glTF/Draco/KTX2.
Für Meilenstein 1 habe ich alles prozedural erzeugt:
- Staunton-Figuren als Drehkörper (`LatheGeometry`) aus Profilkurven, Springerkopf als abgeschrägte Extrusion.
  Die Proportionen folgen dem klassischen Satz (K 1,00 · D 0,89 · L 0,74 · S 0,63 · T 0,60 · B 0,53).
- Texturen für Mond-/Basaltstein und Glyphen werden zur Laufzeit auf Canvas gezeichnet.
- Ambient und Effekte kommen aus Web Audio.

Vorteile: Ladezeit fast nur JS (~240 kB gzip) plus Engine, keine Lizenzfragen bei Assets, beliebig skalierbar, und
die Detailstufe (Segmente) ist direkt an die Qualitätsstufe gekoppelt. Die Pipeline für glTF+Meshopt/KTX2 (`GLTFLoader`
+ `MeshoptDecoder` + `KTX2Loader`) bleibt der Plan, sobald handmodellierte Figuren oder Pflanzen dazukommen.
Der Austausch betrifft nur `render/pieces.ts` bzw. die Geometrie-Fabriken in `world/vegetation.ts`.

**D5 – Licht: genau zwei Echtzeitlichter (Hemisphäre + gerichtetes Mondlicht), keine Schattenkarten.** Glanz kommt über eine
kleine, einmal per PMREM gebackene Umgebungs-Map aus leuchtenden Farbflecken. Kontaktschatten/Lichtschein unter dem
Brett sind ein vorgefertigter Shader-Quad. Leuchten ist ausschließlich emissiv (Shader), es gibt keine Punktlichter.

**D6 – Bloom nur auf dem Desktop bei Qualität „Hoch“.** Post-Processing in WebXR kostet auf der Quest zu viel und
ist mit Multiview nicht sauber stereo-korrekt. Die Leuchtmaterialien sind so abgestimmt, dass sie auch ohne Bloom wirken.

**D7 – Qualitätsstufen.** Automatisch: Standalone-Brillen (Quest/Pico/Wolvic) → `low`, sonst `high`. Auf einer
Standalone-Brille wird eine manuelle Wahl „hoch“ auf „mittel“ begrenzt (Spezifikation: Quest nur Low/Medium).
Eine Änderung braucht ein Neuladen. Die laufende Partie wird dabei über `sessionStorage` gerettet und fortgesetzt.

## Spielgefühl und Darstellung

**D8 – Maßstab: König = 2,2 × Feldgröße.** Bei 0,5-m-Feldern ist der König 1,1 m hoch (Vorgabe: 1,0–1,2 m).
Derselbe Faktor gilt in jeder Brettgröße, also auch im Tischmodus. Der Desktop nutzt fest 0,5-m-Felder.

**D9 – Automatische Feldgröße auf 0,6 m gedeckelt.** In großen Räumen würde sonst das größte Quadrat gewählt
(z. B. 7 m Kante → 0,875-m-Felder und ein fast 2 m großer König). 0,6 m ist die Obergrenze der empfohlenen Spanne.
Kleiner stellen kann man immer, größer als die Boundary nie.

**D10 – Tischmodus-Feldgröße 6 cm.** Das entspricht einem großen Turnierbrett (König ≈ 13 cm). Die Spezifikation legt nur
fest, *wann* in den Tischmodus gewechselt wird (< 0,2 m), nicht wie groß das Brett dann ist.

**D11 – Griffpunkt-Logik ist eingabeunabhängig.** Maus und VR liefern abstrakte „Zeiger“ (Strahl oder Punkt).
Die Schwellen 30 cm (nah) und 8 cm (greifbar) gelten in Metern für beide. Beim Strahl zählt der kürzeste Abstand
Strahl ↔ Griffpunkt. Ein Griffpunkt direkt unter dem Mauszeiger hat Vorrang vor einer getroffenen Figur. Das war
nötig, weil sonst z. B. der König die Spitze des Bauern davor verdeckt (im Test gefunden).

**D12 – Markierungen codieren die Zugart über Form *und* Farbe** (Scheibe = normal, Ring mit Eckzacken = Schlagen,
Doppelring = Rochade, Ring mit Punkt = en passant). Die Farbenblind-Palette nutzt Okabe-Ito. So ist die Information
auch ohne Farbwahrnehmung lesbar.

**D13 – Pilzschale steht rechts neben dem schlagenden Spieler**, außerhalb des Brettrahmens. Sie ist klein und flach.
In VR liegt sie innerhalb der Spielfläche, aber im 0,5-m-Randstreifen. Sie ist rein virtuell und kein Stolperobjekt, mit dem man interagieren
muss.

**D14 – Desktop-Klick-Ereignisse werden gepuffert.** Die Interaktion fragt Zeiger pro Frame ab. Bei niedriger Framerate
würden schnelle Klicks oder Drags sonst verloren gehen (im Headless-Test bei ~20 FPS beobachtet). Jedes
`pointerdown`/`pointerup` wird mit seinem eigenen Strahl nachverarbeitet.

**D15 – Remis-Angebot gegen Stockfish wird abgelehnt** (M1). Hot-Seat fragt den Gegner per Dialog.
Eine bewertungsbasierte Annahme kann später kommen.

## Roomscale und Co-Location (Mathematik schon in M1, Einsatz ab M2/M4)

**D16 – Brettgröße: größtes einbeschriebenes, beliebig gedrehtes Quadrat mit Sicherheitsabstand.** Exakter
Strecke↔Quadrat-Abstand und Bisektion über die halbe Kantenlänge, Grobraster über Mittelpunkt und Drehung
(5°-Schritte plus Richtungen langer Boundary-Kanten), danach Pattern Search. Das funktioniert auch bei nicht-konvexen
(L-förmigen) Boundaries. Rechenzeit einmalig im Bereich von Millisekunden bis einer Zehntelsekunde.

**D17 – Rücken an Rücken: Jeder Spieler schaut beim Kalibrieren zu *seiner eigenen* Grundreihe.** Die Spezifikation
sagt „Richtung Weiß→Schwarz (oder umgekehrt)“. Gewählt habe ich: Nach dem Erfassen geht jeder geradeaus zu seiner
Seite und dreht sich um. Das ist am intuitivsten, und niemand muss am anderen vorbei. Formel: `boardYaw = hostYaw + π`
(Host spielt Weiß) bzw. `= hostYaw` (Host spielt Schwarz).

**D18 – Brettmittelpunkt kommt aus der Boundary, nicht aus der Kalibrierung.** Die Spezifikation verlangt
einerseits „Mittelpunkt zwischen beiden Spielern = Brettmitte“ und andererseits „größtes Quadrat in der Boundary“.
Beides gilt nur zugleich, wenn die Spieler exakt in der Mitte der Fläche stehen. Vorrang hat die
**Sicherheit**: Das Brett liegt dort, wo es garantiert mit 0,5 m Abstand passt. Der Kalibrierungs-Mittelpunkt dient
(a) als Brettmitte, wenn keine Boundary verfügbar ist (`local-floor` + manuelle Einrichtung), und
(b) als Plausibilitätsprüfung: Weicht er mehr als 0,5 m von der berechneten Mitte ab, weist das Spiel darauf hin.
Die Drehung wird unter den vier gleichwertigen 90°-Lagen des Quadrats passend zu D17 gewählt (`alignYaw`).

**D19 – Gemeinsamer Referenzraum = Raum des Hosts.** Der Gast rechnet alles (Boundary, Brett-Pose, eigene Posen
fürs Netz) über `solveGuestToHost`/`invertRigid` um. Nur 2D (Yaw + Bodenverschiebung): `local-floor` garantiert
schon einen gemeinsamen Boden (y = 0) und senkrechte Y-Achse.

## Lichess

Siehe `docs/LICHESS_FEASIBILITY.md`. Kurzfassung: OAuth-PKCE ohne Backend, Board API und CORS sind machbar.
Der PGN-Export (`/api/import`, anonym) ist schon in M1 eingebaut.

## Änderungsrunde 2 (Landingpage, Pilze, Senke, Koordinaten, Insekten)

**D20 – Koordinaten als SDF-Text mit troika-three-text (`BatchedText`), Schrift Inter Bold lokal gebündelt.**
troika erzeugt die SDF-Glyphen zur Laufzeit im Worker aus der WOFF-Datei. Sie bleiben in jeder Entfernung scharf, es gibt keine
vorab erzeugten Atlanten und keinen Font-CDN (die Schrift kommt aus `@fontsource/inter`). Mit `BatchedText` laufen alle 32
Randglyphen in **2 Draw Calls** (Füllung + Kontur). Mit einzelnen `Text`-Objekten wären es 32 bis 64.
Zeichenhöhe S/M/L = 38/46/55 % der Feldbreite. Die Glyphen sind um 25° zum Spieler geneigt und liegen auf einem dunklen
Plättchen. Kontrast ≥ 13:1, im Hochkontrastmodus ≈ 16:1. Die Textfarbe liegt unter der Bloom-Schwelle (diese wurde dafür von 0,72
auf 0,85 angehoben), so verschmiert der Bloom die Kanten nicht. Der Moosring ist dafür auf 0,8 Feldbreiten verbreitert.
Jeder Spieler liest „seine“ Seite: die Linien an der eigenen Grundreihe, die Reihen an der eigenen linken Kante.

**D21 – Landingpage ohne Three.js, Spielszene per dynamischem Import.** Der Hintergrund ist eine Canvas-2D-Animation
(Pilz-Silhouetten mit Lamellenschein, Sporen, ≤ 30 FPS, Pause im Hintergrund-Tab). Bei `prefers-reduced-motion` oder schwachen
Geräten gibt es nur ein Standbild. Eine Three.js-Szene hätte die Startseite von ~13 kB auf ~300 kB (gzip) aufgebläht.
Die Spielszene (`game.ts`) wird erst nach „Spielen“ geladen.

**D22 – Nicht fertige Modi bleiben sichtbar, sind aber gesperrt.** Co-Location (M4), Online per Link (M3) und VR-Spiel (M2)
erscheinen auf der Landingpage mit „folgt in Meilenstein X“. Raumcode, Beitrittslink und `?room=`-Routing funktionieren schon,
der Start-Button erklärt, warum er gesperrt ist. „In VR starten“ hängt an `VR_GAMEPLAY_AVAILABLE` (heute `false`)
**und** an `isSessionSupported('immersive-vr')`. So zeigt die Seite nichts an, was dann nicht funktioniert.

**D23 – Lichess-Partien schon jetzt spielbar (vorgezogen aus M5).** Die Landingpage verlangt Login und die Lichess-Optionen. Ohne
Spielmöglichkeit wären sie tote Knöpfe. Umgesetzt sind:
- OAuth-PKCE (`lichess/auth.ts`)
- serialisierte API-Warteschlange mit 429-Backoff (`api.ts`)
- Board-API-Adapter (`boardSource.ts`). Lichess ist autoritativ: Eigene Züge werden optimistisch gezeigt und bei Abweichung aus
  dem Stream neu aufgebaut. Die lokale Uhr wird nur synchronisiert, Engine und Analysebrett sind bis Partieende gesperrt.

Angeboten werden nur die laut Machbarkeitsanalyse möglichen Optionen. Bei Herausforderungen werden Bullet-Zeitkontrollen
ausgegraut (Board-API-Regel).

**D24 – Senke: Gelände als reine Funktion `heightAt(x, z)` mit harter Flachgarantie.** Bis 0,5 m außerhalb der Boundary
gibt sie exakt `0` zurück, unabhängig vom Rauschen. Der Wallbeginn variiert zwischen 0,5 und 1,0 m, die Höhe zwischen 2,5 und 4 m,
die Breite zwischen 3 und 6 m (skaliert mit der Flächengröße). Unit-Tests prüfen Funktion **und** Render-Gitter für quadratische, kleine, große,
gedrehte und L-förmige Flächen. Desktop nutzt eine virtuelle Fläche „Brett + 2,5 m“, damit die Kamera nie im Wall steht
(Orbit-Abstand und Ego-Modus sind entsprechend begrenzt).

**D25 – Pilze: statische LOD statt Distanz-Sortierung pro Frame.** In Roomscale verlässt der Spieler die flache Fläche nicht.
Deshalb hängt die Detailstufe am Abstand zur Fläche, nicht an der Kamera:
- Wall/Rand: volle Geometrie mit Lamellen
- hinter dem Wall: Fern-LOD mit leuchtender Lamellen-Scheibe im Shader
- weit weg: Billboards

Das spart das CPU-Umsortieren pro Frame. Baby-Pilze nutzen ebenfalls die Fern-Geometrie (Lamellen wären bei 5–20 cm unsichtbar).
Der Wall verdeckt alles Ferne, deshalb gibt es dort nur grobe Geometrie. 8 Arten × 2 LOD = höchstens 16 Draw Calls.

**D26 – Riesenpilze bilden nur ein *teilweises* Dach.** Bei stärkerer Neigung war der Himmel zugedeckt (im Test gesehen).
Mit Neigung 0,12–0,27 und Höhe 3–6,8 m bleibt der Blick nach oben frei.

**D27 – Griffpunkte gebündelt (`GripBatch`).** 32 Kugeln + 32 Halos als Einzel-Meshes kosteten 64 Draw Calls. Jetzt sind es
2 instanzierte Meshes. Die Anker bleiben als `Object3D` in den Figuren, die Interaktion ist unverändert.

**D28 – Insekten: CPU-Verhalten + Instancing, Kopf-Sperrzone als harte Regel am Ende jedes Schritts.**
Die Reihenfolge der Regeln ist Boden → Brettraum → **Kopf (≥ 0,6 m)**. Die Kopfregel gewinnt also im Zweifel. Davor gibt es eine weiche
Ausweichzone (1,3 m) und einen Sichtkegel, aus dem Insekten seitlich hinausgedrängt werden. Über dem Brett dürfen nur
Glühwürmchen fliegen, und nur oberhalb Königshöhe + 0,6 m. Das Landen auf der Hand gibt es nur, wenn die Hand ≥ 0,65 m vom
Kopf entfernt 2 s still gehalten wird (sonst kollidiert es mit der Kopfregel). Das ist VR-only und erst ab M2 testbar.
Ton: eigener Bus „Tiere / Umgebung“, Pool aus 5 HRTF-Pannern, höchstens 3 Insektengeräusche gleichzeitig, Vorbeiflug alle
5–20 s, Pegel deutlich unter den Spielgeräuschen. Der Schalter „Insekten aus“ blendet Insekten und ihre Geräusche komplett aus.

**D29 – Performance gemessen im Headless-Firefox (Draw Calls/Dreiecke), nicht auf der Quest.** Eine Quest oder der
Immersive Web Emulator standen in dieser Umgebung nicht zur Verfügung. FPS aus dem Software-Rendering wären nicht aussagekräftig.
Messung nach den Änderungen (Desktop-Ansicht, 1400×850):

| Stufe | Draw Calls | Dreiecke | Ziel Quest |
|---|---|---|---|
| Low | 75 | 148k | ≤ 100 / 300–500k ✅ |
| Medium | 75 | 321k | ≤ 100 / 300–500k ✅ |
| High (nur Desktop) | 89 | 922k | – |

Bei Problemen auf der Brille in dieser Reihenfolge reduzieren: Insekten (`insects`) → Pilzdetail
(`shroomDetail`/`nearShrooms`) → Bloom (auf der Quest ohnehin aus).
