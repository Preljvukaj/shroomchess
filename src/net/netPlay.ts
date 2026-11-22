import * as THREE from 'three';
import type { ChessGame } from '../core/game';
import { ChessClock, TIME_CONTROLS } from '../core/clock';
import type { AppliedMove, Color, PieceSymbol, Square } from '../core/types';
import type { BoardScene } from '../render/boardScene';
import { Avatar } from '../render/avatar';
import { PLAYER_GLOW } from '../render/pieces';
import { opponentTimeline } from '../render/opponentAnim';
import { squareCenter } from '../render/board';
import { applyHostMessage, checkMoveRequest, clockWire } from './authority';
import { ClockSync, linkQuality } from './clockSync';
import { type LinkStatus, NetLink, signalUrl } from './link';
import { PoseBuffer } from './poseBuffer';
import type { EmoteId, PeerMsg, PoseMsg, PoseWire } from './protocol';
import { PROTOCOL } from './protocol';

/**
 * Online-Mehrspieler und Co-Location: Spielablauf über das Netz.
 * Host = autoritativ (prüft Züge, führt die Uhr), Gast = Spiegel (schickt Zugwünsche, zeigt Host-Stand).
 */

export interface NetPlayHost {
  game: ChessGame;
  board: BoardScene;
  scene: THREE.Scene;
  clock(): ChessClock;
  setClock(c: ChessClock): void;
  /** eigene Farbe setzen (Gast erfährt sie vom Host; Revanche tauscht) */
  setLocalColor(c: Color): void;
  localColor(): Color;
  setNames(n: Record<Color, string>): void;
  localName(): string;
  refreshUi(): void;
  say(text: string, seconds?: number): void;
  confirm(text: string): Promise<boolean>;
  setConn(line: string | null): void;
  setNote(note: string | null): void;
  t(key: string, vars?: Record<string, string | number>): string;
  /** lokale Posen (Welt) – VR: Kopf + Hände; Desktop: nichts (Zeige-Feld kommt aus der Interaktion) */
  localPose(): { vr: boolean; head?: THREE.Matrix4; left?: THREE.Vector3 | null; right?: THREE.Vector3 | null; live?: boolean };
  hoverSquare(): Square | null;
  heldPiece(): { square: Square; root: THREE.Object3D } | null;
  animSpeed(): 'slow' | 'normal' | 'fast';
  playSound(id: 'emote' | 'move' | 'illegal'): void;
  onRemoteAudio(stream: MediaStream): void;
  /** Co-Location: eingehende Kalibrier-Nachrichten */
  onColoc?(m: PeerMsg): void;
  /** Gegner (wieder) verbunden */
  onPeerReady?(): void;
  /** Raumcode hat sich geändert (Einladung aktualisieren) */
  onRoomChanged?(): void;
}

const POSE_HZ_ONLINE = 18;
const POSE_HZ_COLOC = 30;

export class NetPlay {
  readonly link: NetLink;
  readonly role: 'host' | 'guest';
  readonly avatar: Avatar;
  private sync = new ClockSync();
  private poses = new PoseBuffer<{ head?: number[]; left?: number[] | null; right?: number[] | null; held?: number[] | null }>(100);
  private lastPose: PoseMsg | null = null;
  private lastPoseAt = -Infinity;
  private remoteKind: 'vr' | 'desktop' = 'desktop';
  private remoteName = '';
  private remoteAnim: 'slow' | 'normal' | 'fast' = 'slow';
  private remoteScale = 1;
  private remoteHeldSq: Square | null = null;
  private guestColor: Color = 'b';
  private tc: string;
  private names: Record<Color, string>;
  private sendTimer = 0;
  private pingTimer = 0;
  private paused = false;
  private pendingOffer: 'draw' | 'undo' | 'rematch' | null = null;
  private pendingReq: string | null = null;
  /** Gast: Uhr steht bis zu dieser Host-Zeit (Gutschrift) */
  private seenSetup = false;
  private lastStatus: LinkStatus | null = null;
  private remoteLiveMove = false;
  kind: 'online' | 'coloc';
  /** Pose-Senderate (bei Performance-Problemen reduzierbar: min. 10 Hz online, 20 Hz co-located) */
  poseHz: number;

