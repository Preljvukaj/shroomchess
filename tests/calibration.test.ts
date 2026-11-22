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

describe('Co-Location: Mitteln, Boundary-Transformation, Brett-Pose', () => {
  it('Mittelung mehrerer Frames inkl. Yaw über ±π', async () => {
    const { averagePoses } = await import('../src/xr/math/calibration');
    const a = averagePoses([
      { pos: { x: 1, z: 0 }, yaw: Math.PI - 0.02 },
      { pos: { x: 1.02, z: 0.01 }, yaw: -Math.PI + 0.02 },
      { pos: { x: 0.98, z: -0.01 }, yaw: Math.PI },
    ]);
    expect(a.pos.x).toBeCloseTo(1, 6);
    expect(Math.abs(wrapAngle(a.yaw - Math.PI))).toBeLessThan(1e-6);
  });

  it('Boundary des Hosts landet beim Gast an derselben realen Stelle', async () => {
    const { transformRegion } = await import('../src/xr/math/calibration');
    const offset = 0.3;
    const worldHost = { pos: { x: 0.4, z: -0.2 }, yaw: 1.1 };
    const worldGuest = { pos: { x: worldHost.pos.x - forward(worldHost.yaw).x * offset, z: worldHost.pos.z - forward(worldHost.yaw).z * offset }, yaw: worldHost.yaw + Math.PI };
    const host = applyRigidPose(hostFromWorld, worldHost);
    const guest = applyRigidPose(guestFromWorld, worldGuest);
    const G2H = solveGuestToHost(host, guest, offset);
    // reale Boundary-Ecken
    const worldRegion = [{ x: -2, z: -2 }, { x: 2.5, z: -2 }, { x: 2.5, z: 1.8 }, { x: -2, z: 1.8 }];
    const hostRegion = worldRegion.map((p) => applyRigid(hostFromWorld, p));
    const guestRegion = transformRegion(invertRigid(G2H), hostRegion);
    worldRegion.forEach((p, i) => expectV(guestRegion[i], applyRigid(guestFromWorld, p), 1e-9));
  });

  it('Brett-Pose: Mitte zwischen den Köpfen, Größe aus der Host-Boundary, jeder schaut zu seiner Grundreihe', async () => {
    const { colocBoard } = await import('../src/xr/math/calibration');
    const { maxHalfSideAt } = await import('../src/xr/math/boardFit');
    const region = [{ x: -2.5, z: -2.5 }, { x: 2.5, z: -2.5 }, { x: 2.5, z: 2.5 }, { x: -2.5, z: 2.5 }];
    const host = { pos: { x: 0.15, z: 0 }, yaw: Math.PI / 2 }; // schaut nach −X
    const b = colocBoard(host, 'w', 0.3, 0.45, (c, y, m) => maxHalfSideAt(region, c, y, m));
    expect(b.center.x).toBeCloseTo(0.15 - forward(host.yaw).x * 0.15, 9);
    expect(maxHalfSideAt(region, b.center, b.yaw, 0.5)).toBeGreaterThanOrEqual(b.totalSide / 2 - 1e-6);
    // Host (Weiß) schaut beim Erfassen Richtung weiße Grundreihe: lokal +Z des Bretts
    const toWhite = rotate({ x: 0, z: 1 }, b.yaw);
    const f = forward(host.yaw);
    expect(toWhite.x * f.x + toWhite.z * f.z).toBeCloseTo(1, 9);
    expect(b.squareSize).toBeLessThanOrEqual(0.6);
  });
});
