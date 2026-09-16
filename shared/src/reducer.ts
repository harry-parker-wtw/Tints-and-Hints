import {
  assignPawnColor,
  HIDDEN_TARGET,
  type BestGuess,
  type Player,
  type Room,
  type Round,
} from './types';

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type Action =
  | { type: 'START_GAME' }
  | { type: 'CALLER_SUBMIT_CLUE'; clue: string }
  | { type: 'GUESSER_SUBMIT_PIN'; playerId: string; index: number }
  | { type: 'ALL_GUESSES_IN' }
  | { type: 'NEXT_ROUND' }
  | { type: 'RESET_GAME' }
  | { type: 'PLAYER_DISCONNECTED'; playerId: string }
  | { type: 'PLAYER_RECONNECTED'; playerId: string };

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

const clone = <T>(value: T): T =>
  typeof structuredClone === 'function'
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);

let idCounter = 0;
function genId(): string {
  idCounter += 1;
  return `p${idCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Chebyshev (king-move) distance between two flat grid indices. */
export function chebyshevDistance(a: number, b: number, cols: number): number {
  const ar = Math.floor(a / cols);
  const ac = a % cols;
  const br = Math.floor(b / cols);
  const bc = b % cols;
  return Math.max(Math.abs(ar - br), Math.abs(ac - bc));
}

/** Scoring tiers: 0->4, 1->3, 2->2, 3->1, 4+ ->0. */
export function scoreForDistance(distance: number): number {
  if (distance <= 0) return 4;
  if (distance === 1) return 3;
  if (distance === 2) return 2;
  if (distance === 3) return 1;
  return 0;
}

function randomTargetIndex(room: Room): number {
  const total = room.gridConfig.cols * room.gridConfig.rows;
  return Math.floor(Math.random() * total);
}

function makeRound(callerId: string, targetIndex: number): Round {
  return { callerId, targetIndex, clue: null, guesses: {} };
}

const REVEALED_PHASES = new Set(['scoring', 'round-end', 'game-end']);

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function createRoom(code: string): Room {
  return {
    code,
    players: [],
    rounds: [],
    currentRoundIndex: 0,
    phase: 'lobby',
    totalRounds: 0,
    scores: {},
    bestGuess: null,
    gridConfig: { cols: 24, rows: 20 },
  };
}

export function addPlayer(
  room: Room,
  name: string,
): { room: Room; player: Player } {
  const next = clone(room);
  const player: Player = {
    id: genId(),
    name,
    pawnColor: assignPawnColor(next.players),
    connected: true,
  };
  next.players.push(player);
  return { room: next, player };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function applyAction(room: Room, action: Action): Room {
  const next = clone(room);

  switch (action.type) {
    case 'START_GAME': {
      if (next.players.length === 0) return next;
      const caller = next.players[0];
      next.scores = {};
      for (const p of next.players) next.scores[p.id] = 0;
      next.rounds = [makeRound(caller.id, randomTargetIndex(next))];
      next.currentRoundIndex = 0;
      next.totalRounds = next.players.length;
      next.bestGuess = null;
      // Server already knows the target; caller just hasn't flipped yet.
      next.phase = 'caller-picking';
      return next;
    }

    case 'CALLER_SUBMIT_CLUE': {
      const round = next.rounds[next.currentRoundIndex];
      if (!round) return next;
      round.clue = action.clue;
      // clue-given is transient; move straight into guessing.
      next.phase = 'guessing';
      return next;
    }

    case 'GUESSER_SUBMIT_PIN': {
      const round = next.rounds[next.currentRoundIndex];
      if (!round) return next;
      if (action.playerId === round.callerId) return next; // caller can't guess
      round.guesses[action.playerId] = action.index;
      return next;
    }

    case 'ALL_GUESSES_IN': {
      const round = next.rounds[next.currentRoundIndex];
      if (!round) return next;

      const guesserScores: number[] = [];
      let best: BestGuess | null = next.bestGuess;

      for (const player of next.players) {
        if (player.id === round.callerId) continue;
        const guess = round.guesses[player.id];
        if (guess == null) continue;

        const distance = chebyshevDistance(
          guess,
          round.targetIndex,
          next.gridConfig.cols,
        );
        const gained = scoreForDistance(distance);
        next.scores[player.id] = (next.scores[player.id] ?? 0) + gained;
        guesserScores.push(gained);

        if (best === null || distance < best.distance) {
          best = {
            playerId: player.id,
            roundIndex: next.currentRoundIndex,
            distance,
          };
        }
      }

      if (guesserScores.length > 0) {
        const avg =
          guesserScores.reduce((sum, s) => sum + s, 0) / guesserScores.length;
        next.scores[round.callerId] =
          (next.scores[round.callerId] ?? 0) + Math.round(avg);
      }

      next.bestGuess = best;
      next.phase = 'scoring';
      return next;
    }

    case 'NEXT_ROUND': {
      const isLast = next.currentRoundIndex + 1 >= next.totalRounds;
      if (isLast) {
        next.phase = 'game-end';
        return next;
      }

      const current = next.rounds[next.currentRoundIndex];
      const callerIdx = next.players.findIndex((p) => p.id === current.callerId);
      const nextCaller =
        next.players[(callerIdx + 1) % next.players.length];

      next.rounds.push(makeRound(nextCaller.id, randomTargetIndex(next)));
      next.currentRoundIndex += 1;
      next.phase = 'caller-picking';
      return next;
    }

    case 'RESET_GAME': {
      next.rounds = [];
      next.currentRoundIndex = 0;
      next.totalRounds = 0;
      next.scores = {};
      next.bestGuess = null;
      next.phase = 'lobby';
      return next;
    }

    case 'PLAYER_DISCONNECTED': {
      const player = next.players.find((p) => p.id === action.playerId);
      if (player) player.connected = false;
      return next;
    }

    case 'PLAYER_RECONNECTED': {
      const player = next.players.find((p) => p.id === action.playerId);
      if (player) player.connected = true;
      return next;
    }

    default:
      return next;
  }
}

// ---------------------------------------------------------------------------
// Privacy filtering
// ---------------------------------------------------------------------------

/**
 * Returns a copy of the room tailored to what `playerId` is allowed to see:
 *  - The current round's target is hidden (set to HIDDEN_TARGET) from anyone
 *    who isn't the caller, until the round has been revealed (scoring+).
 *  - Every other player's guess in the current round is stripped (set to null)
 *    from everyone until the round is revealed (scoring+).
 * Past rounds are always fully revealed.
 */
export function viewForPlayer(room: Room, playerId: string): Room {
  const view = clone(room);
  const revealed = REVEALED_PHASES.has(view.phase);

  view.rounds = view.rounds.map((round, index) => {
    const isPast = index < view.currentRoundIndex;
    const roundRevealed = revealed || isPast;

    if (roundRevealed) return round;

    // Hide the target from everyone except the caller pre-reveal.
    const targetIndex =
      playerId === round.callerId ? round.targetIndex : HIDDEN_TARGET;

    // Strip other players' guesses; keep only the viewer's own.
    const guesses: Record<string, number | null> = {};
    for (const [pid, value] of Object.entries(round.guesses)) {
      guesses[pid] = pid === playerId ? value : null;
    }

    return { ...round, targetIndex, guesses };
  });

  return view;
}
