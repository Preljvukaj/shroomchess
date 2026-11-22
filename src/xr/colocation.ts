import * as THREE from 'three';
import type { Color } from '../core/types';
import type { PeerMsg } from '../net/protocol';
import { FRAME_WIDTH_FACTOR } from '../render/coordLayout';
import { maxHalfSideAt } from './math/boardFit';
import { type FloorPose, type Rigid2D, IDENTITY, applyRigidPose, averagePoses, colocBoard, composeRigid, invertRigid, solveGuestToHost, transformRegion } from './math/calibration';
import type { V2 } from './math/vec2';
import { forward, rotate } from './math/vec2';
import { V } from './strings';
import { Button3D, ButtonGroup, Panel3D } from './ui3d';
import type { XRPointer } from './xrInput';

/**
 * Co-Location (Meilenstein 4): Rücken-an-Rücken-Kalibrierung zweier Brillen im selben Raum.
 *
 *  1. Host liest seine Boundary (bounded-floor bzw. manuelle Einrichtung) und schickt sie dem Gast.
 *  2. Anleitung (Text + Animation zweier Figuren Rücken an Rücken). Beide halten Trigger/Pinch 2 s → bereit.
 *  3. Sind beide bereit, startet der Host einen 3-s-Countdown; danach erfasst jede Brille 0,5 s lang Kopfposition
 *     (auf den Boden projiziert) und Yaw und mittelt.
 *  4. Der Gast schickt seine Pose, der Host antwortet mit seiner Pose + Brett-Pose (Host-Raum). Der Gast berechnet
 *     daraus die Transformation Gast → Host (Yaw + 180°, Versatz konfigurierbar, Standard 0,30 m) und rechnet Boundary
 *     und Brett in sein System um. Beide Bretter liegen danach an derselben realen Stelle.
 *  5. Kontrolle: Abklatschen. Liegen die virtuellen Hände > 5 cm auseinander → Feinjustierung (Thumbsticks, live) oder
 *     neue Kalibrierung. Reset des Referenzraums oder Tracking-Verlust → Aufforderung zur Neukalibrierung.
 *  Sicherheit: Avatar < 1 m heller, < 0,5 m Warnung mit Ton und Vibration.
 */

export interface ColocHost {
  role: 'host' | 'guest';
  send(m: PeerMsg): void;
  offset(): number;
  localColor(): Color;
  roomCode(): string;
  peerConnected(): boolean;
  /** Avatar des anderen (Welt) */
  remoteHead(): THREE.Vector3 | null;
  remoteHands(): THREE.Vector3[];
  setRemoteGlow(k: number): void;
  warnSound(): void;
}

export interface ColocVR {
  head(): THREE.Vector3;
  headYaw(): number;
  say(text: string, sec: number): void;
  ui: THREE.Group;
  /** eigene Boundary (nur Host relevant) */
  region(): V2[];
  /** Brett in eigenen Koordinaten setzen (Region = Host-Boundary in eigenen Koordinaten) */
  place(region: V2[], board: { center: V2; yaw: number; squareSize: number; totalSide: number }): void;
  stick(h: 'left' | 'right'): [number, number];
  buttonDown(h: 'left' | 'right', i: number): boolean;
  haptic(intensity: number, ms: number): void;
  handTips(): THREE.Vector3[];
}

type Phase = 'wait' | 'instruct' | 'countdown' | 'capture' | 'await-result' | 'done' | 'check' | 'finetune';

const HOLD_SECONDS = 2;
const COUNTDOWN = 3;
const CAPTURE_SECONDS = 0.5;

export class ColocController {
  phase: Phase = 'wait';
  private panel = new Panel3D({ fontSize: 0.03, maxWidth: 1.0 });
  private buttons = new ButtonGroup();
  private anim = new THREE.Group();
  private holdT = 0;
  private readyMe = false;
  private readyPeer = false;
  private countdownEnd = 0;
  private captureEnd = 0;
  private samples: FloorPose[] = [];
  private myPose: FloorPose | null = null;
  private peerPose: FloorPose | null = null;
  private hostRegion: V2[] | null = null;
  /** Gast → Host */
  private T: Rigid2D = IDENTITY;
  private fine: Rigid2D = IDENTITY;
  private boardHost: { center: V2; yaw: number; squareSize: number; totalSide: number } | null = null;
  private time = 0;
  private lastWarn = 0;
  private highFive: { start: number; minD: number; closeFor: number } | null = null;
  private startMarker: THREE.Mesh;
  calibrated = false;