  constructor(private h: NetPlayHost, opts: { room: string; role: 'host' | 'guest'; kind: 'online' | 'coloc'; guestColor: Color; tc: string; names: Record<Color, string> }) {
    this.role = opts.role;
    this.kind = opts.kind;
    this.guestColor = opts.guestColor;
    this.tc = opts.tc;
    this.names = { ...opts.names };
    this.poseHz = opts.kind === 'coloc' ? POSE_HZ_COLOC : POSE_HZ_ONLINE;
    this.avatar = new Avatar(PLAYER_GLOW[opts.role === 'host' ? opts.guestColor : opts.guestColor === 'w' ? 'b' : 'w']);
    h.scene.add(this.avatar.root);
    this.link = new NetLink({ url: signalUrl(), room: opts.room, role: opts.role, kind: opts.kind });
    this.link.onStatus = (s) => this.onStatus(s);
    this.link.onMessage = (m) => this.onMessage(m);
    this.link.onPeerReady = (re) => this.onPeerReady(re);
    this.link.onRemoteAudio = (s) => h.onRemoteAudio(s);
    this.link.onRoomChanged = () => {
      this.updateConnLine();
      h.onRoomChanged?.();
    };

    // Brett: Gegnerzüge langsam animieren, außer die Hand des Gegners war live sichtbar
    h.board.isOpponentMove = (m) => m.color !== h.localColor() && !this.remoteLiveMove;
    h.game.on('move', (m) => this.onLocalGameMove(m));
    h.game.on('end', () => {
      if (this.role === 'host') this.sendState();
    });
    this.updateConnLine();
  }

