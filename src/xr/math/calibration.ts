import { type V2, add, forward, rotate, scale, sub, wrapAngle } from './vec2';

/**
 * Rücken-an-Rücken-Kalibrierung (Co-Location).
 *
 * Jede Brille liefert ihre auf den Boden projizierte Kopfposition und ihren Yaw
 * im eigenen `local-floor`/`bounded-floor`-Raum. Physikalisch gilt beim Erfassen:
 *   – der Gast steht `offset` Meter HINTER dem Host (Rücken an Rücken),
 *   – der Gast schaut genau entgegengesetzt (Host-Yaw + 180°).
 * Daraus folgt eine starre 2D-Transformation (Drehung um Y + Verschiebung), die
 * Gast-Koordinaten in Host-Koordinaten abbildet. Der Host-Raum ist der gemeinsame
 * Referenzraum („Welt“) – auch die Boundary des Hosts lebt dort.
 */

export interface FloorPose {
  pos: V2;
  yaw: number;
}

/** p_host = rotate(p_guest, yaw) + t */
export interface Rigid2D {
  yaw: number;
  t: V2;
}

export const IDENTITY: Rigid2D = { yaw: 0, t: { x: 0, z: 0 } };

export function applyRigid(T: Rigid2D, p: V2): V2 {
  return add(rotate(p, T.yaw), T.t);
}

export function applyRigidPose(T: Rigid2D, pose: FloorPose): FloorPose {
  return { pos: applyRigid(T, pose.pos), yaw: wrapAngle(pose.yaw + T.yaw) };
}

export function invertRigid(T: Rigid2D): Rigid2D {
  // p_g = rotate(p_h − t, −yaw) = rotate(p_h, −yaw) − rotate(t, −yaw)
  return { yaw: wrapAngle(-T.yaw), t: scale(rotate(T.t, -T.yaw), -1) };
}

/** A∘B: erst B, dann A. */
export function composeRigid(A: Rigid2D, B: Rigid2D): Rigid2D {
  return { yaw: wrapAngle(A.yaw + B.yaw), t: add(rotate(B.t, A.yaw), A.t) };
}

/** Standardabstand der Kopfmittelpunkte Rücken an Rücken (konfigurierbar, 0,25–0,35 m). */
export const DEFAULT_BACK_TO_BACK_OFFSET = 0.3;

export function solveGuestToHost(host: FloorPose, guest: FloorPose, offset = DEFAULT_BACK_TO_BACK_OFFSET): Rigid2D {
  // Wo der Gast im Host-Raum steht und wohin er schaut:
  const guestPosInHost = sub(host.pos, scale(forward(host.yaw), offset));
  const guestYawInHost = host.yaw + Math.PI;
  const yaw = wrapAngle(guestYawInHost - guest.yaw);
  const t = sub(guestPosInHost, rotate(guest.pos, yaw));
  return { yaw, t };
}

/** Mittelpunkt zwischen beiden Spielern im Host-Raum (Vorschlag für den Brettmittelpunkt). */
export function calibrationMidpoint(host: FloorPose, offset = DEFAULT_BACK_TO_BACK_OFFSET): V2 {
  return sub(host.pos, scale(forward(host.yaw), offset / 2));
}

/**
 * Brett-Yaw so wählen, dass jeder Spieler beim Kalibrieren zu SEINER Grundreihe
 * schaut (er läuft danach geradeaus zu seiner Seite und dreht sich um).
 * Brett-Konvention: Weiß steht bei lokalem +Z und blickt bei Brett-Yaw nach −Z.
 * „Richtung zur weißen Grundreihe“ = Rückwärtsrichtung des Bretts.
 */
export function desiredBoardYaw(hostYaw: number, hostColor: 'w' | 'b'): number {
  return wrapAngle(hostColor === 'w' ? hostYaw + Math.PI : hostYaw);
}

/** Feinjustierung per Thumbstick: zusätzliche Drehung/Verschiebung im Host-Raum. */
export function fineTune(T: Rigid2D, dYaw: number, dx: number, dz: number, pivot: V2): Rigid2D {
  // Drehung um den Pivot (z. B. Brettmitte), dann Verschiebung.
  const R: Rigid2D = { yaw: dYaw, t: sub(pivot, rotate(pivot, dYaw)) };
  const S: Rigid2D = { yaw: 0, t: { x: dx, z: dz } };
  return composeRigid(S, composeRigid(R, T));
}
