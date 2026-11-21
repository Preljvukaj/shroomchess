import * as THREE from 'three';
import { type V2, pointInPolygon } from '../../xr/math/vec2';
import { GLSL_NOISE, worldUniforms } from '../shared';

/**
 * Spielflächen-Umrandung (Änderung 6): eine Lichtung aus kurzem, etwas hellerem Moos in exakt
 * der Form der Boundary (bzw. der manuell eingerichteten Fläche). Sehr schwaches Leuchten
 * (Sporen im Boden), weicher Übergang zum Waldboden über `fade` Meter mit Noise-Rand.
 * Liegt auf y = 0 (minimal angehoben + Polygon-Offset), Brett und Figuren überdecken sie.
 */

/** Umriss der Lichtung: innen = Boundary unverändert, außen = um `fade` nach außen versetzt. */
export function clearingOutline(poly: V2[], fade: number): { inner: V2[]; outer: V2[] } {
  // Außenseite robust bestimmen: Kantenmitte minimal entlang der Normalen versetzen – liegt der Punkt
  // innen, zeigt die Normale nach innen → Vorzeichen umdrehen (unabhängig von der Umlaufrichtung).
  let sign = 1;
  {
    const a = poly[0];
    const c = poly[1];
    const n = edgeNormal(a, c, 1);
    const probe = { x: (a.x + c.x) / 2 + n.x * 1e-3, z: (a.z + c.z) / 2 + n.z * 1e-3 };
    if (pointInPolygon(probe, poly)) sign = -1;
  }
  const outer = poly.map((p, i) => {
    const a = poly[(i - 1 + poly.length) % poly.length];
    const c = poly[(i + 1) % poly.length];
    const n1 = edgeNormal(a, p, sign);
    const n2 = edgeNormal(p, c, sign);
    let nx = n1.x + n2.x;
    let nz = n1.z + n2.z;
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    // Gehrung: Abstand zu beiden Kanten = fade (begrenzt, damit spitze Ecken nicht ausufern)
    const cosHalf = Math.max(0.35, nx * n1.x + nz * n1.z);
    const k = fade / cosHalf;
    return { x: p.x + nx * k, z: p.z + nz * k };
  });
  return { inner: poly.map((p) => ({ ...p })), outer };
}

function edgeNormal(a: V2, b: V2, sign: number): V2 {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l = Math.hypot(dx, dz) || 1;
  return { x: (sign * -dz) / l, z: (sign * dx) / l };
}

/**
 * Lichtung als Erd-/Moos-Splatmap in einem Mesh (1 Draw Call):
 *   aEdge = 2 innen (≥ fade vom Rand), 1 auf der Boundary, 0 außen (fade jenseits).
 * Innen: warmes, mittleres Braun (Erde, Humus, Nadeln, Blättchen, Steinchen) mit sehr dezenten Sporen.
 * Übergang (Noise-Maske): Moospolster wachsen in die Erde hinein, Erdflecken liegen im Moos.
 */
