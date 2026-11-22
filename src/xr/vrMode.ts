import * as THREE from 'three';
import type { Quality } from '../core/settings';
import { settings } from '../core/settings';
import type { Color } from '../core/types';
import type { InteractionController, Pointer } from '../render/interaction';
import { PLAYER_GLOW } from '../render/pieces';
import { BoundaryWarning, WARN_DISTANCE, distanceToBoundary } from './boundaryWarning';
import { type BoardPlacement, orderPolygon, palmFacesHead, placeBoard } from './math/placement';
import type { V2 } from './math/vec2';
import { V } from './strings';
import { Button3D, ButtonGroup, Panel3D } from './ui3d';
import { type XRPointer, XRInput } from './xrInput';
import { ColocController, type ColocHost } from './colocation';
import type { PeerMsg } from '../net/protocol';

/**
 * VR-Einzelspieler (Meilenstein 2): Sitzung, Spielfläche, Brett-Platzierung, 3D-Oberfläche,
 * Eingabe-Verteilung (UI zuerst, dann Brett), Grenzwarnung, Reaktion auf Tracking-Reset.
 * Das Spiel selbst (Regeln, Figuren, Griffpunkte) bleibt unverändert – VR liefert nur andere Zeiger.
 */

export interface VRHost {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  rig: THREE.Object3D;
  camera: THREE.PerspectiveCamera;
  quality: Quality;
  interaction: InteractionController;
  boardRoot: THREE.Object3D;
  /** Brett-Halbbreite inkl. Rahmen in Brett-Einheiten (Desktop-Maßstab) */
  boardHalfLocal: number;
  /** Feldgröße in Brett-Einheiten (Desktop-Maßstab, 0,5) */
  localSquare: number;
  /** Farbe, deren Grundreihe zum Spieler zeigen soll */
  playerColor(): Color;
  /** Welt/Senke für die Spielfläche neu bauen und Brett platzieren */
  applyPlacement(p: BoardPlacement, region: V2[]): void;
  /** Rückkehr zum Desktop-Layout */
  onExit(): void;
  isGameOver(): boolean;
  action(id: string): void;
  /** Für Untertitel/Hinweise in VR */
  setSubtitleSink(fn: ((text: string) => void) | null): void;
  /** Netzwerkspiel: Menüpunkte für Nachrichten/Sprachchat */
  net?: boolean;
  /** Co-Location (zwei Brillen im selben Raum) */
  coloc?: ColocHost;
}

type Phase = 'idle' | 'setup' | 'playing';

export class VRMode {
  private session: XRSession | null = null;
  private input: XRInput | null = null;
  private phase: Phase = 'idle';
  private region: V2[] = [];
  private placement: BoardPlacement | null = null;
  private manualSide: number | undefined;
  private warning: BoundaryWarning | null = null;
  private showBoundary = 0;
  private notice = new Panel3D({ fontSize: 0.032, maxWidth: 0.9 });
  private noticeUntil = 0;
  private menu = new THREE.Group();
  private menuTitle = new Panel3D({ fontSize: 0.02, maxWidth: 0.3 });
  private menuButtons = new ButtonGroup();
  private menuOpen = false;
  private menuToggled = false;
  private palmTimer = 0;
  private setupPanel = new Panel3D({ fontSize: 0.03, maxWidth: 1.0 });
  private setupButtons = new ButtonGroup();
  private corners: V2[] = [];
  private cornerMarkers = new THREE.Group();
  private needsPlacement = false;
  private resignArmedUntil = 0;
  private armedId = '';
  private lastPressed = new Map<string, boolean>();
  private time = 0;
  private noticeTarget = new THREE.Vector3();
  private coloc: ColocController | null = null;
  private confirmPanel = new Panel3D({ fontSize: 0.03, maxWidth: 0.9 });
  private confirmButtons = new ButtonGroup();
  private confirmResolve: ((ok: boolean) => void) | null = null;
  private trackingLostFor = 0;

