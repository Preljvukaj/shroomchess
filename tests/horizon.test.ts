import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createBasin, squarePolygon } from '../src/render/world/basin';
import { createTerrain } from '../src/render/world/terrain';
import { createHorizonRing, createJungleWall, farRingLayout, horizonProfile } from '../src/render/world/farRings';

const lShape = [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 5 }, { x: 0, z: 5 }];

describe('Kein sichtbarer Geländerand', () => {
  for (const [name, pts] of Object.entries({ quadrat: squarePolygon(2.5), lForm: lShape, gross: squarePolygon(4) })) {
    it(`${name}: jeder Strahl knapp unter/über dem Horizont trifft Gelände, Dschungelwall oder Horizontring – nie das Geländeende`, () => {
      const b = createBasin({ pts });
      const L = farRingLayout(b);
      const terrainMesh = createTerrain(b, 64, L.terrainOuter - L.rim + 6);
      const ring = createHorizonRing(b, 360);
      // Der Beweis kommt allein aus Gelände + Horizontring (der Dschungelwall davor verdeckt zusätzlich)
      const scene = new THREE.Group();
      scene.add(terrainMesh, ring);
      scene.updateMatrixWorld(true);
      // Gelände reicht über den Ring hinaus
      const tp = terrainMesh.geometry.getAttribute('position');
      let tMin = Infinity;
      for (let i = 0; i < tp.count; i++) tMin = Math.min(tMin, Math.hypot(tp.getX(i) - b.center.x, tp.getZ(i) - b.center.z) || Infinity);
      let outer = Infinity;
      // äußerster Ring je Winkel: kleinster „Außenradius“
      const rings = tp.count / 64;
      for (let a = 0; a < 64; a++) {
        const i = a * rings + rings - 1;
        outer = Math.min(outer, Math.hypot(tp.getX(i) - b.center.x, tp.getZ(i) - b.center.z));
      }
      expect(outer).toBeGreaterThan(L.horizon + 6 + 3);

      const rc = new THREE.Raycaster();
      rc.far = 400;
      // Ecken der Spielfläche (minimal nach innen) + Mitte
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
      const eyes = [...pts.map((p) => ({ x: p.x + (cx - p.x) * 0.02, z: p.z + (cz - p.z) * 0.02 })), { x: cx, z: cz }];
      let rays = 0;
      for (const e of eyes) {
        for (const h of [1.4, 1.65, 1.9]) {
          const o = new THREE.Vector3(e.x, h, e.z);
          for (let az = 0; az < 360; az += 3) {
            for (const el of [-3, -1, 0, 0.5, 1, 2, 3]) {
              const a = (az * Math.PI) / 180;
              const v = (el * Math.PI) / 180;
              const d = new THREE.Vector3(Math.cos(a) * Math.cos(v), Math.sin(v), Math.sin(a) * Math.cos(v));
              rc.set(o, d);
              const hit = rc.intersectObjects([terrainMesh, ring], false)[0];
              rays++;
              expect(hit, `${name} Auge ${e.x.toFixed(1)},${e.z.toFixed(1)} h${h} az${az} el${el}`).toBeTruthy();
              // nie hinter dem Horizontring (dort wäre das Geländeende)
              const r = Math.hypot(hit!.point.x - b.center.x, hit!.point.z - b.center.z);
              expect(r).toBeLessThanOrEqual(L.horizon + 6 + 0.5);
            }
          }
        }
      }
      expect(rays).toBeGreaterThan(5000);
    }, 120_000);
  }

  it('Ring-Silhouette ist überall mindestens 7 m hoch und schließt rundum', () => {
    for (let i = 0; i < 720; i++) expect(horizonProfile((i / 720) * Math.PI * 2)).toBeGreaterThanOrEqual(7);
    // deterministisch (gleiche Höhe bei gleichem Winkel)
    expect(horizonProfile(1.234)).toBe(horizonProfile(1.234));
  });
});

describe('Dschungelwall', () => {
  it('3 Reihen, 5–20 m hoch, Fuß unter dem Gelände, ein einziges Mesh', () => {
    const b = createBasin({ pts: squarePolygon(2.5) });
    const L = farRingLayout(b);
    const wall = createJungleWall(b, 1);
    const p = wall.geometry.getAttribute('position');
    let maxH = 0;
    let minBelow = Infinity;
    for (let i = 0; i < p.count; i++) {
      const g = b.heightAt(p.getX(i), p.getZ(i));
      maxH = Math.max(maxH, p.getY(i) - g);
      minBelow = Math.min(minBelow, p.getY(i) - g);
      const r = Math.hypot(p.getX(i) - b.center.x, p.getZ(i) - b.center.z);
      expect(r).toBeLessThan(L.horizon); // vor dem Horizontring
    }
    expect(maxH).toBeGreaterThan(14);
    expect(maxH).toBeLessThan(26);
    expect(minBelow).toBeLessThan(-0.5); // Stiele reichen in den Boden
  });
});
