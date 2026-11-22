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
  /** Netzwerkspiel: Host erstellt den Raum, Gast tritt bei (Art online/coloc erfährt der Gast vom Server). */
  role?: 'host' | 'guest';
  /** Laufende Lichess-Partie. */
  lichess?: { gameId: string };
}

/** Diese Modi haben bereits eine spielbare Umsetzung. */
export const PLAYABLE_MODES: GameMode[] = ['hotseat', 'engine', 'lichess', 'online-link', 'coloc-host', 'coloc-join'];

export function isNetMode(m: GameMode): boolean {
  return m === 'online-link' || m === 'coloc-host' || m === 'coloc-join';
}

/** VR-Spielmodus (Meilenstein 2) ist verfügbar. */
export const VR_GAMEPLAY_AVAILABLE = true;
