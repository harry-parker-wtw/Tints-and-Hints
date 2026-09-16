import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { SHARED_PACKAGE_READY } from 'shared';

// Placeholder server — Prompt 3 replaces this with the real room
// manager (create/join/rejoin, the game action protocol, and
// broadcasting privacy-filtered state to each connection).

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('Tints and Hints server is running.\n');
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (socket) => {
  console.log('client connected, shared package ready:', SHARED_PACKAGE_READY);

  socket.send(
    JSON.stringify({
      type: 'connected',
      message: 'Connected to the Tints and Hints server.',
    })
  );

  socket.on('message', (raw) => {
    // Placeholder echo, until Prompt 3's real message protocol
    // (CREATE_ROOM / JOIN_ROOM / REJOIN_ROOM / ACTION) replaces this.
    socket.send(raw.toString());
  });

  socket.on('close', () => {
    console.log('client disconnected');
  });
});

httpServer.listen(PORT, () => {
  console.log(`Tints and Hints server listening on :${PORT}`);
});
