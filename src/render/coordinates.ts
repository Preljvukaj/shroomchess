import * as THREE from 'three';
import { BatchedText, Text } from 'troika-three-text';
import italicFont from '@fontsource/cormorant-garamond/files/cormorant-garamond-latin-700-italic.woff?url';
import interBold from '@fontsource/inter/files/inter-latin-700-normal.woff?url';
import { type Settings } from '../core/settings';
import type { Square } from '../core/types';
import { COORD_SIZE_FACTOR, type CoordLabel, type CoordOrientation, FRAME_WIDTH_FACTOR, coordinateLayout, squareLabelLayout } from './coordLayout';

/**
 * Brett-Beschriftung, in den Steinrahmen eingelassen: flach, kursiv (Cormorant Garamond Bold Italic,
 * lokal gebündelt), leuchtende Füllung in sanftem Goldweiß mit dunkler „Gravur“-Kante.
 * SDF-Text (troika) → scharf in jeder Entfernung. Gebatcht: Füllung + Kante = 2 Draw Calls,
 * optionale Feldbeschriftung = 1 Draw Call. Die Füllfarbe liegt unter der Bloom-Schwelle (0,85),
 * damit das Leuchten die Kanten nicht verschmiert. Sehr langsames, kaum merkliches Pulsieren.
 */

const FILL = new THREE.Color('#f0e2b6');
const FILL_HC = new THREE.Color('#ffffff');
const HIGHLIGHT = new THREE.Color('#bff3ff');
const GROOVE = '#0b0910';

export class Coordinates {
  readonly root = new THREE.Group();
  private batch = new BatchedText();
  private squareBatch = new BatchedText();
  private labels: { def: CoordLabel; text: Text }[] = [];
  private squareLabels: Text[] = [];
  private highlightFile: number | null = null;
  private highlightRank: number | null = null;
  private highlightT = 0;
  private sizeFactor: number = COORD_SIZE_FACTOR.M;
  private highContrast = false;
  private orient: CoordOrientation = 'both';
  private time = 0;

  constructor(private squareSize: number, private surfaceY: number) {
    this.batch.font = italicFont;
    this.batch.material = new THREE.MeshBasicMaterial({ toneMapped: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.batch.renderOrder = 4;

    for (const reader of ['w', 'b'] as const) {
      for (const def of squareLabelLayout(squareSize, reader)) {
        const t = new Text();
        t.text = def.text;
        t.font = interBold;
        t.anchorX = 'center';
        t.anchorY = 'middle';
        t.fontSize = squareSize * 0.18;
        t.position.set(def.x, surfaceY + 0.003, def.z);
        t.rotation.set(def.pitch, def.yaw, 0, 'YXZ');
        const fileIdx = def.kind === 'file' ? def.index : reader === 'w' ? 0 : 7;
        const rankIdx = def.kind === 'rank' ? def.index : reader === 'w' ? 0 : 7;
        t.color = (fileIdx + rankIdx) % 2 === 1 ? '#2a2440' : '#d8e4ff';
        t.userData.reader = reader;
        this.squareLabels.push(t);
        this.squareBatch.addText(t);
      }
    }
    this.squareBatch.font = interBold;
    this.squareBatch.material = new THREE.MeshBasicMaterial({ toneMapped: true, transparent: true, depthWrite: false });
    this.squareBatch.visible = false;
    this.squareBatch.renderOrder = 3;
    this.root.add(this.batch, this.squareBatch);
    this.build();
  }

  /** Glyphen für die aktuelle Ausrichtung erzeugen (bei Wechsel der Ausrichtung neu). */
  private build(): void {
    for (const { text } of this.labels) {
      this.batch.removeText(text);
      text.dispose();
    }
    this.labels = [];
    for (const def of coordinateLayout(this.squareSize, this.orient)) {
      const t = new Text();
      t.text = def.text;
      t.font = italicFont;
      t.anchorX = 'center';
      t.anchorY = 'middle';
      t.sdfGlyphSize = 64;
      this.labels.push({ def, text: t });
      this.batch.addText(t);
    }
    this.relayout();
  }

  /** Einstellungen übernehmen. `orient`: 'both' (Hot-Seat/zwei Brillen) oder die eigene Farbe. */
  apply(s: Pick<Settings, 'coordSize' | 'coordHighContrast' | 'coordsOnSquares'>, viewer: 'w' | 'b' = 'w', orient: CoordOrientation = 'both'): void {
    this.sizeFactor = COORD_SIZE_FACTOR[s.coordSize];
    this.highContrast = s.coordHighContrast;
    this.squareBatch.visible = s.coordsOnSquares;
    for (const t of this.squareLabels) t.visible = t.userData.reader === viewer;
    this.squareLabels.forEach((t) => t.sync());
    this.squareBatch.sync();
    if (orient !== this.orient) {
      this.orient = orient;
      this.build();
    } else this.relayout();
  }

  private relayout(): void {
    const frameW = FRAME_WIDTH_FACTOR * this.squareSize;
    const h = this.sizeFactor * frameW; // Zeichenhöhe = 48–62 % der Rahmenbreite
    for (const { def, text } of this.labels) {
      // Cormorant: Versalhöhe ≈ 0,63 × fontSize, Ziffern/Kleinbuchstaben ähnlich → fontSize so wählen, dass die Glyphe ≈ h hoch ist
      text.fontSize = h / 0.63;
      text.outlineWidth = this.highContrast ? '12%' : '8%';
      text.outlineColor = GROOVE; // dunkle Kante wirkt wie eine Gravur
      text.color = (this.highContrast ? FILL_HC : FILL).getHex();
      text.position.set(def.x, this.surfaceY + 0.0015, def.z); // minimal über dem Rahmen, Polygon-Offset gegen Z-Fighting
      text.rotation.set(def.pitch, def.yaw, 0, 'YXZ');
      text.sync();
    }
    this.batch.sync();
  }

  /** Bonus: Linie/Reihe des Felds unter der gegriffenen Figur leuchten im Rahmen heller. */
  highlightSquare(sq: Square | null): void {
    const f = sq ? sq.charCodeAt(0) - 97 : null;
    const r = sq ? sq.charCodeAt(1) - 49 : null;
    if (f === this.highlightFile && r === this.highlightRank) return;
    this.highlightFile = f;
    this.highlightRank = r;
    this.highlightT = 0;
  }

  update(dt: number, _camera: THREE.Camera, _boardCenter: THREE.Vector3, _xr: boolean): void {
    this.highlightT += dt;
    this.time += dt;
    const base = (this.highContrast ? FILL_HC : FILL).clone().multiplyScalar(0.94 + 0.06 * Math.sin(this.time * 0.35)); // kaum merkliches Pulsieren
    const k = this.highlightT < 0.25 ? 1 : 0.7;
    for (const { def, text } of this.labels) {
      const on = (def.kind === 'file' && def.index === this.highlightFile) || (def.kind === 'rank' && def.index === this.highlightRank);
      text.color = on ? base.clone().lerp(HIGHLIGHT, k).getHex() : base.getHex();
    }
  }
}
