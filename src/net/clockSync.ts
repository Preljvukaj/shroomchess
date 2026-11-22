import type { ClockWire } from './protocol';
import type { Color } from '../core/types';

/**
 * Zeitabgleich Gast ↔ Host (NTP-artig): Der Gast sendet ping(c = lokale Zeit), der Host antwortet mit seiner Zeit h.
 * Offset = h + RTT/2 − jetzt. Aus den letzten Messungen gilt die mit der kleinsten RTT (am wenigsten Warteschlange).
 */
export class ClockSync {
  private samples: { rtt: number; offset: number }[] = [];
  offset = 0;
  rtt = 0;

  onPong(c: number, h: number, now: number): void {
    const rtt = Math.max(0, now - c);
    this.samples.push({ rtt, offset: h + rtt / 2 - now });
    if (this.samples.length > 8) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.offset = best.offset;
    // angezeigte Latenz: gleitender Mittelwert (für den Verbindungsstatus)
    this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
  }

  /** geschätzte Host-Zeit */
  hostNow(now: number): number {
    return now + this.offset;
  }

  get ready(): boolean {
    return this.samples.length > 0;
  }
}

/** Uhrstand zum Zeitpunkt `hostNow` (Host-Zeit) aus einem empfangenen Stand – lokale Interpolation. */
export function clockAt(w: ClockWire, hostNow: number): Record<Color, number> & { running: Color | null } {
  const out = { w: w.w, b: w.b, running: w.running };
  if (w.running) {
    const start = Math.max(w.h, w.graceUntil ?? 0);
    out[w.running] = Math.max(0, out[w.running] - Math.max(0, hostNow - start));
  }
  return out;
}

/** Verbindungsqualität aus RTT */
export function linkQuality(rtt: number): 'good' | 'ok' | 'poor' {
  return rtt < 120 ? 'good' : rtt < 300 ? 'ok' : 'poor';
}
