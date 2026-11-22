# Testanleitung: zwei Brillen im selben Raum

> Stand Meilenstein 4: Co-Location ist umgesetzt. Die Mathematik ist per Unit-Test abgesichert (`tests/calibration.test.ts`),
> der komplette Ablauf mit zwei emulierten Brillen per Simulation (`scripts/sim/coloc-sim.mjs`, siehe unten). Ein Test mit zwei
> echten Brillen steht noch aus – bitte nach dieser Anleitung durchführen und das Protokoll ausfüllen.

## Vorbereitung

- Zwei Quest-Brillen (2/3/3S/Pro), aktuelle Firmware, Meta Quest Browser.
- Raum mit mindestens ca. 3 × 3 m freier Fläche, ohne Stolperfallen. Gutes, gleichmäßiges Licht (Tracking).
- Auf **beiden** Brillen dieselbe Spielfläche (Guardian/Boundary) einrichten, ungefähr deckungsgleich. Maßgeblich ist die
  Boundary des Hosts. Die Boundary des Gastes dient nur seinem eigenen System-Guardian.
- PC im selben WLAN: `npm run dev` startet Seite **und** Signaling-Server. Auf beiden Brillen `https://<PC-IP>:5173`
  öffnen und das Zertifikat bestätigen. (Alternativ die deployte Seite, wenn dort ein Signaling-Server läuft – README.)
- Beide Brillen im selben WLAN-Segment (keine Client-Isolation), damit die Verbindung direkt per P2P läuft (niedrige
  Latenz, Posen mit 30 Hz). Die Steintafel zeigt „Gleicher Raum · P2P · xx ms“; bei „Relay“ läuft alles über den Server.
- Eine dritte Person als Aufsicht ist für die ersten Tests dringend empfohlen.

## Ablauf

1. **Host** (Brille A): Startseite → „Zwei Brillen im selben Raum“ → „Erstellen“ (Farbe/Zeit wählen) → „In VR starten“.
   Die Tafel vor ihm zeigt „Warte auf die zweite Brille … Raumcode XXXXX“.
2. **Gast** (Brille B): Startseite → „Beitreten“ → Raumcode eingeben (oder den QR-Code von der Startseite des Hosts scannen)
   → „In VR starten“.
3. Beide sehen die Anleitung (Text + Animation zweier Figuren Rücken an Rücken).
4. **Rücken an Rücken** in der Mitte der Spielfläche, Fersen auf einer Linie, geradeaus schauen.
5. Beide halten gleichzeitig Trigger bzw. Pinch für 2 s (Fortschritt in %) → Countdown 3 s → Erfassung 0,5 s. Nicht bewegen.
6. „Kalibriert!“ – jeder geht geradeaus zu seiner Grundreihe (Ring am Boden) und dreht sich um.
7. **Abklatschen** (nach ~9 s automatisch, sonst Menü → „Abklatsch-Check“): Controller oder Hand berühren. Bei > 5 cm
   Abweichung erscheinen „Passt so“ / „Feinjustieren“ / „Neu kalibrieren“. Feinjustieren (nur Gast): linker Stick
   verschiebt, rechter Stick dreht; A/X oder „Fertig“ beendet.

## Prüfliste

| # | Prüfung | Erwartung |
|---|---|---|
| 1 | Brett liegt bei beiden an derselben realen Stelle | Eine Ecke mit dem Controller antippen. Die andere Person sieht den Controller an derselben Brettecke (< 5 cm). |
| 2 | Avatar-Deckung | Kopf-Avatar des anderen deckt sich mit seinem echten Kopf (durch Passthrough oder Abnehmen prüfen). |
| 3 | Abklatschen | Virtuelle Hände treffen sich (< 5 cm). Sonst Feinjustierung (Thumbstick) testen. |
| 4 | Annäherungswarnung | Unter 1 m leuchtet der Avatar stärker, unter 0,5 m Warnton und Untertitel. |
| 5 | Boundary-Warnung | Unter 0,4 m zur Host-Boundary erscheint das Rankengitter, bei **beiden** Spielern korrekt verortet. |
| 6 | Drift | Nach 10 min Spiel eine Ecke erneut antippen (Abweichung notieren). |
| 7 | Recenter | Auf einer Brille die Meta-Taste lang drücken (Neuzentrieren) → Aufforderung zur Neukalibrierung erscheint. |
| 8 | Tracking-Verlust | Eine Brille kurz abdecken → nach Rückkehr Hinweis/Neukalibrierung. |
| 9 | Zug synchron | Figur greifen: Der andere sieht sie in der Hand des Spielers wandern, Zug erscheint bei beiden. |
| 10 | Reconnect | WLAN auf dem Gast kurz trennen → mit derselben Session wieder beitreten, Stellung und Uhr stimmen. |

## Protokoll

Pro Testlauf festhalten: Brillenmodelle, Raumgröße, berechnete Feldgröße, Abweichung bei Tests 1/3/6 in cm,
eingestellter Rücken-an-Rücken-Abstand (Standard 0,30 m), Auffälligkeiten.

## Ohne zweite Brille testen

- **Immersive Web Emulator** (Browser-Erweiterung von Meta) in zwei Browserprofilen. Ein Profil ist Host, eines Gast.
  Kopf- und Controllerposen lassen sich in der Erweiterung setzen, um Rücken-an-Rücken nachzustellen.
- **Automatische Simulation** (`scripts/sim/coloc-sim.mjs`): zwei Firefox-Instanzen mit IWER (Stereo), das
  Koordinatensystem des Gastes ist absichtlich um 46° gedreht und 2,2 m verschoben. Beide stehen Rücken an Rücken,
  halten den Trigger, kalibrieren; danach geht der Gast an eine bekannte reale Stelle. Geprüft wird, dass der Avatar des
  Gastes beim Host genau dort steht (und umgekehrt) und beide Bretter deckungsgleich liegen.

  ```bash
  npm run build && (cd dist && python3 -m http.server 8765) &
  node server/index.js &
  node scripts/sim/coloc-sim.mjs            # braucht puppeteer-core + Firefox
  ```

  Letzter Lauf: Avatar-Abweichung 0,01 cm, Brett 0 cm / 0°.
- **Hinweis zur Kopfposition:** Die XR-Kamera von three.js liegt auf dem linken Auge. Für die Kalibrierung wird die Mitte
  zwischen beiden Augen verwendet – sonst addieren sich Rücken an Rücken zweimal ~3 cm Fehler (DECISIONS.md D67).
