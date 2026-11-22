// @ts-check
/**
 * Myzel-Schach – Signaling-/Lobby-/Relay-Logik (reines Modul, ohne Netzwerk → testbar).
 *
 * Aufgaben:
 *  - Räume mit kurzen Codes (4–8 Zeichen, ohne verwechselbare Zeichen 0/O, 1/I), Art 'online' oder 'coloc'
 *  - je Raum genau ein Host- und ein Gast-Platz, jeder mit Session-Token für den Reconnect (bis 120 s)
 *  - Weiterleiten von WebRTC-Signaling (Offer/Answer/ICE) und – falls P2P scheitert – Relay der Spielnachrichten
 *  - Sicherheit: Größenlimit, Schema-Prüfung, Token-Bucket-Rate-Limit je Verbindung, Raum-Limits je IP,
 *    Räume verfallen bei Inaktivität. Im Raumcode stehen keine Daten (zufällig, nicht ableitbar).
 *
 * Der Server kennt den Spielzustand NICHT – autoritativ ist der Host-Client (siehe src/net/authority.ts).
 */

export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_RE = new RegExp(`^[${ROOM_ALPHABET}]{4,8}$`);
const SESSION_RE = /^[a-f0-9]{32}$/;

export const LIMITS = {
  /** max. Größe einer Nachricht (SDP-Offer mit vielen ICE-Kandidaten passt hinein) */
  maxMessageBytes: 32 * 1024,
  /** Token-Bucket je Verbindung: Nachrichten/s und Burst (Posen-Relay 30 Hz + Spiel + ICE) */
  ratePerSec: 60,
  burst: 120,
  /** Reconnect-Fenster für einen getrennten Platz */
  reconnectMs: 120_000,
  /** Raum verfällt nach so langer Inaktivität (keine Nachricht von niemandem) */
  idleMs: 30 * 60_000,
  /** aktive Räume je IP */
  roomsPerIp: 5,
  /** Raum-Erstellungen je IP und Minute */
  createsPerMinute: 10,
};

/** @typedef {{ id: string, ip: string, send: (msg: object) => void, room: Room | null, role: 'host' | 'guest' | null, tokens: number, last: number, limited: boolean, close?: () => void }} Conn */
/** @typedef {{ conn: Conn | null, session: string | null, leftAt: number }} Slot */
/** @typedef {{ code: string, kind: 'online' | 'coloc', ip: string, host: Slot, guest: Slot, lastActivity: number }} Room */

/**
 * @param {unknown} msg
 * @returns {string | null} Fehlercode oder null, wenn gültig
 */
export function validate(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return 'bad-json';
  const m = /** @type {Record<string, unknown>} */ (msg);
  switch (m.t) {
    case 'create':
      if (typeof m.room !== 'string' || !ROOM_RE.test(m.room)) return 'bad-room';
      if (m.kind !== 'online' && m.kind !== 'coloc') return 'bad-kind';
      if (m.session !== undefined && (typeof m.session !== 'string' || !SESSION_RE.test(m.session))) return 'bad-session';
      return null;
    case 'join':
      if (typeof m.room !== 'string' || !ROOM_RE.test(m.room)) return 'bad-room';
      if (m.session !== undefined && (typeof m.session !== 'string' || !SESSION_RE.test(m.session))) return 'bad-session';
      return null;
    case 'signal':
    case 'relay':
      if (m.data === undefined || m.data === null || typeof m.data !== 'object') return 'bad-data';
      return null;
    case 'leave':
    case 'ping':
      return null;
    default:
      return 'bad-type';
  }
}

export class RoomServer {
  /**
   * @param {{ now?: () => number, token?: () => string, limits?: Partial<typeof LIMITS> }} [opts]
   */
  constructor(opts = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.token = opts.token ?? (() => Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join(''));
    this.limits = { ...LIMITS, ...opts.limits };
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
    /** @type {Map<string, Conn>} */
    this.conns = new Map();
    /** @type {Map<string, number[]>} */
    this.creates = new Map();
  }

  /**
   * @param {string} id
   * @param {string} ip
   * @param {(msg: object) => void} send
   * @param {() => void} [close]
   */
  connect(id, ip, send, close) {
    this.conns.set(id, { id, ip, send, close, room: null, role: null, tokens: this.limits.burst, last: this.now(), limited: false });
  }

