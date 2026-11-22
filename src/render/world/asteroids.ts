import * as THREE from 'three';
import { mulberry32, worldUniforms } from '../shared';
import { AsteroidSky, type V3, positionOf, slerpDir } from './asteroidSim';
import { SKY_BODIES, SKY_SUN } from './sky';

/**
 * Darstellung der Himmelsobjekte. Wie der Himmel „im Unendlichen“: nur die Kamera-Rotation wird angewendet
 * (keine Translation → in beiden Augen identisch, keine falsche Stereo-Tiefe), Tiefe exakt auf der Far-Plane
 * (xyww) → nie Tiefenkonflikt, jede Geometrie der Welt liegt davor.
 *   - Felsbrocken (Asteroiden, Kometenköpfe): ein InstancedMesh, prozedurales Low-Poly-Noise-Mesh, Licht aus fester
 *     Himmelsrichtung (eine Seite hell, eine dunkel), langsame Eigendrehung.
 *   - Streifen (Kometenschweife, Sternschnuppen): ein InstancedMesh, additiv, weicher Verlauf, keine Blitze.
 * 2 Draw Calls, höchstens 8 Objekte (Pool).
 */
const R = 100; // Radius der gedachten Himmelskugel (nur für die Instanz-Matrizen)
const HUES = [new THREE.Color('#38f2e0'), new THREE.Color('#b26bff'), new THREE.Color('#ff9a4a')];

function rockGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  g.deleteAttribute('uv');
  const p = g.getAttribute('position');
  const rng = mulberry32(21);
  const bumps = Array.from({ length: 6 }, () => new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize());
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    let k = 1;
    for (const b of bumps) k -= Math.max(0, v.dot(b) - 0.6) * 0.9; // Krater/Abplattungen
    k *= 0.85 + 0.3 * Math.abs(Math.sin(v.x * 5.1 + v.y * 3.7 + v.z * 4.3));
    v.multiplyScalar(k).multiply(new THREE.Vector3(1.35, 0.85, 1));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  const ng = g.toNonIndexed();
  ng.computeVertexNormals(); // facettiert = felsig
  return ng;
}

const SKY_VERTEX = /* glsl */ `
  vec4 skyClip(vec3 p){
    vec4 c = projectionMatrix * vec4(mat3(viewMatrix) * p, 1.0);
    return c.xyww;
  }`;

export class Asteroids {
  readonly group = new THREE.Group();
  readonly sky: AsteroidSky;
  private rocks: THREE.InstancedMesh;
  private streaks: THREE.InstancedMesh;
  private glowAttr: THREE.InstancedBufferAttribute;
  private streakAttr: THREE.InstancedBufferAttribute;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();

  constructor(seed = 17) {
    this.group.name = 'asteroids';
    const bodies = Object.values(SKY_BODIES).map((b) => ({ dir: { x: b.dir.x, y: b.dir.y, z: b.dir.z }, r: b.r }));
    this.sky = new AsteroidSky(mulberry32(seed), bodies);
    const geo = rockGeometry();
    this.glowAttr = new THREE.InstancedBufferAttribute(new Float32Array(8 * 4), 4);
    this.glowAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aGlow', this.glowAttr);
    this.rocks = new THREE.InstancedMesh(
      geo,
      new THREE.ShaderMaterial({
        depthWrite: false,
        uniforms: { uSun: { value: SKY_SUN.clone() }, uTime: worldUniforms.uTime },
        vertexShader: /* glsl */ `
          attribute vec4 aGlow; // rgb Glühfarbe, a Stärke (Kometenkopf)
          varying vec3 vN; varying vec4 vGlow; varying vec3 vLocal;
          ${SKY_VERTEX}
          void main(){
            vec3 p = (instanceMatrix * vec4(position, 1.0)).xyz;
            vN = normalize(mat3(instanceMatrix) * normal);
            vGlow = aGlow; vLocal = position;
            gl_Position = skyClip(p);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uSun;
          varying vec3 vN; varying vec4 vGlow; varying vec3 vLocal;
          void main(){
            float lit = max(dot(normalize(vN), uSun), 0.0);
            float grain = 0.75 + 0.25 * fract(sin(dot(floor(vLocal * 6.0), vec3(12.9, 78.2, 37.7))) * 43758.5);
            vec3 rock = vec3(0.42, 0.36, 0.34) * grain;
            vec3 col = rock * (0.035 + 0.8 * lit);   // Nachtseite fast schwarz, Tagseite felsig hell
            col = mix(col, vGlow.rgb * 1.4, vGlow.a);
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
      8,
    );
    this.rocks.count = 0;
    this.rocks.frustumCulled = false;
    this.rocks.renderOrder = -9;
    // Streifen: Kegel entlang +Y (0 → 1), Spitze hinten
    const sg = new THREE.CylinderGeometry(0, 1, 1, 8, 1, true).translate(0, 0.5, 0);
    sg.deleteAttribute('uv');
    this.streakAttr = new THREE.InstancedBufferAttribute(new Float32Array(8 * 4), 4);
    this.streakAttr.setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('aCol', this.streakAttr);
    this.streaks = new THREE.InstancedMesh(
      sg,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          attribute vec4 aCol; varying vec4 vCol; varying float vY;
          ${SKY_VERTEX}
          void main(){
            vY = position.y; vCol = aCol;
            gl_Position = skyClip((instanceMatrix * vec4(position, 1.0)).xyz);
          }`,
        fragmentShader: /* glsl */ `
          varying vec4 vCol; varying float vY;
          void main(){
            float a = pow(1.0 - vY, 1.6) * vCol.a;   // am Kopf hell, zum Schweifende weich auslaufend
            gl_FragColor = vec4(vCol.rgb * a, a);
          }`,
      }),
      8,
    );
    this.streaks.count = 0;
    this.streaks.frustumCulled = false;
    this.streaks.renderOrder = -8;
    this.group.add(this.rocks, this.streaks);
  }

