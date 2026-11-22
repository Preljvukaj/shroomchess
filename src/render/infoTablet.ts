import * as THREE from 'three';
import { BatchedText, Text } from 'troika-three-text';
import italicFont from '@fontsource/cormorant-garamond/files/cormorant-garamond-latin-700-italic.woff?url';
import { formatClock } from '../core/clock';
import type { Color, PieceSymbol } from '../core/types';
import { type TabletPose, TABLET, faceFor, tabletSection } from '../xr/math/tablet';
import { stoneTexture } from './board';
import { pieceGeometry } from './pieces';
import { mulberry32, safeMerge } from './shared';

/**
 * Info-Steintafel (Monolith) neben dem Brett – ersetzt alle schwebenden Infos über dem Brett.
 *
 * Dreiseitiges Prisma aus Rahmen-Stein, oben leicht verjüngt (Schauflächen neigen sich nach hinten), Moos am Fuß,
 * leuchtende Adern und ein kleiner Leuchtpilz. Zwei Schauflächen, je eine zu einer Grundreihe; jede zeigt alle Infos
 * richtig herum für ihren Spieler: beide Uhren groß oben (aktive heller, < 10 s pulsierend), Zugrecht/Status,
 * letzte 10 Halbzüge in SAN, geschlagene Figuren als Relief, Namen/Rating, Verbindungsstatus.
 *
 * Draw Calls: Stein + Moos + Pilz (1, Vertexfarben + Emissive-Map), alle Texte (1, BatchedText), Reliefs (1).
 * Text wird nur bei Änderung neu gesetzt, die Uhr höchstens 10×/s und nur die Ziffern.
 */

export interface TabletInfo {
  names: Record<Color, string>;
  status: string;
  /** Schach, Remis-Angebot, Spielende → Status hervorgehoben */
  alert: boolean;
  moves: string[];
  /** geschlagene Figuren, nach schlagender Farbe */
  captured: Record<Color, PieceSymbol[]>;
  /** Verbindungsstatus (online) oder null */
  conn: string | null;
}

const FILL = new THREE.Color('#f0e2b6');
const DIM = new THREE.Color('#8a7f62');
const ACTIVE = new THREE.Color('#fff6d6');
const ALERT = new THREE.Color('#ffb36b');
const WARN = new THREE.Color('#ff7a6b');

/** Basis einer Schaufläche im Tafel-Lokalraum. */
interface Face {
  color: Color;
  origin: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  normal: THREE.Vector3;
  /** Breite der Fläche auf Höhe h (Meter entlang „up“) */
  widthAt(h: number): number;
  matrix(x: number, y: number, z?: number): THREE.Matrix4;
}

const TOP_TAPER = 0.8;
const SINK = 0.06;

function makeFace(color: Color, p0: THREE.Vector3, p1: THREE.Vector3, q0: THREE.Vector3, q1: THREE.Vector3): Face {
  const right = p1.clone().sub(p0).normalize();
  const midB = p0.clone().add(p1).multiplyScalar(0.5);
  const midT = q0.clone().add(q1).multiplyScalar(0.5);
  const upRaw = midT.clone().sub(midB);
  const slant = upRaw.length();
  const up = upRaw.addScaledVector(right, -upRaw.dot(right)).normalize();
  const normal = right.clone().cross(up).normalize();
  const w0 = p0.distanceTo(p1);
  const w1 = q0.distanceTo(q1);
  const basis = new THREE.Matrix4().makeBasis(right, up, normal);
  return {
    color,
    origin: midB,
    right,
    up,
    normal,
    widthAt: (h) => w0 + (w1 - w0) * Math.min(1, Math.max(0, h / slant)),
    matrix(x, y, z = 0) {
      const m = basis.clone();
      m.setPosition(midB.clone().addScaledVector(right, x).addScaledVector(up, y).addScaledVector(normal, z));
      return m;
    },
  };
}

