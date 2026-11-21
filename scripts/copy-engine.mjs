// Kopiert die Stockfish-Lite-Single-Engine (GPL-3.0) nach public/engine.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
const src = 'node_modules/stockfish/bin/';
const dst = 'public/engine/';
mkdirSync(dst, { recursive: true });
for (const f of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) {
  if (existsSync(src + f)) copyFileSync(src + f, dst + f);
  else console.warn('[copy-engine] fehlt:', src + f);
}
