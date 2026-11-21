/** Spielkonfiguration – Ergebnis der Landingpage, Eingabe für die Spielszene. */
export type GameMode =
  | 'hotseat'
  | 'engine'
  | 'coloc-host' // zwei Brillen im selben Raum – Host (M4)
  | 'coloc-join' // zwei Brillen im selben Raum – Gast (M4)
  | 'online-link' // online mit Freund per Link (M3)
  | 'lichess';

export interface GameConfig {
  mode: GameMode;
  name: string;
  color: 'w' | 'b' | 'random';
  tc: string;
  engineLevel: number;
  vr: boolean;
  /** Raumcode bei Co-Location/Online. */
  room?: string;
  /** Laufende Lichess-Partie. */
  lichess?: { gameId: string };
}

/** Diese Modi haben bereits eine spielbare Umsetzung. */
export const PLAYABLE_MODES: GameMode[] = ['hotseat', 'engine', 'lichess'];

/** VR-Spielmodus (Meilenstein 2) – bis dahin bleibt „In VR starten“ gesperrt. */
export const VR_GAMEPLAY_AVAILABLE = false;