  /** @param {string} id @param {string} raw */
  message(id, raw) {
    const c = this.conns.get(id);
    if (!c) return;
    // Rate-Limit (Token-Bucket)
    const now = this.now();
    c.tokens = Math.min(this.limits.burst, c.tokens + ((now - c.last) / 1000) * this.limits.ratePerSec);
    c.last = now;
    if (c.tokens < 1) {
      if (!c.limited) c.send({ t: 'error', code: 'rate' });
      c.limited = true;
      return;
    }
    c.tokens -= 1;
    c.limited = false;
    if (raw.length > this.limits.maxMessageBytes) return c.send({ t: 'error', code: 'too-big' });
    /** @type {any} */
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return c.send({ t: 'error', code: 'bad-json' });
    }
    const err = validate(msg);
    if (err) return c.send({ t: 'error', code: err });
    if (c.room) c.room.lastActivity = now;
    switch (msg.t) {
      case 'ping':
        return c.send({ t: 'pong' });
      case 'create':
        return this.create(c, msg.room, msg.kind, msg.session);
      case 'join':
        return this.join(c, msg.room, msg.session);
      case 'signal':
      case 'relay': {
        const peer = this.peerOf(c);
        if (peer) peer.send({ t: msg.t, data: msg.data });
        return;
      }
      case 'leave':
        return this.leave(c);
    }
  }

  /** @param {Conn} c */
  peerOf(c) {
    if (!c.room || !c.role) return null;
    return (c.role === 'host' ? c.room.guest : c.room.host).conn;
  }

  /** @param {Conn} c @param {string} code @param {'online'|'coloc'} kind @param {string | undefined} session */
  create(c, code, kind, session) {
    if (c.room) return c.send({ t: 'error', code: 'already-in-room' });
    const existing = this.rooms.get(code);
    if (existing) {
      // Reconnect des Hosts mit seiner Session
      if (session && existing.host.session === session && !existing.host.conn) return this.attach(c, existing, 'host', 'created');
      return c.send({ t: 'error', code: 'taken' });
    }
    const now = this.now();
    const recent = (this.creates.get(c.ip) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= this.limits.createsPerMinute) return c.send({ t: 'error', code: 'rate' });
    let active = 0;
    for (const r of this.rooms.values()) if (r.ip === c.ip) active++;
    if (active >= this.limits.roomsPerIp) return c.send({ t: 'error', code: 'too-many-rooms' });
    recent.push(now);
    this.creates.set(c.ip, recent);
    /** @type {Room} */
    const room = { code, kind, ip: c.ip, host: { conn: null, session: null, leftAt: 0 }, guest: { conn: null, session: null, leftAt: 0 }, lastActivity: now };
    this.rooms.set(code, room);
    this.attach(c, room, 'host', 'created');
  }

  /** @param {Conn} c @param {string} code @param {string | undefined} session */
  join(c, code, session) {
    if (c.room) return c.send({ t: 'error', code: 'already-in-room' });
    const room = this.rooms.get(code);
    if (!room) return c.send({ t: 'error', code: 'no-room' });
    const g = room.guest;
    if (g.session && session === g.session && !g.conn) return this.attach(c, room, 'guest', 'joined');
    if (g.session) return c.send({ t: 'error', code: 'full' });
    this.attach(c, room, 'guest', 'joined');
  }

  /** @param {Conn} c @param {Room} room @param {'host'|'guest'} role @param {'created'|'joined'} reply */
  attach(c, room, role, reply) {
    const slot = room[role];
    const back = !!slot.session;
    slot.session ??= this.token();
    slot.conn = c;
    slot.leftAt = 0;
    c.room = room;
    c.role = role;
    room.lastActivity = this.now();
    const peer = this.peerOf(c);
    c.send({ t: reply, room: room.code, kind: room.kind, session: slot.session, role, peer: !!peer, reconnect: back });
    if (peer) peer.send({ t: 'peer', state: back ? 'back' : 'joined' });
  }

  /** @param {Conn} c */
  leave(c) {
    const room = c.room;
    if (!room || !c.role) return;
    const role = c.role;
    const peer = this.peerOf(c);
    c.room = null;
    c.role = null;
    if (role === 'host') {
      peer?.send({ t: 'closed' });
      if (peer) {
        peer.room = null;
        peer.role = null;
      }
      this.rooms.delete(room.code);
    } else {
      room.guest = { conn: null, session: null, leftAt: 0 };
      peer?.send({ t: 'peer', state: 'left', final: true });
    }
  }

  /** Verbindung weg (Netz, Tab geschlossen): Platz bleibt für den Reconnect reserviert. @param {string} id */
  disconnect(id) {
    const c = this.conns.get(id);
    this.conns.delete(id);
    if (!c || !c.room || !c.role) return;
    const slot = c.room[c.role];
    if (slot.conn === c) {
      slot.conn = null;
      slot.leftAt = this.now();
      const peer = this.peerOf(c);
      peer?.send({ t: 'peer', state: 'left' });
    }
  }

  /** Regelmäßig aufrufen: verfallene Reconnect-Plätze und inaktive Räume aufräumen. */
  tick() {
    const now = this.now();
    for (const room of [...this.rooms.values()]) {
      for (const role of /** @type {const} */ (['host', 'guest'])) {
        const s = room[role];
        if (s.session && !s.conn && s.leftAt && now - s.leftAt > this.limits.reconnectMs) {
          if (role === 'host') {
            room.guest.conn?.send({ t: 'closed' });
            if (room.guest.conn) room.guest.conn.room = null;
            this.rooms.delete(room.code);
          } else {
            room.guest = { conn: null, session: null, leftAt: 0 };
            room.host.conn?.send({ t: 'peer', state: 'left', final: true });
          }
        }
      }
      if (this.rooms.has(room.code) && now - room.lastActivity > this.limits.idleMs) {
        for (const s of [room.host, room.guest]) {
          s.conn?.send({ t: 'closed', reason: 'idle' });
          if (s.conn) s.conn.room = null;
        }
        this.rooms.delete(room.code);
      }
    }
  }
}
