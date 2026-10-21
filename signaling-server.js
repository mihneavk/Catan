import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const server = createServer();
const wss = new WebSocketServer({ server });

// roomId -> Set<WebSocket>
const rooms = new Map();
// roomId -> { sdp, hostId }
const pendingOffers = new Map();

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
      case 'offer': {
        ws.roomId = msg.roomId;
        ws.peerId = msg.senderId;
        if (!rooms.has(msg.roomId)) rooms.set(msg.roomId, new Set());
        rooms.get(msg.roomId).add(ws);
        pendingOffers.set(msg.roomId, { sdp: msg.sdp, hostId: msg.senderId });

        // Trimite ofertă tuturor celorlalți în camera (ar trebui să fie doar un singur client)
        rooms.get(msg.roomId).forEach((client) => {
          if (client !== ws && client.readyState === 1) {
            client.send(JSON.stringify({
              type: 'offer',
              sdp: msg.sdp,
              senderId: msg.senderId
            }));
          }
        });
        break;
      }

      case 'join': {
        ws.roomId = msg.roomId;
        ws.peerId = msg.senderId;
        if (!rooms.has(msg.roomId)) rooms.set(msg.roomId, new Set());
        rooms.get(msg.roomId).add(ws);

        // Trimite ofertă pendentă către jucătorul care se alătură
        const pending = pendingOffers.get(msg.roomId);
        if (pending) {
          ws.send(JSON.stringify({
            type: 'offer',
            sdp: pending.sdp,
            senderId: pending.hostId
          }));
        }
        break;
      }

      case 'answer': {
        rooms.get(msg.roomId)?.forEach((client) => {
          if (client.peerId !== ws.peerId && client.readyState === 1) {
            client.send(JSON.stringify({
              type: 'answer',
              sdp: msg.sdp,
              senderId: msg.senderId
            }));
          }
        });
        break;
      }

      case 'ice-candidate': {
        rooms.get(msg.roomId)?.forEach((client) => {
          if (client.peerId !== ws.peerId && client.readyState === 1) {
            client.send(JSON.stringify({
              type: 'ice-candidate',
              candidate: msg.candidate,
              senderId: msg.senderId
            }));
          }
        });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (ws.roomId) {
      rooms.get(ws.roomId)?.delete(ws);
      if (rooms.get(ws.roomId)?.size === 0) {
        rooms.delete(ws.roomId);
        pendingOffers.delete(ws.roomId);
      }
    }
  });
});

server.listen(9000, () => {
  console.log('Signaling server running on ws://localhost:9000');
});
