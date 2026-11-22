import { describe, expect, it } from 'vitest';
// @ts-expect-error – reines JS-Modul des Servers
import { LIMITS, RoomServer, validate } from '../server/rooms.js';

type Msg = Record<string, unknown>;

function setup() {
  let now = 1_000_000;
  let n = 0;
  const srv = new RoomServer({ now: () => now, token: () => (++n).toString(16).padStart(32, '0') });
  const inbox = new Map<string, Msg[]>();
  const conn = (id: string, ip = '1.1.1.1') => {
    inbox.set(id, []);
    srv.connect(id, ip, (m: Msg) => inbox.get(id)!.push(m));
  };
  const send = (id: string, m: Msg) => srv.message(id, JSON.stringify(m));
  const last = (id: string) => inbox.get(id)!.at(-1)!;
  const advance = (ms: number) => {
    now += ms;
    srv.tick();
  };
  return { srv, conn, send, last, inbox, advance };
}

describe('Signaling-Server', () => {
  it('Raum erstellen, beitreten, Signaling und Relay werden weitergeleitet', () => {
    const { conn, send, last, inbox } = setup();
    conn('h');
    conn('g', '2.2.2.2');
    send('h', { t: 'create', room: 'ABCD7', kind: 'online' });
    expect(last('h')).toMatchObject({ t: 'created', room: 'ABCD7', role: 'host', peer: false });
    send('g', { t: 'join', room: 'ABCD7' });
    expect(last('g')).toMatchObject({ t: 'joined', kind: 'online', role: 'guest', peer: true });
    expect(last('h')).toMatchObject({ t: 'peer', state: 'joined' });
    send('h', { t: 'signal', data: { sdp: 'x' } });
    expect(last('g')).toEqual({ t: 'signal', data: { sdp: 'x' } });
    send('g', { t: 'relay', data: { t: 'move', uci: 'e2e4' } });
    expect(last('h')).toEqual({ t: 'relay', data: { t: 'move', uci: 'e2e4' } });
    expect(inbox.get('g')!.some((m) => m.t === 'error')).toBe(false);
  });

  it('dritter Spieler wird abgewiesen, ungültige Codes und Nachrichten ebenso', () => {
    const { conn, send, last } = setup();
    conn('h');
    conn('g');
    conn('x');
    send('h', { t: 'create', room: 'ABCD7', kind: 'coloc' });
    send('g', { t: 'join', room: 'ABCD7' });
    send('x', { t: 'join', room: 'ABCD7' });
    expect(last('x')).toEqual({ t: 'error', code: 'full' });
    send('x', { t: 'join', room: 'AB0D' }); // 0 nicht im Alphabet
    expect(last('x')).toEqual({ t: 'error', code: 'bad-room' });
    send('x', { t: 'hack' });
    expect(last('x')).toEqual({ t: 'error', code: 'bad-type' });
    send('x', { t: 'create', room: 'ABCD7', kind: 'online' });
    expect(last('x')).toEqual({ t: 'error', code: 'taken' });
    expect(validate({ t: 'join', room: 'ABCD', session: 'nope' })).toBe('bad-session');
  });

  it('Reconnect mit Session-ID innerhalb von 2 Minuten, danach verfällt der Platz', () => {
    const { srv, conn, send, last, advance } = setup();
    conn('h');
    conn('g');
    send('h', { t: 'create', room: 'QWER5', kind: 'online' });
    send('g', { t: 'join', room: 'QWER5' });
    const session = last('g').session as string;
    srv.disconnect('g');
    expect(last('h')).toEqual({ t: 'peer', state: 'left' });
    // fremder Spieler darf den reservierten Platz nicht übernehmen
    conn('x');
    send('x', { t: 'join', room: 'QWER5' });
    expect(last('x')).toEqual({ t: 'error', code: 'full' });
    advance(60_000);
    conn('g2');
    send('g2', { t: 'join', room: 'QWER5', session });
    expect(last('g2')).toMatchObject({ t: 'joined', reconnect: true, session });
    expect(last('h')).toEqual({ t: 'peer', state: 'back' });
    // erneut weg, diesmal zu lange
    srv.disconnect('g2');
    advance(LIMITS.reconnectMs + 6000);
    expect(last('h')).toMatchObject({ t: 'peer', state: 'left', final: true });
    conn('g3');
    send('g3', { t: 'join', room: 'QWER5', session });
    // alte Session ist verfallen: Platz ist frei, Beitritt als neuer Gast mit neuer Session
    expect(last('g3')).toMatchObject({ t: 'joined', reconnect: false });
    expect(last('g3').session).not.toBe(session);
  });

  it('Host-Reconnect stellt den Raum wieder her; Host weg zu lange → Raum geschlossen', () => {
    const { srv, conn, send, last, advance } = setup();
    conn('h');
    conn('g');
    send('h', { t: 'create', room: 'ZXCV9', kind: 'online' });
    const hs = last('h').session as string;
    send('g', { t: 'join', room: 'ZXCV9' });
    srv.disconnect('h');
    conn('h2');
    send('h2', { t: 'create', room: 'ZXCV9', kind: 'online', session: hs });
    expect(last('h2')).toMatchObject({ t: 'created', reconnect: true, peer: true });
    srv.disconnect('h2');
    advance(LIMITS.reconnectMs + 6000);
    expect(last('g')).toEqual({ t: 'closed' });
    expect(srv.rooms.size).toBe(0);
  });

  it('Rate-Limit und Größenlimit', () => {
    const { conn, send, last, inbox, srv } = setup();
    conn('h');
    send('h', { t: 'create', room: 'RATE5', kind: 'online' });
    for (let i = 0; i < LIMITS.burst + 20; i++) send('h', { t: 'ping' });
    expect(inbox.get('h')!.some((m) => m.code === 'rate')).toBe(true);
    conn('b');
    srv.message('b', JSON.stringify({ t: 'relay', data: { x: 'y'.repeat(LIMITS.maxMessageBytes) } }));
    expect(last('b')).toEqual({ t: 'error', code: 'too-big' });
  });

  it('Räume je IP begrenzt, inaktive Räume verfallen', () => {
    const { conn, send, last, advance, srv } = setup();
    for (let i = 0; i < LIMITS.roomsPerIp; i++) {
      conn(`h${i}`);
      send(`h${i}`, { t: 'create', room: `RMMM${'ABCDEFGH'[i]}`, kind: 'online' });
    }
    conn('hx');
    send('hx', { t: 'create', room: 'RMMMZ', kind: 'online' });
    expect(last('hx')).toEqual({ t: 'error', code: 'too-many-rooms' });
    advance(LIMITS.idleMs + 6000);
    expect(srv.rooms.size).toBe(0);
    expect(last('h0')).toEqual({ t: 'closed', reason: 'idle' });
  });
});
