import * as THREE from 'three';
import { BatchedText, Text } from 'troika-three-text';
import interBold from '@fontsource/inter/files/inter-latin-700-normal.woff?url';
import { type Settings } from '../core/settings';
import type { Square } from '../core/types';
import { COORD_SIZE_FACTOR, type CoordLabel, coordinateLayout, squareLabelLayout } from './coordLayout';

/**
 * Koordinaten a–h / 1–8 als SDF-Text (troika-three-text, Schrift Inter Bold, lokal gebündelt).
 * Scharf in jeder Entfernung. Draw Calls: Plättchen (1, instanziert) + Text (2: Füllung +
 * Kontur, gebatcht) + optionale Feldbeschriftung (1).
 *
 * Kontrast (WCAG-Verhältnis, gegen das Plättchen):
 *   normal  Text #bfe6df auf #07060d, Deckkraft 0,85 → ≈ 13:1
 *   hoch    Text #e6e6e6 auf #000000, Deckkraft 0,95 → ≈ 16:1
 * Die Textfarbe liegt in linearer Luminanz unter der Bloom-Schwelle (0,85), damit die
 * Kanten nicht verschmieren.
 */

const NORMAL = { text: '#bfe6df', outline: '#05040a', plate: '#07060d', plateOpacity: 0.85, glow: '#7dfff0' };
const HIGH = { text: '#e6e6e6', outline: '#000000', plate: '#000000', plateOpacity: 0.95, glow: '#ffffff' };

export class Coordinates {
  readonly root = new THREE.Group();
  private batch = new BatchedText();
  private squareBatch = new BatchedText();
  private plates: THREE.InstancedMesh;
  private labels: { def: CoordLabel; text: Text }[] = [];
  private squareLabels: Text[] = [];
  private highlightFile: number | null = null;
  private highlightRank: number | null = null;
  private highlightT = 0;
  private sizeFactor: number = COORD_SIZE_FACTOR.M;
  private highContrast = false;
  private zoomScale = 1;

