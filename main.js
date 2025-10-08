import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import dotenv from 'dotenv';
import { BattleService } from './database.js';

dotenv.config();

// Enhanced logging function
const log = {
  info: (message, data = null) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] INFO: ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  error: (message, error = null) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ERROR: ${message}`, error || '');
  },
  warn: (message, data = null) => {
    const timestamp = new Date().toISOString();
    console.warn(`[${timestamp}] WARN: ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  debug: (message, data = null) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] DEBUG: ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }
};

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

log.info('Server initialization started');
log.info('Environment variables loaded', {
  PORT: process.env.PORT,
  SUPABASE_URL: process.env.SUPABASE_URL ? 'SET' : 'NOT SET',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'NOT SET',
  ADMIN_USER_ID: process.env.ADMIN_USER_ID ? 'SET' : 'NOT SET'
});

app.use(cors());
log.info('CORS middleware enabled');

// Store rooms with their users and player data
const rooms = new Map();
// Store player data: { userId: { ws, testsPassed, totalTests, joinedAt } }
const playerData = new Map();
// Store global status watchers (users monitoring room statuses without joining)
const statusWatchers = new Map(); // Map<connectionId, { ws, watchedRooms: Set<roomId> }>

app.get('/', (req, res) => {
  log.info('Health check endpoint accessed');
  res.json({ status: 'ok' });
});

// GET endpoint to retrieve all players in a room
app.get('/room/:roomId/players', (req, res) => {
  const { roomId } = req.params;
  log.info(`Getting players for room: ${roomId}`);
  
  const room = rooms.get(roomId);
  
  if (!room) {
    log.warn(`No room found for roomId: ${roomId}`);
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
  
  log.info(`Found ${players.length} players in room ${roomId}`, { players });
  res.json({ players });
});

// GET endpoint to retrieve user's battle history
app.get('/user/:userId/battles', async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    
    log.info(`Fetching battle history for user: ${userId} (limit: ${limit})`);
    
    const battles = await BattleService.getUserBattleHistory(userId, limit);
    log.info(`Found ${battles.length} battles for user ${userId}`);
    
    res.json({ battles });
  } catch (error) {
    log.error('Error fetching user battles:', error);
    res.status(500).json({ error: 'Failed to fetch battle history' });
  }
});

// GET endpoint to retrieve user's battle statistics
app.get('/user/:userId/stats', async (req, res) => {
  try {
    const { userId } = req.params;
    log.info(`Fetching stats for user: ${userId}`);
    
    const stats = await BattleService.getUserStats(userId);
    log.info(`Stats retrieved for user ${userId}`, { stats });
    
    res.json({ stats });
  } catch (error) {
    log.error('Error fetching user stats:', error);
    res.status(500).json({ error: 'Failed to fetch user statistics' });
  }
});

// GET endpoint to retrieve current battle status for a room
app.get('/room/:roomId/battle', async (req, res) => {
  try {
    const { roomId } = req.params;
    log.info(`Fetching battle status for room: ${roomId}`);
    
    const battle = await BattleService.getBattle(roomId);
    
    if (!battle) {
      log.warn(`No battle found for room: ${roomId}`);
      return res.json({ 
        battle: null, 
        message: 'No battle found for this room',
        canJoin: true,
        status: 'no-battle'
      });
    }
    
    const room = rooms.get(roomId);
    const connectedPlayers = room ? room.size : 0;
    
    const battleInfo = {
      id: battle.id,
      status: battle.status,
      startedAt: battle.started_at,
      createdAt: battle.created_at,
      adminUserId: battle.admin_user_id,
      participantCount: battle.participants?.length || 0,
      connectedPlayers: connectedPlayers,
      canJoin: battle.status === 'waiting' || battle.status === 'active',
      isActive: battle.status === 'active',
      isWaiting: battle.status === 'waiting',
      isCompleted: battle.status === 'completed'
    };
    
    log.info(`Battle status retrieved for room ${roomId}`, { battleInfo });
    
    res.json({ battle: battleInfo });
  } catch (error) {
    log.error('Error fetching battle status:', error);
    res.status(500).json({ error: 'Failed to fetch battle status' });
  }
});

