import * as THREE from 'three';
import type { MoveKind, Square } from '../core/types';
import { squareCenter } from './board';
import { worldUniforms } from './shared';

/**
 * Zielfeld-Markierungen. Ein InstancedMesh (1 Draw Call). Form + Farbe codieren
 * die Zugart, damit die Information nicht nur über Farbe läuft (Barrierefreiheit):
 *   normal     gefüllte Scheibe
 *   capture    Ring mit Eckzacken
 *   castle     doppelter Ring
 *   enpassant  Ring mit Punkt
 */

const PAL_NORMAL: Record<string, string> = { normal: '#3dff7a', capture: '#ff3d4f', castle: '#ffd23d', enpassant: '#b46bff', last: '#4dd8ff', check: '#ff2040', hover: '#ffffff' };
// Okabe-Ito-Palette (farbenblindfreundlich)
const PAL_CB: Record<string, string> = { normal: '#0072B2', capture: '#E69F00', castle: '#F0E442', enpassant: '#CC79A7', last: '#56B4E9', check: '#D55E00', hover: '#ffffff' };

type Style = 'normal' | 'capture' | 'castle' | 'enpassant' | 'last' | 'check' | 'hover';

const STYLE_ID: Record<Style, number> = { normal: 0, capture: 1, castle: 2, enpassant: 3, last: 4, check: 5, hover: 6 };

export function styleOf(kind: MoveKind): Style {
  if (kind === 'capture' || kind === 'promotion-capture') return 'capture';
  if (kind === 'castle') return 'castle';
  if (kind === 'enpassant') return 'enpassant';
  return 'normal';
}

export class Highlights {
  readonly mesh: THREE.InstancedMesh;
  private styleAttr: THREE.InstancedBufferAttribute;
  private colorAttr: THREE.InstancedBufferAttribute;
  private entries: { sq: Square; style: Style }[] = [];
  private tmp = new THREE.Vector3();
  private m = new THREE.Matrix4();
  colorblind = false;

  constructor(private squareSize: number, surfaceY: number) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const MAX = 80;
    this.styleAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    this.colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    geo.setAttribute('aStyle', this.styleAttr);
    geo.setAttribute('aCol', this.colorAttr);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: worldUniforms.uTime },
      vertexShader: /* glsl */ `
        attribute float aStyle; attribute vec3 aCol;
        varying vec2 vUv; varying float vStyle; varying vec3 vCol;
        void main(){ vUv = uv * 2.0 - 1.0; vStyle = aStyle; vCol = aCol;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; varying vec2 vUv; varying float vStyle; varying vec3 vCol;
        float ring(float d, float r, float w){ return smoothstep(w, 0.0, abs(d - r)); }
        void main(){
          float d = length(vUv);
          float sq = max(abs(vUv.x), abs(vUv.y));
          float pulse = 0.75 + 0.25 * sin(uTime * 4.0);
          float a = 0.0;
          int s = int(vStyle + 0.5);
          if (s == 0) a = smoothstep(0.42, 0.36, d) * 0.85;                         // Scheibe
          else if (s == 1) a = ring(d, 0.72, 0.09)
                               + step(0.72, abs(vUv.x)) * step(0.72, abs(vUv.y)) * step(sq, 0.97) * 0.9; // Ring + Eckzacken
          else if (s == 2) a = ring(d, 0.7, 0.06) + ring(d, 0.5, 0.06);           // Doppelring
          else if (s == 3) a = ring(d, 0.68, 0.07) + smoothstep(0.2, 0.14, d);    // Ring + Punkt
          else if (s == 4) a = smoothstep(0.08, 0.0, abs(sq - 0.92)) * 0.6 + 0.12; // letzter Zug: Rahmen
          else if (s == 5) a = smoothstep(1.0, 0.0, d) * 0.9;                     // Schach: Glühen
          else a = smoothstep(0.06, 0.0, abs(sq - 0.95)) * 0.9;                   // Hover-Rahmen
          gl_FragColor = vec4(vCol * (0.9 + 0.5 * pulse), clamp(a * (0.75 + 0.25 * pulse), 0.0, 0.95));
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.position.y = surfaceY + 0.004;
    this.mesh.renderOrder = 2;
  }

  private rebuild(): void {
    const pal = this.colorblind ? PAL_CB : PAL_NORMAL;
    const c = new THREE.Color();
    this.entries.forEach((e, i) => {
      squareCenter(e.sq, this.squareSize, this.tmp);
      const size = this.squareSize * (e.style === 'check' ? 1.0 : 0.96);
      this.m.makeScale(size, 1, size).setPosition(this.tmp.x, i * 0.0004, this.tmp.z);
      this.mesh.setMatrixAt(i, this.m);
      this.styleAttr.setX(i, STYLE_ID[e.style]);
      c.set(pal[e.style]);
      this.colorAttr.setXYZ(i, c.r, c.g, c.b);
    });
    this.mesh.count = this.entries.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.styleAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }

  private base: { sq: Square; style: Style }[] = [];
  private targets: { sq: Square; style: Style }[] = [];
  private hover: { sq: Square; style: Style }[] = [];

  /** Dauerhafte Markierungen: letzter Zug und Schach. */
  setBase(lastFrom: Square | null, lastTo: Square | null, checkSq: Square | null): void {
    this.base = [];
    if (lastFrom) this.base.push({ sq: lastFrom, style: 'last' });
    if (lastTo) this.base.push({ sq: lastTo, style: 'last' });
    if (checkSq) this.base.push({ sq: checkSq, style: 'check' });
    this.flush();
  }

  setTargets(list: { to: Square; kind: MoveKind }[]): void {
    this.targets = list.map((m) => ({ sq: m.to, style: styleOf(m.kind) }));
    this.flush();
  }

  setHover(sq: Square | null): void {
    this.hover = sq ? [{ sq, style: 'hover' }] : [];
    this.flush();
  }

  private flush(): void {
    this.entries = [...this.base, ...this.targets, ...this.hover];
    this.rebuild();
  }

  refreshPalette(): void {
    this.rebuild();
  }
}
