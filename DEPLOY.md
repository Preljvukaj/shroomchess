# Myzel-Schach – Deploy-Branch

Dieser Branch enthält nur die **fertig gebaute Webseite** (`npm run build` aus `main`).
Er wird direkt ins Webroot (`httpdocs`) ausgerollt. Quellcode, Doku und Tests liegen im Branch `main`.

Voraussetzungen am Server: HTTPS (für WebXR und Lichess-Login), `.wasm` als `application/wasm` (siehe `.htaccess`).

## Lizenzhinweis Stockfish
`engine/stockfish-19-lite-single.*` ist Stockfish 19 (stockfish.js von Nathan Rugg / Chess.com), lizenziert unter der
GNU GPL v3 – siehe `engine/COPYING-stockfish.txt`. Quellcode: https://github.com/nmrugg/stockfish.js (v19.0.1) und
https://github.com/official-stockfish/Stockfish.
