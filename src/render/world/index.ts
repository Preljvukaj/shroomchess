import * as THREE from 'three';
import type { QualityProfile } from '../scene';
import { worldUniforms } from '../shared';
import { type Basin, type FlatRegion, createBasin, squarePolygon } from './basin';
import { createGroundFog, createParticles } from './particles';
import { createSky } from './sky';
import { createClearing } from './clearing';
import { LavaBubbles } from './lavaBubbles';
import { mulberry32 } from '../shared';
import { createTerrain } from './terrain';
import { createHorizonRing, createJungleWall, farRingLayout } from './farRings';
import { Asteroids } from './asteroids';
import { terrain } from './terrainConfig';
import { type GroundedObject, createVegetation } from './vegetation';

export interface World {
  root: THREE.Group;
  basin: Basin;
  /** Positionen leuchtender Pilzhüte (für Motten). */
  attractors: THREE.Vector3[];
  /** Bodennahe Zirp-Quellen in der Vegetation. */
  chirpSpots: THREE.Vector3[];
  /** Alle platzierten Objekte (Bodenkontakt-Prüfung). */
  grounded: GroundedObject[];
  /** Klangquellen der Pflanzen/Pilze */
  soundSpots: ReturnType<typeof createVegetation>['soundSpots'];
  /** Steinoberseiten (Landepunkte der Brummer) */
  rockTops: THREE.Vector3[];
  /** Lavalampen-Blasen */
  lava: LavaBubbles;
  /** Himmelsobjekte (Asteroiden, Kometen, Sternschnuppen) */
  asteroids: Asteroids;
  /** Dichte im Mittelbereich (0,3–1) – erste Stellschraube bei zu wenig FPS */
  setMidDensity(f: number): void;
  readonly midDensity: number;
  /** Spielende: Dschungel leuchtet in der Siegerfarbe (null = Remis → Violett/Weiß). */
  celebrate(color: THREE.Color | null): void;
  resetTint(): void;
  update(dt: number, camera?: THREE.Vector3, heads?: THREE.Vector3[]): void;
  tintState(): number;
  restoreTint(target: number): void;
}

/**
 * Weltraum-Dschungel in einer Senke. `region` ist die begehbare Fläche (Desktop: Brett + Rand,
 * VR ab M2: Boundary des Hosts). Sie bleibt flach; Wälle und Vegetation beginnen außerhalb.
 * Der Wall verdeckt den Horizont – dahinter gibt es nur noch Fern-LOD und Impostors.
 */
export function createWorld(profile: QualityProfile, region: FlatRegion): World {
  const basin = createBasin(region);
  const root = new THREE.Group();
  root.name = 'world';
  root.add(createSky());
  const asteroids = new Asteroids();
  root.add(asteroids.group);
  // Gelände reicht bis unter den Horizontring (dessen Fuß 3 m unter dem Boden liegt) → keine Geländekante sichtbar
  const far = farRingLayout(basin);
  root.add(createTerrain(basin, profile.terrainAngular, far.terrainOuter - far.rim + 6));
  root.add(createJungleWall(basin, profile.wallDensity));
  root.add(createHorizonRing(basin));
  root.add(createClearing(region.pts, terrain.clearingFade));
  const veg = createVegetation(profile, basin);
  root.add(veg.group);
  const rim = basin.extent + basin.rimDistance(0);
  root.add(createParticles(profile, rim));
  root.add(createGroundFog(basin.extent, rim + 1));
  const lava = new LavaBubbles(basin, profile.bubbles, mulberry32(4242));
  root.add(lava.mesh);

  let target = 0;
  let midDensity = 1;
  return {
    setMidDensity(f) {
      midDensity = Math.min(1, Math.max(0.3, f));
      veg.group.traverse((o) => {
        const m = o as THREE.InstancedMesh;
        const start = m.userData?.midStart as number | undefined;
        if (start === undefined) return;
        const total = m.userData.total as number;
        m.count = start + Math.round((total - start) * midDensity);
      });
    },
    get midDensity() {
      return midDensity;
    },
    root,
    basin,
    attractors: veg.attractors,
    chirpSpots: veg.chirpSpots,
    grounded: veg.grounded,
    soundSpots: veg.soundSpots,
    rockTops: veg.rockTops,
    lava,
    asteroids,
    celebrate(color) {
      worldUniforms.uTint.value.copy(color ?? new THREE.Color('#d7b8ff'));
      target = 0.85;
    },
    resetTint() {
      target = 0;
    },
    tintState() {
      return target;
    },
    restoreTint(t) {
      target = t;
    },
    update(dt, camera, heads) {
      if (camera) lava.update(dt, camera, heads ?? [camera]);
      asteroids.update(Math.min(dt, 0.1));
      const u = worldUniforms.uTintAmt;
      u.value += (target - u.value) * Math.min(1, dt * 1.2);
    },
  };
}

/** Quadratische begehbare Fläche um den Ursprung. */
export function squareRegion(half: number): FlatRegion {
  return { pts: squarePolygon(half) };
}
