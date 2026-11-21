import * as THREE from 'three';
import { type Square, frToSquare } from '../core/types';
import { FRAME_WIDTH_FACTOR } from './coordLayout';
import { GLSL_NOISE, mulberry32, worldUniforms } from './shared';

/** Brett-lokale Koordinaten: Feld (f, r) → (x, z). Weiß steht bei +Z. */
export function squareCenter(sq: Square, s: number, out = new THREE.Vector3()): THREE.Vector3 {
  const f = sq.charCodeAt(0) - 97;
  const r = sq.charCodeAt(1) - 49;
  return out.set((f - 3.5) * s, 0, (3.5 - r) * s);
}

/** Brett-lokale Position → Feld oder null (außerhalb). */
export function squareAt(x: number, z: number, s: number): Square | null {
  const f = Math.floor(x / s + 4);
  const r = Math.floor(4 - z / s);
  if (f < 0 || f > 7 || r < 0 || r > 7) return null;
  return frToSquare(f, r);
}

function stoneTexture(kind: 'moon' | 'basalt', seed: number): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const rng = mulberry32(seed);
  if (kind === 'moon') {
    const grd = g.createLinearGradient(0, 0, size, size);
    grd.addColorStop(0, '#d9dcef');
    grd.addColorStop(0.5, '#c7cde6');
    grd.addColorStop(1, '#dfe2f2');
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    // feine bläuliche Adern (Adularisieren)
    for (let i = 0; i < 14; i++) {
      g.strokeStyle = `rgba(${120 + rng() * 60},${150 + rng() * 60},255,${0.08 + rng() * 0.12})`;
      g.lineWidth = 1 + rng() * 3;
      g.beginPath();
      let x = rng() * size;
      let y = rng() * size;
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (rng() - 0.5) * 90;
        y += (rng() - 0.5) * 90;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  } else {
    g.fillStyle = '#17141f';
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < 2500; i++) {
      const v = 20 + rng() * 40;
      g.fillStyle = `rgba(${v},${v - 4},${v + 10},${0.5 + rng() * 0.5})`;
      g.fillRect(rng() * size, rng() * size, 1 + rng() * 2, 1 + rng() * 2);
    }
  }
  // Flecken
  for (let i = 0; i < 40; i++) {
    g.fillStyle = kind === 'moon' ? `rgba(255,255,255,${rng() * 0.08})` : `rgba(90,70,120,${rng() * 0.08})`;
    g.beginPath();
    g.arc(rng() * size, rng() * size, 4 + rng() * 20, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class BoardView {
  readonly root = new THREE.Group();
  readonly squareSize: number;

  constructor(squareSize: number) {
    this.squareSize = squareSize;
    this.root.name = 'board';
    this.build();
  }

  get side(): number {
    return this.squareSize * 8;
  }

  private build(): void {
    const s = this.squareSize;
    const gap = s * 0.035;
    const h = Math.min(0.05, s * 0.1);

    // Fugen: leuchtende Fläche unter den Steinen
    const grout = new THREE.Mesh(
      new THREE.PlaneGeometry(8 * s, 8 * s).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        uniforms: { ...worldUniforms, uS: { value: s } },
        vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform float uS; uniform vec3 uTint; uniform float uTintAmt; varying vec2 vP;
          ${GLSL_NOISE}
          void main(){
            float flow = 0.55 + 0.45 * sin(uTime * 1.2 - length(vP) * 3.0 / uS + vnoise(vP * 4.0 / uS) * 4.0);
            vec3 c = mix(vec3(0.1, 0.9, 0.85), vec3(0.55, 0.3, 1.0), vnoise(vP * 0.6 / uS));
            c = mix(c, uTint, uTintAmt);
            gl_FragColor = vec4(c * (0.5 + 0.9 * flow), 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    grout.position.y = h * 0.3;
    this.root.add(grout);

    // Felder: je Steinart ein InstancedMesh (2 Draw Calls für 64 Felder)
    const tileGeo = new THREE.BoxGeometry(s - gap, h, s - gap);
    tileGeo.translate(0, h / 2, 0);
    const light = new THREE.MeshStandardMaterial({ map: stoneTexture('moon', 1), roughness: 0.35, metalness: 0.0, envMapIntensity: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ map: stoneTexture('basalt', 2), roughness: 0.55, metalness: 0.05, envMapIntensity: 0.7 });
    const lightMesh = new THREE.InstancedMesh(tileGeo, light, 32);
    const darkMesh = new THREE.InstancedMesh(tileGeo, dark, 32);
    let li = 0;
    let di = 0;
    const m = new THREE.Matrix4();
    const rng = mulberry32(5);
    for (let f = 0; f < 8; f++) {
      for (let r = 0; r < 8; r++) {
        const p = squareCenter(frToSquare(f, r), s);
        // leichte Zufallsdrehung in 90°-Schritten → Texturvariation
        m.makeRotationY(Math.floor(rng() * 4) * (Math.PI / 2)).setPosition(p.x, 0, p.z);
        if ((f + r) % 2 === 1) lightMesh.setMatrixAt(li++, m);
        else darkMesh.setMatrixAt(di++, m);
      }
    }
    this.root.add(lightMesh, darkMesh);

    // Moosring als Rahmen
    const outer = 8 * s + 2 * FRAME_WIDTH_FACTOR * s;
    const inner = 8 * s + gap;
    const shape = new THREE.Shape();
    shape.moveTo(-outer / 2, -outer / 2).lineTo(outer / 2, -outer / 2).lineTo(outer / 2, outer / 2).lineTo(-outer / 2, outer / 2).closePath();
    const hole = new THREE.Path();
    hole.moveTo(-inner / 2, -inner / 2).lineTo(-inner / 2, inner / 2).lineTo(inner / 2, inner / 2).lineTo(inner / 2, -inner / 2).closePath();
    shape.holes.push(hole);
    const frameGeo = new THREE.ExtrudeGeometry(shape, { depth: h * 0.9, bevelEnabled: true, bevelThickness: h * 0.4, bevelSize: s * 0.06, bevelSegments: 3, curveSegments: 1 });
    frameGeo.rotateX(-Math.PI / 2);
    const moss = new THREE.ShaderMaterial({
      uniforms: { ...worldUniforms },
      vertexShader: `varying vec3 vW; varying vec3 vN; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uTint; uniform float uTintAmt; varying vec3 vW; varying vec3 vN;
        ${GLSL_NOISE}
        void main(){
          float n = fbm(vW.xz * 7.0);
          float light = 0.35 + 0.65 * clamp(dot(normalize(vN), normalize(vec3(-0.4, 1.0, -0.3))), 0.0, 1.0);
          vec3 c = mix(vec3(0.02, 0.07, 0.05), vec3(0.06, 0.2, 0.12), n) * light;
          float tip = step(0.975, hash12(floor(vW.xz * 40.0)));
          vec3 g = mix(vec3(0.5, 1.0, 0.4), uTint, uTintAmt);
          c += g * tip * (0.5 + 0.5 * sin(uTime * 1.7 + hash12(floor(vW.xz*40.0)) * 20.0)) * 0.8;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.root.add(new THREE.Mesh(frameGeo, moss));

    // Koordinaten: siehe render/coordinates.ts (SDF-Text, eigenes Modul)


    // Gebackener „Kontaktschatten“ / Lichtschein rund um das Brett
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(outer * 1.3, outer * 1.3).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uHalf: { value: outer / 2 } },
        vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform float uHalf; varying vec2 vP; void main(){ vec2 d = max(abs(vP) - uHalf, 0.0); float a = exp(-length(d) * 3.0 / max(uHalf*0.25, 0.05)); gl_FragColor = vec4(vec3(0.03,0.16,0.16)*a*0.35, a*0.35); }`,
      }),
    );
    halo.position.y = 0.001;
    this.root.add(halo);
  }

  /** Höhe der Brettoberfläche (Figurenfuß). */
  get surfaceY(): number {
    return Math.min(0.05, this.squareSize * 0.1);
  }
}
