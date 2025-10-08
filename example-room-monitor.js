// Example: Room Status Monitoring for Entry Screen
// This shows how to monitor room statuses without joining them

class RoomStatusMonitor {
  constructor(serverUrl = 'ws://localhost:3001') {
    this.serverUrl = serverUrl;
    this.ws = null;
    this.watchedRooms = new Set();
    this.onStatusUpdate = null;
  }

  // Connect and start watching rooms
  async connect(roomIds = []) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.serverUrl);
      
      this.ws.onopen = () => {
        console.log('Connected to room status monitor');
        
        if (roomIds.length > 0) {
          this.watchRooms(roomIds);
        }
        
        resolve();
      };
      
      this.ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      };
      
      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      };
      
      this.ws.onclose = () => {
        console.log('Room status monitor disconnected');
        // Auto-reconnect logic could go here
      };
    });
  }

  // Start watching specific rooms
  watchRooms(roomIds) {
    roomIds.forEach(id => this.watchedRooms.add(id));
    
    this.ws.send(JSON.stringify({
      type: 'watch-rooms',
      roomIds: Array.from(this.watchedRooms)
    }));
    
    console.log('Now watching rooms:', Array.from(this.watchedRooms));
  }

  // Stop watching rooms
  stopWatching() {
    this.ws.send(JSON.stringify({
      type: 'unwatch-rooms'
    }));
    
    this.watchedRooms.clear();
    console.log('Stopped watching all rooms');
  }

  // Handle incoming messages
  handleMessage(message) {
    switch (message.type) {
      case 'room-statuses':
        // Initial status for all watched rooms
        console.log('Initial room statuses:', message.rooms);
        if (this.onStatusUpdate) {
          this.onStatusUpdate(message.rooms);
        }
        break;
        
      case 'room-status-update':
        // Real-time status update for a specific room
        console.log(`Room ${message.roomId} status update:`, {
          status: message.status,
          canJoin: message.canJoin,
          isActive: message.isActive,
          connectedPlayers: message.connectedPlayers,
          change: message.change
        });
        
        if (this.onStatusUpdate) {
          this.onStatusUpdate({
            [message.roomId]: {
              status: message.status,
              canJoin: message.canJoin,
              isActive: message.isActive,
              isWaiting: message.isWaiting,
              isCompleted: message.isCompleted,
              connectedPlayers: message.connectedPlayers,
              participantCount: message.participantCount,
              startedAt: message.startedAt,
              change: message.change
            }
          });
        }
        break;
        
      case 'unwatched':
        console.log(message.message);
        break;
        
      case 'error':
        console.error('Room monitor error:', message.message);
        break;
        
      default:
        console.log('Unknown message type:', message.type);
    }
  }

  // Set callback for status updates
  onRoomStatusUpdate(callback) {
    this.onStatusUpdate = callback;
  }

  // Disconnect
  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// Example usage for entry screen
async function exampleUsage() {
  const monitor = new RoomStatusMonitor();
  
  // Set up callback to update UI
  monitor.onRoomStatusUpdate((roomStatuses) => {
    Object.entries(roomStatuses).forEach(([roomId, status]) => {
      updateRoomUI(roomId, status);
    });
  });
  
  // Connect and start watching specific rooms
  await monitor.connect(['coding-battle-1', 'coding-battle-2', 'coding-battle-3']);
  
  // You can add more rooms to watch later
  // monitor.watchRooms(['coding-battle-4']);
  
  // Stop watching when user leaves entry screen
  // monitor.stopWatching();
  // monitor.disconnect();
}

// Mock UI update function
function updateRoomUI(roomId, status) {
  console.log(`Updating UI for room ${roomId}:`, {
    status: status.status,
    canJoin: status.canJoin,
    playerCount: status.connectedPlayers,
    battleStatus: status.isActive ? 'Battle in Progress' : 
                  status.isWaiting ? 'Waiting for Admin to Start' :
                  status.isCompleted ? 'Battle Completed' : 'No Battle'
  });
  
  // Here you would update your actual UI elements
  // Example:
  // const roomElement = document.getElementById(`room-${roomId}`);
  // roomElement.querySelector('.status').textContent = status.status;
  // roomElement.querySelector('.player-count').textContent = status.connectedPlayers;
  // roomElement.querySelector('.join-button').disabled = !status.canJoin;
}

// Alternative: Using REST API for one-time status checks
async function checkRoomStatusREST(roomIds) {
  try {
    const response = await fetch(`http://localhost:3001/rooms/status?roomIds=${roomIds.join(',')}`);
    const data = await response.json();
    
    console.log('Room statuses via REST:', data.rooms);
    return data.rooms;
  } catch (error) {
    console.error('Error fetching room statuses:', error);
    return {};
  }
}

// Example: Check single room status
async function checkSingleRoomStatus(roomId) {
  try {
    const response = await fetch(`http://localhost:3001/room/${roomId}/battle`);
    const data = await response.json();
    
    console.log(`Room ${roomId} status:`, data.battle);
    return data.battle;
  } catch (error) {
    console.error('Error fetching room status:', error);
    return null;
  }
}

export { RoomStatusMonitor, checkRoomStatusREST, checkSingleRoomStatus };