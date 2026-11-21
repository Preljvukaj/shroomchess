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

/**
 * Greif-Säule (Greifen ohne Bücken): Über jeder Figur steht eine unsichtbare senkrechte Säule.
 * Ist die Hand horizontal klar über der Figur (Radius 38 % der Feldbreite), ist sie greifbar –
 * in jeder Höhe zwischen Griffpunkt und 2,0 m. Austritt erst bei +20 % Radius (Hysterese).
 */
export const columnConfig = {
  /** Säulenradius relativ zur Feldbreite (< 0,5 → Säulen benachbarter Felder überschneiden sich nie). */
  radiusFactor: 0.38,
  /** Austritt erst bei Radius × exitFactor. */
  exitFactor: 1.2,
  /** Obergrenze der Säule über dem Boden (m). */
  maxHeight: 2.0,
  /** Unterhalb des Griffpunkts gilt die Säule noch so weit (m) – darunter übernimmt das Nah-Greifen. */
  belowGrip: 0.05,
  /** Snap aus der Säule: Figur fliegt in dieser Zeit (ease-out) nach oben in die Hand (s). */
  snapSeconds: 0.15,
  /** Ablegen: Figur gleitet in dieser Zeit senkrecht aufs Feld (s). */
  dropSeconds: 0.18,
  /** Wechsel zu einer anderen Säule nur, wenn sie horizontal um diesen Anteil des Radius näher ist. */
  switchMargin: 0.25,
};

export interface ColumnCandidate<T> {
  item: T;
  /** Mittelpunkt der Figur (Welt, horizontal) */
  x: number;
  z: number;
  /** Höhe des Griffpunkts (Welt) */
  gripY: number;
}

function inColumn(hand: { x: number; y: number; z: number }, c: { x: number; z: number; gripY: number }, radius: number, cfg: typeof columnConfig): number | null {
  const d = Math.hypot(hand.x - c.x, hand.z - c.z);
  if (d >= radius) return null;
  if (hand.y < c.gripY - cfg.belowGrip || hand.y > cfg.maxHeight) return null;
  return d;
}

/** Säulen-Ziel einer Hand mit Hysterese. `squareWorld` = Feldbreite in m. */
export function pickColumnTarget<T>(
  cands: ColumnCandidate<T>[],
  current: T | null,
  hand: { x: number; y: number; z: number },
  squareWorld: number,
  cfg = columnConfig,
): T | null {
  const r = cfg.radiusFactor * squareWorld;
  let best: ColumnCandidate<T> | null = null;
  let bestD = Infinity;
  for (const c of cands) {
    const d = inColumn(hand, c, r, cfg);
    if (d !== null && d < bestD) {
      bestD = d;
      best = c;
    }
  }
  const cur = current !== null ? cands.find((c) => c.item === current) : undefined;
  if (cur) {
    const dc = inColumn(hand, cur, r * cfg.exitFactor, cfg);
    if (dc !== null) {
      if (best && best.item !== current && bestD < dc - cfg.switchMargin * r) return best.item;
      return current;
    }
  }
  return best ? best.item : null;
}

/** Höhe der getragenen Figur (Brett-lokal): hängt am Griffpunkt, Fuß nie unter der Brettoberfläche. */
export function heldFootY(handY: number, gripOffsetY: number): number {
  return Math.max(0, handY - gripOffsetY);
}

/** Ablegen: zählt nur die horizontale Handposition (Brett-lokal), die Höhe ist egal. */
export function dropSquareAt<S>(handLocal: { x: number; y: number; z: number }, squareAtFn: (x: number, z: number) => S): S {
  return squareAtFn(handLocal.x, handLocal.z);
}