  constructor(private h: ColocHost, private v: ColocVR) {
    v.ui.add(this.panel.root, this.anim);
    this.buildAnim();
    const ring = new THREE.RingGeometry(0.22, 0.3, 40).rotateX(-Math.PI / 2);
    this.startMarker = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: '#4dfff0', transparent: true, opacity: 0.6, depthWrite: false }));
    this.startMarker.visible = false;
    v.ui.add(this.startMarker);
    const ok = this.buttons.add(new Button3D('ok', V('colocOk'), 0.03, '#9dff3a'));
    const ft = this.buttons.add(new Button3D('fine', V('colocFineTune'), 0.03, '#2fd8ff'));
    const rc = this.buttons.add(new Button3D('recal', V('colocRecal'), 0.03, '#ff4fd8'));
    ok.root.position.set(-0.42, -0.22, 0);
    ft.root.position.set(-0.12, -0.22, 0);
    rc.root.position.set(0.22, -0.22, 0);
    for (const b of this.buttons.buttons) this.panel.root.add(b.root);
    this.showButtons(false);
    this.enter('wait');
  }

  private showButtons(on: boolean, fineOnly = false): void {
    for (const b of this.buttons.buttons) b.root.visible = on && (!fineOnly || b.id === 'ok');
  }

  /** Zwei Figuren Rücken an Rücken, leicht wippend (Anleitung). */
  private buildAnim(): void {
    const mat = (c: string) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85 });
    for (const [i, c] of [[0, '#4dfff0'], [1, '#ff4fd8']] as const) {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.14, 4, 8), mat(c));
      const headM = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), mat(c));
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.03, 6).rotateX(-Math.PI / 2), mat('#ffffff'));
      const g = new THREE.Group();
      body.position.y = 0.1;
      headM.position.y = 0.22;
      nose.position.set(0, 0.22, -0.035);
      g.add(body, headM, nose);
      g.position.z = i === 0 ? -0.04 : 0.04;
      g.rotation.y = i === 0 ? 0 : Math.PI;
      g.userData.base = g.position.z;
      this.anim.add(g);
    }
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.002, 0.004), mat('#ffffff'));
    this.anim.add(line);
  }

  private enter(p: Phase): void {
    this.phase = p;
    this.panel.root.visible = p !== 'done';
    this.anim.visible = p === 'instruct' || p === 'countdown';
    this.showButtons(p === 'check' || p === 'finetune', p === 'finetune');
    if (p === 'finetune') this.buttons.buttons.find((b) => b.id === 'ok')?.setLabel(V('colocFineDone'));
    else this.buttons.buttons.find((b) => b.id === 'ok')?.setLabel(V('colocOk'));
    if (p === 'instruct') {
      this.holdT = 0;
      this.readyMe = false;
      this.readyPeer = false;
      this.calibrated = false;
    }
    this.refreshText();
  }

  private refreshText(): void {
    switch (this.phase) {
      case 'wait':
        this.panel.setText(this.h.peerConnected() ? V('colocWaitBoundary') : V('colocWaitPeer', { code: this.h.roomCode() }));
        break;
      case 'instruct':
        this.panel.setText(`${V('colocInstruct')}\n\n${this.readyMe ? V('colocWaitOther') : V('colocHoldMe', { p: Math.round((this.holdT / HOLD_SECONDS) * 100) })}`);
        break;
      case 'countdown':
        this.panel.setText(V('colocCountdown', { n: Math.max(1, Math.ceil(this.countdownEnd - this.time)) }));
        break;
      case 'capture':
      case 'await-result':
        this.panel.setText(V('colocCapturing'));
        break;
      case 'check':
        break;
      case 'finetune':
        this.panel.setText(V('colocFineHelp'));
        break;
    }
  }

  /** Host: eigene Boundary ist bekannt → an den Gast schicken. */
  boundaryReady(): void {
    if (this.h.role !== 'host') return;
    this.hostRegion = this.v.region();
    this.h.send({ t: 'coloc-boundary', region: this.hostRegion });
    if (this.phase === 'wait' && this.h.peerConnected()) this.enter('instruct');
  }

  /** Gegner (neu) verbunden. */
  peerReady(): void {
    if (this.h.role === 'host' && this.hostRegion) {
      this.h.send({ t: 'coloc-boundary', region: this.hostRegion });
      if (this.phase === 'wait') this.enter('instruct');
    }
    this.refreshText();
  }

  /** Aufforderung zur Neukalibrierung (Reset, Tracking-Verlust, Menü, Gegenseite). */
  recalibrate(reasonKey: 'colocReset' | 'colocTrackingLost' | 'colocPeerRecal' | null, notifyPeer = true): void {
    if (reasonKey) this.v.say(V(reasonKey), 6);
    if (notifyPeer) this.h.send({ t: 'recalibrate' });
    this.fine = IDENTITY;
    this.startMarker.visible = false;
    this.enter(this.hostRegion ? 'instruct' : 'wait');
  }

  onMessage(m: PeerMsg): void {
    switch (m.t) {
      case 'coloc-boundary':
        if (this.h.role === 'guest') {
          this.hostRegion = m.region;
          if (this.phase === 'wait') this.enter('instruct');
        }
        return;
      case 'calib-ready':
        this.readyPeer = m.ready;
        if (this.h.role === 'host') this.maybeStart();
        return;
      case 'calib-start':
        // Countdown relativ zum Empfang (LAN-Latenz vernachlässigbar)
        this.countdownEnd = this.time + m.at / 1000;
        this.enter('countdown');
        return;
      case 'calib-pose':
        this.peerPose = { pos: m.pos, yaw: m.yaw };
        if (this.h.role === 'host') this.solveAsHost();
        else this.solveAsGuest();
        return;
      case 'calib-result':
        if (this.h.role === 'guest') {
          this.boardHost = { center: { x: m.board.x, z: m.board.z }, yaw: m.board.yaw, squareSize: m.board.squareSize, totalSide: m.board.totalSide };
          this.solveAsGuest();
        }
        return;
      case 'fine-tune':
        return; // der Gast justiert; beim Host bewegt sich nur der Avatar (über die Posen)
      case 'recalibrate':
        this.recalibrate('colocPeerRecal', false);
        return;
    }
  }

  private maybeStart(): void {
    if (this.readyMe && this.readyPeer && this.phase === 'instruct') {
      const at = COUNTDOWN * 1000;
      this.h.send({ t: 'calib-start', at });
      this.countdownEnd = this.time + COUNTDOWN;
      this.enter('countdown');
    }
  }

  private solveAsHost(): void {
    if (!this.myPose || !this.peerPose || !this.hostRegion) return;
    const region = this.hostRegion;
    const b = colocBoard(this.myPose, this.h.localColor(), this.h.offset(), FRAME_WIDTH_FACTOR, (c, y, mg) => maxHalfSideAt(region, c, y, mg));
    this.boardHost = b;
    this.h.send({ t: 'calib-pose', pos: this.myPose.pos, yaw: this.myPose.yaw });
    this.h.send({ t: 'calib-result', board: { x: b.center.x, z: b.center.z, yaw: b.yaw, squareSize: b.squareSize, totalSide: b.totalSide } });
    this.v.place(region, b);
    if (b.tight) this.v.say(V('colocTight'), 5);
    this.finish();
  }

  private solveAsGuest(): void {
    if (!this.myPose || !this.peerPose || !this.boardHost || !this.hostRegion) return;
    // peerPose = Host-Pose (Host-Raum), myPose = eigene Pose
    this.T = solveGuestToHost(this.peerPose, this.myPose, this.h.offset());
    this.applyGuestTransform();
    this.finish();
  }

  /** Gast: Host-Boundary und Brett mit (T ∘ Feinjustierung)⁻¹ ins eigene System bringen. */
  private applyGuestTransform(): void {
    if (!this.boardHost || !this.hostRegion) return;
    const G2H = composeRigid(this.fine, this.T);
    const H2G = invertRigid(G2H);
    const bh = this.boardHost;
    const pose = applyRigidPose(H2G, { pos: bh.center, yaw: bh.yaw });
    this.v.place(transformRegion(H2G, this.hostRegion), { center: pose.pos, yaw: pose.yaw, squareSize: bh.squareSize, totalSide: bh.totalSide });
  }

  private finish(): void {
    this.calibrated = true;
    this.enter('done');
    const myColor = this.h.localColor();
    this.v.say(V('colocDone', { color: myColor === 'w' ? V('white') : V('black') }), 7);
    // Startposition hinter der eigenen Grundreihe markieren (läuft man geradeaus, steht man dort)
    const me = this.myPose!;
    const dist = (this.boardHost?.totalSide ?? 2) / 2 + 0.45;
    const startHalf = this.h.offset() / 2;
    const f = forward(me.yaw);
    const c = { x: me.pos.x - f.x * startHalf + f.x * 0, z: me.pos.z - f.z * startHalf };
    const target = { x: c.x + f.x * dist, z: c.z + f.z * dist };
    this.startMarker.position.set(target.x, 0.01, target.z);
    this.startMarker.visible = true;
    setTimeout(() => {
      this.startMarker.visible = false;
      this.startHighFive();
    }, 9000);
  }

  /** Abklatsch-Check starten (nach der Kalibrierung und aus dem Menü). */
  startHighFive(): void {
    if (!this.calibrated) return;
    this.highFive = { start: this.time, minD: Infinity, closeFor: 0 };
    this.v.say(V('colocHighFive'), 6);
  }

  // ---------- pro Frame ----------

  update(dt: number, pointers: XRPointer[], consumed: Set<string>): void {
    this.time += dt;
    const head = this.v.head();
    // Tafel vor dem Spieler
    if (this.panel.root.visible) {
      const f = new THREE.Vector3(-Math.sin(this.v.headYaw()), 0, -Math.cos(this.v.headYaw()));
      const target = head.clone().addScaledVector(f, 1.0).setY(head.y - 0.15);
      if (this.panel.root.position.distanceTo(target) > 0.25) this.panel.root.position.lerp(target, 0.06);
      this.panel.faceYaw(head);
      this.anim.position.copy(this.panel.root.position).add(new THREE.Vector3(0, 0.22, 0));
      this.anim.rotation.y = this.v.headYaw() + Math.PI / 2;
      this.anim.children.forEach((g, i) => {
        if (i < 2) g.position.z = (g.userData.base as number) + Math.sin(this.time * 2) * 0.01 * (i === 0 ? -1 : 1);
      });
    }
    switch (this.phase) {
      case 'wait':
        this.refreshText();
        break;
      case 'instruct': {
        const holding = pointers.some((p) => p.pressed);
        if (holding) this.holdT += dt;
        else this.holdT = Math.max(0, this.holdT - dt * 2);
        const ready = this.holdT >= HOLD_SECONDS;
        if (ready !== this.readyMe) {
          this.readyMe = ready;
          if (ready) this.v.haptic(0.6, 80);
          this.h.send({ t: 'calib-ready', ready });
          if (this.h.role === 'host') this.maybeStart();
        }
        this.refreshText();
        break;
      }
      case 'countdown':
        this.refreshText();
        if (this.time >= this.countdownEnd) {
          this.samples = [];
          this.captureEnd = this.time + CAPTURE_SECONDS;
          this.v.haptic(0.8, 120);
          this.enter('capture');
        }
        break;
      case 'capture':
        this.samples.push({ pos: { x: head.x, z: head.z }, yaw: this.v.headYaw() });
        if (this.time >= this.captureEnd) {
          this.myPose = averagePoses(this.samples);
          this.enter('await-result');
          if (this.h.role === 'guest') this.h.send({ t: 'calib-pose', pos: this.myPose.pos, yaw: this.myPose.yaw });
          else this.solveAsHost();
        }
        break;
      case 'check':
      case 'finetune': {
        const fired = this.buttons.update(dt, pointers, true, consumed);
        if (this.phase === 'finetune') this.updateFineTune(dt);
        if (fired === 'ok' || (this.phase === 'finetune' && (this.v.buttonDown('right', 4) || this.v.buttonDown('left', 4)))) this.enter('done');
        if (fired === 'fine') this.enter('finetune');
        if (fired === 'recal') this.recalibrate(null);
        break;
      }
    }
    this.updateSafety();
    this.updateHighFive(dt);
  }

  private updateFineTune(dt: number): void {
    if (this.h.role !== 'guest') return;
    const [lx, ly] = this.v.stick('left');
    const [rx] = this.v.stick('right');
    if (!lx && !ly && !rx) return;
    // Verschieben relativ zur Blickrichtung, langsam (präzise): 0,15 m/s, Drehung 8°/s
    const yaw = this.v.headYaw();
    const move = rotate({ x: lx, z: ly }, yaw);
    const step = 0.15 * dt;
    const pivot = this.boardHost?.center ?? { x: 0, z: 0 };
    const dYaw = -rx * ((8 * Math.PI) / 180) * dt;
    const R: Rigid2D = { yaw: dYaw, t: { x: pivot.x - rotate(pivot, dYaw).x, z: pivot.z - rotate(pivot, dYaw).z } };
    this.fine = composeRigid({ yaw: 0, t: { x: -move.x * step, z: -move.z * step } }, composeRigid(R, this.fine));
    this.applyGuestTransform();
    this.h.send({ t: 'fine-tune', yaw: this.fine.yaw, x: this.fine.t.x, z: this.fine.t.z });
  }

  private updateSafety(): void {
    const rh = this.h.remoteHead();
    if (!rh) return;
    const me = this.v.head();
    const d = Math.hypot(rh.x - me.x, rh.z - me.z);
    // < 1 m: Avatar leuchtet stärker; < 0,5 m: deutliche Warnung mit Ton und Vibration
    this.h.setRemoteGlow(d < 1 ? Math.min(1, (1 - d) / 0.5) : 0);
    if (d < 0.5 && this.time - this.lastWarn > 1.5 && this.calibrated) {
      this.lastWarn = this.time;
      this.v.say(V('colocTooClose'), 2);
      this.h.warnSound();
      this.v.haptic(1, 200);
    }
  }

  private updateHighFive(dt: number): void {
    const hf = this.highFive;
    if (!hf) return;
    if (this.time - hf.start > 20) {
      this.highFive = null;
      return;
    }
    const mine = this.v.handTips();
    const theirs = this.h.remoteHands();
    if (!mine.length || !theirs.length) return;
    let d = Infinity;
    for (const a of mine) for (const b of theirs) d = Math.min(d, a.distanceTo(b));
    if (d < 0.3) {
      hf.closeFor += dt;
      hf.minD = Math.min(hf.minD, d);
    } else if (hf.closeFor > 0.25) {
      // Berührung vorbei → auswerten. Die verfolgten Punkte (Fingerspitze/Controllerspitze) liegen bei Kontakt
      // real etwa 3 cm auseinander → Abweichung = Abstand − 3 cm.
      const err = Math.max(0, hf.minD - 0.03);
      this.highFive = null;
      const cm = Math.round(err * 100);
      if (err > 0.05) {
        this.panel.setText(V('colocHighFiveOff', { cm }));
        this.enter('check');
        this.panel.setText(V('colocHighFiveOff', { cm }));
      } else this.v.say(V('colocHighFiveOk', { cm }), 4);
    } else hf.closeFor = 0;
  }

  dispose(): void {
    this.panel.root.removeFromParent();
    this.anim.removeFromParent();
    this.startMarker.removeFromParent();
  }
}