  get isGuest(): boolean {
    return this.role === 'guest';
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Farbe des Gegners */
  get remoteColor(): Color {
    return this.h.localColor() === 'w' ? 'b' : 'w';
  }

  // ---------- Verbindung ----------

  private onStatus(s: LinkStatus): void {
    const prev = this.lastStatus;
    this.lastStatus = s;
    if (s.kind) this.kind = s.kind;
    if (s.phase === 'peer-lost' || (s.phase === 'reconnecting' && prev?.phase === 'connected')) this.setPaused(true);
    if (s.phase === 'error') {
      const key = s.error === 'no-room' ? 'netNoRoom' : s.error === 'full' ? 'netFull' : s.error === 'taken' ? 'netTaken' : 'netError';
      this.h.say(this.h.t(key), 8);
    }
    if (s.phase === 'closed') this.h.say(this.h.t('netClosed'), 8);
    this.updateConnLine();
  }

  private updateConnLine(): void {
    const s = this.lastStatus;
    const t = this.h.t.bind(this.h);
    let line: string;
    if (!s || s.phase === 'connecting') line = t('netConnecting');
    else if (s.phase === 'waiting') line = t('netWaiting', { code: this.link.room });
    else if (s.phase === 'peer-lost' || s.phase === 'reconnecting') line = this.role === 'host' || s.phase === 'peer-lost' ? t('netPeerReconnecting') : t('netReconnecting');
    else if (s.phase === 'connected') {
      const q = linkQuality(this.sync.rtt);
      line = `${t(this.kind === 'coloc' ? 'netColoc' : 'netOnline')} · ${s.transport === 'p2p' ? 'P2P' : 'Relay'}${this.sync.ready || this.role === 'host' ? ` · ${Math.round(this.sync.rtt)} ms · ${t(q === 'good' ? 'qGood' : q === 'ok' ? 'qOk' : 'qPoor')}` : ''}`;
    } else line = t('netClosed');
    if (this.paused && s?.phase !== 'waiting') line += ` · ${t('netPaused')}`;
    this.h.setConn(line);
  }

  private onPeerReady(reconnect: boolean): void {
    this.send({ t: 'hello', proto: PROTOCOL, name: this.h.localName(), client: this.h.localPose().vr ? 'vr' : 'desktop', anim: this.h.animSpeed() });
    if (this.role === 'host') {
      this.send({ t: 'setup', kind: this.kind, guestColor: this.guestColor, tc: this.tc, names: this.names });
      this.setPaused(false);
      this.sendState();
    }
    if (reconnect) this.h.say(this.h.t('netBack'), 3);
    this.h.onPeerReady?.();
    this.updateConnLine();
  }

  private setPaused(p: boolean): void {
    if (this.paused === p) return;
    this.paused = p;
    const clock = this.h.clock();
    if (this.role === 'host') {
      // Host autoritativ: bei Abbruch stehen die Uhren, bei Rückkehr laufen sie weiter
      if (p) clock.stop();
      else if (!this.h.game.result() && this.h.game.plyCount > 0) clock.start(this.h.game.turn);
      this.send({ t: 'pause', paused: p });
    } else if (p) clock.stop();
    this.h.setNote(p ? this.h.t(this.role === 'host' ? 'netPeerReconnecting' : 'netHostLost') : null);
    this.h.refreshUi();
    this.updateConnLine();
  }

  private send(m: PeerMsg, reliable = true): void {
    this.link.send(m, reliable);
  }

  // ---------- Zustand (Host → Gast) ----------

  private sendState(): void {
    if (this.role !== 'host') return;
    const g = this.h.game;
    this.send({
      t: 'state',
      seq: g.plyCount,
      uci: g.historyUci(),
      clock: clockWire(this.h.clock(), performance.now()),
      result: g.result(),
      paused: this.paused,
      names: this.names,
      guestColor: this.guestColor,
    });
  }

  /** Gutschrift (ms) für den Spieler, der nach Zug `m` dran ist: so lange dauert bei ihm die Gegner-Animation. */
  graceFor(m: AppliedMove): number {
    const nextIsLocal = m.color !== this.h.localColor();
    if (nextIsLocal) return this.remoteLiveMove ? 0 : this.h.board.opponentAnimDuration(m) * 1000;
    // der Gegner sieht meinen Zug langsam, wenn meine Hand nicht live sichtbar ist
    const live = this.h.localPose().vr && !!this.h.localPose().live;
    return live ? 0 : opponentTimeline(m, this.remoteAnim).total * 1000;
  }

  private onLocalGameMove(m: AppliedMove): void {
    if (this.role !== 'host') {
      this.remoteLiveMove = false;
      return;
    }
    // Host verteilt jeden Zug (eigene und bestätigte Gast-Züge) mit Uhrstand
    const clock = this.h.clock();
    const grace = this.graceFor(m);
    const now = performance.now();
    const wire = clockWire(clock, now, grace ? now + grace : undefined);
    const live = m.color === this.h.localColor() ? this.h.localPose().vr && !!this.h.localPose().live : this.remoteLiveMove;
    this.send({ t: 'move', seq: this.h.game.plyCount - 1, uci: m.from + m.to + (m.promotion ?? ''), clock: wire, live });
    this.remoteLiveMove = false;
  }

  // ---------- Züge ----------

  /** Gast: eigener Zug → Wunsch an den Host (true = abgeschickt, Figur bleibt bis zur Bestätigung stehen). */
  requestMove(from: Square, to: Square, promo: PieceSymbol): boolean {
    if (this.paused || !this.link.connected) {
      this.h.say(this.h.t('netPaused'), 2);
      return false;
    }
    const g = this.h.game;
    if (g.turn !== this.h.localColor() || !g.isLegal(from, to)) return false;
    const uci = from + to + (g.isPromotion(from, to) ? promo : '');
    this.pendingReq = uci;
    this.send({ t: 'move-req', uci, seq: g.plyCount, live: this.h.localPose().vr && !!this.h.localPose().live });
    return true;
  }

  // ---------- Eingang ----------

  private onMessage(m: PeerMsg): void {
    switch (m.t) {
      case 'hello':
        this.remoteName = m.name.slice(0, 24) || this.h.t(this.remoteColor === 'w' ? 'white' : 'black');
        this.remoteKind = m.client;
        this.remoteAnim = m.anim;
        if (this.role === 'host') {
          this.names[this.guestColor] = this.remoteName;
          this.names[this.guestColor === 'w' ? 'b' : 'w'] = this.h.localName();
          this.h.setNames(this.names);
          this.sendState();
        }
        this.h.refreshUi();
        return;
      case 'anim':
        this.remoteAnim = m.anim;
        return;
      case 'ping':
        if (this.role === 'host') this.send({ t: 'pong', c: m.c, h: performance.now() });
        return;
      case 'pong':
        this.sync.onPong(m.c, m.h, performance.now());
        this.updateConnLine();
        return;
      case 'pose':
        this.onPose(m);
        return;
      case 'emote':
        this.h.playSound('emote');
        this.h.setNote(`${this.remoteName || this.h.t('opponent')}: ${this.h.t(`emote_${m.id}`)}`);
        this.avatar.proximity = Math.max(this.avatar.proximity, 0.8);
        setTimeout(() => this.h.setNote(this.paused ? this.h.t('netPeerReconnecting') : null), 4000);
        return;
      case 'offer':
        void this.onOffer(m.kind);
        return;
      case 'answer':
        this.onAnswer(m.kind, m.ok);
        return;
      case 'coloc-boundary':
      case 'calib-ready':
      case 'calib-start':
      case 'calib-pose':
      case 'calib-result':
      case 'fine-tune':
      case 'recalibrate':
        this.h.onColoc?.(m);
        return;
    }
    if (this.role === 'host') this.onGuestMessage(m);
    else this.onHostMessage(m);
  }

  private onGuestMessage(m: PeerMsg): void {
    const g = this.h.game;
    switch (m.t) {
      case 'move-req': {
        const why = checkMoveRequest(g, this.guestColor, m.uci, this.paused);
        if (why) {
          this.send({ t: 'move-reject', uci: m.uci, reason: why, seq: g.plyCount });
          return;
        }
        this.remoteLiveMove = m.live && this.liveFresh();
        if (this.remoteLiveMove) this.h.board.markDropped(m.uci.slice(2, 4) as Square);
        g.tryMove(m.uci.slice(0, 2) as Square, m.uci.slice(2, 4) as Square, (m.uci[4] as PieceSymbol | undefined) ?? 'q');
        return;
      }
      case 'resign':
        if (m.color === this.guestColor) g.resign(this.guestColor);
        return;
    }
  }

  private onHostMessage(m: PeerMsg): void {
    const g = this.h.game;
    switch (m.t) {
      case 'setup': {
        const first = !this.seenSetup;
        this.seenSetup = true;
        this.kind = m.kind;
        this.guestColor = m.guestColor;
        this.tc = m.tc;
        this.h.setLocalColor(m.guestColor);
        this.names = m.names;
        this.names[m.guestColor] = this.h.localName();
        this.h.setNames(this.names);
        const tc = TIME_CONTROLS.find((c) => c.id === m.tc)?.tc ?? { initial: 0, increment: 0 };
        if (first || this.h.clock().tc.initial !== tc.initial) this.h.setClock(new ChessClock(tc));
        this.avatar.dispose();
        (this as { avatar: Avatar }).avatar = new Avatar(PLAYER_GLOW[m.guestColor === 'w' ? 'b' : 'w']);
        this.h.scene.add(this.avatar.root);
        return;
      }
      case 'state': {
        this.guestColor = m.guestColor;
        if (this.h.localColor() !== m.guestColor) this.h.setLocalColor(m.guestColor);
        this.names = { ...m.names, [m.guestColor]: this.h.localName() };
        this.h.setNames(this.names);
        this.pendingReq = null;
        applyHostMessage(g, m);
        this.applyClock(m.clock);
        if (m.paused !== this.paused) this.setPaused(m.paused);
        this.h.refreshUi();
        return;
      }
      case 'move': {
        const mine = this.pendingReq === m.uci;
        this.pendingReq = null;
        this.remoteLiveMove = !mine && m.live && this.liveFresh();
        if (this.remoteLiveMove) this.h.board.markDropped(m.uci.slice(2, 4) as Square);
        const r = applyHostMessage(g, m);
        if (r === 'resynced') this.send({ t: 'ping', c: performance.now() }); // Host schickt bei Bedarf den Zustand
        this.applyClock(m.clock);
        this.remoteLiveMove = false;
        return;
      }
      case 'move-reject':
        this.pendingReq = null;
        this.h.playSound('illegal');
        this.h.board.syncAll(); // Figur zurück auf ihr Feld
        return;
      case 'pause':
        this.setPaused(m.paused);
        return;
    }
  }

  private applyClock(w: import('./protocol').ClockWire | null): void {
    if (!w) return;
    const hostNow = this.sync.hostNow(performance.now());
    const start = Math.max(w.h, w.graceUntil ?? 0);
    this.h.clock().sync({ w: w.w, b: w.b, running: w.running }, hostNow - start);
  }

  // ---------- Angebote ----------

  offer(kind: 'draw' | 'undo' | 'rematch'): void {
    if (!this.link.connected) return this.h.say(this.h.t('netPaused'), 2);
    this.pendingOffer = kind;
    this.send({ t: 'offer', kind });
    this.h.say(this.h.t(kind === 'draw' ? 'drawOffered' : kind === 'undo' ? 'undoAsked' : 'rematchAsked'), 3);
  }

  private async onOffer(kind: 'draw' | 'undo' | 'rematch'): Promise<void> {
    const who = this.remoteName || this.h.t('opponent');
    const key = kind === 'draw' ? 'offerDrawQ' : kind === 'undo' ? 'offerUndoQ' : 'offerRematchQ';
    this.h.setNote(this.h.t(key, { name: who }));
    const ok = await this.h.confirm(this.h.t(key, { name: who }));
    this.h.setNote(null);
    this.send({ t: 'answer', kind, ok });
    if (ok && this.role === 'host') this.applyAgreement(kind, 'guest');
  }

  private onAnswer(kind: 'draw' | 'undo' | 'rematch', ok: boolean): void {
    if (this.pendingOffer !== kind) return;
    this.pendingOffer = null;
    this.h.say(this.h.t(ok ? 'offerAccepted' : 'offerDeclined'), 3);
    if (ok && this.role === 'host') this.applyAgreement(kind, 'host');
  }

  /** Host führt eine angenommene Vereinbarung aus. `by` = wer gefragt hat. */
  private applyAgreement(kind: 'draw' | 'undo' | 'rematch', by: 'host' | 'guest'): void {
    const g = this.h.game;
    if (kind === 'draw') g.agreeDraw();
    if (kind === 'undo') {
      const askerColor: Color = by === 'host' ? this.h.localColor() : this.guestColor;
      // Wer fragt, will seinen letzten Zug zurück: 1 Halbzug, wenn er zuletzt zog, sonst 2
      const n = g.turn === askerColor ? 2 : 1;
      for (let i = 0; i < n && g.plyCount > 0; i++) g.undo();
      this.h.clock().start(g.turn);
    }
    if (kind === 'rematch') {
      this.guestColor = this.guestColor === 'w' ? 'b' : 'w';
      this.h.setLocalColor(this.guestColor === 'w' ? 'b' : 'w');
      const n = { w: this.names.b, b: this.names.w };
      this.names = n;
      this.h.setNames(n);
      const tc = TIME_CONTROLS.find((c) => c.id === this.tc)?.tc ?? { initial: 0, increment: 0 };
      this.h.setClock(new ChessClock(tc));
      g.reset();
      this.send({ t: 'setup', kind: this.kind, guestColor: this.guestColor, tc: this.tc, names: this.names });
    }
    this.sendState();
    this.h.refreshUi();
  }

  resign(): void {
    const me = this.h.localColor();
    if (this.role === 'host') this.h.game.resign(me);
    else this.send({ t: 'resign', color: me });
  }

  emote(id: EmoteId): void {
    this.send({ t: 'emote', id });
    this.h.setNote(`${this.h.t('you')}: ${this.h.t(`emote_${id}`)}`);
    setTimeout(() => this.h.setNote(null), 2500);
  }

  setAnim(a: 'slow' | 'normal' | 'fast'): void {
    this.send({ t: 'anim', anim: a });
  }

  async setMic(on: boolean): Promise<boolean> {
    return this.link.setMic(on);
  }

  sendColoc(m: PeerMsg): void {
    this.send(m);
  }

  // ---------- Posen ----------

  private liveFresh(): boolean {
    return this.remoteKind === 'vr' && !!this.lastPose?.live && performance.now() - this.lastPoseAt < 400;
  }

  private onPose(m: PoseMsg): void {
    const now = performance.now();
    this.lastPose = m;
    this.lastPoseAt = now;
    this.remoteKind = m.kind;
    if (typeof (m as { s?: number }).s === 'number') this.remoteScale = Math.min(10, Math.max(0.05, (m as { s?: number }).s!));
    this.poses.push(now, { head: m.head, left: m.left ?? null, right: m.right ?? null, held: m.held?.p ?? null });
    const sq = (m.held?.sq as Square | undefined) ?? null;
    if (sq !== this.remoteHeldSq) {
      // Gegner lässt los, ohne zu ziehen → Figur zurück
      if (this.remoteHeldSq && !sq) {
        const pv = this.h.board.pieceAt(this.remoteHeldSq);
        if (pv && pv.square === this.remoteHeldSq) void this.h.board.returnPiece(pv);
      }
      this.remoteHeldSq = sq;
    }
  }

  /** Brett-Koordinaten (board.root lokal) einer Weltmatrix */
  private toBoard(world: THREE.Matrix4): PoseWire {
    const inv = this.h.board.root.matrixWorld.clone().invert();
    const m = inv.multiply(world);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    m.decompose(p, q, s);
    return [p.x, p.y, p.z, q.x, q.y, q.z, q.w].map((v) => Math.round(v * 1e4) / 1e4) as PoseWire;
  }

  private sendPose(): void {
    const lp = this.h.localPose();
    const bs = this.h.board.root.scale.x;
    const msg: PoseMsg & { s: number } = { t: 'pose', kind: lp.vr ? 'vr' : 'desktop', s: bs, live: lp.live };
    if (lp.vr && lp.head) {
      msg.head = this.toBoard(lp.head);
      const hand = (v: THREE.Vector3 | null | undefined) => (v ? this.toBoard(new THREE.Matrix4().setPosition(v)) : null);
      msg.left = hand(lp.left);
      msg.right = hand(lp.right);
    } else msg.hover = this.h.hoverSquare();
    const held = this.h.heldPiece();
    msg.held = held ? { sq: held.square, p: this.toBoard(held.root.matrixWorld) } : null;
    this.send(msg, false);
  }

  // ---------- pro Frame ----------

  update(dt: number, time: number): void {
    const now = performance.now();
    this.sendTimer += dt;
    if (this.link.connected && this.sendTimer >= 1 / this.poseHz) {
      this.sendTimer = 0;
      this.sendPose();
    }
    if (this.role === 'guest') {
      this.pingTimer -= dt;
      if (this.pingTimer <= 0 && this.link.connected) {
        this.pingTimer = 2;
        this.send({ t: 'ping', c: now });
      }
    } else {
      this.pingTimer -= dt;
      if (this.pingTimer <= 0 && this.link.connected) {
        this.pingTimer = 2;
        this.send({ t: 'ping', c: now }); // auch der Host misst die Latenz (Anzeige)
      }
    }
    this.renderRemote(now, time);
  }

  private renderRemote(now: number, time: number): void {
    this.avatar.update(time);
    const stale = now - this.lastPoseAt > 3000;
    if (!this.lastPose || stale) {
      // Co-Location: Avatar bleibt aus Sicherheitsgründen sichtbar (letzte Pose), online ausblenden
      if (this.kind !== 'coloc') this.avatar.hide();
      return;
    }
    const s = this.poses.sample(now);
    if (!s) return;
    const root = this.h.board.root;
    root.updateMatrixWorld();
    // Maßstab: Kopfgröße relativ zum eigenen Brett (online verschieden große Bretter)
    this.avatar.scale = this.kind === 'coloc' ? 1 : Math.min(4, Math.max(0.25, root.scale.x / this.remoteScale));
    const toWorld = (p: number[]) => new THREE.Matrix4().compose(new THREE.Vector3(p[0], p[1], p[2]), new THREE.Quaternion(p[3], p[4], p[5], p[6]), new THREE.Vector3(1, 1, 1)).premultiply(root.matrixWorld);
    if (this.remoteKind === 'vr' && s.head) {
      const hw = toWorld(s.head);
      // Skalierung des Bretts aus der Matrix entfernen (nur Lage)
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      hw.decompose(p, q, sc);
      const hand = (v: number[] | null | undefined) => (v ? new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(root.matrixWorld) : null);
      this.avatar.setVR(new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)), hand(s.left), hand(s.right));
    } else {
      // Desktop-Gegner: schwebender Kopf hinter seiner Grundreihe, Zeiger-Licht über dem Feld
      const sq = this.board().square;
      const side = this.remoteColor === 'w' ? 1 : -1;
      const headLocal = new THREE.Vector3(0, this.h.board.kingHeight * 1.55, side * sq * 5.2);
      const head = headLocal.clone().applyMatrix4(root.matrixWorld);
      const hoverSq = this.lastPose.hover as Square | null | undefined;
      let hover: THREE.Vector3 | null = null;
      let look = new THREE.Vector3(0, 0, 0).applyMatrix4(root.matrixWorld);
      if (hoverSq) {
        const c = squareCenter(hoverSq, sq);
        c.y = this.h.board.board.surfaceY;
        hover = c.applyMatrix4(root.matrixWorld);
        look = hover.clone();
      }
      this.avatar.scale = root.scale.x * 2.2;
      this.avatar.setDesktop(head, look, hover, sq * 0.42 * root.scale.x);
    }
    // getragene Figur des Gegners live zeigen
    if (this.remoteHeldSq && s.held) {
      const pv = this.h.board.pieceAt(this.remoteHeldSq);
      if (pv && pv.color === this.remoteColor && !this.h.board.busy) {
        const local = new THREE.Vector3(s.held[0], s.held[1] - this.h.board.board.surfaceY, s.held[2]);
        pv.root.position.copy(local);
      }
    }
  }

  private board(): { square: number } {
    return { square: this.h.board.squareSize };
  }

  dispose(): void {
    this.link.close();
    this.avatar.dispose();
  }
}
