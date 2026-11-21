import * as THREE from 'three';
import { Text } from 'troika-three-text';
import interBold from '@fontsource/inter/files/inter-latin-700-normal.woff?url';
import type { XRPointer } from './xrInput';

/**
 * Diegetische 3D-Oberfläche für VR: Tafeln mit Rankenrahmen (SDF-Text, immer zum Spieler
 * gedreht) und Knöpfe als leuchtende Pilzhüte, die man mit Fingerspitze/Controllerspitze antippt.
 * Mindestschriftgrößen: ≥ 1° Sehwinkel (z. B. 2,5 cm Zeichen in 1,4 m, 1,2 cm in 0,6 m).
 */

const plateMat = (color: string, opacity: number) =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uAspect: { value: 1 }, uGlow: { value: new THREE.Color('#2fd8ff') } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    // abgerundete Tafel mit leuchtendem, leicht welligem „Ranken“-Rand
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; uniform float uAspect; uniform vec3 uGlow; varying vec2 vUv;
      void main(){
        vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
        vec2 hs = vec2(uAspect, 1.0) * 0.5 - 0.06;
        float d = length(max(abs(p) - hs + 0.06, 0.0)) - 0.06;
        float inside = smoothstep(0.01, -0.01, d);
        float wave = 0.006 * sin(atan(p.y, p.x) * 40.0);
        float rim = smoothstep(0.012, 0.0, abs(d + 0.018 + wave));
        gl_FragColor = vec4(mix(uColor, uGlow, rim), max(inside * uOpacity, rim * 0.9));
        #include <colorspace_fragment>
      }`,
  });

export class Panel3D {
  readonly root = new THREE.Group();
  readonly text = new Text();
  private plate: THREE.Mesh;
  private current = '';
  pad: number;

  constructor(opts: { fontSize: number; maxWidth?: number; color?: string; align?: 'left' | 'center' }) {
    this.pad = opts.fontSize * 0.7;
    this.text.font = interBold;
    this.text.fontSize = opts.fontSize;
    this.text.anchorX = 'center';
    this.text.anchorY = 'middle';
    this.text.color = opts.color ?? '#e6fbff';
    (this.text as unknown as { maxWidth: number; textAlign: string; lineHeight: number }).maxWidth = opts.maxWidth ?? 1;
    (this.text as unknown as { textAlign: string }).textAlign = opts.align ?? 'center';
    (this.text as unknown as { lineHeight: number }).lineHeight = 1.25;
    this.text.position.z = 0.002;
    this.text.renderOrder = 11;
    this.plate = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), plateMat('#0a0618', 0.88));
    this.plate.renderOrder = 10;
    this.root.add(this.plate, this.text);
    this.root.visible = false;
  }

  setText(s: string): void {
    if (s === this.current) return;
    this.current = s;
    this.text.text = s;
    this.text.sync(() => {
      const info = (this.text as unknown as { textRenderInfo?: { blockBounds: number[] } }).textRenderInfo;
      if (!info) return;
      const [x0, y0, x1, y1] = info.blockBounds;
      const w = x1 - x0 + this.pad * 2;
      const h = y1 - y0 + this.pad * 2;
      this.plate.scale.set(w, h, 1);
      (this.plate.material as THREE.ShaderMaterial).uniforms.uAspect.value = w / h;
    });
  }

  get height(): number {
    return this.plate.scale.y;
  }

  /** Nur um die Hochachse zum Betrachter drehen (Text bleibt aufrecht). */
  faceYaw(viewer: THREE.Vector3): void {
    const p = this.root.getWorldPosition(new THREE.Vector3());
    const yawWorld = Math.atan2(viewer.x - p.x, viewer.z - p.z);
    const parentQ = this.root.parent ? this.root.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    const target = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawWorld);
    this.root.quaternion.copy(parentQ.invert().multiply(target));
  }

  /** Voll zum Betrachter drehen (für Tafeln an der Hand). */
  faceFull(viewer: THREE.Vector3): void {
    const p = this.root.getWorldPosition(new THREE.Vector3());
    const m = new THREE.Matrix4().lookAt(viewer, p, new THREE.Vector3(0, 1, 0));
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const parentQ = this.root.parent ? this.root.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    this.root.quaternion.copy(parentQ.invert().multiply(q));
  }
}

/** Knopf als leuchtender Pilzhut mit Beschriftung darunter/daneben. */
export class Button3D {
  readonly root = new THREE.Group();
  private cap: THREE.Mesh;
  private label = new Text();
  private hover = 0;
  private flash = 0;

  constructor(public id: string, text: string, public radius: number, color = '#2fd8ff') {
    const g = new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(radius, radius * 0.45, radius);
    g.rotateX(Math.PI / 2); // Hutwölbung zeigt zum Betrachter (+Z)
    this.cap = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    this.cap.renderOrder = 12;
    this.label.font = interBold;
    this.label.text = text;
    this.label.fontSize = radius * 0.62;
    this.label.anchorX = 'left';
    this.label.anchorY = 'middle';
    this.label.color = '#e6fbff';
    this.label.position.set(radius * 1.35, 0, 0.002);
    this.label.renderOrder = 12;
    this.label.sync();
    this.root.add(this.cap, this.label);
  }

  setLabel(text: string): void {
    this.label.text = text;
    this.label.sync();
  }

  /** Abstand der Zeigerspitze zum Knopf (Welt). */
  distanceTo(p: THREE.Vector3): number {
    return this.cap.getWorldPosition(new THREE.Vector3()).distanceTo(p);
  }

  update(dt: number, hovered: boolean): void {
    this.hover += ((hovered ? 1 : 0) - this.hover) * Math.min(1, dt * 12);
    this.flash = Math.max(0, this.flash - dt * 3);
    const s = 1 + this.hover * 0.18 + this.flash * 0.25;
    this.cap.scale.setScalar(s);
    (this.cap.material as THREE.MeshBasicMaterial).opacity = 0.6 + 0.4 * this.hover;
  }

  pressedFx(): void {
    this.flash = 1;
  }
}

/**
 * Knopf-Gruppe mit Antipp-Logik: Ein Knopf löst aus, wenn eine Zeigerspitze in seinem Radius
 * ist und der Zeiger gedrückt wird (Pinch/Trigger) – oder bei Händen schon beim Antippen.
 */
export class ButtonGroup {
  readonly buttons: Button3D[] = [];
  private wasInside = new Map<string, boolean>();
  private wasPressed = new Map<string, boolean>();

  add(b: Button3D): Button3D {
    this.buttons.push(b);
    return b;
  }

  /** Gibt die ID des ausgelösten Knopfs zurück (oder null). Zeiger, die einen Knopf berühren, werden in `consumed` gemeldet. */
  update(dt: number, pointers: XRPointer[], visible: boolean, consumed: Set<string>): string | null {
    let fired: string | null = null;
    for (const b of this.buttons) {
      let hovered = false;
      if (visible) {
        for (const p of pointers) {
          const d = b.distanceTo(p.tip);
          const near = d < b.radius * 1.6;
          if (!near) continue;
          hovered = true;
          consumed.add(p.id);
          const key = `${b.id}|${p.id}`;
          const enteredTouch = p.kind === 'hand' && d < b.radius * 1.05 && !this.wasInside.get(key);
          const pressEdge = p.pressed && !this.wasPressed.get(p.id);
          if (!fired && (enteredTouch || pressEdge)) {
            fired = b.id;
            b.pressedFx();
            p.haptic?.(0.5, 40);
          }
          this.wasInside.set(key, d < b.radius * 1.05);
        }
      }
      b.update(dt, hovered);
    }
    for (const p of pointers) this.wasPressed.set(p.id, p.pressed);
    return fired;
  }
}
