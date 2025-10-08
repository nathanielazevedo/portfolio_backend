import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());

// Store rooms with their two users
const rooms = new Map();

app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

wss.on('connection', (ws) => {
  let currentRoom = null;
  let userId = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'join') {
        currentRoom = message.roomId;
        userId = message.userId;

        if (!rooms.has(currentRoom)) {
          rooms.set(currentRoom, new Map());
        }

        rooms.get(currentRoom).set(userId, ws);
        console.log(`User ${userId} joined room ${currentRoom}`);
      }

      if (message.type === 'test-results') {
        // Broadcast test results to the other user in the room
        const room = rooms.get(currentRoom);
        if (room) {
          room.forEach((client, clientUserId) => {
            if (clientUserId !== userId && client.readyState === 1) {
              client.send(JSON.stringify({
                type: 'opponent-results',
                userId,
                passed: message.passed,
                total: message.total
              }));
            }
          });
        }
      }
    } catch (error) {
      console.error('Error:', error);
    }
  });

  ws.on('close', () => {
    if (currentRoom && userId) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.delete(userId);
        if (room.size === 0) {
          rooms.delete(currentRoom);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`);
});