import type { PeerMsg } from './protocol';
import { validatePeerMsg } from './protocol';
import { generateRoomCode } from '../ui/landing/route';

/**
 * Verbindung zum Gegner:
 *  1. WebSocket zum Signaling-Server (Raum erstellen/beitreten, Session-ID für Reconnect)
 *  2. WebRTC (Peer-to-Peer): zwei DataChannels – 'game' (zuverlässig, geordnet) und 'pose' (unzuverlässig,
 *     ungeordnet, kein Neusenden → immer die frischeste Pose). Optional ein Audio-Transceiver (Sprachchat).
 *  3. Fallback: Kommt P2P nicht in 7 s zustande (symmetrisches NAT, Firewall, kein TURN), laufen alle
 *     Nachrichten als Relay über den WebSocket-Server.
 * Reconnect: WS-Abbruch → erneut verbinden (Backoff) mit derselben Session-ID, bis 2 Minuten.
 */

export type LinkPhase = 'connecting' | 'waiting' | 'connected' | 'peer-lost' | 'reconnecting' | 'closed' | 'error';

export interface LinkStatus {
  phase: LinkPhase;
  transport: 'p2p' | 'relay' | null;
  room: string;
  kind: 'online' | 'coloc' | null;
  role: 'host' | 'guest';
  error?: string;
}

export interface LinkOptions {
  url: string;
  room: string;
  role: 'host' | 'guest';
  kind?: 'online' | 'coloc';
  iceServers?: RTCIceServer[];
}

const P2P_TIMEOUT = 7000;
const RECONNECT_WINDOW = 120_000;

/** Standard-ICE: öffentlicher STUN; TURN per VITE_ICE_SERVERS (JSON) bzw. ?ice= konfigurierbar. */
export function defaultIceServers(): RTCIceServer[] {
  try {
    const q = new URLSearchParams(location.search).get('ice');
    const env = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_ICE_SERVERS;
    const raw = q ?? env;
    if (raw) return JSON.parse(raw) as RTCIceServer[];
  } catch {
    /* ungültig → Standard */
  }
  return [{ urls: 'stun:stun.l.google.com:19302' }];
}

