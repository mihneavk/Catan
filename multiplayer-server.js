import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const server = createServer();
const wss = new WebSocketServer({ server });

// roomId -> Map<peerId, ws>
const rooms = new Map();
// roomId -> board seed (authoritative, provided by the host)
const roomSeeds = new Map();

wss.on('connection', (ws) => {
  ws.roomId = null;
  ws.peerId = null;

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'JOIN_ROOM': {
        ws.roomId = msg.roomId;
        ws.peerId = msg.senderId;
        if (!rooms.has(msg.roomId)) rooms.set(msg.roomId, new Map());
        const room = rooms.get(msg.roomId);
        room.set(ws.peerId, ws);

        const peers = Array.from(room.keys()).filter(id => id !== ws.peerId);

        if (typeof msg.seed === 'number') {
          roomSeeds.set(msg.roomId, msg.seed);
        }
        const knownSeed = roomSeeds.get(msg.roomId);

        // Trimite confirmarea cu payload structurat corect pentru network.ts
        ws.send(JSON.stringify({
          type: 'ROOM_JOINED',
          payload: {
            roomId: msg.roomId,
            peers,
            seed: knownSeed,
            senderId: ws.peerId
          }
        }));

        if (knownSeed !== undefined) {
          ws.send(JSON.stringify({
            type: 'BOARD_SEED',
            payload: { seed: knownSeed }
          }));
        }

        if (typeof msg.seed === 'number') {
          room.forEach((client, id) => {
            if (id !== ws.peerId && client.readyState === 1) {
              client.send(JSON.stringify({
                type: 'BOARD_SEED',
                payload: { seed: msg.seed }
              }));
            }
          });
        }

        // Anunță ceilalți jucători din cameră (cu payload.peerId)
        room.forEach((client, id) => {
          if (id !== ws.peerId && client.readyState === 1) {
            client.send(JSON.stringify({
              type: 'PEER_JOINED',
              payload: { peerId: ws.peerId }
            }));
          }
        });
        break;
      }

      case 'GAME_MESSAGE': {
        const room = rooms.get(msg.roomId);
        if (!room) return;
        room.forEach((client, id) => {
          if (id !== msg.senderId && client.readyState === 1) {
            client.send(JSON.stringify(msg));
          }
        });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (ws.roomId && rooms.has(ws.roomId)) {
      const room = rooms.get(ws.roomId);
      room.delete(ws.peerId);
      if (room.size === 0) {
        rooms.delete(ws.roomId);
        roomSeeds.delete(ws.roomId);
      } else {
        room.forEach((client) => {
          if (client.readyState === 1) {
            client.send(JSON.stringify({
              type: 'PEER_LEFT',
              payload: { peerId: ws.peerId }
            }));
          }
        });
      }
    }
  });
});

server.listen(9000, () => {
  console.log('Multiplayer WebSocket server running on ws://localhost:9000');
});