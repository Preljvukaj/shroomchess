import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Pointer } from '../render/interaction';

export type CameraMode = 'orbit' | 'first';

/**
 * Desktop-Steuerung:
 *  Orbit  – Rechtsklick drehen, Mausrad zoomen, Mittelklick verschieben. Linksklick gehört den Figuren.
 *  Ego    – WASD/Pfeiltasten gehen, Rechtsklick halten + Maus = umsehen, Q/E drehen.
 * Liefert außerdem den Maus-Zeiger für den InteractionController.
 */
export class DesktopControls {
  readonly orbit: OrbitControls;
  mode: CameraMode = 'orbit';
  private mouse = new THREE.Vector2();
  private screen = new THREE.Vector2();
  private hasMouse = false;
  private leftDown = false;
  private rightDown = false;
  private keys = new Set<string>();
  private yaw = 0;
  private pitch = -0.25;
  private raycaster = new THREE.Raycaster();
  readonly pointer: Pointer = { id: 'mouse', pressed: false, ray: new THREE.Ray() };
  /** Gepufferte Tasten-Ereignisse – kein Klick geht bei niedriger Framerate verloren. */
  private events: { ndc: THREE.Vector2; screen: THREE.Vector2; pressed: boolean }[] = [];
  enabled = true;

  constructor(private camera: THREE.PerspectiveCamera, dom: HTMLElement, private boardSide: number, private flatHalf = boardSide / 2 + 2.5) {
    this.orbit = new OrbitControls(camera, dom);
    this.orbit.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.orbit.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.minDistance = Math.max(0.4, boardSide * 0.3);
    // Kamera bleibt über der flachen Senkenmitte – nie im Wall
    this.orbit.maxDistance = this.flatHalf + 1.1;
    this.orbit.maxPolarAngle = Math.PI * 0.47;
    this.orbit.target.set(0, 0, 0);
    this.resetView('w');

    dom.addEventListener('pointermove', (e) => {
      this.hasMouse = true;
      this.screen.set(e.clientX, e.clientY);
      this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      if (this.mode === 'first' && this.rightDown) {
        this.yaw -= e.movementX * 0.0035;
        this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0035, -1.3, 1.1);
      }
    });
    dom.addEventListener('pointerdown', (e) => {
      if (e.button === 0) {
        this.leftDown = true;
        this.screen.set(e.clientX, e.clientY);
        this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
        this.hasMouse = true;
        this.events.push({ ndc: this.mouse.clone(), screen: this.screen.clone(), pressed: true });
        dom.setPointerCapture(e.pointerId);
      }
      if (e.button === 2) this.rightDown = true;
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0 && this.leftDown) {
        this.leftDown = false;
        this.screen.set(e.clientX, e.clientY);
        this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
        this.events.push({ ndc: this.mouse.clone(), screen: this.screen.clone(), pressed: false });
      }
      if (e.button === 2) this.rightDown = false;
    });
    dom.addEventListener('pointerleave', () => (this.hasMouse = false));
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.closest?.('input,select,textarea')) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Standardansicht von der Seite einer Farbe. */
  resetView(side: 'w' | 'b'): void {
    const d = Math.min(this.boardSide * 0.95 + 1.2, this.flatHalf - 0.3);
    const sign = side === 'w' ? 1 : -1;
    this.camera.position.set(0, Math.max(1.7, this.boardSide * 0.6), sign * d);
    this.orbit.target.set(0, 0, sign * this.boardSide * 0.05);
    this.camera.lookAt(this.orbit.target);
    this.orbit.update();
  }

  setMode(mode: CameraMode, side: 'w' | 'b'): void {
    this.mode = mode;
    this.orbit.enabled = mode === 'orbit';
    if (mode === 'first') {
      const sign = side === 'w' ? 1 : -1;
      this.camera.position.set(0, 1.65, sign * (this.boardSide / 2 + 1.0));
      this.yaw = side === 'w' ? 0 : Math.PI;
      this.pitch = -0.35;
    } else {
      this.resetView(side);
    }
  }

  /** Blickrichtung (Yaw) der Kamera – für die Ausrichtung schwebender Auswahl-UI. */
  viewYaw(): number {
    const d = this.camera.getWorldDirection(new THREE.Vector3());
    return Math.atan2(-d.x, -d.z);
  }

  update(dt: number): void {
    if (!this.enabled) return;
    if (this.mode === 'orbit') {
      this.orbit.update();
    } else {
      const speed = (this.keys.has('ShiftLeft') ? 3.2 : 1.6) * dt;
      const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const k = (c: string) => this.keys.has(c);
      if (k('KeyW') || k('ArrowUp')) this.camera.position.addScaledVector(f, speed);
      if (k('KeyS') || k('ArrowDown')) this.camera.position.addScaledVector(f, -speed);
      if (k('KeyA')) this.camera.position.addScaledVector(r, -speed);
      if (k('KeyD')) this.camera.position.addScaledVector(r, speed);
      if (k('KeyQ') || k('ArrowLeft')) this.yaw += dt * 1.5;
      if (k('KeyE') || k('ArrowRight')) this.yaw -= dt * 1.5;
      const lim = this.flatHalf - 0.3;
      this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, -lim, lim);
      this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z, -lim, lim);
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    }
    // Maus → Strahl
    this.raycaster.setFromCamera(this.mouse, this.camera);
    this.pointer.ray!.copy(this.raycaster.ray);
    this.pointer.pressed = this.leftDown;
  }

  /**
   * Zeiger-Schnappschüsse seit dem letzten Frame: einer pro Tasten-Ereignis
   * (mit dem Strahl zum Zeitpunkt des Ereignisses) plus der aktuelle Zustand.
   */
  drainSnapshots(): { pointer: Pointer; screen: THREE.Vector2 }[] {
    const out = this.events.map((ev) => {
      this.raycaster.setFromCamera(ev.ndc, this.camera);
      return { pointer: { id: 'mouse', pressed: ev.pressed, ray: this.raycaster.ray.clone() } as Pointer, screen: ev.screen };
    });
    this.events = [];
    if (this.active) out.push({ pointer: this.pointer, screen: this.screen.clone() });
    return out;
  }

  get active(): boolean {
    return this.hasMouse || this.leftDown;
  }

  get screenPos(): THREE.Vector2 {
    return this.screen;
  }
}