  constructor(private host: VRHost) {
    const ui = new THREE.Group();
    ui.name = 'vr-ui';
    ui.add(this.notice.root, this.menu, this.setupPanel.root, this.cornerMarkers, this.confirmPanel.root);
    this.menu.visible = false;
    this.buildMenu();
    const yes = this.confirmButtons.add(new Button3D('yes', V('yes'), 0.035, '#9dff3a'));
    const no = this.confirmButtons.add(new Button3D('no', V('no'), 0.035, '#ff4fd8'));
    yes.root.position.set(-0.25, -0.16, 0);
    no.root.position.set(0.08, -0.16, 0);
    this.confirmPanel.root.add(yes.root, no.root);
    this.buildSetup();
    this.uiRoot = ui;
  }

  private uiRoot: THREE.Group;

  get active(): boolean {
    return this.session !== null;
  }

  static async supported(): Promise<boolean> {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr || !window.isSecureContext) return false;
    try {
      return await xr.isSessionSupported('immersive-vr');
    } catch {
      return false;
    }
  }

  /** Muss direkt aus einer Nutzergeste (Klick) aufgerufen werden. */
  async enter(): Promise<void> {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) throw new Error('WebXR nicht verfügbar');
    const session = await xr.requestSession('immersive-vr', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['bounded-floor', 'hand-tracking'],
    });
    // bounded-floor bevorzugen, wenn die Brille eine Spielfläche liefert
    let type: XRReferenceSpaceType = 'local-floor';
    let bounds: V2[] = [];
    try {
      const bsp = (await session.requestReferenceSpace('bounded-floor')) as XRBoundedReferenceSpace;
      bounds = Array.from(bsp.boundsGeometry ?? []).map((p) => ({ x: p.x, z: p.z }));
      if (bounds.length >= 3) type = 'bounded-floor';
    } catch {
      /* nicht unterstützt → local-floor + manuelle Einrichtung */
    }
    // Debug-Modus (?xremu=1&bounds=4x3): Test-Spielfläche, weil der Emulator keine liefert
    const dbg = (window as unknown as { __myzelDebugBounds?: V2[] }).__myzelDebugBounds;
    if (bounds.length < 3 && dbg) bounds = dbg;
    const r = this.host.renderer;
    r.xr.setReferenceSpaceType(type);
    r.xr.setFramebufferScaleFactor(this.host.quality === 'high' ? 1.2 : this.host.quality === 'medium' ? 1.0 : 0.9);
    r.xr.setFoveation(1); // fester Foveated-Rendering-Grad (Quest: spart deutlich Fill-Rate)
    await r.xr.setSession(session);
    this.session = session;
    this.input ??= new XRInput(r, this.host.rig);
    this.host.scene.add(this.uiRoot);
    session.addEventListener('end', () => this.onEnd());
    const ref = r.xr.getReferenceSpace();
    ref?.addEventListener('reset', () => void this.onReset(type));
    this.host.setSubtitleSink((txt) => this.say(txt, 3));

    this.rebuildMenu();
    if (this.host.coloc) {
      this.coloc?.dispose();
      const vr = this;
      this.coloc = new ColocController(this.host.coloc, {
        head: () => vr.head(),
        headYaw: () => vr.headYaw(),
        say: (t, s) => vr.say(t, s),
        ui: this.uiRoot,
        region: () => vr.region,
        place: (region, b) => vr.placeColoc(region, b),
        stick: (h) => vr.input?.stick(h) ?? [0, 0],
        buttonDown: (h, i) => vr.input?.buttonDown(h, i) ?? false,
        haptic: (k, ms) => vr.input?.pointers.forEach((p) => p.haptic?.(k, ms)),
        handTips: () => (vr.input?.pointers ?? []).map((p) => p.tip.clone()),
      });
      for (const m of this.colocInbox) this.coloc.onMessage(m);
      this.colocInbox = [];
    }
    if (this.host.coloc?.role === 'guest') {
      // Gast: Spielfläche kommt vom Host (über die Kalibrierung)
      this.phase = 'playing';
    } else if (bounds.length >= 3) {
      this.region = orderPolygon(bounds);
      this.phase = 'playing';
      if (this.coloc) this.coloc.boundaryReady();
      else this.needsPlacement = true; // nach dem ersten Frame (Kopfpose bekannt)
    } else {
      this.startSetup();
    }
  }

  exit(): void {
    void this.session?.end();
  }

  private onEnd(): void {
    this.session = null;
    this.phase = 'idle';
    this.uiRoot.removeFromParent();
    this.warning?.dispose();
    this.warning = null;
    this.host.setSubtitleSink(null);
    this.host.onExit();
  }

  private async onReset(type: XRReferenceSpaceType): Promise<void> {
    if (!this.session) return;
    if (this.coloc) {
      // Neu zentriert → beide Koordinatensysteme passen nicht mehr zusammen
      if (this.host.coloc?.role === 'host' && type === 'bounded-floor') {
        try {
          const bsp = (await this.session.requestReferenceSpace('bounded-floor')) as XRBoundedReferenceSpace;
          const b = Array.from(bsp.boundsGeometry ?? []).map((p) => ({ x: p.x, z: p.z }));
          if (b.length >= 3) this.region = orderPolygon(b);
        } catch {
          /* alte Fläche */
        }
        this.coloc.boundaryReady();
      }
      this.coloc.recalibrate('colocReset');
      return;
    }
    if (type === 'bounded-floor') {
      try {
        const bsp = (await this.session.requestReferenceSpace('bounded-floor')) as XRBoundedReferenceSpace;
        const b = Array.from(bsp.boundsGeometry ?? []).map((p) => ({ x: p.x, z: p.z }));
        if (b.length >= 3) this.region = orderPolygon(b);
      } catch {
        /* alte Fläche behalten */
      }
      this.needsPlacement = true;
      this.say(V('reset'), 6);
    } else {
      this.say(V('resetLocal'), 6);
      this.startSetup();
    }
  }

  // ---------- Platzierung ----------

  /**
   * Kopfmitte (Welt). Achtung: Die XR-Kamera von three.js liegt auf dem LINKEN Auge – für die Kalibrierung zählt die
   * Mitte zwischen beiden Augen (sonst addieren sich Rücken an Rücken 2 × 3 cm Fehler).
   */
  private head(): THREE.Vector3 {
    const xr = this.host.renderer.xr;
    if (xr.isPresenting) {
      const cams = xr.getCamera().cameras;
      if (cams.length >= 2) {
        const a = new THREE.Vector3().setFromMatrixPosition(cams[0].matrixWorld);
        const b = new THREE.Vector3().setFromMatrixPosition(cams[1].matrixWorld);
        return a.add(b).multiplyScalar(0.5);
      }
    }
    return this.host.camera.getWorldPosition(new THREE.Vector3());
  }

  /** Kopfpose (Welt) mit der Kopfmitte als Position – für die Posen-Übertragung. */
  headMatrix(): THREE.Matrix4 {
    const q = this.host.camera.getWorldQuaternion(new THREE.Quaternion());
    return new THREE.Matrix4().compose(this.head(), q, new THREE.Vector3(1, 1, 1));
  }

  private headYaw(): number {
    const d = this.host.camera.getWorldDirection(new THREE.Vector3());
    return Math.atan2(-d.x, -d.z);
  }

  private place(): void {
    const h = this.head();
    const p = placeBoard(this.region, { pos: { x: h.x, z: h.z }, yaw: this.headYaw() }, this.host.playerColor(), {
      seated: settings.get().seated,
      manualSide: this.manualSide,
    });
    this.placement = p;
    this.host.applyPlacement(p, this.region);
    this.warning?.dispose();
    this.warning = new BoundaryWarning(this.region);
    this.host.scene.add(this.warning.mesh);
    if (p.mode === 'roomscale') this.say(V('placedRoom', { cm: Math.round(p.squareSize * 100), kcm: Math.round(p.squareSize * 220) }), 7);
    else this.say(V(p.reason === 'seated' ? 'placedSeated' : 'placedSmall'), 7);
    setTimeout(() => {
      // nur, wenn gerade nichts Wichtigeres angezeigt wird
      if (!this.notice.root.visible) this.say(this.input?.hasController('left') ? V('menuHintController') : V('menuHintHand'), 5);
    }, 7500);
  }

  // ---------- Manuelle Flächeneinrichtung (local-floor) ----------

  private buildSetup(): void {
    const b1 = this.setupButtons.add(new Button3D('seated', V('setupSeated'), 0.035, '#ff4fd8'));
    const b2 = this.setupButtons.add(new Button3D('restart', V('setupRestart'), 0.035, '#2fd8ff'));
    b1.root.position.set(-0.32, -0.2, 0);
    b2.root.position.set(0.08, -0.2, 0);
    this.setupPanel.root.add(b1.root, b2.root);
  }

  private startSetup(): void {
    this.phase = 'setup';
    this.corners = [];
    this.cornerMarkers.clear();
    this.setupPanel.root.visible = true;
    this.updateSetupText();
  }

  private updateSetupText(): void {
    this.setupPanel.setText(`${V('setupTitle')}\n\n${V('setupBody', { n: 4, i: Math.min(4, this.corners.length + 1) })}`);
  }

  private setupStep(pointers: XRPointer[], consumed: Set<string>): void {
    const h = this.head();
    // Tafel 1,1 m vor dem Kopf, leicht unter Augenhöhe
    const f = this.host.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    this.noticeTarget.copy(h).addScaledVector(f, 1.1).setY(h.y - 0.2);
    this.setupPanel.root.position.lerp(this.noticeTarget, 0.05);
    this.setupPanel.faceYaw(h);
    const fired = this.setupButtons.update(1 / 72, pointers, true, consumed);
    if (fired === 'seated') {
      settings.set({ seated: true });
      // Sitzmodus braucht keine Fläche: kleines Quadrat um den Spieler
      this.region = [-0.6, 0.6].flatMap((dx) => [-0.6, 0.6].map((dz) => ({ x: h.x + dx, z: h.z + dz })));
      this.region = orderPolygon(this.region);
      this.finishSetup();
      return;
    }
    if (fired === 'restart') return this.startSetup();
    for (const p of pointers) {
      if (consumed.has(p.id)) continue;
      const edge = p.pressed && !this.lastPressed.get(p.id);
      if (edge && p.point!.y < 0.3) {
        this.corners.push({ x: p.point!.x, z: p.point!.z });
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 12, 1, true), new THREE.MeshBasicMaterial({ color: '#2fd8ff', transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
        m.position.set(p.point!.x, 0.3, p.point!.z);
        this.cornerMarkers.add(m);
        p.haptic?.(0.7, 60);
        this.updateSetupText();
        if (this.corners.length >= 4) {
          this.region = orderPolygon(this.corners);
          this.finishSetup();
          return;
        }
      }
    }
  }

  private finishSetup(): void {
    this.setupPanel.root.visible = false;
    setTimeout(() => this.cornerMarkers.clear(), 1500);
    this.phase = 'playing';
    if (this.coloc) this.coloc.boundaryReady();
    else this.needsPlacement = true;
  }

  /** Co-Location: Brett aus der Kalibrierung setzen (Region = Host-Boundary in eigenen Koordinaten). */
  private placeColoc(region: V2[], b: { center: V2; yaw: number; squareSize: number; totalSide: number }): void {
    this.region = region;
    const p: BoardPlacement = { center: b.center, yaw: b.yaw, height: 0, squareSize: b.squareSize, mode: 'roomscale', maxSide: b.totalSide, totalSide: b.totalSide, reason: 'fits' };
    this.placement = p;
    this.host.applyPlacement(p, region);
    this.warning?.dispose();
    this.warning = new BoundaryWarning(region);
    this.host.scene.add(this.warning.mesh);
  }

  /** vor dem VR-Eintritt empfangene Co-Location-Nachrichten (z. B. die Host-Boundary) */
  private colocInbox: PeerMsg[] = [];

  /** Co-Location-Nachricht vom Mitspieler */
  onColocMessage(m: PeerMsg): void {
    if (this.coloc) this.coloc.onMessage(m);
    else if (m.t === 'coloc-boundary') this.colocInbox = [m];
  }

  /** Mitspieler verbunden (Co-Location: Boundary erneut schicken) */
  colocPeerReady(): void {
    this.coloc?.peerReady();
  }

  /** Bestätigungsdialog in VR (Ja/Nein-Pilzhüte) */
  confirm(question: string): Promise<boolean> {
    this.confirmResolve?.(false);
    this.confirmPanel.setText(question);
    this.confirmPanel.root.visible = true;
    const h = this.head();
    const f = this.host.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    this.confirmPanel.root.position.copy(h).addScaledVector(f, 0.75).setY(h.y - 0.2);
    this.confirmPanel.faceYaw(h);
    return new Promise((res) => (this.confirmResolve = res));
  }

  /** Hände (Fingerspitze bzw. Controllerspitze) je Seite, null = nicht verfolgt */
  handPoses(): { left: THREE.Vector3 | null; right: THREE.Vector3 | null } {
    const ps = this.input?.pointers ?? [];
    const of = (h: 'left' | 'right') => ps.find((p) => p.handedness === h)?.tip.clone() ?? null;
    return { left: of('left'), right: of('right') };
  }

  get colocCalibrated(): boolean {
    return !this.coloc || this.coloc.calibrated;
  }

  startHighFive(): void {
    this.coloc?.startHighFive();
  }

  // ---------- Hinweise / Uhr ----------

  say(text: string, seconds: number): void {
    this.notice.setText(text);
    this.notice.root.visible = true;
    this.noticeUntil = this.time + seconds;
    // sofort vor den Spieler setzen
    const h = this.head();
    const f = this.host.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    this.notice.root.position.copy(h).addScaledVector(f, 1.2).setY(h.y - 0.25);
  }

  private updateNotice(): void {
    if (!this.notice.root.visible) return;
    if (this.time > this.noticeUntil) {
      this.notice.root.visible = false;
      return;
    }
    // folgt dem Blick träge (kein starres Kopf-HUD → angenehmer)
    const h = this.head();
    const f = this.host.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    this.noticeTarget.copy(h).addScaledVector(f, 1.2).setY(h.y - 0.25);
    if (this.notice.root.position.distanceTo(this.noticeTarget) > 0.35) this.notice.root.position.lerp(this.noticeTarget, 0.04);
    this.notice.faceYaw(h);
  }

  // ---------- Handgelenk-Menü ----------

  private menuItems: { id: string; key: Parameters<typeof V>[0] }[] = [
    { id: 'resign', key: 'mResign' },
    { id: 'draw', key: 'mDraw' },
    { id: 'undo', key: 'mUndo' },
    { id: 'boundary', key: 'mBoundary' },
    { id: 'realign', key: 'mRealign' },
    { id: 'seated', key: 'mSeated' },
    { id: 'smaller', key: 'mSmaller' },
    { id: 'bigger', key: 'mBigger' },
    { id: 'insects', key: 'mInsects' },
    { id: 'grabray', key: 'mGrabRay' },
    { id: 'coords', key: 'mCoords' },
    { id: 'rematch', key: 'mRematch' },
    { id: 'new', key: 'mNew' },
    { id: 'exit', key: 'mExit' },
  ];

  private readonly baseItems = [...this.menuItems];

  /** Menüpunkte je nach Modus (Netzwerk: Nachrichten/Sprachchat; Co-Location: Abklatsch-Check/Neu kalibrieren). */
  private rebuildMenu(): void {
    let items = [...this.baseItems];
    if (this.host.net) items.splice(items.length - 2, 0, { id: 'emote-nice', key: 'mEmoteNice' }, { id: 'emote-hmm', key: 'mEmoteHmm' }, { id: 'voice', key: 'mVoice' });
    if (this.host.coloc) {
      // Größe/Lage kommen aus der Kalibrierung – eigene Platzierung würde die Bretter auseinanderbringen
      items = items.filter((m) => !['realign', 'seated', 'smaller', 'bigger'].includes(m.id));
      items.splice(3, 0, { id: 'highfive', key: 'mHighFive' }, { id: 'recal', key: 'mRecal' });
    }
    this.menuItems = items;
    for (const b of this.menuButtons.buttons) b.root.removeFromParent();
    this.menuButtons.buttons.length = 0;
    this.menuTitle.root.removeFromParent();
    this.buildMenu();
  }

  private buildMenu(): void {
    this.menuTitle.setText(V('menuTitle'));
    this.menuTitle.root.visible = true;
    this.menuTitle.root.position.set(0.06, 0.05, 0);
    this.menu.add(this.menuTitle.root);
    const colors = ['#ff4fd8', '#9dff3a', '#2fd8ff', '#1de9c9', '#8b3dff'];
    this.menuItems.forEach((it, i) => {
      const b = this.menuButtons.add(new Button3D(it.id, V(it.key), 0.016, colors[i % colors.length]));
      // zwei Spalten
      const col = i % 2;
      const row = Math.floor(i / 2);
      b.root.position.set(col * 0.15, -row * 0.042, 0);
      this.menu.add(b.root);
    });
  }

  private updateMenu(pointers: XRPointer[], consumed: Set<string>, dt: number): void {
    const inp = this.input!;
    const menuHand = settings.get().leftHanded ? 'right' : 'left';
    const otherHand = menuHand === 'left' ? 'right' : 'left';
    // Öffnen: Taste Y/B am Menü-Controller (umschalten) oder Blick auf die Handfläche (Hand)
    if (inp.buttonDown(menuHand, 5) || inp.buttonDown(menuHand, 4)) this.menuToggled = !this.menuToggled;
    const pj = inp.palmJoints(menuHand);
    let palm = false;
    if (pj) palm = palmFacesHead(pj.wrist, pj.indexMeta, pj.pinkyMeta, this.head(), menuHand);
    this.palmTimer = palm ? this.palmTimer + dt : Math.max(0, this.palmTimer - dt * 2);
    const open = this.menuToggled || this.palmTimer > 0.35;
    if (open !== this.menuOpen) {
      this.menuOpen = open;
      this.menu.visible = open;
    }
    const anchor = inp.anchor(menuHand);
    if (open && anchor) {
      const a = anchor.getWorldPosition(new THREE.Vector3());
      const h = this.head();
      // Menü schwebt knapp über/neben dem Handgelenk, Richtung Körpermitte versetzt
      const toHead = h.clone().sub(a).normalize();
      const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), toHead).normalize();
      this.menu.position.copy(a).addScaledVector(new THREE.Vector3(0, 1, 0), 0.1).addScaledVector(side, menuHand === 'left' ? -0.06 : 0.22);
      const m = new THREE.Matrix4().lookAt(h, this.menu.position, new THREE.Vector3(0, 1, 0));
      this.menu.quaternion.setFromRotationMatrix(m);
    }
    const presser = pointers.filter((p) => p.handedness === otherHand);
    const fired = this.menuButtons.update(dt, presser, open, consumed);
    if (fired) this.onMenu(fired);
  }

  private onMenu(id: string): void {
    switch (id) {
      case 'resign':
      case 'draw':
        // Bestätigung per zweitem Tippen innerhalb von 3 s (kein versehentliches Aufgeben/Remis)
        if (this.time < this.resignArmedUntil && this.armedId === id) {
          this.resignArmedUntil = 0;
          this.host.action(id);
        } else {
          this.resignArmedUntil = this.time + 3;
          this.armedId = id;
          this.say(V(id === 'resign' ? 'confirmResign' : 'confirmDraw'), 3);
        }
        return;
      case 'boundary':
        this.showBoundary = this.showBoundary > 0 ? 0 : 1;
        return;
      case 'realign':
        this.needsPlacement = true;
        return;
      case 'seated':
        settings.set({ seated: !settings.get().seated });
        this.needsPlacement = true;
        return;
      case 'smaller':
      case 'bigger': {
        if (!this.placement || this.placement.mode !== 'roomscale') return;
        const cur = this.placement.totalSide;
        this.manualSide = Math.min(this.placement.maxSide, Math.max(1.6, cur + (id === 'bigger' ? 0.4 : -0.4)));
        this.needsPlacement = true;
        return;
      }
      case 'insects':
        settings.set({ insects: !settings.get().insects });
        return;
      case 'grabray':
        settings.set({ grabRay: !settings.get().grabRay });
        this.say(V(settings.get().grabRay ? 'grabRayOn' : 'grabRayOff'), 3);
        return;
      case 'coords': {
        const order = ['S', 'M', 'L'] as const;
        settings.set({ coordSize: order[(order.indexOf(settings.get().coordSize) + 1) % 3] });
        return;
      }
      case 'exit':
        this.exit();
        return;
      case 'highfive':
        this.coloc?.startHighFive();
        return;
      case 'recal':
        this.coloc?.recalibrate(null);
        return;
      default:
        this.host.action(id); // draw, undo, rematch, new
    }
  }

  // ---------- Frame ----------

  update(dt: number, time: number): void {
    if (!this.session || !this.input) return;
    this.time = time;
    const color = (h: 'left' | 'right') => (h === 'left' ? PLAYER_GLOW.w : PLAYER_GLOW.b);
    this.input.update(color);
    const pointers = this.input.pointers;
    const consumed = new Set<string>();

    if (this.needsPlacement && this.phase === 'playing') {
      this.needsPlacement = false;
      this.host.interaction.cancelAll();
      this.place();
    }

    // Bestätigungsdialog hat Vorrang
    if (this.confirmPanel.root.visible) {
      const fired = this.confirmButtons.update(dt, pointers, true, consumed);
      if (fired) {
        this.confirmPanel.root.visible = false;
        const r = this.confirmResolve;
        this.confirmResolve = null;
        r?.(fired === 'yes');
      }
    }
    // Tracking-Verlust (Co-Location): Pose fehlt oder ist nur geschätzt → danach neu kalibrieren
    if (this.coloc) {
      const frame = this.host.renderer.xr.getFrame();
      const ref = this.host.renderer.xr.getReferenceSpace();
      const vp = frame && ref ? frame.getViewerPose(ref) : null;
      if (!vp || vp.emulatedPosition) this.trackingLostFor += dt;
      else {
        if (this.trackingLostFor > 0.6 && this.coloc.calibrated) this.coloc.recalibrate('colocTrackingLost');
        this.trackingLostFor = 0;
      }
    }

    if (this.phase === 'setup') {
      this.setupStep(pointers, consumed);
    } else if (this.phase === 'playing') {
      this.updateMenu(pointers, consumed, dt);
      this.coloc?.update(dt, pointers, consumed);
      // Brett-Interaktion mit allen Zeigern, die gerade keinen Knopf berühren
      const free = pointers.filter((p) => !consumed.has(p.id));
      const all: Pointer[] = [...free];
      // Optionaler Greifstrahl: zusätzlicher Strahl-Zeiger nach vorne-unten – pausiert, solange die Hand
      // selbst eine Figur markiert/hält (sonst würden zwei Figuren gleichzeitig gegriffen)
      if (settings.get().grabRay) {
        for (const p of free) {
          const rid = `${p.id}-ray`;
          if (this.host.interaction.hasTarget(p.id) && !this.host.interaction.hasTarget(rid)) {
            this.rayBeam(rid, null);
            continue;
          }
          const dir = p.rayDir.clone();
          dir.y -= 0.35;
          dir.normalize();
          const ray = new THREE.Ray(p.rayOrigin.clone(), dir);
          all.push({ id: rid, ray, pressed: p.pressed, haptic: p.haptic });
          this.rayBeam(rid, ray);
        }
      } else for (const id of this.rayBeams.keys()) this.rayBeam(id, null);
      // Co-Location: vor der Kalibrierung steht das Brett noch nicht an der gemeinsamen Stelle
      this.host.interaction.update(this.colocCalibrated ? all : []);
      // Grenzwarnung (Kopf + Hände) und kurzer Text, wenn der Kopf sehr nah ist
      if (this.warning) {
        const h = this.head();
        const pts = [h, ...pointers.map((p) => p.point!)];
        this.warning.update(time, pts, this.showBoundary);
        if (distanceToBoundary({ x: h.x, z: h.z }, this.region) < WARN_DISTANCE * 0.6 && !this.notice.root.visible) this.say(V('boundaryNear'), 2);
      }
    }
    this.updateNotice();
    for (const p of pointers) this.lastPressed.set(p.id, p.pressed);
  }

  private rayBeams = new Map<string, THREE.Mesh>();

  /** Sichtbarer Greifstrahl (bis zum Boden bzw. 4 m). */
  private rayBeam(id: string, ray: THREE.Ray | null): void {
    let m = this.rayBeams.get(id);
    if (!ray) {
      if (m) m.visible = false;
      return;
    }
    if (!m) {
      const g = new THREE.CylinderGeometry(0.002, 0.002, 1, 5, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2); // entlang +Z
      m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#9ffcff', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.rayBeams.set(id, m);
      this.uiRoot.add(m);
    }
    const len = ray.direction.y < -0.01 ? Math.min(4, -ray.origin.y / ray.direction.y) : 4;
    m.position.copy(ray.origin);
    m.lookAt(ray.origin.clone().add(ray.direction)); // Object3D.lookAt richtet +Z zum Ziel aus
    m.scale.set(1, 1, len);
    m.visible = true;
  }

  /** Blickrichtung relativ zum Brett (für die Ausrichtung der Umwandlungsauswahl). */
  viewerYawOnBoard(): number {
    return this.headYaw() - (this.placement?.yaw ?? 0);
  }

  handPoints(): THREE.Vector3[] {
    return (this.input?.pointers ?? []).filter((p) => p.kind === 'hand').map((p) => p.point!.clone());
  }
}
