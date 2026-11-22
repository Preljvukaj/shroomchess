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
  /** Insekten gesamt (Vorgabe: Low 60, Medium 180, High 400; wird bei zu wenig FPS automatisch reduziert). */
  insects: number;
  /** Neue Alien-Flora: Instanzen je Art (bei zu wenig FPS zuerst die Fernanteile senken). */
  flora: { bubble: number; tentacle: number; fan: number; coral: number; leaf: number; capsule: number; clumpA: number; clumpB: number };
  /** Riesenpilze mit herabhängenden Leuchtfäden */
  hangingCaps: number;
  /** Steine (alle Arten zusammen) */
  rocks: number;
  /** feine Stein-LOD-Stufe für nahe Steine (sonst überall die grobe) */
  rockNearDetail: boolean;
  /** Gleichzeitige Lavalampen-Blasen */
  bubbles: number;
}

export const QUALITY: Record<Quality, QualityProfile> = {
  low: { pixelRatio: 1, bloom: false, latheSegments: 18, shroomDetail: 'low', nearShrooms: 60, rimGiants: 12, farShrooms: 40, vfarShrooms: 120, saumPerMeter: 3, babies: 40, ferns: 90, pods: 40, spores: 300, vines: 10, mycelium: 20, terrainAngular: 72, insects: 60, flora: { bubble: 14, tentacle: 12, fan: 12, coral: 18, leaf: 12, capsule: 12, clumpA: 40, clumpB: 24 }, hangingCaps: 5, rocks: 50, rockNearDetail: false, bubbles: 8 },
  medium: { pixelRatio: 1.5, bloom: false, latheSegments: 26, shroomDetail: 'medium', nearShrooms: 100, rimGiants: 20, farShrooms: 40, vfarShrooms: 110, saumPerMeter: 5, babies: 90, ferns: 170, pods: 90, spores: 800, vines: 20, mycelium: 45, terrainAngular: 96, insects: 180, flora: { bubble: 26, tentacle: 22, fan: 22, coral: 28, leaf: 18, capsule: 22, clumpA: 80, clumpB: 44 }, hangingCaps: 10, rocks: 90, rockNearDetail: false, bubbles: 14 },
  high: { pixelRatio: 2, bloom: true, latheSegments: 36, shroomDetail: 'high', nearShrooms: 280, rimGiants: 36, farShrooms: 120, vfarShrooms: 420, saumPerMeter: 8, babies: 220, ferns: 480, pods: 200, spores: 2000, vines: 36, mycelium: 90, terrainAngular: 128, insects: 400, flora: { bubble: 70, tentacle: 60, fan: 60, coral: 100, leaf: 60, capsule: 60, clumpA: 200, clumpB: 110 }, hangingCaps: 20, rocks: 160, rockNearDetail: true, bubbles: 20 },
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
    // MSAA immer an – auch auf der Quest (Low): der XR-Framebuffer übernimmt `antialias` (4× MSAA auf
    // Tile-GPUs nahezu kostenlos) und es verhindert das Flimmern feiner Kanten wie der Figurenkontur.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
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

    // Genau zwei Echtzeitlichter, beide auf das Brett gerichtet („Lichtinsel“, siehe placeLights):
    //  Hauptlicht: weiches, leicht kühles Licht schräg von oben (wie durch eine Öffnung im Pilzdach)
    //  Kantenlicht: schwächer, türkis, flach von der Seite → Silhouetten leuchten für BEIDE Spielerseiten
    // Die Welt nutzt eigene (emissive) Shader und wird davon nicht beeinflusst → das Brett wirkt als Bühne.
    // Grundhelligkeit kommt aus der Environment-Map (kein Hemisphärenlicht mehr).
    this.keyLight = new THREE.DirectionalLight('#e4eeff', 2.6);
    this.rimLight = new THREE.DirectionalLight('#45e6ff', 1.6);
    this.scene.add(this.keyLight, this.keyLight.target, this.rimLight, this.rimLight.target);
    this.placeLights(new THREE.Vector3(0, 0, 0), 0, 1);
    this.scene.environment = this.buildEnvironment();

    if (this.profile.bloom) this.setupBloom();

    window.addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop((t, frame) => this.tick(t, frame));
  }

  readonly keyLight: THREE.DirectionalLight;
  readonly rimLight: THREE.DirectionalLight;

  /**
   * Lichter auf das Brett ausrichten (Mitte, Brett-Yaw, Maßstab). Hauptlicht schräg von oben über
   * der Ecke a1/h8-Diagonale; Kantenlicht flach von der rechten Seite (aus Sicht von Weiß) – damit
   * erscheint es für Weiß rechts und für Schwarz links, Silhouetten leuchten auf beiden Seiten.
   */
  placeLights(center: THREE.Vector3, yaw: number, scale: number): void {
    const rot = (x: number, z: number) => new THREE.Vector3(x * Math.cos(yaw) + z * Math.sin(yaw), 0, -x * Math.sin(yaw) + z * Math.cos(yaw));
    this.keyLight.target.position.copy(center);
    this.keyLight.position.copy(center).add(rot(-2.2 * scale, 1.6 * scale)).setY(center.y + 6 * scale);
    this.rimLight.target.position.copy(center);
    this.rimLight.position.copy(center).add(rot(5 * scale, -0.6 * scale)).setY(center.y + 1.4 * scale);
    this.keyLight.target.updateMatrixWorld();
    this.rimLight.target.updateMatrixWorld();
  }

  /**
   * Umgebungs-Map (PMREM aus einer kleinen Szene): dunkler violetter Grund, eine große kühle
   * „Dachöffnung“ oben, farbige Lichtstreifen ringsum (Türkis/Violett/Magenta) und warme Akzente.
   * Auf dem Obsidian (Rauheit 0,3) entstehen so weiche, formnachzeichnende Reflexe.
   */
  private buildEnvironment(): THREE.Texture {
    const env = new THREE.Scene();
    const sky = new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), new THREE.MeshBasicMaterial({ color: '#100c26', side: THREE.BackSide }));
    env.add(sky);
    const geo = new THREE.SphereGeometry(1, 16, 8);
    const add = (c: string, x: number, y: number, z: number, sx: number, sy = sx, sz = sx) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c }));
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      env.add(m);
    };
    add('#dcebff', 0, 15, 0, 6, 1, 6); // Öffnung im Pilzdach
    add('#2fd8ff', 14, 2, 0, 1.5, 3, 9); // türkiser Streifen rechts
    add('#8b3dff', -14, 3, 0, 1.5, 3, 9); // violetter Streifen links
    add('#ff2fb3', 0, 2, 14, 7, 1.5, 1.5); // Magenta hinten
    add('#1de9c9', 0, 1.5, -14, 7, 1.5, 1.5); // Türkis vorne
    add('#ffd9a8', -9, 8, 9, 1.4); // warme Akzente
    add('#ffd9a8', 9, 7, -9, 1.2);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const tex = pmrem.fromScene(env, 0.035).texture;
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
