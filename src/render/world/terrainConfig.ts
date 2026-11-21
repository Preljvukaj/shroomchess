/**
 * Zentrale Parameter der Senke (`terrain.*`). Alle Gelände-, Vegetations- und Insekten-Positionen
 * leiten sich aus der Höhenfunktion ab, die diese Werte nutzt – es gibt keine festen y-Werte.
 */
export const terrain = {
  /** Mittlere Wallhöhe in m (wird je Richtung leicht variiert, begrenzt auf 1,2–1,8 m). */
  basinHeight: 1.5,
  /** Gewünschte horizontale Hangbreite in m. Wird automatisch verbreitert, falls sonst `maxSlopeDeg` überschritten würde. */
  basinSlopeWidth: 5,
  /** Übergang zwischen Spielflächen-Umrandung (Boundary) und Hangfuß in m (je Richtung 0,85–1,15 × Wert). */
  transition: 1.0,
  /** Höchste erlaubte Hangsteigung in Grad (inkl. Unebenheiten bleibt sie unter 25°). */
  maxSlopeDeg: 21,
  /** Breite des weichen Übergangs von der Moos-Lichtung zum Waldboden in m. */
  clearingFade: 0.3,
  minHeight: 1.2,
  maxHeight: 1.8,
};
