# Testanleitung: zwei Brillen im selben Raum

> **Entwurf.** Die Co-Location kommt in Meilenstein 4. Diese Anleitung beschreibt den geplanten Testablauf, damit
> Hardware und Raum vorbereitet werden können. Die Kalibrierungs-Mathematik ist schon per Unit-Test abgesichert
> (`tests/calibration.test.ts`).

## Vorbereitung

- Zwei Quest-Brillen (2/3/3S/Pro), aktuelle Firmware, Meta Quest Browser.
- Raum mit mindestens ca. 3 × 3 m freier Fläche, ohne Stolperfallen. Gutes, gleichmäßiges Licht (Tracking).
- Auf **beiden** Brillen dieselbe Spielfläche (Guardian/Boundary) einrichten, ungefähr deckungsgleich. Maßgeblich ist die
  Boundary des Hosts. Die Boundary des Gastes dient nur seinem eigenen System-Guardian.
- PC im selben WLAN: `npm run dev` (Seite) und ab M3 `npm run server` (Signaling). Auf beiden Brillen
  `https://<PC-IP>:5173` öffnen und das Zertifikat bestätigen.
- Eine dritte Person als Aufsicht ist für die ersten Tests dringend empfohlen.

## Ablauf

1. **Host** (Brille A): Startseite → „Zwei Brillen im selben Raum“ → Lobby erstellen. Raumcode notieren.
2. **Gast** (Brille B): Startseite → Raumcode eingeben (oder QR-Code am Desktop scannen).
3. Beide: „In VR starten“. Der Host sieht Brett und Boundary. Der Gast sieht zunächst nur die Anleitung.
4. **Rücken an Rücken** in der Mitte der Spielfläche, Fersen auf einer Linie, geradeaus schauen.
5. Beide halten gleichzeitig Trigger bzw. Pinch für 2 s → Countdown 3 s → Erfassung. Nicht bewegen.
6. Jeder geht geradeaus zu seiner Grundreihe und dreht sich um (siehe DECISIONS.md D17).
7. **Abklatschen**: Beide strecken einen Controller aus und berühren sich. Die virtuellen Hände/Controller sollen
   sich höchstens wenige Zentimeter verfehlen.

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
- Geplant für M4: `?debug=coloc` simuliert beide Spieler in einem Tab mit zufällig versetzten Koordinatensystemen
  und zeigt die Abweichung live an.
