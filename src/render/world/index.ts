import * as THREE from 'three';
import type { QualityProfile } from '../scene';
import { worldUniforms } from '../shared';
import { type Basin, type FlatRegion, createBasin, squarePolygon } from './basin';
import { createGroundFog, createParticles } from './particles';
import { createSky } from './sky';
import { createClearing } from './clearing';
import { createTerrain } from './terrain';
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
  /** Spielende: Dschungel leuchtet in der Siegerfarbe (null = Remis → Violett/Weiß). */
  celebrate(color: THREE.Color | null): void;
  resetTint(): void;
  update(dt: number): void;
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
  root.add(createTerrain(basin, profile.terrainAngular));
  root.add(createClearing(region.pts, terrain.clearingFade));
  const veg = createVegetation(profile, basin);
  root.add(veg.group);
  const rim = basin.extent + basin.rimDistance(0);
  root.add(createParticles(profile, rim));
  root.add(createGroundFog(basin.extent, rim + 1));

  let target = 0;
  return {
    root,
    basin,
    attractors: veg.attractors,
    chirpSpots: veg.chirpSpots,
    grounded: veg.grounded,
    soundSpots: veg.soundSpots,
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
    update(dt) {
      const u = worldUniforms.uTintAmt;
      u.value += (target - u.value) * Math.min(1, dt * 1.2);
    },
  };
}

/** Quadratische begehbare Fläche um den Ursprung. */
export function squareRegion(half: number): FlatRegion {
  return { pts: squarePolygon(half) };
}
