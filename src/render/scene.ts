import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Quality } from '../core/settings';
import { worldUniforms } from './shared';

export interface QualityProfile {
  pixelRatio: number;
  bloom: boolean;
  latheSegments: number;
  /** Detailstufe der nahen Pilze (Lamellen, Segmente). */
  shroomDetail: 'low' | 'medium' | 'high';
  /** Pilze an den Wällen der Senke (volle Geometrie mit Lamellen). */
  nearShrooms: number;
  /** Riesenpilze am Rand, die über die Senke ragen. */
  rimGiants: number;
  /** Pilze hinter dem Wall (Fern-LOD ohne Lamellen). */
  farShrooms: number;
  /** Sehr weit entfernte 3D-Pilze (Low-Poly-LOD, ersetzt Billboards). */
  vfarShrooms: number;
  /** Saum aus Moospolstern/Mini-Leuchtpilzen am Rand der Spielfläche (pro Meter Umfang). */
  saumPerMeter: number;
  /** Baby-Pilze rund um größere Exemplare. */
  babies: number;
  ferns: number;
  pods: number;
  spores: number;
  vines: number;
  mycelium: number;
  terrainAngular: number;
  /** Insekten gesamt (Vorgabe: Low 30, Medium 80, High 200). */
  insects: number;
}

export const QUALITY: Record<Quality, QualityProfile> = {
  low: { pixelRatio: 1, bloom: false, latheSegments: 18, shroomDetail: 'low', nearShrooms: 60, rimGiants: 12, farShrooms: 40, vfarShrooms: 120, saumPerMeter: 3, babies: 40, ferns: 90, pods: 40, spores: 300, vines: 10, mycelium: 20, terrainAngular: 72, insects: 30 },
  medium: { pixelRatio: 1.5, bloom: false, latheSegments: 26, shroomDetail: 'medium', nearShrooms: 120, rimGiants: 22, farShrooms: 70, vfarShrooms: 220, saumPerMeter: 5, babies: 100, ferns: 220, pods: 100, spores: 800, vines: 20, mycelium: 45, terrainAngular: 96, insects: 80 },
  high: { pixelRatio: 2, bloom: true, latheSegments: 36, shroomDetail: 'high', nearShrooms: 280, rimGiants: 36, farShrooms: 120, vfarShrooms: 420, saumPerMeter: 8, babies: 220, ferns: 480, pods: 200, spores: 2000, vines: 36, mycelium: 90, terrainAngular: 128, insects: 200 },
};

export type FrameCallback = (dt: number, time: number, frame?: XRFrame) => void;

/** Renderer, Kamera, Licht, Umgebungs-Map und (optional) Bloom. */
export class SceneContext {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** Träger der Kamera – in VR wird dieser „Rig“ verschoben, nie die Kamera selbst. */
  readonly rig = new THREE.Group();
  private composer: EffectComposer | null = null;
  private callbacks = new Set<FrameCallback>();
  private clock = new THREE.Timer();
  profile: QualityProfile;

  constructor(container: HTMLElement, public quality: Quality) {
    this.profile = QUALITY[quality];
    this.renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.profile.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.xr.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.05, 400);
    this.rig.add(this.camera);
    this.scene.add(this.rig);
    this.scene.background = new THREE.Color('#03020a');

    // Höchstens zwei Echtzeitlichter: Mondlicht + Hemisphäre (kein Schatten, Kontaktschatten sind gebacken).
    const hemi = new THREE.HemisphereLight('#b8b4d8', '#10141a', 0.5);
    const moon = new THREE.DirectionalLight('#d8e6ff', 1.5);
    moon.position.set(-8, 14, -6);
    this.scene.add(hemi, moon);
    this.scene.environment = this.buildEnvironment();

    if (this.profile.bloom) this.setupBloom();

    window.addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop((t, frame) => this.tick(t, frame));
  }

  /** Kleine, dunkle Umgebungs-Map aus leuchtenden Flecken → Glanzlichter auf Stein/Obsidian. */
  private buildEnvironment(): THREE.Texture {
    const env = new THREE.Scene();
    const geo = new THREE.SphereGeometry(1, 16, 8);
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(20, 32, 16),
      new THREE.MeshBasicMaterial({ color: '#0b0820', side: THREE.BackSide }),
    );
    env.add(sky);
    const blobs: [string, number, number, number, number][] = [
      ['#2fd8ff', 6, 4, -8, 2.5],
      ['#ff2fb3', -7, 2, 5, 2],
      ['#8b3dff', 3, 9, 6, 3.5],
      ['#1de9c9', -5, 1, -6, 2],
      ['#fff4e0', -8, 14, -6, 1.2],
    ];
    for (const [c, x, y, z, s] of blobs) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c }));
      m.position.set(x, y, z);
      m.scale.setScalar(s);
      env.add(m);
    }
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const tex = pmrem.fromScene(env, 0.04).texture;
    pmrem.dispose();
    return tex;
  }

  private setupBloom(): void {
    const size = this.renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(size, 0.55, 0.5, 0.85));
    this.composer.addPass(new OutputPass());
  }

  onFrame(cb: FrameCallback): () => void {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  private resize(): void {
    if (this.renderer.xr.isPresenting) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer?.setSize(window.innerWidth, window.innerHeight);
  }

  private tick(_t: number, frame?: XRFrame): void {
    this.clock.update();
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const time = this.clock.getElapsed();
    worldUniforms.uTime.value = time;
    for (const cb of this.callbacks) cb(dt, time, frame);
    // Post-Processing nur am Desktop – in XR wäre es zu teuer und nicht stereo-korrekt.
    if (this.composer && !this.renderer.xr.isPresenting) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
