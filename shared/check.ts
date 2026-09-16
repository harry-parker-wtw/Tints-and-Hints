// Unit-style checks for the shared game logic. Run with:
//   npx tsx shared/check.ts        (from repo root)
//   npm run check -w shared
//
// No test framework — just assertions and console output.

import {
  addPlayer,
  applyAction,
  chebyshevDistance,
  createRoom,
  HIDDEN_TARGET,
  scoreForDistance,
  viewForPlayer,
  type GridConfig,
  type Room,
} from './src/index';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed += 1;
  console.log(`  ok - ${msg}`);
}

/** Build a grid index at an exact Chebyshev distance from `target`. */
function guessAtDistance(
  target: number,
  distance: number,
  grid: GridConfig,
): number {
  const { cols } = grid;
  const tr = Math.floor(target / cols);
  const tc = target % cols;
  let nc = tc + distance;
  if (nc >= cols) nc = tc - distance;
  return tr * cols + nc;
}

// ---------------------------------------------------------------------------
// Setup: a 3-player room.
// ---------------------------------------------------------------------------
console.log('Setup: create room + add players');
let room: Room = createRoom('ROOM1');
let res = addPlayer(room, 'Alice');
room = res.room;
const alice = res.player;
res = addPlayer(room, 'Bob');
room = res.room;
const bob = res.player;
res = addPlayer(room, 'Carol');
room = res.room;
const carol = res.player;

assert(room.players.length === 3, 'three players added');
assert(
  new Set(room.players.map((p) => p.pawnColor)).size === 3,
  'each player got a distinct pawn color',
);
assert(room.gridConfig.cols === 24 && room.gridConfig.rows === 20, 'grid is 24x20');

// ---------------------------------------------------------------------------
// Round 1
// ---------------------------------------------------------------------------
console.log('\nRound 1: start game (caller = Alice)');
room = applyAction(room, { type: 'START_GAME' });
assert(room.phase === 'caller-picking', 'phase is caller-picking after START_GAME');
assert(room.rounds.length === 1, 'one round exists');
assert(room.rounds[0].callerId === alice.id, 'Alice is the caller');
assert(room.totalRounds === 3, 'totalRounds equals player count');

const target1 = room.rounds[0].targetIndex;

console.log('\nPrivacy: target hidden from guessers pre-reveal');
const bobViewPre = viewForPlayer(room, bob.id);
const aliceViewPre = viewForPlayer(room, alice.id);
assert(
  bobViewPre.rounds[0].targetIndex === HIDDEN_TARGET,
  'guesser (Bob) cannot see the target before scoring',
);
assert(
  aliceViewPre.rounds[0].targetIndex === target1,
  'caller (Alice) CAN see the target before scoring',
);

console.log('\nCaller submits clue -> guessing');
room = applyAction(room, { type: 'CALLER_SUBMIT_CLUE', clue: 'warm citrus' });
assert(room.phase === 'guessing', 'phase is guessing after clue submitted');
assert(room.rounds[0].clue === 'warm citrus', 'clue is stored');

console.log('\nGuessers submit pins');
const bobGuess = guessAtDistance(target1, 0, room.gridConfig); // perfect, score 4
const carolGuess = guessAtDistance(target1, 2, room.gridConfig); // score 2
assert(chebyshevDistance(bobGuess, target1, room.gridConfig.cols) === 0, 'Bob guess distance 0');
assert(chebyshevDistance(carolGuess, target1, room.gridConfig.cols) === 2, 'Carol guess distance 2');
room = applyAction(room, { type: 'GUESSER_SUBMIT_PIN', playerId: bob.id, index: bobGuess });
room = applyAction(room, { type: 'GUESSER_SUBMIT_PIN', playerId: carol.id, index: carolGuess });

console.log('\nPrivacy: other guesses hidden during guessing');
const bobDuringGuess = viewForPlayer(room, bob.id);
assert(
  bobDuringGuess.rounds[0].guesses[bob.id] === bobGuess,
  'Bob sees his own guess',
);
assert(
  bobDuringGuess.rounds[0].guesses[carol.id] === null,
  "Bob cannot see Carol's guess before scoring",
);

