import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSky } from '../src/render/world/sky';

describe('Himmel', () => {
  const sky = createSky();
  const mat = sky.material as THREE.ShaderMaterial;
  it('ist eine einzige geschlossene Geometrie mit einem Shader-Durchlauf', () => {
    expect(sky.isMesh).toBe(true);
    expect(sky.children.length).toBe(0);
    expect(sky.geometry).toBeInstanceOf(THREE.SphereGeometry);
    expect(mat.depthWrite).toBe(false);
  });
  it('nutzt keine Winkel-/UV-Koordinaten mit Umlaufkante (Ursache der Naht)', () => {
    expect(mat.fragmentShader).not.toMatch(/atan\s*\(/); // Azimut-Winkel springt bei ±π
    expect(mat.fragmentShader).not.toMatch(/vUv|texture2D|texture\(/); // keine Equirect-Textur/UV-Naht
    expect(Object.keys(mat.uniforms).some((k) => (mat.uniforms[k].value as THREE.Texture)?.isTexture)).toBe(false);
    expect(mat.fragmentShader).toMatch(/fbm3\(d/);
  });
  it('wird unendlich weit gerendert (nur Rotation, Far-Plane)', () => {
    expect(mat.vertexShader).toMatch(/mat3\(viewMatrix\)/);
    expect(mat.vertexShader).toMatch(/xyww/);
  });
});
