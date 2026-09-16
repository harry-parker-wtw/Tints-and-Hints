// Core domain types shared by client and server.

export type GamePhase =
  | 'lobby'
  | 'caller-picking'
  | 'clue-given'
  | 'guessing'
  | 'scoring'
  | 'round-end'
  | 'game-end';

export interface Player {
  id: string;
  name: string;
  pawnColor: string;
  connected: boolean;
}

export interface Round {
  callerId: string;
  targetIndex: number;
  clue: string | null;
  /** playerId -> flat grid index guessed, or null if not yet guessed. */
  guesses: Record<string, number | null>;
}

export interface BestGuess {
  playerId: string;
  roundIndex: number;
  distance: number;
}

export interface GridConfig {
  cols: number;
  rows: number;
}

export interface Room {
  code: string;
  players: Player[];
  rounds: Round[];
  currentRoundIndex: number;
  phase: GamePhase;
  totalRounds: number;
  /** playerId -> cumulative score across the game. */
  scores: Record<string, number>;
  bestGuess: BestGuess | null;
  gridConfig: GridConfig;
}

/** Sentinel written into a view's `targetIndex` when it must stay hidden. */
export const HIDDEN_TARGET = -1;

/** Fixed 8-color pawn palette. */
export const PAWN_PALETTE: readonly string[] = [
  '#e6194b', // red
  '#3cb44b', // green
  '#4363d8', // blue
  '#f58231', // orange
  '#911eb4', // purple
  '#42d4f4', // cyan
  '#f032e6', // magenta
  '#ffe119', // yellow
];

/**
 * Returns the next unused pawn color for a set of players, cycling back
 * through the palette once every color has been taken.
 */
export function assignPawnColor(players: Player[]): string {
  const used = new Set(players.map((p) => p.pawnColor));
  for (const color of PAWN_PALETTE) {
    if (!used.has(color)) return color;
  }
  return PAWN_PALETTE[players.length % PAWN_PALETTE.length];
}