export function createClearing(poly: V2[], fade: number): THREE.Mesh {
  const { inner, outer } = clearingOutline(poly, fade);
  const innerBand = clearingOutline(poly, -fade).outer; // nach innen versetzt
  // Füllung: Dreiecksnetz des (ggf. konkaven) inneren Polygons
  const shape = new THREE.Shape(innerBand.map((p) => new THREE.Vector2(p.x, -p.z)));
  const fill = new THREE.ShapeGeometry(shape);
  fill.rotateX(-Math.PI / 2);
  const fillPos = fill.getAttribute('position');
  const pos: number[] = [];
  const edge: number[] = [];
  for (let i = 0; i < fillPos.count; i++) {
    pos.push(fillPos.getX(i), 0, fillPos.getZ(i));
    edge.push(2);
  }
  const idx: number[] = Array.from(fill.index!.array);
  const ring = (a: V2[], ea: number, b: V2[], eb: number) => {
    const base = pos.length / 3;
    a.forEach((p, i) => {
      pos.push(p.x, 0, p.z, b[i].x, 0, b[i].z);
      edge.push(ea, eb);
    });
    for (let i = 0; i < a.length; i++) {
      const s0 = base + i * 2;
      const s1 = base + ((i + 1) % a.length) * 2;
      idx.push(s0, s0 + 1, s1, s1, s0 + 1, s1 + 1);
    }
  };
  ring(innerBand, 2, inner, 1); // inneres Band (Moos wächst herein)
  ring(inner, 1, outer, 0); // äußeres Band (Erde läuft aus)
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    uniforms: { ...worldUniforms },
    vertexShader: `attribute float aEdge; varying float vEdge; varying vec3 vW;
      void main(){ vEdge = aEdge; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uTint; uniform float uTintAmt;
      varying float vEdge; varying vec3 vW;
      ${GLSL_NOISE}
      vec3 srgb(vec3 c){ return pow(c, vec3(2.2)); }
      void main(){
        vec2 p = vW.xz;
        float n = fbm(p * 3.0);
        // Außen: Erde läuft unregelmäßig ins Moos aus (Erdflecken im Grün)
        float a = smoothstep(0.0, 1.0, min(vEdge, 1.0) * 1.15 + (n - 0.5) * 0.7);
        if (a < 0.01) discard;
        // Erde: warmes mittleres Braun #5A3E2B…#6B4A33, ±10 %, feiner Humus
        float hum = fbm(p * 7.0);
        vec3 earth = mix(srgb(vec3(0.353, 0.243, 0.169)), srgb(vec3(0.42, 0.29, 0.2)), hum);
        earth *= 0.9 + 0.2 * fbm(p * 1.7);
        // trockene Nadeln: kurze, schräge Striche
        vec2 q = p * 14.0;
        vec2 cell = floor(q);
        float rnd = hash12(cell);
        if (rnd > 0.82) {
          vec2 f = fract(q) - 0.5;
          float ang = hash12(cell + 7.7) * 6.283;
          vec2 dir = vec2(cos(ang), sin(ang));
          float along = dot(f, dir);
          float across = abs(dot(f, vec2(-dir.y, dir.x)));
          float needle = smoothstep(0.035, 0.0, across) * step(abs(along), 0.38);
          earth = mix(earth, srgb(vec3(0.55, 0.42, 0.25)), needle * 0.8);
        }
        // Blättchen (etwas dunkler/ockerfarben) und kleine Steinchen (grau)
        vec2 lq = p * 6.0;
        float leaf = smoothstep(0.16, 0.1, length(fract(lq) - 0.5 + 0.2 * (vec2(hash12(floor(lq)), hash12(floor(lq) + 3.1)) - 0.5))) * step(0.9, hash12(floor(lq) + 1.7));
        earth = mix(earth, srgb(vec3(0.38, 0.24, 0.12)), leaf * 0.7);
        vec2 sq = p * 11.0;
        float stone = smoothstep(0.12, 0.07, length(fract(sq) - 0.5)) * step(0.94, hash12(floor(sq) + 9.3));
        earth = mix(earth, srgb(vec3(0.42, 0.41, 0.4)), stone * 0.85);
        // Moos wächst unregelmäßig herein: nah an der Boundary viel, weiter innen vereinzelte Polster
        float nearEdge = 1.0 - smoothstep(1.0, 2.0, vEdge);
        float mossMask = smoothstep(0.52, 0.62, fbm(p * 2.4 + 4.0)) * nearEdge
                       + smoothstep(0.86, 0.9, fbm(p * 4.0 + 11.0)) * 0.9;
        vec3 moss = mix(srgb(vec3(0.16, 0.36, 0.2)), srgb(vec3(0.12, 0.34, 0.3)), fbm(p * 9.0));
        vec3 col = mix(earth, moss, clamp(mossMask, 0.0, 1.0));
        // Nacht: insgesamt etwas gedämpft, bleibt aber klar als Braun lesbar
        col *= 0.62;
        // sehr dezente, warm-türkise Leuchtsporen und Myzelfäden im Boden
        float spark = step(0.993, hash12(floor(p * 26.0)));
        float tw = 0.5 + 0.5 * sin(uTime * 1.1 + hash12(floor(p * 26.0)) * 40.0);
        float thread = smoothstep(0.02, 0.0, abs(fbm(p * 1.5) - 0.5)) * 0.25;
        vec3 glow = mix(vec3(0.35, 0.95, 0.75), uTint, uTintAmt);
        col += glow * (spark * tw * 0.18 + thread * 0.035);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.0008;
  mesh.renderOrder = 1;
  mesh.name = 'clearing';
  return mesh;
}
