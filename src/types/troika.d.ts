// Minimale Typen für troika-three-text (das Paket liefert keine eigenen).
declare module 'troika-three-text' {
  import type { Color, Material, Mesh } from 'three';
  export class Text extends Mesh {
    text: string;
    font: string | null;
    fontSize: number;
    fontWeight: number | string;
    anchorX: number | string;
    anchorY: number | string;
    color: Color | string | number | null;
    outlineWidth: number | string;
    outlineColor: Color | string | number;
    outlineOpacity: number;
    outlineBlur: number | string;
    fillOpacity: number;
    letterSpacing: number;
    sdfGlyphSize: number;
    material: Material;
    sync(cb?: () => void): void;
    dispose(): void;
  }
  export class BatchedText extends Text {
    addText(t: Text): void;
    removeText(t: Text): void;
  }
  export function preloadFont(opts: { font: string; characters?: string }, cb: () => void): void;
}
