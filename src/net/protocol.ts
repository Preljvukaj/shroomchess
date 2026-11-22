import type { Color, EndReason } from '../core/types';

/**
 * Nachrichten zwischen den beiden Spielern (über WebRTC-DataChannel oder WS-Relay).
 * Alles Räumliche ist in BRETT-KOORDINATEN (lokaler Raum von board.root, Desktop-Maßstab: Feld = 0,5):
 * Online hat jeder sein eigenes Brett (andere Größe/Lage) – der Gegner erscheint so auf der anderen Brettseite.
 * Co-Location: Beide Bretter liegen nach der Kalibrierung an derselben realen Stelle → identische Brett-Koordinaten.
 */

export const PROTOCOL = 1;

export interface ClockWire {
  w: number;
  b: number;
  running: Color | null;
  /** Host-Zeit (ms) des Stands */
  h: number;
  /** Gutschrift: Uhr steht bis zu dieser Host-Zeit (Animation des Gegnerzugs) */
  graceUntil?: number;
}

/** Pose im Brett-Raum: Position + Quaternion (x,y,z,w) */
export type PoseWire = [number, number, number, number, number, number, number];

export interface PoseMsg {
  t: 'pose';
  /** 'vr' = Kopf + Hände; 'desktop' = Zeige-Feld */
  kind: 'vr' | 'desktop';
  head?: PoseWire;
  left?: PoseWire | null;
  right?: PoseWire | null;
  /** getragene Figur: Startfeld + Pose */
  held?: { sq: string; p: PoseWire } | null;
  /** Desktop: Feld, auf das gezeigt wird */
  hover?: string | null;
  /** Hände werden live verfolgt (für „nicht künstlich verlangsamen“) */
  live?: boolean;
}

export type PeerMsg =
  | { t: 'hello'; proto: number; name: string; client: 'vr' | 'desktop'; anim: 'slow' | 'normal' | 'fast' }
  | { t: 'setup'; kind: 'online' | 'coloc'; guestColor: Color; tc: string; names: Record<Color, string> }
  | { t: 'state'; seq: number; uci: string[]; clock: ClockWire | null; result: { reason: EndReason; winner: Color | null } | null; paused: boolean; names: Record<Color, string>; guestColor: Color }
  | { t: 'move'; seq: number; uci: string; clock: ClockWire | null; live: boolean }
  | { t: 'move-req'; uci: string; seq: number; live: boolean }
  | { t: 'move-reject'; uci: string; reason: string; seq: number }
  | { t: 'ping'; c: number }
  | { t: 'pong'; c: number; h: number }
  | PoseMsg
  | { t: 'offer'; kind: 'draw' | 'undo' | 'rematch' }
  | { t: 'answer'; kind: 'draw' | 'undo' | 'rematch'; ok: boolean }
  | { t: 'resign'; color: Color }
  | { t: 'emote'; id: EmoteId }
  | { t: 'anim'; anim: 'slow' | 'normal' | 'fast' }
  | { t: 'pause'; paused: boolean }
  // Co-Location (M4)
  | { t: 'coloc-boundary'; region: { x: number; z: number }[] }
  | { t: 'calib-ready'; ready: boolean }
  | { t: 'calib-start'; at: number }
  | { t: 'calib-pose'; pos: { x: number; z: number }; yaw: number }
  | { t: 'calib-result'; board: { x: number; z: number; yaw: number; squareSize: number; totalSide: number } }
  | { t: 'fine-tune'; yaw: number; x: number; z: number }
  | { t: 'recalibrate' };

export const EMOTES = ['nice', 'hmm', 'wow', 'oops', 'gg', 'thinking'] as const;
export type EmoteId = (typeof EMOTES)[number];

const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const isNum = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
const isPose = (p: unknown) => Array.isArray(p) && p.length === 7 && p.every(isNum);
const isColor = (c: unknown) => c === 'w' || c === 'b';

/** Grobe Schema-Prüfung eingehender Nachrichten (Gegner ist nicht vertrauenswürdig). */
export function validatePeerMsg(m: unknown): m is PeerMsg {
  if (!m || typeof m !== 'object') return false;
  const o = m as Record<string, unknown>;
  switch (o.t) {
    case 'hello':
      return isNum(o.proto) && typeof o.name === 'string' && o.name.length <= 40 && (o.client === 'vr' || o.client === 'desktop');
    case 'setup':
      return isColor(o.guestColor) && typeof o.tc === 'string' && (o.kind === 'online' || o.kind === 'coloc');
    case 'state':
      return isNum(o.seq) && Array.isArray(o.uci) && o.uci.length < 1200 && o.uci.every((u) => typeof u === 'string' && UCI_RE.test(u));
    case 'move':
      return isNum(o.seq) && typeof o.uci === 'string' && UCI_RE.test(o.uci);
    case 'move-req':
      return isNum(o.seq) && typeof o.uci === 'string' && UCI_RE.test(o.uci);
    case 'move-reject':
      return typeof o.uci === 'string';
    case 'ping':
      return isNum(o.c);
    case 'pong':
      return isNum(o.c) && isNum(o.h);
    case 'pose':
      return (o.kind === 'vr' || o.kind === 'desktop') && (o.head === undefined || isPose(o.head)) && (o.left == null || isPose(o.left)) && (o.right == null || isPose(o.right));
    case 'offer':
    case 'answer':
      return o.kind === 'draw' || o.kind === 'undo' || o.kind === 'rematch';
    case 'resign':
      return isColor(o.color);
    case 'emote':
      return (EMOTES as readonly string[]).includes(o.id as string);
    case 'anim':
      return o.anim === 'slow' || o.anim === 'normal' || o.anim === 'fast';
    case 'pause':
      return typeof o.paused === 'boolean';
    case 'coloc-boundary':
      return Array.isArray(o.region) && o.region.length >= 3 && o.region.length <= 64 && o.region.every((p) => p && isNum((p as { x: unknown }).x) && isNum((p as { z: unknown }).z));
    case 'calib-ready':
      return typeof o.ready === 'boolean';
    case 'calib-start':
      return isNum(o.at);
    case 'calib-pose':
      return !!o.pos && isNum((o.pos as { x: unknown }).x) && isNum((o.pos as { z: unknown }).z) && isNum(o.yaw);
    case 'calib-result':
      return !!o.board && ['x', 'z', 'yaw', 'squareSize', 'totalSide'].every((k) => isNum((o.board as Record<string, unknown>)[k]));
    case 'fine-tune':
      return isNum(o.yaw) && isNum(o.x) && isNum(o.z);
    case 'recalibrate':
      return true;
    default:
      return false;
  }
}