console.log('\nAll guesses in -> scoring');
room = applyAction(room, { type: 'ALL_GUESSES_IN' });
assert(room.phase === 'scoring', 'phase is scoring');
assert(room.scores[bob.id] === 4, 'Bob scored 4 (distance 0)');
assert(room.scores[carol.id] === 2, 'Carol scored 2 (distance 2)');
// caller average = round((4 + 2) / 2) = 3
assert(room.scores[alice.id] === 3, 'Alice (caller) got rounded average = 3');

console.log('\nbestGuess tracking');
assert(room.bestGuess !== null, 'bestGuess is set');
assert(room.bestGuess!.playerId === bob.id, 'bestGuess belongs to Bob');
assert(room.bestGuess!.distance === 0, 'bestGuess distance is 0');
assert(room.bestGuess!.roundIndex === 0, 'bestGuess round index is 0');

console.log('\nPrivacy: target + guesses revealed after scoring');
const bobViewPost = viewForPlayer(room, bob.id);
assert(
  bobViewPost.rounds[0].targetIndex === target1,
  'guesser (Bob) CAN see the target after scoring',
);
assert(
  bobViewPost.rounds[0].guesses[carol.id] === carolGuess,
  "Bob CAN see Carol's guess after scoring",
);

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------
console.log('\nNext round: caller rotation');
room = applyAction(room, { type: 'NEXT_ROUND' });
assert(room.phase === 'caller-picking', 'phase back to caller-picking');
assert(room.currentRoundIndex === 1, 'advanced to round index 1');
assert(room.rounds[1].callerId === bob.id, 'caller rotated to Bob');
assert(room.rounds[1].clue === null, 'new round clue reset');
assert(Object.keys(room.rounds[1].guesses).length === 0, 'new round guesses reset');

console.log('\nDisconnect / reconnect never removes a player');
room = applyAction(room, { type: 'PLAYER_DISCONNECTED', playerId: carol.id });
assert(room.players.length === 3, 'player count unchanged on disconnect');
assert(room.players.find((p) => p.id === carol.id)!.connected === false, 'Carol marked disconnected');
room = applyAction(room, { type: 'PLAYER_RECONNECTED', playerId: carol.id });
assert(room.players.find((p) => p.id === carol.id)!.connected === true, 'Carol marked reconnected');

// ---------------------------------------------------------------------------
// Play out remaining rounds -> game-end
// ---------------------------------------------------------------------------
console.log('\nPlay to game end');
// round index 1 (Bob calling) -> next
room = applyAction(room, { type: 'CALLER_SUBMIT_CLUE', clue: 'x' });
room = applyAction(room, { type: 'ALL_GUESSES_IN' });
room = applyAction(room, { type: 'NEXT_ROUND' });
assert(room.currentRoundIndex === 2 && room.rounds[2].callerId === carol.id, 'caller rotated to Carol');
// round index 2 (Carol calling) -> next should end the game
room = applyAction(room, { type: 'CALLER_SUBMIT_CLUE', clue: 'y' });
room = applyAction(room, { type: 'ALL_GUESSES_IN' });
room = applyAction(room, { type: 'NEXT_ROUND' });
assert(room.phase === 'game-end', 'phase is game-end after the last round');

console.log('\nReset game');
room = applyAction(room, { type: 'RESET_GAME' });
assert(room.phase === 'lobby', 'phase back to lobby');
assert(room.rounds.length === 0, 'rounds cleared');
assert(room.bestGuess === null, 'bestGuess cleared');
assert(room.players.length === 3, 'players kept through reset');

// ---------------------------------------------------------------------------
// Standalone scoring-tier sanity
// ---------------------------------------------------------------------------
console.log('\nScoring tiers');
assert(scoreForDistance(0) === 4, 'distance 0 -> 4');
assert(scoreForDistance(1) === 3, 'distance 1 -> 3');
assert(scoreForDistance(2) === 2, 'distance 2 -> 2');
assert(scoreForDistance(3) === 1, 'distance 3 -> 1');
assert(scoreForDistance(4) === 0, 'distance 4 -> 0');
assert(scoreForDistance(9) === 0, 'distance 9 -> 0');

console.log(`\nAll ${passed} checks passed.`);
console.log(
  'CONFIRMED: scoring, caller averaging, bestGuess tracking, rotation, ' +
    'and viewForPlayer privacy filtering all behave correctly.',
);