// GET endpoint to get status of multiple rooms at once
app.get('/rooms/status', async (req, res) => {
  try {
    const { roomIds } = req.query; // Expect comma-separated room IDs
    
    if (!roomIds) {
      return res.status(400).json({ error: 'roomIds query parameter is required' });
    }
    
    const roomIdArray = roomIds.split(',').map(id => id.trim());
    log.info(`Fetching status for multiple rooms:`, { roomIds: roomIdArray });
    
    const roomStatuses = {};
    
    for (const roomId of roomIdArray) {
      try {
        const battle = await BattleService.getBattle(roomId);
        const room = rooms.get(roomId);
        const connectedPlayers = room ? room.size : 0;
        
        if (!battle) {
          roomStatuses[roomId] = {
            status: 'no-battle',
            canJoin: true,
            connectedPlayers: connectedPlayers
          };
        } else {
          roomStatuses[roomId] = {
            status: battle.status,
            canJoin: battle.status === 'waiting' || battle.status === 'active',
            isActive: battle.status === 'active',
            isWaiting: battle.status === 'waiting',
            isCompleted: battle.status === 'completed',
            connectedPlayers: connectedPlayers,
            participantCount: battle.participants?.length || 0,
            startedAt: battle.started_at
          };
        }
      } catch (error) {
        log.error(`Error fetching status for room ${roomId}:`, error);
        roomStatuses[roomId] = {
          status: 'error',
          canJoin: false,
          error: 'Failed to fetch room status'
        };
      }
    }
    
    log.info(`Room statuses retrieved:`, { roomStatuses });
    res.json({ rooms: roomStatuses });
  } catch (error) {
    log.error('Error fetching room statuses:', error);
    res.status(500).json({ error: 'Failed to fetch room statuses' });
  }
});

