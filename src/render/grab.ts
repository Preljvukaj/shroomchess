/**
 * Greif-Logik (rein, testbar): Hysterese für den Zustand „greifbar“ und die Snap-Animation,
 * mit der die Figur beim Greifen in die Hand schnappt.
 */
export const grabConfig = {
  /** „greifbar“ beginnt unter diesem Abstand Hand ↔ Griffpunkt (m) … */
  enter: 0.1,
  /** … und endet erst über diesem (gegen Flackern). */
  exit: 0.14,
  /** Ab hier leuchtet der Griffpunkt an (Annäherung). */
  near: 0.3,
  /** Dauer des Einschnappens in die Hand (s), ease-out. */
  snapSeconds: 0.1,
  /** Eine andere Figur übernimmt die Markierung nur, wenn sie um so viel näher ist (m). */
  switchMargin: 0.02,
};

/**
 * Wählt die greifbare Figur eines Zeigers mit Hysterese.
 * `current` = bisher greifbare Figur (oder null), `dist(x)` = Abstand zum Griffpunkt.
 * Es gewinnt die nächste Figur; die aktuelle bleibt bis `exit`, solange keine andere deutlich näher ist.
 */
export function pickGrabTarget<T>(
  candidates: T[],
  current: T | null,
  dist: (t: T) => number,
  scale = 1,
  cfg = grabConfig,
): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = dist(c);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  const enter = cfg.enter * scale;
  const exit = cfg.exit * scale;
  if (current !== null && candidates.includes(current)) {
    const dc = dist(current);
    if (dc <= exit) {
      if (best !== null && best !== current && bestD < enter && bestD < dc - cfg.switchMargin * scale) return best;
      return current;
    }
  }
  return bestD < enter ? best : null;
}

/** Ease-out (kubisch) für den Snap: 0 → 1 in `snapSeconds`. */
export function snapProgress(elapsed: number, cfg = grabConfig): number {
  const k = Math.min(1, Math.max(0, elapsed / cfg.snapSeconds));
  return 1 - Math.pow(1 - k, 3);
}

/** Restversatz Griffpunkt ↔ Hand während des Snaps (danach exakt 0, kein Nachschwingen). */
export function snapOffset(start: { x: number; y: number; z: number }, elapsed: number, cfg = grabConfig): { x: number; y: number; z: number } {
  const r = 1 - snapProgress(elapsed, cfg);
  return { x: start.x * r, y: start.y * r, z: start.z * r };
}