/** Emissive-Map: leuchtende Adern; Bereich u<0.45, v>0.55 bleibt dunkel (Gravurfelder), Ecke u,v>0.94 leuchtet (Pilz). */
function veinTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 256);
  const rng = mulberry32(77);
  g.lineCap = 'round';
  for (let k = 0; k < 14; k++) {
    let x = 128 + rng() * 128;
    let y = rng() * 256;
    g.strokeStyle = rng() < 0.6 ? 'rgba(60,240,220,0.9)' : 'rgba(170,110,255,0.85)';
    g.lineWidth = 0.8 + rng() * 1.6;
    g.shadowColor = g.strokeStyle;
    g.shadowBlur = 4;
    g.beginPath();
    g.moveTo(x, y);
    for (let i = 0; i < 18; i++) {
      x += (rng() - 0.5) * 22;
      y += (rng() - 0.3) * 18;
      g.lineTo(Math.max(118, x), y);
    }
    g.stroke();
  }
  g.shadowBlur = 0;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 115, 115); // Gravurfelder (oben links im Canvas = v hoch)
  g.fillStyle = '#ff7bd9';
  g.fillRect(242, 0, 14, 14); // Pilzhut-Ecke
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function setVertexColor(g: THREE.BufferGeometry, col: THREE.Color): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.toArray(a, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

function setUv(g: THREE.BufferGeometry, fn: (p: THREE.Vector3, i: number) => [number, number]): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) uv.set(fn(v.fromBufferAttribute(pos, i), i), i * 2);
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Viereck aus 4 Punkten (gegen den Uhrzeigersinn von außen gesehen). */
function quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a.toArray(), ...b.toArray(), ...c.toArray(), ...a.toArray(), ...c.toArray(), ...d.toArray()], 3));
  g.computeVertexNormals();
  return g;
}

