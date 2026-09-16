import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  addPlayer,
  applyAction,
  createRoom,
  viewForPlayer,
  type Action,
  type Room,
} from 'shared';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const MAX_PLAYERS = 8;

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

/** roomCode -> authoritative Room state. */
const rooms = new Map<string, Room>();

/** connectionId -> which room/player this live socket is acting as. */
const connections = new Map<string, { roomCode: string; playerId: string }>();

/** connectionId -> the live socket, for broadcasting. */
const sockets = new Map<string, WebSocket>();

/** roomCode -> (token -> playerId), so a dropped client can REJOIN. */
const roomTokens = new Map<string, Map<string, string>>();

// ---------------------------------------------------------------------------
// Message protocol
// ---------------------------------------------------------------------------

type ClientMessage =
  | { type: 'CREATE_ROOM'; name: string }
  | { type: 'JOIN_ROOM'; code: string; name: string }
  | { type: 'REJOIN_ROOM'; code: string; token: string }
  | { type: 'ACTION'; action: Action };

type ServerMessage =
  | { type: 'JOINED'; code: string; token: string; playerId: string }
  | { type: 'STATE'; view: Room }
  | { type: 'ERROR'; message: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function sendError(socket: WebSocket, message: string): void {
  send(socket, { type: 'ERROR', message });
}

/** Send every connection in a room its own privacy-filtered STATE. */
function broadcastState(roomCode: string): void {
  const room = rooms.get(roomCode);
  if (!room) return;
  for (const [connId, conn] of connections) {
    if (conn.roomCode !== roomCode) continue;
    const socket = sockets.get(connId);
    if (!socket) continue;
    send(socket, { type: 'STATE', view: viewForPlayer(room, conn.playerId) });
  }
}

function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = '';
    for (let i = 0; i < 4; i += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (!rooms.has(code)) return code;
  }
  throw new Error('Unable to allocate a unique room code');
}

function registerToken(roomCode: string, playerId: string): string {
  const token = randomUUID();
  let tokens = roomTokens.get(roomCode);
  if (!tokens) {
    tokens = new Map();
    roomTokens.set(roomCode, tokens);
  }
  tokens.set(token, playerId);
  return token;
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

function handleCreateRoom(
  connId: string,
  socket: WebSocket,
  name: string,
): void {
  const code = generateRoomCode();
  const { room, player } = addPlayer(createRoom(code), name);
  rooms.set(code, room);

  const token = registerToken(code, player.id);
  connections.set(connId, { roomCode: code, playerId: player.id });

  send(socket, { type: 'JOINED', code, token, playerId: player.id });
  broadcastState(code);
}

function handleJoinRoom(
  connId: string,
  socket: WebSocket,
  code: string,
  name: string,
): void {
  const room = rooms.get(code);
  if (!room) {
    sendError(socket, `Room ${code} not found`);
    return;
  }
  if (room.players.length >= MAX_PLAYERS) {
    sendError(socket, 'Room is full');
    return;
  }

  const { room: updated, player } = addPlayer(room, name);
  rooms.set(code, updated);

  const token = registerToken(code, player.id);
  connections.set(connId, { roomCode: code, playerId: player.id });

  send(socket, { type: 'JOINED', code, token, playerId: player.id });
  // Every connection (including this one) receives its own filtered STATE.
  broadcastState(code);
}

function handleRejoinRoom(
  connId: string,
  socket: WebSocket,
  code: string,
  token: string,
): void {
  const room = rooms.get(code);
  if (!room) {
    sendError(socket, `Room ${code} not found`);
    return;
  }

  const playerId = roomTokens.get(code)?.get(token);
  const player = playerId
    ? room.players.find((p) => p.id === playerId)
    : undefined;

  if (!playerId || !player) {
    // Let the client fall back to JOIN_ROOM as a fresh player.
    sendError(socket, 'Invalid session token');
    return;
  }

  const updated = applyAction(room, { type: 'PLAYER_RECONNECTED', playerId });
  rooms.set(code, updated);

  connections.set(connId, { roomCode: code, playerId });

  send(socket, { type: 'STATE', view: viewForPlayer(updated, playerId) });
  // Others should see this player come back online too.
  broadcastState(code);
}

function handleAction(
  connId: string,
  socket: WebSocket,
  action: Action,
): void {
  const conn = connections.get(connId);
  if (!conn) {
    sendError(socket, 'Not in a room');
    return;
  }
  const room = rooms.get(conn.roomCode);
  if (!room) {
    sendError(socket, 'Room no longer exists');
    return;
  }

  rooms.set(conn.roomCode, applyAction(room, action));
  broadcastState(conn.roomCode);
}

function handleClose(connId: string): void {
  const conn = connections.get(connId);
  connections.delete(connId);
  sockets.delete(connId);
  if (!conn) return;

  const room = rooms.get(conn.roomCode);
  if (room) {
    // Keep their slot + any in-progress guess; just flag them offline.
    rooms.set(
      conn.roomCode,
      applyAction(room, {
        type: 'PLAYER_DISCONNECTED',
        playerId: conn.playerId,
      }),
    );
    broadcastState(conn.roomCode);
  }
}

// ---------------------------------------------------------------------------
// Server wiring
// ---------------------------------------------------------------------------

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('Tints and Hints server is running.\n');
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (socket) => {
  const connId = randomUUID();
  sockets.set(connId, socket);

  socket.on('message', (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      sendError(socket, 'Invalid JSON');
      return;
    }

    switch (message.type) {
      case 'CREATE_ROOM':
        handleCreateRoom(connId, socket, message.name);
        break;
      case 'JOIN_ROOM':
        handleJoinRoom(connId, socket, message.code, message.name);
        break;
      case 'REJOIN_ROOM':
        handleRejoinRoom(connId, socket, message.code, message.token);
        break;
      case 'ACTION':
        handleAction(connId, socket, message.action);
        break;
      default:
        sendError(socket, 'Unknown message type');
    }
  });

  socket.on('close', () => handleClose(connId));
});

httpServer.listen(PORT, () => {
  console.log(`Tints and Hints server listening on :${PORT}`);
});
