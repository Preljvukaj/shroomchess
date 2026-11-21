import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Uniforms, die sich alle Welt-Shader teilen: Zeit, globales Pulsieren und die
 * „Siegerfarbe“, in der der Dschungel am Spielende aufleuchtet.
 */
export const worldUniforms = {
  uTime: { value: 0 },
  uTint: { value: new THREE.Color('#ffffff') },
  uTintAmt: { value: 0 },
  uFogColor: { value: new THREE.Color('#05030d') },
  uFogDensity: { value: 0.035 },
};

export const PALETTE = {
  turquoise: new THREE.Color('#1de9c9'),
  violet: new THREE.Color('#8b3dff'),
  magenta: new THREE.Color('#ff2fb3'),
  cyan: new THREE.Color('#2fd8ff'),
  toxic: new THREE.Color('#9dff3a'),
  ground: new THREE.Color('#07060f'),
};

/** Wert-Rauschen / FBM für GLSL (klein, schnell genug für Mobile-GPUs). */
export const GLSL_NOISE = /* glsl */ `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0; float a = 0.5; for(int i=0;i<4;i++){ v += a*vnoise(p); p *= 2.03; a *= 0.5; } return v; }
float vnoise3(vec3 p){ vec3 i = floor(p); vec3 f = fract(p); vec3 u = f*f*(3.0-2.0*f);
  float a = mix(mix(hash13(i), hash13(i+vec3(1,0,0)), u.x), mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,1,0)), u.x), u.y);
  float b = mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), u.x), mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), u.x), u.y);
  return mix(a, b, u.z); }
float fbm3(vec3 p){ float v = 0.0; float a = 0.5; for(int i=0;i<4;i++){ v += a*vnoise3(p); p *= 2.03; a *= 0.5; } return v; }
`;

/** Exponentieller Nebel, passend zur Szene. */
export const GLSL_FOG = /* glsl */ `
uniform vec3 uFogColor; uniform float uFogDensity;
vec3 applyFog(vec3 col, float dist){ float f = 1.0 - exp(-pow(uFogDensity * dist, 2.0)); return mix(col, uFogColor, clamp(f, 0.0, 1.0)); }
`;

/** Deterministischer Zufall (für reproduzierbare Vegetation). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** mergeGeometries, das gemischte (indizierte/nicht indizierte) Geometrien verträgt. */
export function safeMerge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const mixed = parts.some((p) => p.index) && parts.some((p) => !p.index);
  const list = mixed ? parts.map((p) => (p.index ? p.toNonIndexed() : p)) : parts;
  const merged = mergeGeometries(list);
  if (!merged) throw new Error('Geometrien konnten nicht zusammengeführt werden');
  return merged;
}