wss.on('connection', (ws) => {
  let currentRoom = null;
  let userId = null;
  const connectionId = Math.random().toString(36).substring(7);
  
  log.info(`New WebSocket connection established`, { connectionId });

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      log.debug(`Received message from ${userId || connectionId}`, {
        type: message.type,
        roomId: message.roomId || currentRoom,
        userId: message.userId || userId,
        messageData: message
      });

      if (message.type === 'join') {
        currentRoom = message.roomId;
        userId = message.userId;

        log.info(`User attempting to join room`, {
          userId,
          roomId: currentRoom,
          connectionId
        });

        if (!rooms.has(currentRoom)) {
          rooms.set(currentRoom, new Map());
          log.info(`Created new room: ${currentRoom}`);
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
          log.info(`New player data created for user: ${userId}`);
        } else {
          // Update WebSocket connection for existing player
          const existing = playerData.get(userId);
          existing.ws = ws;
          log.info(`Updated WebSocket connection for existing user: ${userId}`);
        }
        
        log.info(`User ${userId} successfully joined room ${currentRoom}`);
        
        // Create or get battle for this room
        try {
          log.info(`Managing battle for room: ${currentRoom}`);
          let battle = await BattleService.getBattle(currentRoom);
          
          if (!battle) {
            // Create new battle in waiting state when first user joins
            // Admin is the first user to join or specified admin
            const adminUserId = process.env.ADMIN_USER_ID || userId;
            log.info(`Creating new battle for room ${currentRoom}`, {
              adminUserId,
              isDefaultAdmin: !process.env.ADMIN_USER_ID
            });
            
            battle = await BattleService.createBattle(currentRoom, adminUserId, [{ userId, joinedAt: new Date().toISOString() }]);
            log.info(`Battle created successfully`, {
              battleId: battle.id,
              status: battle.status,
              adminUserId: battle.admin_user_id
            });
          } else {
            // Add participant to existing battle
            log.info(`Adding participant to existing battle`, {
              battleId: battle.id,
              userId,
              currentStatus: battle.status
            });
            await BattleService.addParticipantToBattle(currentRoom, userId);
          }
          
          // Send battle status to the joining user
          const battleStatus = {
            type: 'battle-status',
            status: battle.status,
            isAdmin: battle.admin_user_id === userId,
            battleId: battle.id
          };
          
          log.info(`Sending battle status to user ${userId}`, { battleStatus });
          ws.send(JSON.stringify(battleStatus));
        } catch (error) {
          log.error('Error managing battle:', error);
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to manage battle'
          }));
        }
        
        // Broadcast updated player list to all users in the room
        broadcastPlayerList(currentRoom);
        
        // Broadcast room status change to watchers (new player joined)
        broadcastRoomStatus(currentRoom, 'player-joined').catch(err => 
          log.error('Error broadcasting room status on player join:', err)
        );
      }

      if (message.type === 'start-battle') {
        log.info(`User ${userId} attempting to start battle in room ${currentRoom}`);
        
        // Only admin can start the battle
        try {
          const isAdmin = await BattleService.isAdminForBattle(currentRoom, userId);
          log.info(`Admin check result for user ${userId}:`, { isAdmin });
          
          if (!isAdmin) {
            log.warn(`Unauthorized start-battle attempt by user ${userId}`);
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Only the admin can start the battle'
            }));
            return;
          }

          const battle = await BattleService.startBattle(currentRoom, userId);
          if (battle) {
            log.info(`Battle started successfully`, {
              battleId: battle.id,
              roomId: currentRoom,
              adminUserId: userId,
              startedAt: battle.started_at
            });
            
            // Broadcast battle started to all users in the room
            const room = rooms.get(currentRoom);
            if (room) {
              const broadcastMessage = {
                type: 'battle-started',
                battleId: battle.id,
                startedAt: battle.started_at
              };
              
              room.forEach((client, clientUserId) => {
                if (client.readyState === 1) {
                  client.send(JSON.stringify(broadcastMessage));
                  log.debug(`Battle start notification sent to user: ${clientUserId}`);
                }
              });
            }
            log.info(`Battle started for room ${currentRoom} by admin ${userId}`);
            
            // Broadcast status change to watchers
            await broadcastRoomStatus(currentRoom, 'battle-started');
          } else {
            log.warn(`Failed to start battle - no battle returned from service`);
          }
        } catch (error) {
          log.error('Error starting battle:', error);
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to start battle'
          }));
        }
      }

      if (message.type === 'test-results') {
        log.info(`Test results received from user ${userId}`, {
          passed: message.passed,
          total: message.total,
          roomId: currentRoom
        });
        
        // Only allow test results if battle is active
        try {
          const battle = await BattleService.getActiveBattle(currentRoom);
          if (!battle) {
            log.warn(`Test results rejected - no active battle in room ${currentRoom}`);
            ws.send(JSON.stringify({
              type: 'error',
              message: 'No active battle. Wait for admin to start the battle.'
            }));
            return;
          }

          log.info(`Active battle found, updating test results`, {
            battleId: battle.id,
            userId,
            passed: message.passed,
            total: message.total
          });

          // Update player's test results
          const data = playerData.get(userId);
          if (data) {
            data.testsPassed = message.passed;
            data.totalTests = message.total;
            log.debug(`Updated local player data for ${userId}`, { data });
          }
          
          // Update battle participant data
          await BattleService.updateBattleParticipant(currentRoom, userId, message.passed, message.total);
          log.info(`Battle participant data updated in database`);
          
          // Broadcast test results to all users in the room
          const room = rooms.get(currentRoom);
          if (room) {
            const broadcastMessage = {
              type: 'test-results-update',
              userId,
              passed: message.passed,
              total: message.total
            };
            
            room.forEach((client, clientUserId) => {
              if (client.readyState === 1) {
                client.send(JSON.stringify(broadcastMessage));
                log.debug(`Test results broadcast sent to user: ${clientUserId}`);
              }
            });
            log.info(`Test results broadcasted to ${room.size} users in room ${currentRoom}`);
          }
          
          // Also broadcast updated player list
          broadcastPlayerList(currentRoom);
        } catch (error) {
          log.error('Error updating test results:', error);
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to update test results'
          }));
        }
      }
      
      if (message.type === 'get-players') {
        log.info(`Player list requested by user ${userId} for room ${currentRoom}`);
        
        // Send current player list to requesting user
        const players = getRoomPlayers(currentRoom);
        const response = {
          type: 'players-list',
          players
        };
        
        log.info(`Sending player list to user ${userId}`, { 
          playerCount: players.length,
          players 
        });
        
        ws.send(JSON.stringify(response));
      }

      if (message.type === 'watch-rooms') {
        // Allow users to monitor room statuses without joining
        const watchedRooms = new Set(message.roomIds || []);
        statusWatchers.set(connectionId, { ws, watchedRooms });
        
        log.info(`User ${userId || connectionId} started watching rooms`, { 
          watchedRooms: Array.from(watchedRooms) 
        });
        
        // Send initial status for watched rooms
        const roomStatuses = {};
        for (const roomId of watchedRooms) {
          try {
            const battle = await BattleService.getBattle(roomId);
            const room = rooms.get(roomId);
            const connectedPlayers = room ? room.size : 0;
            
            if (!battle) {
              roomStatuses[roomId] = {
                status: 'no-battle',
                canJoin: true,
                connectedPlayers: connectedPlayers
              };
            } else {
              roomStatuses[roomId] = {
                status: battle.status,
                canJoin: battle.status === 'waiting' || battle.status === 'active',
                isActive: battle.status === 'active',
                isWaiting: battle.status === 'waiting',
                isCompleted: battle.status === 'completed',
                connectedPlayers: connectedPlayers,
                participantCount: battle.participants?.length || 0,
                startedAt: battle.started_at
              };
            }
          } catch (error) {
            log.error(`Error fetching initial status for room ${roomId}:`, error);
            roomStatuses[roomId] = { status: 'error', canJoin: false };
          }
        }
        
        ws.send(JSON.stringify({
          type: 'room-statuses',
          rooms: roomStatuses
        }));
      }

      if (message.type === 'unwatch-rooms') {
        // Stop watching room statuses
        statusWatchers.delete(connectionId);
        log.info(`User ${userId || connectionId} stopped watching rooms`);
        
        ws.send(JSON.stringify({
          type: 'unwatched',
          message: 'No longer watching room statuses'
        }));
      }
      
      if (message.type === 'complete-battle') {
        // Only admin can complete the battle
        try {
          const isAdmin = await BattleService.isAdminForBattle(currentRoom, userId);
          if (!isAdmin) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Only the admin can complete the battle'
            }));
            return;
          }

          const room = rooms.get(currentRoom);
          if (room) {
            const finalResults = [];
            
            // Collect all player results
            room.forEach((client, clientUserId) => {
              const data = playerData.get(clientUserId);
              if (data) {
                finalResults.push({
                  userId: clientUserId,
                  testsPassed: data.testsPassed,
                  totalTests: data.totalTests,
                  completionTime: message.completionTime || null
                });
              }
            });
            
            // Sort by tests passed (descending) to determine placement
            finalResults.sort((a, b) => {
              if (b.testsPassed !== a.testsPassed) {
                return b.testsPassed - a.testsPassed;
              }
              // If same tests passed, sort by completion time (ascending)
              if (a.completionTime && b.completionTime) {
                return a.completionTime - b.completionTime;
              }
              return 0;
            });
            
            // Complete the battle in database
            const completedBattle = await BattleService.completeBattle(currentRoom, finalResults);
            
            // Broadcast final results to all users
            room.forEach((client) => {
              if (client.readyState === 1) {
                client.send(JSON.stringify({
                  type: 'battle-completed',
                  battleId: completedBattle.id,
                  results: finalResults.map((result, index) => ({
                    ...result,
                    placement: index + 1
                  }))
                }));
              }
            });
            
            log.info(`Battle completed for room ${currentRoom} by admin ${userId}`);
            
            // Broadcast status change to watchers
            await broadcastRoomStatus(currentRoom, 'battle-completed');
          }
        } catch (error) {
          log.error('Error completing battle:', error);
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to complete battle'
          }));
        }
      }
    } catch (error) {
      log.error(`Error processing WebSocket message from ${userId || connectionId}:`, error);
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid message format or processing error'
        }));
      }
    }
  });

  ws.on('close', () => {
    log.info(`WebSocket connection closed`, {
      userId: userId || 'unknown',
      connectionId,
      roomId: currentRoom || 'none'
    });
    
    if (currentRoom && userId) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.delete(userId);
        log.info(`User ${userId} removed from room ${currentRoom}`);
        
        if (room.size === 0) {
          rooms.delete(currentRoom);
          log.info(`Room ${currentRoom} deleted - no remaining users`);
          // Clean up player data for this room's players
          // Note: We keep player data even after disconnect for persistence
        } else {
          log.info(`Room ${currentRoom} still has ${room.size} users remaining`);
          // Broadcast updated player list when someone leaves
          broadcastPlayerList(currentRoom);
          // Broadcast room status change to watchers (player left)
          broadcastRoomStatus(currentRoom, 'player-left').catch(err => 
            log.error('Error broadcasting room status on player leave:', err)
          );
        }
      }
    }
    
    // Clean up status watchers
    statusWatchers.delete(connectionId);
  });

  ws.on('error', (error) => {
    log.error(`WebSocket error for connection ${connectionId}:`, error);
  });
});