  constructor(private squareSize: number, private surfaceY: number) {
    const layout = coordinateLayout(squareSize);
    const plateGeo = new THREE.PlaneGeometry(1, 1);
    const plateMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color(NORMAL.plate) }, uOpacity: { value: NORMAL.plateOpacity } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position,1.0); }`,
      // Abgerundetes Plättchen (SDF), weiche Kante
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv;
        void main(){ vec2 p = abs(vUv - 0.5) - vec2(0.32); float d = length(max(p, 0.0)) - 0.16;
          float a = smoothstep(0.02, -0.02, d) * uOpacity; gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }`,
    });
    this.plates = new THREE.InstancedMesh(plateGeo, plateMat, layout.length);
    this.plates.renderOrder = 3;

    for (const def of layout) {
      const t = new Text();
      t.text = def.text;
      t.font = interBold;
      t.anchorX = 'center';
      t.anchorY = 'middle';
      t.sdfGlyphSize = 64;
      this.labels.push({ def, text: t });
      this.batch.addText(t);
    }
    this.batch.font = interBold;
    this.batch.material = new THREE.MeshBasicMaterial({ toneMapped: true, transparent: true, depthWrite: false });
    this.batch.renderOrder = 4;

    // Feldbeschriftung (beide Leserichtungen – wir zeigen die für die Ansicht passende)
    for (const reader of ['w', 'b'] as const) {
      for (const def of squareLabelLayout(squareSize, reader)) {
        const t = new Text();
        t.text = def.text;
        t.font = interBold;
        t.anchorX = 'center';
        t.anchorY = 'middle';
        t.fontSize = squareSize * 0.18;
        t.position.set(def.x, surfaceY + 0.003, def.z);
        t.rotation.set(def.pitch, def.yaw, 0, 'YXZ');
        // Lichess-Stil: auf hellen Feldern dunkel, auf dunklen hell
        const fileIdx = def.kind === 'file' ? def.index : reader === 'w' ? 0 : 7;
        const rankIdx = def.kind === 'rank' ? def.index : reader === 'w' ? 0 : 7;
        t.color = (fileIdx + rankIdx) % 2 === 1 ? '#2a2440' : '#d8e4ff';
        t.userData.reader = reader;
        this.squareLabels.push(t);
        this.squareBatch.addText(t);
      }
    }
    this.squareBatch.font = interBold;
    this.squareBatch.material = new THREE.MeshBasicMaterial({ toneMapped: true, transparent: true, depthWrite: false });
    this.squareBatch.visible = false;
    this.squareBatch.renderOrder = 3;

    this.root.add(this.plates, this.batch, this.squareBatch);
    this.relayout();
  }

  /** Einstellungen übernehmen (Größe, Kontrast, Feldbeschriftung). */
  apply(s: Pick<Settings, 'coordSize' | 'coordHighContrast' | 'coordsOnSquares'>, viewer: 'w' | 'b' = 'w'): void {
    this.sizeFactor = COORD_SIZE_FACTOR[s.coordSize];
    this.highContrast = s.coordHighContrast;
    this.squareBatch.visible = s.coordsOnSquares;
    for (const t of this.squareLabels) t.visible = t.userData.reader === viewer;
    this.squareLabels.forEach((t) => t.sync());
    this.squareBatch.sync();
    this.relayout();
  }

  private relayout(): void {
    const pal = this.highContrast ? HIGH : NORMAL;
    const s = this.squareSize;
    const h = this.sizeFactor * s * this.zoomScale;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const lift = this.surfaceY * 1.6 + 0.004;
    this.labels.forEach(({ def, text }, i) => {
      // troika: fontSize ≈ Versalhöhe / 0,73 (Inter) → Zeichenhöhe der Ziffern/Kleinbuchstaben ≈ h
      text.fontSize = h / 0.73;
      text.outlineWidth = this.highContrast ? '14%' : '9%';
      text.outlineColor = pal.outline;
      text.color = pal.text;
      // leicht über dem Plättchen, um die Neigung angehoben
      const rise = Math.sin(((90 + (def.pitch * 180) / Math.PI) * Math.PI) / 180) * h * 0.5;
      text.position.set(def.x, lift + rise + 0.002, def.z);
      text.rotation.set(def.pitch, def.yaw, 0, 'YXZ');
      e.set(def.pitch, def.yaw, 0, 'YXZ');
      q.setFromEuler(e);
      const plate = h * 1.5;
      m.compose(new THREE.Vector3(def.x, lift + rise, def.z), q, new THREE.Vector3(plate, plate, 1));
      // Plättchen minimal hinter den Text schieben (entlang der Normalen)
      const n = new THREE.Vector3(0, 0, -0.002).applyQuaternion(q);
      m.elements[12] += n.x;
      m.elements[13] += n.y;
      m.elements[14] += n.z;
      this.plates.setMatrixAt(i, m);
      text.sync();
    });
    this.plates.instanceMatrix.needsUpdate = true;
    const pm = this.plates.material as THREE.ShaderMaterial;
    pm.uniforms.uColor.value.set(pal.plate);
    pm.uniforms.uOpacity.value = pal.plateOpacity;
    this.batch.sync();
  }

  /** Bonus: Linie/Reihe des Felds unter der gegriffenen Figur leuchten kurz auf. */
  highlightSquare(sq: Square | null): void {
    const f = sq ? sq.charCodeAt(0) - 97 : null;
    const r = sq ? sq.charCodeAt(1) - 49 : null;
    if (f === this.highlightFile && r === this.highlightRank) return;
    this.highlightFile = f;
    this.highlightRank = r;
    this.highlightT = 0;
  }

  /**
   * Pro Frame: Hervorhebung animieren; am Desktop bei starkem Herauszoomen die Glyphen
   * etwas vergrößern, damit sie nicht zu klein werden (Faktor 1–1,6).
   */
  update(dt: number, camera: THREE.Camera, boardWorldCenter: THREE.Vector3, xr: boolean): void {
    this.highlightT += dt;
    const pal = this.highContrast ? HIGH : NORMAL;
    const base = new THREE.Color(pal.text);
    const glow = new THREE.Color(pal.glow);
    // kurzes Aufleuchten (0,25 s), dann gedämpft hervorgehoben, solange die Hand dort ist
    const k = this.highlightT < 0.25 ? 1 : 0.55;
    for (const { def, text } of this.labels) {
      const on = (def.kind === 'file' && def.index === this.highlightFile) || (def.kind === 'rank' && def.index === this.highlightRank);
      text.color = on ? base.clone().lerp(glow, k).getHex() : pal.text;
    }
    if (!xr) {
      const d = camera.getWorldPosition(new THREE.Vector3()).distanceTo(boardWorldCenter);
      const target = THREE.MathUtils.clamp(d / (this.squareSize * 8 * 1.4), 1, 1.6);
      if (Math.abs(target - this.zoomScale) > 0.05) {
        this.zoomScale = target;
        this.relayout();
      }
    }
  }
}
