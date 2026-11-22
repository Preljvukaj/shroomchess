/**
 * Interpolationspuffer für Gegner-Posen: Darstellung ~100 ms in der Vergangenheit, zwischen den zwei
 * umgebenden Samples linear (Position) bzw. normiert-linear (Quaternion) interpoliert. Fehlen neue Samples,
 * wird höchstens `maxExtrapolate` fortgeschrieben, danach gehalten.
 */
export type Vec = number[];

export class PoseBuffer<T extends Record<string, Vec | null | undefined>> {
  private buf: { t: number; v: T }[] = [];

  constructor(public delayMs = 100, private maxExtrapolate = 100) {}

  push(t: number, v: T): void {
    if (this.buf.length && t <= this.buf[this.buf.length - 1].t) t = this.buf[this.buf.length - 1].t + 0.001;
    this.buf.push({ t, v });
    if (this.buf.length > 40) this.buf.shift();
  }

  get lastTime(): number {
    return this.buf.length ? this.buf[this.buf.length - 1].t : -Infinity;
  }

  clear(): void {
    this.buf = [];
  }

  /** Interpolierte Werte für die Anzeigezeit now − delay. */
  sample(now: number): T | null {
    if (!this.buf.length) return null;
    const t = now - this.delayMs;
    const b = this.buf;
    if (t <= b[0].t) return b[0].v;
    for (let i = 1; i < b.length; i++) {
      if (b[i].t >= t) return lerpRecord(b[i - 1].v, b[i].v, (t - b[i - 1].t) / (b[i].t - b[i - 1].t));
    }
    // hinter dem letzten Sample: begrenzt fortschreiben
    if (b.length >= 2) {
      const a = b[b.length - 2], c = b[b.length - 1];
      const over = Math.min(t - c.t, this.maxExtrapolate);
      return lerpRecord(a.v, c.v, 1 + over / Math.max(1, c.t - a.t));
    }
    return b[b.length - 1].v;
  }
}

function lerpRecord<T extends Record<string, Vec | null | undefined>>(a: T, b: T, k: number): T {
  const out: Record<string, Vec | null | undefined> = {};
  for (const key of Object.keys(b)) {
    const x = a[key];
    const y = b[key];
    if (!x || !y || x.length !== y.length) {
      out[key] = y;
      continue;
    }
    const r = x.map((xi, i) => xi + (y[i] - xi) * k);
    // Pose [x,y,z,qx,qy,qz,qw]: Quaternion auf kürzestem Weg und normiert
    if (r.length === 7) {
      const dot = x[3] * y[3] + x[4] * y[4] + x[5] * y[5] + x[6] * y[6];
      if (dot < 0) for (let i = 3; i < 7; i++) r[i] = x[i] + (-y[i] - x[i]) * k;
      const l = Math.hypot(r[3], r[4], r[5], r[6]) || 1;
      for (let i = 3; i < 7; i++) r[i] /= l;
    }
    out[key] = r;
  }
  return out as T;
}