// Helper function to get all players in a room
function getRoomPlayers(roomId) {
  log.debug(`Getting players for room: ${roomId}`);
  
  const room = rooms.get(roomId);
  if (!room) {
    log.debug(`No room found for roomId: ${roomId}`);
    return [];
  }
  
  const players = [];
  room.forEach((ws, userId) => {
    const data = playerData.get(userId);
    const player = {
      userId,
      testsPassed: data?.testsPassed || 0,
      totalTests: data?.totalTests || 0,
      joinedAt: data?.joinedAt || new Date().toISOString(),
      isConnected: ws.readyState === 1
    };
    players.push(player);
    log.debug(`Player data for ${userId}`, { player });
  });
  
  log.debug(`Found ${players.length} players in room ${roomId}`);
  return players;
}

// Helper function to broadcast player list to all users in a room
function broadcastPlayerList(roomId) {
  log.debug(`Broadcasting player list for room: ${roomId}`);
  
  const room = rooms.get(roomId);
  if (!room) {
    log.debug(`No room found for broadcast: ${roomId}`);
    return;
  }
  
  const players = getRoomPlayers(roomId);
  const message = JSON.stringify({
    type: 'players-list',
    players
  });
  
  let sentCount = 0;
  room.forEach((ws, userId) => {
    if (ws.readyState === 1) {
      ws.send(message);
      sentCount++;
      log.debug(`Player list sent to user: ${userId}`);
    } else {
      log.debug(`Skipped sending to user ${userId} - connection not ready (state: ${ws.readyState})`);
    }
  });
  
  log.info(`Player list broadcast completed for room ${roomId}`, {
    totalUsers: room.size,
    sentTo: sentCount,
    playerCount: players.length
  });
}