  update(dt: number): void {
    this.sky.step(dt);
    const now = this.sky.now;
    let nr = 0;
    let ns = 0;
    for (const o of this.sky.objects) {
      const p = positionOf(o, now);
      if (!p) continue;
      const u = (now - o.start) / o.duration;
      // weich ein-/ausblenden (Größe bzw. Helligkeit), keine harten Auftritte
      const env = Math.min(1, u / 0.08, (1 - u) / 0.08);
      const pos = new THREE.Vector3(p.x, p.y, p.z).multiplyScalar(R);
      const ahead = slerpDir(o.from, o.to, Math.min(1, u + 0.01));
      const vel = new THREE.Vector3(ahead.x - p.x, ahead.y - p.y, ahead.z - p.z).normalize();
      if (o.kind !== 'meteor' && nr < 8) {
        const s = o.size * R * (o.kind === 'comet' ? 0.6 : 1) * Math.max(0.05, env);
        this.q.setFromAxisAngle(new THREE.Vector3(o.seed - 0.5, 1, o.seed * 0.7).normalize(), now * o.spin + o.seed * 10);
        this.m.compose(pos, this.q, new THREE.Vector3(s, s, s));
        this.rocks.setMatrixAt(nr, this.m);
        if (o.kind === 'comet') {
          const c = HUES[o.hue];
          this.glowAttr.setXYZW(nr, c.r, c.g, c.b, 0.85);
        } else this.glowAttr.setXYZW(nr, 0, 0, 0, 0);
        nr++;
      }
      if ((o.kind === 'comet' || o.kind === 'meteor') && ns < 8) {
        // Schweif: entgegen der Flugrichtung, in der Tangentialebene der Himmelskugel
        const len = (o.kind === 'comet' ? 0.22 : 0.07) * R;
        const width = (o.kind === 'comet' ? 0.018 : 0.0025) * R;
        const back = vel.clone().negate();
        this.q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), back);
        this.m.compose(pos, this.q, new THREE.Vector3(width, len, width));
        this.streaks.setMatrixAt(ns, this.m);
        const c = o.kind === 'comet' ? HUES[o.hue] : new THREE.Color('#e8f4ff');
        // Sternschnuppe: an- und abschwellen (max. moderat hell – keine Blitze)
        const k = o.kind === 'meteor' ? Math.sin(Math.min(1, Math.max(0, u)) * Math.PI) * 0.55 : 0.45 * env;
        this.streakAttr.setXYZW(ns, c.r, c.g, c.b, k);
        ns++;
      }
    }
    this.rocks.count = nr;
    this.streaks.count = ns;
    this.rocks.instanceMatrix.needsUpdate = true;
    this.streaks.instanceMatrix.needsUpdate = true;
    this.glowAttr.needsUpdate = true;
    this.streakAttr.needsUpdate = true;
  }
}

export type { V3 };
