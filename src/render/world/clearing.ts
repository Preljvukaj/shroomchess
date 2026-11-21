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

export function createClearing(poly: V2[], fade: number): THREE.Mesh {
  const { inner, outer } = clearingOutline(poly, fade);
  // Füllung: Dreiecksnetz des (ggf. konkaven) Polygons
  const shape = new THREE.Shape(inner.map((p) => new THREE.Vector2(p.x, -p.z)));
  const fill = new THREE.ShapeGeometry(shape);
  fill.rotateX(-Math.PI / 2); // (x, y) → (x, 0, −y) = (x, 0, z)
  const fillPos = fill.getAttribute('position');
  const pos: number[] = [];
  const edge: number[] = [];
  for (let i = 0; i < fillPos.count; i++) {
    pos.push(fillPos.getX(i), 0, fillPos.getZ(i));
    edge.push(1);
  }
  const idx: number[] = Array.from(fill.index!.array);
  // Übergangsband: innen (Kante 1) → außen (Kante 0)
  const base = pos.length / 3;
  inner.forEach((p, i) => {
    pos.push(p.x, 0, p.z, outer[i].x, 0, outer[i].z);
    edge.push(1, 0);
  });
  for (let i = 0; i < inner.length; i++) {
    const a = base + i * 2;
    const b = base + ((i + 1) % inner.length) * 2;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
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
    vertexShader: `attribute float aEdge; varying float vEdge; varying vec3 vW; varying float vDist;
      void main(){ vEdge = aEdge; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vDist = length(mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uTint; uniform float uTintAmt;
      varying float vEdge; varying vec3 vW; varying float vDist;
      ${GLSL_NOISE}
      void main(){
        vec2 p = vW.xz;
        // Noise-Rand: weicher, unregelmäßiger Übergang statt hartem Strich
        float n = fbm(p * 3.0);
        float a = smoothstep(0.0, 1.0, vEdge * 1.15 + (n - 0.5) * 0.5);
        if (a < 0.01) discard;
        // kurzes Moos: etwas heller und grün-türkiser als der Waldboden
        float fine = fbm(p * 18.0);
        vec3 moss = mix(vec3(0.026, 0.07, 0.06), vec3(0.042, 0.105, 0.085), fine);
        moss *= 0.85 + 0.3 * fbm(p * 1.3);
        // sehr schwaches, gleichmäßiges Sporenleuchten im Boden
        float spark = step(0.985, hash12(floor(p * 24.0)));
        float tw = 0.5 + 0.5 * sin(uTime * 1.3 + hash12(floor(p * 24.0)) * 40.0);
        vec3 glow = mix(vec3(0.2, 0.9, 0.75), uTint, uTintAmt);
        vec3 col = moss + glow * (0.025 + spark * tw * 0.25);
        gl_FragColor = vec4(col, a * 0.92);
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