// Helper function to broadcast room status changes to watchers
async function broadcastRoomStatus(roomId, statusChange = null) {
  log.debug(`Broadcasting room status for room: ${roomId}`, { statusChange });
  
  try {
    // Get current battle status
    const battle = await BattleService.getBattle(roomId);
    const room = rooms.get(roomId);
    const connectedPlayers = room ? room.size : 0;
    
    let roomStatus;
    if (!battle) {
      roomStatus = {
        status: 'no-battle',
        canJoin: true,
        connectedPlayers: connectedPlayers
      };
    } else {
      roomStatus = {
        status: battle.status,
        canJoin: battle.status === 'waiting' || battle.status === 'active',
        isActive: battle.status === 'active',
        isWaiting: battle.status === 'waiting',
        isCompleted: battle.status === 'completed',
        connectedPlayers: connectedPlayers,
        participantCount: battle.participants?.length || 0,
        startedAt: battle.started_at
      };
    }
    
    // Add change information if provided
    if (statusChange) {
      roomStatus.change = statusChange;
    }
    
    const message = JSON.stringify({
      type: 'room-status-update',
      roomId: roomId,
      ...roomStatus
    });
    
    // Send to all watchers monitoring this room
    let sentCount = 0;
    statusWatchers.forEach((watcher, connectionId) => {
      if (watcher.watchedRooms.has(roomId) && watcher.ws.readyState === 1) {
        watcher.ws.send(message);
        sentCount++;
        log.debug(`Room status sent to watcher: ${connectionId}`);
      }
    });
    
    log.info(`Room status broadcast completed for room ${roomId}`, {
      sentToWatchers: sentCount,
      roomStatus
    });
    
  } catch (error) {
    log.error(`Error broadcasting room status for ${roomId}:`, error);
  }
}

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  log.info(`WebSocket server started successfully on port ${PORT}`);
  log.info('Server ready to accept connections');
  log.info('Available endpoints:', {
    healthCheck: `http://localhost:${PORT}/`,
    roomPlayers: `http://localhost:${PORT}/room/:roomId/players`,
    roomBattle: `http://localhost:${PORT}/room/:roomId/battle`,
    userBattles: `http://localhost:${PORT}/user/:userId/battles`,
    userStats: `http://localhost:${PORT}/user/:userId/stats`
  });
});