import * as THREE from 'three';
import type { Pointer } from '../render/interaction';

/**
 * Controller und Handtracking → abstrakte Punkt-Zeiger für die Griffpunkt-Logik.
 *  Controller: Punkt = Spitze des Controllers (Target-Ray-Ursprung), gedrückt = Trigger ODER Grip
 *  Hand:       Punkt = Mitte zwischen Daumen- und Zeigefingerspitze, gedrückt = Pinch (mit Hysterese)
 * Dazu: Tastenflanken (X/Y/A/B) und Handgelenks-Gelenke für das Handgelenk-Menü.
 */

export type Handedness = 'left' | 'right';

export interface XRPointer extends Pointer {
  handedness: Handedness;
  kind: 'controller' | 'hand';
  /** Zeigefingerspitze (Hand) bzw. Spitze (Controller) – zum „Antippen“ von Knöpfen */
  tip: THREE.Vector3;
}

const PINCH_ON = 0.02;
const PINCH_OFF = 0.04;
const JOINTS: XRHandJoint[] = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
];

interface Slot {
  index: number;
  source: XRInputSource | null;
  ray: THREE.Group;
  grip: THREE.Group;
  hand: THREE.XRHandSpace;
  select: boolean;
  squeeze: boolean;
  pinching: boolean;
  buttons: boolean[];
  prevButtons: boolean[];
  pointer: XRPointer;
}

export class XRInput {
  private slots: Slot[] = [];
  readonly visuals: THREE.InstancedMesh;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private m = new THREE.Matrix4();

