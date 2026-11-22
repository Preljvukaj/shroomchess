import { describe, expect, it } from 'vitest';
import { ChessGame } from '../src/core/game';
import { ChessClock } from '../src/core/clock';
import { ClockSync, clockAt } from '../src/net/clockSync';
import { PoseBuffer } from '../src/net/poseBuffer';
import { applyHostMessage, checkMoveRequest, clockWire } from '../src/net/authority';
import { validatePeerMsg } from '../src/net/protocol';

function lcg(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

describe('Host-Autorität', () => {
  it('prüft Zugwünsche des Gastes mit chess.js', () => {
    const g = new ChessGame();
    expect(checkMoveRequest(g, 'b', 'e7e5')).toBe('not-your-turn');
    g.tryMoveNotation('e2e4');
    expect(checkMoveRequest(g, 'b', 'e7e4')).toBe('illegal');
    expect(checkMoveRequest(g, 'b', 'e2e3')).toBe('illegal'); // eigene Figur nicht vorhanden
    expect(checkMoveRequest(g, 'b', 'xx')).toBe('bad-format');
    expect(checkMoveRequest(g, 'b', 'e7e5', true)).toBe('paused');
    expect(checkMoveRequest(g, 'b', 'e7e5')).toBeNull();
    g.resign('w');
    expect(checkMoveRequest(g, 'b', 'e7e5')).toBe('game-over');
  });

  it('Umwandlung braucht die Figurenwahl', () => {
    const g = new ChessGame();
    g.reset('8/4P3/8/8/8/8/k7/4K3 w - - 0 1');
    expect(checkMoveRequest(g, 'w', 'e7e8')).toBe('promotion-missing');
    expect(checkMoveRequest(g, 'w', 'e7e8n')).toBeNull();
  });

  it('Gast spielt Host-Züge nach; verpasste Züge (Reconnect) → stilles Neuladen', () => {
    const host = new ChessGame();
    const guest = new ChessGame();
    host.tryMoveNotation('e2e4');
    expect(applyHostMessage(guest, { t: 'move', seq: 0, uci: 'e2e4', clock: null, live: false })).toBe('moved');
    host.tryMoveNotation('e7e5');
    host.tryMoveNotation('g1f3');
    // Gast war weg und hat zwei Züge verpasst
    expect(applyHostMessage(guest, { t: 'move', seq: 2, uci: 'g1f3', clock: null, live: false })).toBe('resynced');
    const st = { t: 'state' as const, seq: host.plyCount, uci: host.historyUci(), clock: null, result: null, paused: false, names: { w: 'A', b: 'B' }, guestColor: 'b' as const };
    expect(applyHostMessage(guest, st)).toBe('resynced');
    expect(guest.fen).toBe(host.fen);
    // genau ein neuer Zug im Zustand → normal animiert
    host.tryMoveNotation('b8c6');
    expect(applyHostMessage(guest, { ...st, seq: host.plyCount, uci: host.historyUci() })).toBe('moved');
    expect(guest.fen).toBe(host.fen);
    // doppelt zugestellt → ignoriert
    expect(applyHostMessage(guest, { t: 'move', seq: 3, uci: 'b8c6', clock: null, live: false })).toBe('ignored');
  });
});

describe('Uhr-Synchronisation mit simulierter Latenz', () => {
  it('Offset-Schätzung trotz Jitter auf wenige ms genau; angezeigte Restzeit stimmt', () => {
    const rng = lcg(5);
    const hostOffset = 123_456; // Host-Uhr läuft um diesen Betrag vor
    const sync = new ClockSync();
    let now = 1000;
    for (let i = 0; i < 20; i++) {
      const up = 40 + rng() * 60; // 40–100 ms hin, asymmetrisch
      const down = 40 + rng() * 120;
      const c = now;
      const h = c + up + hostOffset;
      now = c + up + down;
      sync.onPong(c, h, now);
      now += 2000;
    }
    expect(Math.abs(sync.hostNow(now) - (now + hostOffset))).toBeLessThan(45);
    expect(sync.rtt).toBeGreaterThan(80);

    // Host-Uhr: Weiß läuft, 60 s übrig, Stand 300 ms alt (Übertragung)
    const hostClock = new ChessClock({ initial: 60, increment: 0 }, () => hostTimeNow);
    let hostTimeNow = now + hostOffset;
    hostClock.start('w');
    const wire = clockWire(hostClock, hostTimeNow)!;
    now += 300;
    hostTimeNow += 300;
    const shown = clockAt(wire, sync.hostNow(now));
    expect(Math.abs(shown.w - hostClock.read().w)).toBeLessThan(50);
  });

  it('Gutschrift: Uhr steht während der Gegner-Animation', () => {
    const wire = { w: 30_000, b: 30_000, running: 'b' as const, h: 1000, graceUntil: 3000 };
    expect(clockAt(wire, 2500).b).toBe(30_000);
    expect(clockAt(wire, 4000).b).toBe(29_000);
  });

  it('ChessClock: press mit Gutschrift zieht die Animationszeit nicht ab', () => {
    let t = 0;
    const c = new ChessClock({ initial: 60, increment: 0 }, () => t);
    c.start('w');
    t = 5000;
    c.press('w', 2000); // Schwarz bekommt 2 s Animations-Gutschrift
    t = 6500;
    expect(c.read().b).toBe(60_000);
    t = 9000;
    expect(c.read().b).toBe(58_000); // 9 s − 5 s − 2 s Gutschrift = 2 s verbraucht
  });
});

describe('Posen-Interpolation (100 ms Puffer)', () => {
  it('interpoliert zwischen Samples und schreibt begrenzt fort', () => {
    const b = new PoseBuffer<{ head: number[] }>(100, 100);
    const q = [0, 0, 0, 1];
    for (let i = 0; i <= 10; i++) b.push(i * 50, { head: [i * 0.05, 1.6, 0, ...q] }); // 20 Hz, 1 m/s
    const s = b.sample(375)!; // Anzeigezeit 275 ms → x = 0.275
    expect(s.head[0]).toBeCloseTo(0.275, 6);
    // weit hinter dem letzten Sample (500 ms): höchstens 100 ms fortgeschrieben
    const late = b.sample(2000)!;
    expect(late.head[0]).toBeCloseTo(0.6, 6);
  });

  it('Quaternion wird auf kürzestem Weg interpoliert und bleibt normiert', () => {
    const b = new PoseBuffer<{ head: number[] }>(0);
    const s45 = Math.sin(Math.PI / 8), c45 = Math.cos(Math.PI / 8);
    b.push(0, { head: [0, 0, 0, 0, 0, 0, 1] });
    b.push(100, { head: [0, 0, 0, 0, -s45 * 2 * c45, 0, -(c45 * c45 - s45 * s45)] }); // gleiche Drehung, negiertes Vorzeichen
    const m = b.sample(50)!;
    expect(Math.hypot(m.head[3], m.head[4], m.head[5], m.head[6])).toBeCloseTo(1, 6);
  });
});

describe('Protokoll-Validierung', () => {
  it('lehnt kaputte oder bösartige Nachrichten ab', () => {
    expect(validatePeerMsg({ t: 'move-req', uci: 'e2e4', seq: 0, live: false })).toBe(true);
    expect(validatePeerMsg({ t: 'move-req', uci: 'e2e9', seq: 0 })).toBe(false);
    expect(validatePeerMsg({ t: 'pose', kind: 'vr', head: [1, 2, 3] })).toBe(false);
    expect(validatePeerMsg({ t: 'emote', id: '<script>' })).toBe(false);
    expect(validatePeerMsg({ t: 'state', seq: 0, uci: ['e2e4', 'DROP TABLE'] })).toBe(false);
    expect(validatePeerMsg(null)).toBe(false);
  });
});
