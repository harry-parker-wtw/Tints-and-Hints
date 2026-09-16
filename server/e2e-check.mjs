// Temporary end-to-end acceptance test for the WebSocket server.
import { WebSocket } from 'ws';

const URL = 'ws://localhost:8799';

function open() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function nextMsg(ws, predicate) {
  return new Promise((resolve) => {
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (!predicate || predicate(msg)) {
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

function collect(ws, bucket) {
  ws.on('message', (raw) => bucket.push(JSON.parse(raw.toString())));
}

function assert(cond, msg) {
  if (!cond) throw new Error('FAILED: ' + msg);
  console.log('  ok -', msg);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // --- Creator ---
  const c1 = await open();
  c1.send(JSON.stringify({ type: 'CREATE_ROOM', name: 'Alice' }));
  const joined1 = await nextMsg(c1, (m) => m.type === 'JOINED');
  assert(/^[A-Z]{4}$/.test(joined1.code), '4-letter room code generated');
  const code = joined1.code;
  const aliceToken = joined1.token;
  const aliceId = joined1.playerId;
  const state1 = await nextMsg(c1, (m) => m.type === 'STATE');
  assert(state1.view.players.length === 1, 'creator is first player');

  // --- Joiner ---
  const c2 = await open();
  c2.send(JSON.stringify({ type: 'JOIN_ROOM', code, name: 'Bob' }));
  const joined2 = await nextMsg(c2, (m) => m.type === 'JOINED');
  const bobToken = joined2.token;
  const bobId = joined2.playerId;
  assert(bobId !== aliceId, 'second player has distinct id');

  // Both sockets should now see 2 players.
  const c1State2 = await nextMsg(c1, (m) => m.type === 'STATE');
  const c2State2 = await nextMsg(c2, (m) => m.type === 'STATE');
  assert(c1State2.view.players.length === 2, 'creator sees 2 players after join');
  assert(c2State2.view.players.length === 2, 'joiner sees 2 players after join');

  // --- ACTION broadcast to all ---
  c1.send(JSON.stringify({ type: 'ACTION', action: { type: 'START_GAME' } }));
  const c1Start = await nextMsg(c1, (m) => m.type === 'STATE');
  const c2Start = await nextMsg(c2, (m) => m.type === 'STATE');
  assert(c1Start.view.phase === 'caller-picking', 'creator got STATE after action');
  assert(c2Start.view.phase === 'caller-picking', 'joiner got STATE after action');

  // Privacy: caller sees target, guesser does not.
  const callerId = c1Start.view.rounds[0].callerId;
  const callerState = callerId === aliceId ? c1Start : c2Start;
  const guesserState = callerId === aliceId ? c2Start : c1Start;
  assert(callerState.view.rounds[0].targetIndex >= 0, 'caller sees target');
  assert(guesserState.view.rounds[0].targetIndex === -1, 'guesser target hidden');

  // --- Disconnect Bob, others see him offline ---
  const dropPromise = nextMsg(c1, (m) => m.type === 'STATE');
  c2.close();
  const c1AfterDrop = await dropPromise;
  const bobInList = c1AfterDrop.view.players.find((p) => p.id === bobId);
  assert(c1AfterDrop.view.players.length === 2, 'dropped player NOT removed');
  assert(bobInList.connected === false, 'dropped player marked offline');

  // --- Rejoin Bob with same token, no duplicate ---
  const c3 = await open();
  c3.send(JSON.stringify({ type: 'REJOIN_ROOM', code, token: bobToken }));
  const rejoinState = await nextMsg(c3, (m) => m.type === 'STATE');
  assert(rejoinState.view.players.length === 2, 'rejoin does not duplicate player');
  const bobAfter = rejoinState.view.players.find((p) => p.id === bobId);
  assert(bobAfter && bobAfter.connected === true, 'rejoined as same player, online');

  // --- Bad token rejoin -> ERROR ---
  const c4 = await open();
  c4.send(JSON.stringify({ type: 'REJOIN_ROOM', code, token: 'bogus' }));
  const err = await nextMsg(c4, (m) => m.type === 'ERROR');
  assert(err.type === 'ERROR', 'bad token yields ERROR for JOIN fallback');

  // --- Join full room -> ERROR ---
  // (2 players present; not full, so instead test unknown room.)
  const c5 = await open();
  c5.send(JSON.stringify({ type: 'JOIN_ROOM', code: 'ZZZZ', name: 'Nobody' }));
  const err2 = await nextMsg(c5, (m) => m.type === 'ERROR');
  assert(/not found/.test(err2.message), 'joining unknown room errors');

  console.log('\nALL SERVER ACCEPTANCE CHECKS PASSED');
  [c1, c3, c4, c5].forEach((w) => w.close());
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
