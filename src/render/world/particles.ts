import * as THREE from 'three';
import type { QualityProfile } from '../scene';
import { GLSL_NOISE, mulberry32, worldUniforms } from '../shared';

/**
 * Schwebende Sporen und Glühwürmchen. Bewegung komplett im Vertex-Shader
 * (Startposition + Phase → Drift), daher keine CPU-Kosten pro Frame.
 */
function createPoints(count: number, opts: {
  seed: number; minR: number; maxR: number; minY: number; maxY: number; size: number; colors: string[]; blink: boolean; drift: number;
}): THREE.Points {
  const rng = mulberry32(opts.seed);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const ph = new Float32Array(count);
  const palette = opts.colors.map((c) => new THREE.Color(c));
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const r = opts.minR + (opts.maxR - opts.minR) * Math.sqrt(rng());
    pos.set([Math.cos(a) * r, opts.minY + rng() * (opts.maxY - opts.minY), Math.sin(a) * r], i * 3);
    const c = palette[Math.floor(rng() * palette.length)];
    col.set([c.r, c.g, c.b], i * 3);
    ph[i] = rng();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { ...worldUniforms, uSize: { value: opts.size }, uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute float aPhase;
      uniform float uTime; uniform float uSize; uniform float uPixelRatio; uniform vec3 uTint; uniform float uTintAmt;
      varying vec3 vColor; varying float vAlpha;
      ${GLSL_NOISE}
      void main(){
        vec3 p = position;
        float t = uTime * ${opts.drift.toFixed(3)} + aPhase * 100.0;
        p += vec3(vnoise(vec2(t, aPhase*10.0)) - 0.5, vnoise(vec2(t*0.7, aPhase*20.0+3.0)) - 0.5, vnoise(vec2(t*0.9, aPhase*30.0+7.0)) - 0.5) * 3.0;
        p.y += sin(t * 0.5) * 0.3;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float blink = ${opts.blink ? 'pow(max(0.0, sin(uTime * (0.8 + aPhase) + aPhase * 50.0)), 6.0)' : '0.6 + 0.4 * sin(uTime * 1.3 + aPhase * 20.0)'};
        vAlpha = blink * clamp(1.0 - (-mv.z) / 45.0, 0.0, 1.0);
        vColor = mix(aColor, uTint, uTintAmt);
        gl_PointSize = uSize * uPixelRatio * (300.0 / max(-mv.z, 0.5));
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying float vAlpha;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vColor * a * vAlpha * 1.5, a * vAlpha);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

export function createParticles(profile: QualityProfile, basinRadius: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'particles';
  // Sporen: in der Senke und darüber (kein Hindernis, nur Licht). Glühwürmchen sind jetzt Insekten (insects.ts).
  g.add(createPoints(profile.spores, {
    seed: 3, minR: 0, maxR: basinRadius + 4, minY: 0.2, maxY: 7, size: 0.035, drift: 0.02,
    colors: ['#7fffe8', '#c49bff', '#ff8ad8', '#bfff7a'], blink: false,
  }));
  return g;
}

/**
 * Bodennebel, der sich in der Senke sammelt: zwei transparente Schichten knapp über dem Boden.
 * Über der Spielfläche sehr dünn (Figurenfüße bleiben sichtbar), zu den Wällen dichter.
 * Wo der Wall höher ist, verdeckt der Tiefentest den Nebel → er „staut“ sich am Hang.
 */
export function createGroundFog(innerRadius: number, outerRadius: number): THREE.Group {
  const g = new THREE.Group();
  for (const [y, strength] of [[0.1, 0.26], [0.3, 0.1]] as const) {
    const geo = new THREE.CircleGeometry(outerRadius, 64);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { ...worldUniforms, uIn: { value: innerRadius }, uOut: { value: outerRadius }, uStrength: { value: strength } },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uIn; uniform float uOut; uniform float uStrength;
        varying vec3 vW;
        ${GLSL_NOISE}
        void main(){
          float r = length(vW.xz);
          float n = fbm(vW.xz * 0.35 + vec2(uTime * 0.03, uTime * 0.017));
          float edge = mix(0.12, 1.0, smoothstep(uIn * 0.7, uIn + 1.5, r)) * (1.0 - smoothstep(uOut * 0.85, uOut, r));
          float a = smoothstep(0.3, 0.8, n) * edge * uStrength;
          gl_FragColor = vec4(vec3(0.16, 0.24, 0.26) * 0.6, a); // neutral-kühl, überdeckt das Grün nicht
        }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.renderOrder = 5;
    g.add(m);
  }
  return g;
}
