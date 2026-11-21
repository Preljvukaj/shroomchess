import { describe, expect, it } from 'vitest';
import {
  applyRigid,
  applyRigidPose,
  calibrationMidpoint,
  composeRigid,
  desiredBoardYaw,
  fineTune,
  invertRigid,
  type Rigid2D,
  solveGuestToHost,
} from '../src/xr/math/calibration';
import { type V2, dist, forward, rotate, wrapAngle } from '../src/xr/math/vec2';

/**
 * Wir simulieren einen realen Raum („Welt“) und zwei Brillen, deren lokale
 * Koordinatensysteme beliebig gegenüber der Welt verdreht/verschoben sind.
 */
const hostFromWorld: Rigid2D = { yaw: 0.7, t: { x: 1.3, z: -2.1 } };
const guestFromWorld: Rigid2D = { yaw: -2.4, t: { x: -0.5, z: 3.3 } };

function expectV(a: V2, b: V2, eps = 1e-9): void {
  expect(dist(a, b)).toBeLessThan(eps);
}

describe('Rücken-an-Rücken-Kalibrierung', () => {
  // Reale Situation: Host steht bei (2,1) und schaut in Welt-Yaw 0,3.
  const worldHostPos = { x: 2, z: 1 };
  const worldHostYaw = 0.3;
  const offset = 0.3;
  const worldGuestPos = { x: worldHostPos.x - forward(worldHostYaw).x * offset, z: worldHostPos.z - forward(worldHostYaw).z * offset };
  const worldGuestYaw = worldHostYaw + Math.PI;

  const host = applyRigidPose(hostFromWorld, { pos: worldHostPos, yaw: worldHostYaw });
  const guest = applyRigidPose(guestFromWorld, { pos: worldGuestPos, yaw: worldGuestYaw });
  const G2H = solveGuestToHost(host, guest, offset);

  // Ground truth: guest→host = hostFromWorld ∘ worldFromGuest
  const truth = composeRigid(hostFromWorld, invertRigid(guestFromWorld));

  it('rekonstruiert die exakte Transformation', () => {
    expect(wrapAngle(G2H.yaw - truth.yaw)).toBeCloseTo(0, 9);
    expectV(G2H.t, truth.t);
  });

  it('ein beliebiger realer Punkt landet in beiden Systemen an derselben Stelle', () => {
    const worldPoint = { x: -1.7, z: 0.4 };
    const inHost = applyRigid(hostFromWorld, worldPoint);
    const inGuest = applyRigid(guestFromWorld, worldPoint);
    expectV(applyRigid(G2H, inGuest), inHost);
  });

  it('Boundary des Hosts wird korrekt in das Gast-System übertragen', () => {
    const H2G = invertRigid(G2H);
    const hostBoundary = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }];
    for (const p of hostBoundary) {
      const world = applyRigid(invertRigid(hostFromWorld), p);
      expectV(applyRigid(H2G, p), applyRigid(guestFromWorld, world));
    }
  });

  it('Inverse und Komposition sind konsistent', () => {
    const id = composeRigid(G2H, invertRigid(G2H));
    expect(id.yaw).toBeCloseTo(0, 12);
    expectV(id.t, { x: 0, z: 0 });
  });

  it('Mittelpunkt liegt zwischen beiden Spielern', () => {
    const mid = calibrationMidpoint(host, offset);
    const guestInHost = applyRigid(G2H, guest.pos);
    expect(dist(mid, host.pos)).toBeCloseTo(offset / 2, 9);
    expect(dist(mid, guestInHost)).toBeCloseTo(offset / 2, 9);
  });

  it('Brett-Yaw: Host (Weiß) schaut zur weißen Grundreihe', () => {
    const y = desiredBoardYaw(host.yaw, 'w');
    // Weiß steht bei lokalem +Z: Richtung zur weißen Grundreihe = rotate((0,1), boardYaw)
    const toWhite = rotate({ x: 0, z: 1 }, y);
    expectV(toWhite, forward(host.yaw), 1e-9);
  });

  it('Feinjustierung dreht um den Pivot', () => {
    const pivot = { x: 1, z: 1 };
    const T = fineTune({ yaw: 0, t: { x: 0, z: 0 } }, Math.PI / 2, 0, 0, pivot);
    expectV(applyRigid(T, pivot), pivot);
    const moved = fineTune(G2H, 0, 0.1, -0.05, pivot);
    expectV(applyRigid(moved, { x: 0, z: 0 }), { x: G2H.t.x + 0.1, z: G2H.t.z - 0.05 });
  });
});
