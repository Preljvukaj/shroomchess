import * as THREE from 'three';
import type { Color, PieceSymbol } from '../core/types';
import { pieceGeometry, pieceMaterials } from './pieces';
import { worldUniforms } from './shared';

/**
 * Pilzschale neben dem Brett: ein umgedrehter, leuchtender Pilzhut auf kurzem Stiel.
 * Geschlagene Figuren erscheinen hier verkleinert.
 */
export class CaptureBowl {
  readonly root = new THREE.Group();
  private minis: THREE.Mesh[] = [];
  private readonly radius: number;
  private readonly topY: number;

  constructor(squareSize: number, private kingHeight: number, private segments: number, private high: boolean, tint: string) {
    this.radius = squareSize * 0.95;
    this.topY = Math.min(0.75, Math.max(0.05, squareSize * 1.0));
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(this.radius * 0.18, this.radius * 0.28, this.topY, 12),
      new THREE.MeshStandardMaterial({ color: '#1a1424', roughness: 0.8, emissive: new THREE.Color(tint), emissiveIntensity: 0.08 }),
    );
    stem.position.y = this.topY / 2;
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * (Math.PI / 2);
      pts.push(new THREE.Vector2(Math.sin(a) * this.radius, -Math.cos(a) * this.radius * 0.35 + this.radius * 0.35));
    }
    const bowlGeo = new THREE.LatheGeometry(pts, 32);
    const bowlMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { uTime: worldUniforms.uTime, uTint: { value: new THREE.Color(tint) }, uR: { value: this.radius } },
      vertexShader: `varying vec3 vP; varying vec3 vN; void main(){ vP = position; vN = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uTint; uniform float uR; varying vec3 vP; varying vec3 vN;
        void main(){
          float r = length(vP.xz) / uR;
          float a = atan(vP.z, vP.x);
          float gills = 0.5 + 0.5 * sin(a * 48.0);
          float pulse = 0.7 + 0.3 * sin(uTime * 1.5 - r * 4.0);
          vec3 c = vec3(0.03, 0.02, 0.05) + uTint * (0.15 + 0.5 * gills * r) * pulse;
          c += uTint * smoothstep(0.93, 1.0, r) * 1.2;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const bowl = new THREE.Mesh(bowlGeo, bowlMat);
    bowl.position.y = this.topY;
    this.root.add(stem, bowl);
  }

  add(type: PieceSymbol, color: Color, animateFrom?: THREE.Vector3, effects?: { tween: (d: number, f: (k: number) => void) => void }): void {
    const i = this.minis.length;
    const mini = new THREE.Mesh(pieceGeometry(type, Math.max(12, this.segments >> 1)), pieceMaterials(this.high)[color]);
    const s = this.kingHeight * 0.2;
    mini.scale.setScalar(s);
    // Spirale in der Schale
    const ring = i < 6 ? 0 : 1;
    const idx = ring === 0 ? i : i - 6;
    const n = ring === 0 ? 6 : 10;
    const a = (idx / n) * Math.PI * 2 + ring * 0.3;
    const rr = this.radius * (ring === 0 ? 0.35 : 0.7);
    const target = new THREE.Vector3(Math.cos(a) * rr, this.topY + this.radius * 0.05 + ring * this.radius * 0.08, Math.sin(a) * rr);
    this.root.add(mini);
    this.minis.push(mini);
    if (animateFrom && effects) {
      const from = this.root.worldToLocal(animateFrom.clone());
      mini.position.copy(from);
      mini.scale.setScalar(0.001);
      effects.tween(0.9, (k) => {
        const e = 1 - Math.pow(1 - k, 3);
        mini.position.lerpVectors(from, target, e);
        mini.position.y += Math.sin(e * Math.PI) * this.radius;
        mini.scale.setScalar(Math.max(0.001, s * e));
        mini.rotation.y = e * Math.PI * 2;
      });
    } else {
      mini.position.copy(target);
    }
  }

  clear(): void {
    for (const m of this.minis) m.removeFromParent();
    this.minis = [];
  }
}