export class InfoTablet {
  readonly root = new THREE.Group();
  private stone: THREE.Mesh;
  private stoneMat: THREE.MeshStandardMaterial;
  private text = new BatchedText();
  private reliefs: THREE.Mesh;
  private reliefMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.1, emissive: '#1a1410', emissiveIntensity: 0.6 });
  private faces: Face[] = [];
  private texts: { face: Face; names: Text[]; clocks: Text[]; status: Text; moves: Text; conn: Text }[] = [];
  private pose: TabletPose | null = null;
  private faceAngle = -1;
  private info: TabletInfo | null = null;
  private clockMs: Record<Color, number> | null = null;
  private turn: Color = 'w';
  private running = false;
  private time = 0;
  private fade = 0;
  private capturedKey = '';
  /** wird aufgerufen, wenn jemand näher als 0,3 m kommt (für einen Hinweis) */
  onTooClose: (() => void) | null = null;
  private wasClose = false;

  constructor() {
    this.root.name = 'info-tablet';
    this.stoneMat = new THREE.MeshStandardMaterial({
      map: stoneTexture('moon', 3),
      color: '#9b93ab',
      roughness: 0.6,
      metalness: 0.05,
      vertexColors: true,
      emissive: '#ffffff',
      emissiveMap: veinTexture(),
      emissiveIntensity: 0.9,
      envMapIntensity: 0.6,
    });
    this.stone = new THREE.Mesh(new THREE.BufferGeometry(), this.stoneMat);
    this.reliefs = new THREE.Mesh(new THREE.BufferGeometry(), this.reliefMat);
    this.reliefs.visible = false;
    this.text.font = italicFont;
    this.text.material = new THREE.MeshBasicMaterial({ toneMapped: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.text.renderOrder = 4;
    this.root.add(this.stone, this.reliefs, this.text);
    this.root.visible = false;
  }

  /** Tafel an eine neue Stelle setzen (nach Brett-Platzierung). */
  place(p: TabletPose, baseY = 0): void {
    this.pose = p;
    this.root.position.set(p.x, baseY, p.z);
    this.root.rotation.set(0, p.yaw, 0);
    this.root.scale.setScalar(p.scale);
    this.root.visible = true;
    if (Math.abs(p.faceAngle - this.faceAngle) > 1e-4) {
      this.faceAngle = p.faceAngle;
      this.build(p);
    }
  }

  /** Schaufläche einer Farbe (Tafel-lokal) – für Tests/Debug. */
  faceOf(c: Color): Face | undefined {
    return this.faces.find((f) => f.color === c);
  }

  private build(p: TabletPose): void {
    const { a, b, c } = tabletSection(p.faceAngle, 1);
    const H = TABLET.height;
    const cx = (a.x + b.x + c.x) / 3;
    const top = (v: { x: number; z: number }) => new THREE.Vector3(cx + (v.x - cx) * TOP_TAPER + 0.03, H, v.z * TOP_TAPER);
    const bot = (v: { x: number; z: number }) => new THREE.Vector3(v.x, -SINK, v.z);
    const A0 = bot(a), B0 = bot(b), C0 = bot(c), A1 = top(a), B1 = top(b), C1 = top(c);
    // Fläche +z: A→B (für den Leser links→rechts), Fläche −z: C→A
    const fPlus = makeFace('w', A0, B0, A1, B1);
    const fMinus = makeFace('b', C0, A0, C1, A1);
    const plusColor: Color = faceFor(p, 'w') === 1 ? 'w' : 'b';
    fPlus.color = plusColor;
    fMinus.color = plusColor === 'w' ? 'b' : 'w';
    this.faces = [fPlus, fMinus];

    const stoneUv = (pt: THREE.Vector3) => [0.5 + (pt.x + pt.z) * 0.4, 0.1 + pt.y * 0.32] as [number, number];
    const grey = new THREE.Color(1, 1, 1);
    const parts: THREE.BufferGeometry[] = [];
    // Seiten (Schauflächen + Rückseite), Deckel
    for (const g of [quad(A0, B0, B1, A1), quad(C0, A0, A1, C1), quad(B0, C0, C1, B1)]) parts.push(setUv(setVertexColor(g, grey), stoneUv));
    const cap = new THREE.BufferGeometry();
    cap.setAttribute('position', new THREE.Float32BufferAttribute([...A1.toArray(), ...C1.toArray(), ...B1.toArray()], 3));
    cap.computeVertexNormals();
    parts.push(setUv(setVertexColor(cap, grey), stoneUv));
    // unregelmäßiger Steinbrocken als Abschluss oben
    const lump = new THREE.IcosahedronGeometry(0.2, 1);
    lump.deleteAttribute('uv');
    const rng = mulberry32(5);
    const lp = lump.getAttribute('position');
    for (let i = 0; i < lp.count; i++) lp.setXYZ(i, lp.getX(i) * (0.9 + rng() * 0.25), lp.getY(i) * 0.45 * (0.9 + rng() * 0.2), lp.getZ(i) * (0.9 + rng() * 0.25));
    lump.computeVertexNormals();
    lump.scale(1.1, 1, 1.4);
    lump.translate(cx + 0.03, H, 0);
    parts.push(setUv(setVertexColor(lump, grey), stoneUv));
    // eingravierte, dunklere Schreibfelder (eigene Vertices → UVs im aderfreien Bereich der Emissive-Map)
    for (const f of this.faces) {
      const y0 = 0.2, y1 = 1.3;
      const w0 = f.widthAt(y0) - 0.07, w1 = f.widthAt(y1) - 0.07;
      const P = (x: number, y: number) => f.origin.clone().addScaledVector(f.right, x).addScaledVector(f.up, y).addScaledVector(f.normal, 0.002);
      const g = quad(P(-w0 / 2, y0), P(w0 / 2, y0), P(w1 / 2, y1), P(-w1 / 2, y1));
      parts.push(setUv(setVertexColor(g, new THREE.Color(0.36, 0.33, 0.4)), (_pt, i) => [0.05 + (i % 3) * 0.1, 0.62 + (i % 2) * 0.25]));
    }
    // Moos am Fuß
    const moss = new THREE.Color('#3f8f4a');
    for (let k = 0; k < 14; k++) {
      const t = k / 14;
      const edge = t < 1 / 3 ? [A0, B0] : t < 2 / 3 ? [B0, C0] : [C0, A0];
      const u = (t * 3) % 1;
      const pos = edge[0].clone().lerp(edge[1], u);
      const m = new THREE.IcosahedronGeometry(0.06 + rng() * 0.06, 0);
      m.deleteAttribute('uv');
      m.scale(1.3, 0.45, 1.3);
      m.translate(pos.x + (rng() - 0.3) * 0.08, 0.0, pos.z + (rng() - 0.5) * 0.08);
      parts.push(setUv(setVertexColor(m, moss.clone().offsetHSL((rng() - 0.5) * 0.06, 0, (rng() - 0.5) * 0.1)), () => [0.02, 0.02]));
    }
    // kleiner Leuchtpilz an der hinteren Ecke
    const stem = new THREE.CylinderGeometry(0.012, 0.018, 0.16, 7);
    stem.deleteAttribute('uv');
    stem.translate(B0.x + 0.1, 0.08, B0.z + 0.06);
    parts.push(setUv(setVertexColor(stem, new THREE.Color('#d9d0ff')), () => [0.3, 0.05]));
    const capG = new THREE.SphereGeometry(0.055, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1);
    capG.deleteAttribute('uv');
    capG.translate(B0.x + 0.1, 0.16, B0.z + 0.06);
    parts.push(setUv(setVertexColor(capG, new THREE.Color('#ff9be6')), () => [0.97, 0.97]));

    this.stone.geometry.dispose();
    this.stone.geometry = safeMerge(parts);

    // Texte neu anlegen (Positionen hängen von den Flächen ab)
    for (const t of this.texts) for (const x of [...t.names, ...t.clocks, t.status, t.moves, t.conn]) {
      this.text.removeText(x);
      x.dispose();
    }
    this.texts = this.faces.map((f) => {
      const mk = (x: number, y: number, size: number, anchorX: 'left' | 'center' | 'right' = 'center', anchorY: 'top' | 'middle' = 'middle') => {
        const t = new Text();
        t.font = italicFont;
        t.fontSize = size;
        t.anchorX = anchorX;
        t.anchorY = anchorY;
        t.sdfGlyphSize = 64;
        t.color = FILL;
        t.text = ' ';
        t.matrixAutoUpdate = false;
        t.matrix.copy(f.matrix(x, y, 0.004));
        this.text.addText(t);
        return t;
      };
      const w = f.widthAt(1.12) * 0.25;
      const names = [mk(-w, 1.235, 0.042), mk(w, 1.235, 0.042)];
      const clocks = [mk(-w, 1.115, 0.11), mk(w, 1.115, 0.11)];
      const status = mk(0, 0.985, 0.05);
      (status as unknown as { maxWidth: number }).maxWidth = f.widthAt(1) - 0.12;
      (status as unknown as { textAlign: string }).textAlign = 'center';
      const moves = mk(-f.widthAt(0.9) / 2 + 0.07, 0.915, 0.048, 'left', 'top');
      (moves as unknown as { lineHeight: number }).lineHeight = 1.18;
      const conn = mk(0, 0.25, 0.034);
      return { face: f, names, clocks, status, moves, conn };
    });
    this.capturedKey = '';
    if (this.info) {
      const i = this.info;
      this.info = null;
      this.setInfo(i);
    }
    if (this.clockMs) this.setClocks(this.clockMs, this.turn, this.running, true);
  }

  /** Infos setzen – nur Geändertes wird neu gesetzt. */
  setInfo(info: TabletInfo): void {
    const prev = this.info;
    this.info = info;
    for (const t of this.texts) {
      const me = t.face.color;
      const op: Color = me === 'w' ? 'b' : 'w';
      // eigene Farbe links, Gegner rechts
      const order: Color[] = [me, op];
      order.forEach((c, k) => {
        if (!prev || prev.names[c] !== info.names[c]) t.names[k].text = info.names[c] || ' ';
      });
      if (!prev || prev.status !== info.status || prev.alert !== info.alert) {
        t.status.text = info.status || ' ';
        t.status.color = info.alert ? ALERT : FILL;
      }
      if (!prev || prev.moves.length !== info.moves.length || prev.moves[prev.moves.length - 1] !== info.moves[info.moves.length - 1]) t.moves.text = movesText(info.moves) || ' ';
      if (!prev || prev.conn !== info.conn) t.conn.text = info.conn ?? ' ';
    }
    const key = `${info.captured.w.join('')}|${info.captured.b.join('')}`;
    if (key !== this.capturedKey) {
      this.capturedKey = key;
      this.buildReliefs(info.captured);
    }
  }

  /** Uhren (ms) – höchstens 10×/s aufrufen; setzt nur geänderte Ziffern. */
  setClocks(ms: Record<Color, number> | null, turn: Color, running: boolean, force = false): void {
    const prevTurn = this.turn;
    this.clockMs = ms;
    this.turn = turn;
    this.running = running;
    for (const t of this.texts) {
      const me = t.face.color;
      const order: Color[] = [me, me === 'w' ? 'b' : 'w'];
      order.forEach((c, k) => {
        const s = ms ? formatClock(ms[c]) : c === turn && running ? '•' : ' ';
        if (force || t.clocks[k].text !== s) t.clocks[k].text = s;
        if (force || prevTurn !== turn) t.clocks[k].color = c === turn && running ? ACTIVE : DIM;
      });
    }
  }

  private buildReliefs(captured: Record<Color, PieceSymbol[]>): void {
    const parts: THREE.BufferGeometry[] = [];
    const order: PieceSymbol[] = ['q', 'r', 'b', 'n', 'p'];
    const ivory = new THREE.Color('#e8dcc0');
    const obsidian = new THREE.Color('#3a3346');
    for (const f of this.faces) {
      const me = f.color;
      // Zeile 1: was ich geschlagen habe (Figuren des Gegners), Zeile 2: was ich verloren habe
      const rows: [PieceSymbol[], Color][] = [
        [[...captured[me]].sort((x, y) => order.indexOf(x) - order.indexOf(y)), me === 'w' ? 'b' : 'w'],
        [[...captured[me === 'w' ? 'b' : 'w']].sort((x, y) => order.indexOf(x) - order.indexOf(y)), me],
      ];
      rows.forEach(([list, pieceColor], r) => {
        const y = 0.4 - r * 0.085;
        const width = f.widthAt(y) - 0.14;
        const step = Math.min(0.06, width / Math.max(1, list.length));
        list.forEach((type, i) => {
          const g = pieceGeometry(type, 10, 1).clone();
          for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
          // Relief: in Normalenrichtung flach gedrückt
          g.scale(0.095, 0.095, 0.095 * 0.22);
          g.applyMatrix4(f.matrix(-width / 2 + step * (i + 0.5), y - 0.035, 0.003));
          parts.push(setVertexColor(g, pieceColor === 'w' ? ivory : obsidian));
        });
      });
    }
    this.reliefs.geometry.dispose();
    this.reliefs.geometry = parts.length ? safeMerge(parts) : new THREE.BufferGeometry();
    this.reliefs.visible = parts.length > 0; // leer → kein Draw Call
  }

  /** Pro Frame: Puls der knappen Uhr, Adern, Durchsichtigkeit bei Nähe (Köpfe/Hände in Welt). */
  update(dt: number, viewers: THREE.Vector3[]): void {
    if (!this.root.visible || !this.pose) return;
    this.time += dt;
    this.stoneMat.emissiveIntensity = 0.75 + 0.2 * Math.sin(this.time * 0.6);
    // Uhr unter 10 s: pulsiert
    if (this.clockMs && this.running) {
      const ms = this.clockMs[this.turn];
      if (ms < 10_000) {
        const k = 0.5 + 0.5 * Math.sin(this.time * 6);
        for (const t of this.texts) {
          const idx = t.face.color === this.turn ? 0 : 1;
          t.clocks[idx].color = ACTIVE.clone().lerp(WARN, k);
        }
      }
    }
    // Nähe: man darf sich nicht „anlehnen“ – unter 0,3 m wird die Tafel durchscheinend
    const local = new THREE.Vector3();
    let close = false;
    const inv = this.root.matrixWorld.clone().invert();
    const sec = tabletSection(this.pose.faceAngle, 1);
    for (const v of viewers) {
      local.copy(v).applyMatrix4(inv);
      if (local.y > TABLET.height + 0.4) continue;
      const d = distToTriangle(local.x, local.z, sec) * this.pose.scale;
      if (d < 0.3) close = true;
    }
    this.fade += ((close ? 1 : 0) - this.fade) * Math.min(1, dt * 6);
    const transparent = this.fade > 0.02;
    if (this.stoneMat.transparent !== transparent) {
      this.stoneMat.transparent = transparent;
      this.reliefMat.transparent = transparent;
      this.stoneMat.needsUpdate = this.reliefMat.needsUpdate = true;
    }
    this.stoneMat.opacity = this.reliefMat.opacity = 1 - 0.6 * this.fade;
    this.stoneMat.depthWrite = !transparent;
    if (close && !this.wasClose) this.onTooClose?.();
    this.wasClose = close;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.stone.geometry.dispose();
    this.reliefs.geometry.dispose();
    this.text.dispose();
  }
}

/** Letzte 10 Halbzüge in Zeilen „12. Sf3  Sc6“. */
export function movesText(moves: string[]): string {
  const n = moves.length;
  const start = Math.max(0, 2 * (Math.ceil(n / 2) - 5));
  const lines: string[] = [];
  for (let i = start; i < n; i += 2) lines.push(`${i / 2 + 1}. ${moves[i]}${moves[i + 1] ? `   ${moves[i + 1]}` : ''}`);
  return lines.join('\n');
}

/** Abstand eines Punkts (Tafel-lokal, xz) zum Fuß-Dreieck (0 = innen). */
function distToTriangle(x: number, z: number, s: { a: { x: number; z: number }; b: { x: number; z: number }; c: { x: number; z: number } }): number {
  const pts = [s.a, s.b, s.c];
  let pos = 0;
  let neg = 0;
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const p = pts[i], q = pts[(i + 1) % 3];
    const ex = q.x - p.x, ez = q.z - p.z;
    const cross = ex * (z - p.z) - ez * (x - p.x);
    if (cross > 0) pos++;
    else neg++;
    const t = Math.max(0, Math.min(1, ((x - p.x) * ex + (z - p.z) * ez) / (ex * ex + ez * ez)));
    best = Math.min(best, Math.hypot(x - (p.x + ex * t), z - (p.z + ez * t)));
  }
  return pos === 3 || neg === 3 ? 0 : best;
}
