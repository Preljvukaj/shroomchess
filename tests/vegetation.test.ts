import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { QUALITY } from '../src/render/scene';
import { createBasin, squarePolygon } from '../src/render/world/basin';
import { clearingOutline, createClearing } from '../src/render/world/clearing';
import { createVegetation, footprintMin, groundError } from '../src/render/world/vegetation';
import { distanceToPolygonEdge, pointInPolygon } from '../src/xr/math/vec2';

const lShape = [
  { x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 5 }, { x: 0, z: 5 },
];

describe('Vegetation: Bodenkontakt (Toleranz 3 cm)', () => {
  for (const [name, pts] of Object.entries({ desktop: squarePolygon(4.5), lForm: lShape })) {
    it(`${name}: jedes platzierte Objekt steht auf dem Gelände`, () => {
      const b = createBasin({ pts });
      const veg = createVegetation(QUALITY.low, b);
      expect(veg.grounded.length).toBeGreaterThan(200);
      const bad = veg.grounded.filter((o) => groundError(b, o.base, o.footRadius) > 0.03);
      expect(bad.map((o) => `${o.kind}@${o.base.x.toFixed(2)},${o.base.z.toFixed(2)}`)).toEqual([]);
      // und keines schwebt über der niedrigsten Stelle seiner Grundfläche
      for (const o of veg.grounded) expect(o.base.y).toBeLessThanOrEqual(footprintMin(b, o.base.x, o.base.z, o.footRadius) + 1e-9);
    });
  }

  it('in der Spielfläche steht nichts – der Saum liegt knapp außerhalb, unter Knöchelhöhe', () => {
    const pts = squarePolygon(3);
    const b = createBasin({ pts });
    const veg = createVegetation(QUALITY.low, b);
    for (const o of veg.grounded) expect(pointInPolygon({ x: o.base.x, z: o.base.z }, pts)).toBe(false);
    const saum = veg.grounded.filter((o) => o.kind === 'saum');
    expect(saum.length).toBeGreaterThan(20);
    for (const o of saum) {
      const d = distanceToPolygonEdge({ x: o.base.x, z: o.base.z }, pts);
      expect(d).toBeLessThan(0.45);
      expect(o.footRadius).toBeLessThanOrEqual(0.07); // 3–6,5 cm groß
    }
    // alles Höhere beginnt erst am Hangfuß
    for (const o of veg.grounded.filter((x) => x.kind !== 'saum')) expect(b.distOutside(o.base.x, o.base.z)).toBeGreaterThan(0.85);
  });

  it('keine kameraausgerichteten Billboards/Sprites in der Vegetation', () => {
    const b = createBasin({ pts: squarePolygon(3) });
    const veg = createVegetation(QUALITY.medium, b);
    let meshes = 0;
    veg.group.traverse((o) => {
      expect((o as THREE.Sprite).isSprite).not.toBe(true);
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      meshes++;
      expect(m.name).not.toMatch(/impostor|billboard/i);
      expect(m.geometry).not.toBeInstanceOf(THREE.InstancedBufferGeometry); // früheres Billboard-Verfahren
      const vs = (m.material as THREE.ShaderMaterial).vertexShader ?? '';
      // Billboarding = Versatz im View-Space nach der Modelview-Transformation
      expect(vs).not.toMatch(/mvCenter|mv\.xy\s*\+=/);
    });
    expect(meshes).toBeGreaterThan(10);
  });
});

describe('Spielflächen-Umrandung', () => {
  it('Innenkontur entspricht exakt dem Boundary-Polygon, Außenkontur liegt den Übergang weiter außen', () => {
    for (const pts of [squarePolygon(2), lShape, [...lShape].reverse()]) {
      const { inner, outer } = clearingOutline(pts, 0.3);
      expect(inner).toEqual(pts);
      outer.forEach((o) => {
        expect(pointInPolygon(o, pts)).toBe(false);
        const d = distanceToPolygonEdge(o, pts);
        expect(d).toBeGreaterThan(0.29);
        expect(d).toBeLessThan(0.3 / 0.35 + 1e-6); // Gehrung begrenzt
      });
    }
  });

  it('Mesh liegt auf y ≈ 0 und deckt die Fläche ab', () => {
    const mesh = createClearing(lShape, 0.3);
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBe(0);
    expect(mesh.position.y).toBeLessThan(0.002);
    const box = new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute);
    expect(box.min.x).toBeLessThan(0);
    expect(box.max.x).toBeGreaterThan(5);
  });
});
