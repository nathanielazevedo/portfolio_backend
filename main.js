import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());

// Store rooms with their users and player data
const rooms = new Map();
// Store player data: { userId: { ws, testsPassed, totalTests, joinedAt } }
const playerData = new Map();

app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

// GET endpoint to retrieve all players in a room
app.get('/room/:roomId/players', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  
  if (!room) {
    return res.json({ players: [] });
  }
  
  const players = [];
  room.forEach((ws, userId) => {
    const data = playerData.get(userId);
    players.push({
      userId,
      testsPassed: data?.testsPassed || 0,
      totalTests: data?.totalTests || 0,
      joinedAt: data?.joinedAt || new Date().toISOString(),
      isConnected: ws.readyState === 1
    });
  });
  
  res.json({ players });
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
        
        // Initialize or update player data
        if (!playerData.has(userId)) {
          playerData.set(userId, {
            ws,
            testsPassed: 0,
            totalTests: 0,
            joinedAt: new Date().toISOString()
          });
        } else {
          // Update WebSocket connection for existing player
          const existing = playerData.get(userId);
          existing.ws = ws;
        }
        
        console.log(`User ${userId} joined room ${currentRoom}`);
        
        // Broadcast updated player list to all users in the room
        broadcastPlayerList(currentRoom);
      }

      if (message.type === 'test-results') {
        // Update player's test results
        const data = playerData.get(userId);
        if (data) {
          data.testsPassed = message.passed;
          data.totalTests = message.total;
        }
        
        // Broadcast test results to all users in the room
        const room = rooms.get(currentRoom);
        if (room) {
          room.forEach((client, clientUserId) => {
            if (client.readyState === 1) {
              client.send(JSON.stringify({
                type: 'test-results-update',
                userId,
                passed: message.passed,
                total: message.total
              }));
            }
          });
        }
        
        // Also broadcast updated player list
        broadcastPlayerList(currentRoom);
      }
      
      if (message.type === 'get-players') {
        // Send current player list to requesting user
        const players = getRoomPlayers(currentRoom);
        ws.send(JSON.stringify({
          type: 'players-list',
          players
        }));
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
          // Clean up player data for this room's players
          // Note: We keep player data even after disconnect for persistence
        } else {
          // Broadcast updated player list when someone leaves
          broadcastPlayerList(currentRoom);
        }
      }
    }
  });
});

// Helper function to get all players in a room
function getRoomPlayers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  
  const players = [];
  room.forEach((ws, userId) => {
    const data = playerData.get(userId);
    players.push({
      userId,
      testsPassed: data?.testsPassed || 0,
      totalTests: data?.totalTests || 0,
      joinedAt: data?.joinedAt || new Date().toISOString(),
      isConnected: ws.readyState === 1
    });
  });
  
  return players;
}

// Helper function to broadcast player list to all users in a room
function broadcastPlayerList(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  const players = getRoomPlayers(roomId);
  const message = JSON.stringify({
    type: 'players-list',
    players
  });
  
  room.forEach((ws) => {
    if (ws.readyState === 1) {
      ws.send(message);
    }
  });
}

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`);
});