/** Signaling-URL: ?signal=… > VITE_SIGNAL_URL > gleicher Host unter /signal */
export function signalUrl(): string {
  const q = new URLSearchParams(location.search).get('signal');
  const env = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SIGNAL_URL;
  if (q) return q;
  if (env) return env;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/signal`;
}

export class NetLink {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private game: RTCDataChannel | null = null;
  private pose: RTCDataChannel | null = null;
  private relay = false;
  private queue: string[] = [];
  private session: string | null = null;
  private lostSince = 0;
  private closedByUs = false;
  private p2pTimer = 0;
  private retry = 0;
  private audioSender: RTCRtpSender | null = null;
  private micTrack: MediaStreamTrack | null = null;
  status: LinkStatus;
  onMessage: (m: PeerMsg) => void = () => undefined;
  onStatus: (s: LinkStatus) => void = () => undefined;
  onRemoteAudio: (stream: MediaStream) => void = () => undefined;
  /** Host: Raumcode wurde geändert (alter Code war vergeben) */
  onRoomChanged: (room: string) => void = () => undefined;
  /** Gegner erstmals bzw. erneut verbunden (Host schickt dann den vollständigen Zustand) */
  onPeerReady: (reconnect: boolean) => void = () => undefined;
  private peerSeen = false;
  private readyFired = false;

  constructor(private opts: LinkOptions) {
    this.status = { phase: 'connecting', transport: null, room: opts.room, kind: opts.kind ?? null, role: opts.role };
    try {
      this.session = sessionStorage.getItem(this.sessionKey());
    } catch {
      /* kein Speicher */
    }
    this.connectWs();
  }

  private sessionKey(): string {
    return `myzel-schach.net.${this.opts.room}.${this.opts.role}`;
  }

  private setStatus(p: Partial<LinkStatus>): void {
    this.status = { ...this.status, ...p };
    this.onStatus(this.status);
  }

  get room(): string {
    return this.opts.room;
  }

  // ---------- Signaling ----------

  private connectWs(): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.opts.url);
    } catch (e) {
      this.setStatus({ phase: 'error', error: (e as Error).message });
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      const base = this.session ? { session: this.session } : {};
      ws.send(JSON.stringify(this.opts.role === 'host' ? { t: 'create', room: this.opts.room, kind: this.opts.kind ?? 'online', ...base } : { t: 'join', room: this.opts.room, ...base }));
    };
    ws.onmessage = (ev) => {
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      void this.onSignal(m);
    };
    ws.onclose = () => {
      this.ws = null;
      if (this.closedByUs || this.status.phase === 'closed') return;
      // Server weg: P2P kann weiterlaufen; Signaling neu verbinden
      if (!this.lostSince) this.lostSince = Date.now();
      if (Date.now() - this.lostSince > RECONNECT_WINDOW) {
        this.setStatus({ phase: 'closed', error: 'timeout' });
        return;
      }
      if (!this.game || this.game.readyState !== 'open') this.setStatus({ phase: 'reconnecting' });
      const delay = Math.min(5000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connectWs(), delay);
    };
    ws.onerror = () => undefined;
  }

  private async onSignal(m: Record<string, unknown>): Promise<void> {
    switch (m.t) {
      case 'created':
      case 'joined': {
        this.lostSince = 0;
        this.session = String(m.session);
        try {
          sessionStorage.setItem(this.sessionKey(), this.session);
        } catch {
          /* ignorieren */
        }
        this.setStatus({ kind: m.kind as 'online' | 'coloc', phase: m.peer ? this.status.phase : 'waiting' });
        if (m.peer) this.startPeer(!!m.reconnect || this.peerSeen);
        return;
      }
      case 'peer':
        if (m.state === 'joined' || m.state === 'back') this.startPeer(m.state === 'back' || this.peerSeen);
        else {
          this.teardownPeer();
          this.setStatus({ phase: m.final ? 'waiting' : 'peer-lost', transport: null });
        }
        return;
      case 'signal':
        return this.onRtcSignal(m.data as Record<string, unknown>);
      case 'relay': {
        const d = m.data;
        if (validatePeerMsg(d)) this.onMessage(d);
        return;
      }
      case 'closed':
        this.setStatus({ phase: 'closed', error: String(m.reason ?? 'closed') });
        this.close();
        return;
      case 'error':
        if (m.code === 'taken' && this.opts.role === 'host' && !this.peerSeen) {
          // Code schon vergeben (selten): neuen Code würfeln und erneut erstellen
          this.opts.room = generateRoomCode();
          this.session = null;
          this.status = { ...this.status, room: this.opts.room };
          this.onRoomChanged(this.opts.room);
          this.ws?.send(JSON.stringify({ t: 'create', room: this.opts.room, kind: this.opts.kind ?? 'online' }));
          return;
        }
        if (m.code === 'taken' || m.code === 'no-room' || m.code === 'full') this.setStatus({ phase: 'error', error: String(m.code) });
        return;
    }
  }

  private sendSignal(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'signal', data }));
  }

  // ---------- WebRTC ----------

  private startPeer(reconnect: boolean): void {
    this.teardownPeer();
    this.peerSeen = true;
    this.relay = false;
    const pc = new RTCPeerConnection({ iceServers: this.opts.iceServers ?? defaultIceServers() });
    this.pc = pc;
    // ausgehandelte Kanäle (gleiche IDs auf beiden Seiten → kein Warten auf ondatachannel)
    this.game = pc.createDataChannel('game', { negotiated: true, id: 0, ordered: true });
    this.pose = pc.createDataChannel('pose', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    this.readyFired = false;
    const ready = () => {
      if (this.readyFired) return;
      this.readyFired = true;
      this.onPeerReady(reconnect);
    };
    this.game.onopen = () => {
      clearTimeout(this.p2pTimer);
      this.relay = false; // P2P kam doch noch zustande → Relay nicht mehr nötig
      this.setStatus({ phase: 'connected', transport: 'p2p' });
      this.flush();
      ready();
    };
    for (const ch of [this.game, this.pose]) {
      ch.onmessage = (ev) => {
        let d: unknown;
        try {
          d = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (validatePeerMsg(d)) this.onMessage(d);
      };
    }
    this.game.onclose = () => {
      if (this.pc === pc && !this.relay && this.status.phase === 'connected') this.setStatus({ phase: 'peer-lost', transport: null });
    };
    pc.onicecandidate = (e) => e.candidate && this.sendSignal({ ice: e.candidate.toJSON() });
    pc.ontrack = (e) => this.onRemoteAudio(e.streams[0] ?? new MediaStream([e.track]));
    if (this.opts.role === 'host') {
      // Audio-Transceiver vorab (Sprachchat später ohne Neuverhandlung zuschaltbar)
      const tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
      this.audioSender = tr.sender;
      if (this.micTrack) void tr.sender.replaceTrack(this.micTrack);
      void pc
        .createOffer()
        .then((o) => pc.setLocalDescription(o))
        .then(() => this.sendSignal({ sdp: pc.localDescription }));
    }
    // Fallback auf Relay
    this.p2pTimer = window.setTimeout(() => {
      if (this.game?.readyState !== 'open') {
        this.relay = true;
        this.setStatus({ phase: 'connected', transport: 'relay' });
        this.flush();
        ready();
      }
    }, P2P_TIMEOUT);
  }

  private async onRtcSignal(d: Record<string, unknown>): Promise<void> {
    const pc = this.pc;
    if (!pc) return;
    try {
      if (d.sdp) {
        const desc = d.sdp as RTCSessionDescriptionInit;
        await pc.setRemoteDescription(desc);
        if (desc.type === 'offer') {
          const tr = pc.getTransceivers().find((t) => t.receiver.track.kind === 'audio');
          if (tr) {
            tr.direction = 'sendrecv';
            this.audioSender = tr.sender;
            if (this.micTrack) await tr.sender.replaceTrack(this.micTrack);
          }
          await pc.setLocalDescription(await pc.createAnswer());
          this.sendSignal({ sdp: pc.localDescription });
        }
      } else if (d.ice) await pc.addIceCandidate(d.ice as RTCIceCandidateInit);
    } catch {
      /* fehlerhafte Signale ignorieren; Relay übernimmt nach Timeout */
    }
  }

  private teardownPeer(): void {
    clearTimeout(this.p2pTimer);
    this.game?.close();
    this.pose?.close();
    this.pc?.close();
    this.pc = null;
    this.game = null;
    this.pose = null;
    this.audioSender = null;
  }

  // ---------- Senden ----------

  /** reliable = Spielnachrichten (werden bei kurzer Unterbrechung gepuffert), sonst Posen (dürfen verloren gehen). */
  send(msg: PeerMsg, reliable = true): void {
    const s = JSON.stringify(msg);
    if (!reliable && this.pose?.readyState === 'open') return this.pose.send(s);
    if (this.game?.readyState === 'open') return this.game.send(s);
    if (this.relay && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ t: 'relay', data: msg }));
      return;
    }
    if (reliable && this.queue.length < 200) this.queue.push(s);
  }

  private flush(): void {
    const q = this.queue;
    this.queue = [];
    for (const s of q) this.send(JSON.parse(s) as PeerMsg, true);
  }

  get connected(): boolean {
    return this.status.phase === 'connected';
  }

  // ---------- Sprachchat ----------

  /** Mikrofon an/aus (standardmäßig aus). Nur über P2P – das Relay überträgt kein Audio. */
  async setMic(on: boolean): Promise<boolean> {
    if (on && !this.micTrack) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        this.micTrack = s.getAudioTracks()[0];
      } catch {
        return false;
      }
    }
    if (this.micTrack) this.micTrack.enabled = on;
    if (this.audioSender && this.micTrack) await this.audioSender.replaceTrack(on ? this.micTrack : null);
    return true;
  }

  close(): void {
    this.closedByUs = true;
    try {
      this.ws?.send(JSON.stringify({ t: 'leave' }));
    } catch {
      /* egal */
    }
    this.teardownPeer();
    this.ws?.close();
    this.micTrack?.stop();
  }
}
