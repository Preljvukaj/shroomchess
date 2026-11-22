/**
 * Langsame, gut verfolgbare Animation gegnerischer Züge (KI, Lichess, Online ohne Live-Pose).
 * Reine Zeitplanung (testbar); abgespielt in BoardScene.
 *
 * Ablauf je Figur: Vorwarnung (Griffpunkt leuchtet in der Figurenfarbe) → Anheben → sanfter Bogen zum Ziel
 * (Dauer nach Entfernung, Ease-in-out) → weiches Aufsetzen mit Sporen-Staub.
 * Schlagen: Die geschlagene Figur löst sich erst auf, wenn der Angreifer über ihr ist (Beginn des Aufsetzens),
 * dann gemächlich. En passant: Auflösen erst nach dem Aufsetzen (eigener Schritt, da anderes Feld).
 * Rochade: erst der König komplett, dann der Turm. Umwandlung: nach dem Aufsetzen eigener Schritt.
 */

export type AnimSpeed = 'slow' | 'normal' | 'fast';
export const SPEED_FACTOR: Record<AnimSpeed, number> = { slow: 1, normal: 0.6, fast: 0.3 };

export type StepKind = 'glow' | 'lift' | 'glide' | 'land' | 'dissolve' | 'promote';
export type StepActor = 'mover' | 'rook' | 'victim';

export interface AnimStep {
  kind: StepKind;
  actor: StepActor;
  start: number;
  dur: number;
}

export interface AnimMove {
  from: string;
  to: string;
  captured?: string;
  capturedSquare?: string;
  rookMove?: { from: string; to: string };
  promotion?: string;
}

/** Felddistanz (Chebyshev-ähnlich, euklidisch in Feldern). */
export function squareDistance(a: string, b: string): number {
  const fx = a.charCodeAt(0) - b.charCodeAt(0);
  const fy = Number(a[1]) - Number(b[1]);
  return Math.hypot(fx, fy);
}

/** Basisdauern bei „Langsam“ (Sekunden). */
export const BASE = { glow: 0.4, lift: 0.4, glideMin: 0.8, glideMax: 1.2, land: 0.3, dissolve: 1.1, promote: 0.5 };

export function opponentTimeline(m: AnimMove, speed: AnimSpeed): { steps: AnimStep[]; total: number } {
  const f = SPEED_FACTOR[speed];
  const steps: AnimStep[] = [];
  let t = 0;
  const piece = (actor: StepActor, from: string, to: string, glow: boolean) => {
    if (glow) {
      steps.push({ kind: 'glow', actor, start: t, dur: BASE.glow * f });
      t += BASE.glow * f;
    }
    steps.push({ kind: 'lift', actor, start: t, dur: BASE.lift * f });
    t += BASE.lift * f;
    const d = Math.min(1, Math.max(0, (squareDistance(from, to) - 1) / 6));
    const glide = (BASE.glideMin + (BASE.glideMax - BASE.glideMin) * d) * f;
    steps.push({ kind: 'glide', actor, start: t, dur: glide });
    t += glide;
    const landStart = t;
    steps.push({ kind: 'land', actor, start: t, dur: BASE.land * f });
    t += BASE.land * f;
    return landStart;
  };
  const landStart = piece('mover', m.from, m.to, true);
  if (m.captured && m.capturedSquare) {
    const enPassant = m.capturedSquare !== m.to;
    // normaler Schlag: Angreifer schwebt über dem Opfer → Auflösen beginnt mit dem Aufsetzen
    steps.push({ kind: 'dissolve', actor: 'victim', start: enPassant ? t : landStart, dur: BASE.dissolve * f });
    if (enPassant) t += BASE.dissolve * f;
  }
  if (m.rookMove) piece('rook', m.rookMove.from, m.rookMove.to, true);
  if (m.promotion) {
    steps.push({ kind: 'promote', actor: 'mover', start: t, dur: BASE.promote * f });
    t += BASE.promote * f;
  }
  const total = Math.max(t, ...steps.map((s) => s.start + s.dur));
  return { steps, total };
}