  constructor(renderer: THREE.WebGLRenderer, rig: THREE.Object3D) {
    for (let i = 0; i < 2; i++) {
      const ray = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      const hand = renderer.xr.getHand(i);
      rig.add(ray, grip, hand);
      const slot: Slot = {
        index: i, source: null, ray, grip, hand, select: false, squeeze: false, pinching: false, buttons: [], prevButtons: [],
        pointer: { id: `xr${i}`, pressed: false, point: new THREE.Vector3(), tip: new THREE.Vector3(), handedness: 'right', kind: 'controller' },
      };
      ray.addEventListener('connected', (e) => {
        const src = (e as unknown as { data: XRInputSource }).data;
        slot.source = src;
        slot.pointer.handedness = src.handedness === 'left' ? 'left' : 'right';
        slot.pointer.kind = src.hand ? 'hand' : 'controller';
        slot.pointer.id = `${slot.pointer.kind}-${slot.pointer.handedness}`;
        slot.pointer.haptic = (intensity, ms) => {
          try {
            const act = src.gamepad?.hapticActuators?.[0] as unknown as { pulse?: (v: number, d: number) => void } | undefined;
            act?.pulse?.(intensity, ms);
          } catch {
            /* keine Haptik verfügbar */
          }
        };
      });
      ray.addEventListener('disconnected', () => {
        slot.source = null;
        slot.select = slot.squeeze = slot.pinching = false;
      });
      ray.addEventListener('selectstart', () => (slot.select = true));
      ray.addEventListener('selectend', () => (slot.select = false));
      ray.addEventListener('squeezestart', () => (slot.squeeze = true));
      ray.addEventListener('squeezeend', () => (slot.squeeze = false));
      this.slots.push(slot);
    }

    // Leuchtende „Sporen“ für Handgelenke/Fingerglieder und Controller-Spitzen (1 Draw Call)
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
    this.visuals = new THREE.InstancedMesh(geo, mat, 2 * (JOINTS.length + 2));
    this.visuals.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.visuals.count * 3), 3);
    this.visuals.frustumCulled = false;
    this.visuals.count = 0;
    this.visuals.renderOrder = 8;
    rig.add(this.visuals);
  }

  /** Aktive Zeiger (nur verbundene Eingabequellen). */
  get pointers(): XRPointer[] {
    return this.slots.filter((s) => s.source).map((s) => s.pointer);
  }

  update(colorFor: (h: Handedness) => THREE.Color): void {
    let vi = 0;
    const col = new THREE.Color();
    const put = (pos: THREE.Vector3, r: number, c: THREE.Color) => {
      this.m.makeScale(r, r, r).setPosition(pos);
      this.visuals.setMatrixAt(vi, this.m);
      this.visuals.setColorAt(vi, c);
      vi++;
    };
    for (const s of this.slots) {
      if (!s.source) continue;
      const p = s.pointer;
      s.prevButtons = s.buttons;
      s.buttons = (s.source.gamepad?.buttons ?? []).map((b) => b.pressed);
      col.copy(colorFor(p.handedness));
      if (s.source.hand) {
        const jt = s.hand.joints as Record<string, THREE.Group | undefined>;
        const thumb = jt['thumb-tip'];
        const index = jt['index-finger-tip'];
        if (!thumb?.visible || !index?.visible) {
          p.pressed = false;
          continue;
        }
        thumb.getWorldPosition(this.tmp);
        index.getWorldPosition(this.tmp2);
        const d = this.tmp.distanceTo(this.tmp2);
        s.pinching = s.pinching ? d < PINCH_OFF : d < PINCH_ON;
        p.point!.copy(this.tmp).add(this.tmp2).multiplyScalar(0.5);
        p.tip.copy(this.tmp2);
        p.pressed = s.pinching;
        for (const name of JOINTS) {
          const j = jt[name];
          if (!j?.visible) continue;
          j.getWorldPosition(this.tmp);
          const tipJ = name.endsWith('tip');
          put(this.tmp, tipJ ? 0.009 : 0.007, tipJ && s.pinching ? col.clone().multiplyScalar(1.6) : col);
        }
      } else {
        s.ray.getWorldPosition(p.point!);
        p.tip.copy(p.point!);
        p.pressed = s.select || s.squeeze;
        put(p.point!, p.pressed ? 0.018 : 0.013, p.pressed ? col.clone().multiplyScalar(1.6) : col);
        s.grip.getWorldPosition(this.tmp);
        put(this.tmp, 0.022, col.clone().multiplyScalar(0.4));
      }
    }
    this.visuals.count = vi;
    this.visuals.instanceMatrix.needsUpdate = true;
    if (this.visuals.instanceColor) this.visuals.instanceColor.needsUpdate = true;
  }

  /** Flanke einer Gamepad-Taste (xr-standard: 4 = X/A, 5 = Y/B). */
  buttonDown(handedness: Handedness, index: number): boolean {
    const s = this.slots.find((x) => x.source && x.pointer.handedness === handedness);
    return !!s && !!s.buttons[index] && !s.prevButtons[index];
  }

  /** Gelenke für die Handflächen-Erkennung (nur Handtracking). */
  palmJoints(handedness: Handedness): { wrist: THREE.Vector3; indexMeta: THREE.Vector3; pinkyMeta: THREE.Vector3 } | null {
    const s = this.slots.find((x) => x.source?.hand && x.pointer.handedness === handedness);
    if (!s) return null;
    const jt = s.hand.joints as Record<string, THREE.Group | undefined>;
    const w = jt.wrist;
    const i = jt['index-finger-metacarpal'];
    const k = jt['pinky-finger-metacarpal'];
    if (!w?.visible || !i?.visible || !k?.visible) return null;
    return { wrist: w.getWorldPosition(new THREE.Vector3()), indexMeta: i.getWorldPosition(new THREE.Vector3()), pinkyMeta: k.getWorldPosition(new THREE.Vector3()) };
  }

  /** Position des Handgelenks bzw. Controllers einer Seite (Anker für das Menü). */
  anchor(handedness: Handedness): THREE.Object3D | null {
    const s = this.slots.find((x) => x.source && x.pointer.handedness === handedness);
    if (!s) return null;
    if (s.source!.hand) return (s.hand.joints as Record<string, THREE.Group | undefined>).wrist ?? null;
    return s.grip;
  }

  hasController(handedness: Handedness): boolean {
    return this.slots.some((x) => x.source && !x.source.hand && x.pointer.handedness === handedness);
  }
}
