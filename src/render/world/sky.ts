import * as THREE from 'three';
import { GLSL_NOISE, GLSL_SKY_BASE, worldUniforms } from '../shared';

/**
 * Himmel in einem einzigen Draw Call: Sternenfeld, Nebelschleier, zwei Monde
 * und ein gebänderter Gasriese mit Ring – alles analytisch im Fragment-Shader.
 */
/** Himmelskörper (Richtung, Winkelradius in sin-Näherung) – auch für die Asteroidenbahnen (nie hindurch). */
export const SKY_BODIES = {
  moon1: { dir: new THREE.Vector3(-0.45, 0.55, -0.7).normalize(), r: 0.05 },
  moon2: { dir: new THREE.Vector3(0.6, 0.32, -0.73).normalize(), r: 0.028 },
  // Gasriese inkl. Ring (Ring bis 1,9 × Radius)
  giant: { dir: new THREE.Vector3(0.15, 0.08, 1.0).normalize(), r: 0.32 * 1.9 },
};
/** feste Licht-Richtung am Himmel (Asteroiden: eine Seite hell, eine dunkel) */
export const SKY_SUN = new THREE.Vector3(-0.8, 0.3, 0.2).normalize();

export function createSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(300, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: worldUniforms.uTime,
      uMoon1: { value: SKY_BODIES.moon1.dir.clone() },
      uMoon2: { value: SKY_BODIES.moon2.dir.clone() },
      uGiant: { value: SKY_BODIES.giant.dir.clone() },
      uSunDir: { value: SKY_SUN.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        // Unendlich weit: nur die Kamera-Rotation anwenden (keine Translation) → identisch in beiden
        // Augen, keine Parallaxe; xyww legt den Himmel exakt auf die Far-Plane (nie abgeschnitten).
        vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * vDir, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uMoon1; uniform vec3 uMoon2; uniform vec3 uGiant; uniform vec3 uSunDir;
      varying vec3 vDir;
      ${GLSL_NOISE}
      ${GLSL_SKY_BASE}

      // Scheibe um Richtung c mit Winkelradius r → (lokale Koordinaten, Maske)
      vec3 disc(vec3 d, vec3 c, float r){
        vec3 up = abs(c.y) > 0.99 ? vec3(1,0,0) : vec3(0,1,0);
        vec3 t = normalize(cross(up, c)); vec3 b = cross(c, t);
        float cosA = dot(d, c);
        vec2 uv = vec2(dot(d, t), dot(d, b)) / r;
        return vec3(uv, step(0.0, cosA) * (1.0 - smoothstep(0.97, 1.0, length(uv))));
      }

      vec3 moon(vec3 d, vec3 c, float r, vec3 tint, float seed, inout float occl){
        vec3 m = disc(d, c, r);
        if (m.z <= 0.0) return vec3(0);
        vec2 uv = m.xy; float z = sqrt(max(0.0, 1.0 - dot(uv,uv)));
        vec3 n = vec3(uv, z);
        float lit = clamp(dot(n, normalize(vec3(-0.6, 0.3, 0.75))), 0.0, 1.0);
        float crat = fbm(uv * 4.0 + seed) * 0.6 + 0.4;
        occl = max(occl, m.z);
        return tint * (0.08 + lit * crat) * m.z;
      }

      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        // Grundverlauf: fast schwarz oben, violetter Dunst am Horizont (gemeinsam mit der Fern-Atmosphäre)
        vec3 col = skyBase(d);

        // Nebel (Emissions- und Dunkelwolken) – 3D-Noise direkt auf dem Richtungsvektor.
        // Früher: 2D-Noise auf dem Azimut-Winkel (arctan von z/x) → Sprung von +π auf −π in Richtung −X = Naht
        // (und Strahlen am Zenit). Auf der Kugel gibt es so keine Umlaufkante mehr.
        float n1 = fbm3(d * 2.4 + vec3(0.0, uTime * 0.003, 0.0));
        float n2 = fbm3(d * 4.6 + 7.1);
        float wave = fbm3(d * 1.2 + 3.3) - 0.5;
        float band = exp(-pow((h - 0.35 + 0.5 * wave) * 2.4, 2.0));
        vec3 neb = mix(vec3(0.35, 0.05, 0.45), vec3(0.02, 0.35, 0.45), n2);
        col += neb * pow(n1, 3.0) * band * 0.9 * smoothstep(-0.05, 0.15, h);

        // Sterne: Zellen-Hash, funkelnd, Dunkelwolken dämpfen
        vec3 sp = d * 220.0;
        vec3 cell = floor(sp);
        float rnd = hash13(cell);
        if (rnd > 0.985) {
          vec3 f = fract(sp) - 0.5;
          float s = smoothstep(0.08, 0.0, length(f) - 0.03 * (rnd - 0.985) * 60.0);
          float tw = 0.7 + 0.3 * sin(uTime * (1.0 + rnd * 4.0) + rnd * 50.0);
          vec3 sc = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.8, 0.9), hash13(cell + 3.1));
          col += sc * s * tw * smoothstep(-0.02, 0.1, h) * (1.0 - 0.7 * smoothstep(0.55, 0.8, n2));
        }

        // Gasriese am Horizont mit Bändern, Terminator und Ring
        float occl = 0.0;
        vec3 g = disc(d, uGiant, 0.32);
        if (g.z > 0.0) {
          vec2 uv = g.xy; float z = sqrt(max(0.0, 1.0 - dot(uv,uv)));
          vec3 n = normalize(vec3(uv, z));
          float lat = uv.y + 0.08 * fbm(uv * vec2(6.0, 20.0) + uTime * 0.01);
          vec3 bands = mix(vec3(0.55, 0.25, 0.6), vec3(0.15, 0.55, 0.65), 0.5 + 0.5 * sin(lat * 18.0));
          bands = mix(bands, vec3(0.9, 0.5, 0.7), smoothstep(0.6, 0.9, fbm(uv * 8.0)) * 0.4);
          float lit = clamp(dot(n, normalize(vec3(0.7, 0.2, 0.6))), 0.0, 1.0);
          col = mix(col, bands * (0.02 + lit * 0.42), g.z);
          col += vec3(0.4, 0.2, 0.6) * pow(1.0 - z, 3.0) * g.z * 0.35; // Atmosphärenrand
          occl = g.z;
        }
        // Ring (geneigte Ellipse)
        {
          vec3 up = vec3(0,1,0); vec3 t = normalize(cross(up, uGiant)); vec3 b = cross(uGiant, t);
          vec2 uv = vec2(dot(d, t), dot(d, b)) / 0.32;
          float ca = cos(0.35), sa = sin(0.35);
          vec2 r = vec2(ca * uv.x - sa * uv.y, sa * uv.x + ca * uv.y);
          float e = length(vec2(r.x, r.y * 4.2));
          float ring = smoothstep(1.25, 1.3, e) * (1.0 - smoothstep(1.85, 1.9, e));
          ring *= 0.55 + 0.45 * sin(e * 60.0);
          bool behind = r.y > 0.0 && occl > 0.0;
          if (!behind && dot(d, uGiant) > 0.0) col += vec3(0.5, 0.4, 0.55) * ring * 0.18;
        }

        col += moon(d, uMoon1, 0.05, vec3(0.85, 0.9, 1.0), 1.0, occl);
        col += moon(d, uMoon2, 0.028, vec3(1.0, 0.75, 0.85), 5.0, occl);
        // Halo um den großen Mond
        col += vec3(0.25, 0.3, 0.45) * pow(max(dot(d, uMoon1), 0.0), 400.0);

        // Unter dem Horizont: dunkler Dschungelrand
        col = mix(col, vec3(0.01, 0.01, 0.02), smoothstep(0.02, -0.06, h));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
