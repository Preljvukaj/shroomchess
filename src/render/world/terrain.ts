import * as THREE from 'three';
import { GLSL_FOG, GLSL_NOISE, worldUniforms } from '../shared';
import { type Basin, buildTerrainGrid } from './basin';

/**
 * Geländemesh der Senke: flacher Boden (y = 0) in der Spielfläche, bewachsene Wälle
 * (Moos, Wurzeln, leuchtende Myzel-Adern), dunkles Plateau dahinter. Ein Draw Call.
 */
export function createTerrain(basin: Basin, angular = 96): THREE.Mesh {
  const grid = buildTerrainGrid(basin, angular);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(grid.positions, 3));
  geo.setIndex(new THREE.BufferAttribute(grid.index, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mat = new THREE.ShaderMaterial({
    uniforms: { ...worldUniforms, uExtent: { value: basin.extent }, uCenter: { value: new THREE.Vector2(basin.center.x, basin.center.z) } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying vec3 vN; varying float vDist;
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
        vec4 mv = viewMatrix * w; vDist = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uTint; uniform float uTintAmt; uniform float uExtent; uniform vec2 uCenter;
      varying vec3 vWorld; varying vec3 vN; varying float vDist;
      ${GLSL_NOISE}
      ${GLSL_FOG}
      float voronoiEdge(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p); float d1 = 8.0, d2 = 8.0;
        for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++){
          vec2 g = vec2(x,y); vec2 o = vec2(hash12(i+g), hash12(i+g+17.3));
          float d = length(g + o - f);
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
        return d2 - d1;
      }
      void main(){
        vec3 n = normalize(vN);
        vec2 p = vWorld.xz;
        float h = vWorld.y;
        float slope = 1.0 - clamp(n.y, 0.0, 1.0);            // 0 flach, 1 senkrecht
        float wall = smoothstep(0.02, 0.6, h);
        float r = length(p - uCenter);
        float nse = fbm(p * 0.35 + h * 0.2);
        // Umgebung grün: saftiges Moos, Bodendecker, kurzes gras-artiges Alien-Gewächs.
        // Mehrere Grüntöne (Smaragd → Moosgrün → türkisgrün) per Noise gemischt.
        vec3 emerald = vec3(0.018, 0.085, 0.045);
        vec3 mossG   = vec3(0.04, 0.075, 0.02);
        vec3 teal    = vec3(0.015, 0.075, 0.065);
        float m1 = fbm(vec2(p.x + h, p.y - h) * 0.6 + 3.0);
        float m2 = fbm(p * 1.9 + 8.0);
        vec3 col = mix(mix(emerald, mossG, smoothstep(0.35, 0.65, m1)), teal, smoothstep(0.55, 0.8, m2));
        // gras-artige Struktur: feine, gerichtete Streifen + Polster
        float blades = 0.5 + 0.5 * sin(p.x * 55.0 + sin(p.y * 13.0) * 2.0 + fbm(p * 6.0) * 6.0);
        col *= 0.82 + 0.28 * blades * fbm(p * 12.0);
        float cushion = smoothstep(0.62, 0.75, fbm(p * 3.3 + 1.0));
        col = mix(col, col * 1.35 + vec3(0.0, 0.015, 0.008), cushion);
        float moss = m1;
        // Wurzeln: dunkle, gewundene Stränge am Hang
        float rootN = abs(fbm(vec2(atan(p.y - uCenter.y, p.x - uCenter.x) * 9.0, h * 1.6)) - 0.5);
        float root = (1.0 - smoothstep(0.0, 0.035, rootN)) * wall;
        col = mix(col, vec3(0.05, 0.03, 0.025), root * 0.85);
        // Mondlicht
        float moonL = clamp(dot(n, normalize(vec3(-0.5, 0.8, -0.4))), 0.0, 1.0);
        col *= 0.55 + 0.6 * moonL;
        // Myzel-Adern (leuchtend), auf dem Boden dezent, am Hang kräftiger
        float e = voronoiEdge(vec2(p.x + h * 0.7, p.y - h * 0.4) * 0.55 + vec2(fbm(p*0.3), fbm(p*0.3+5.0)) * 1.4);
        float vein = 1.0 - smoothstep(0.0, 0.05, e);
        float pulse = 0.55 + 0.45 * sin(uTime * 0.8 - r * 0.35 + nse * 6.0);
        vec3 veinCol = mix(vec3(0.1, 0.9, 0.8), vec3(0.6, 0.25, 1.0), smoothstep(0.3, 0.7, fbm(p * 0.12)));
        veinCol = mix(veinCol, uTint, uTintAmt);
        float floorFade = smoothstep(uExtent * 0.5, uExtent * 1.1, r);
        col += veinCol * vein * pulse * (0.04 + 0.16 * floorFade + 0.18 * wall) * (1.0 - root);
        // leuchtende Moos-Sprenkel auf dem Hang
        float speck = step(0.988, hash12(floor(vec2(p.x + h, p.y) * 9.0))) * (moss + wall);
        col += vec3(0.4, 1.0, 0.3) * speck * (0.5 + 0.5 * sin(uTime * 2.0 + hash12(floor(p*9.0)) * 30.0)) * 0.35;
        // leuchtende Grasspitzen, vereinzelt
        float tip = step(0.985, hash12(floor(p * 30.0)));
        col += vec3(0.3, 1.0, 0.6) * tip * 0.12 * (0.6 + 0.4 * sin(uTime * 1.5 + p.x * 3.0));
        gl_FragColor = vec4(applyFog(col, vDist), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -0.002; // minimal unter dem Brett (kein Z-Fighting)
  mesh.name = 'terrain';
  return mesh;
}
