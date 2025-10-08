# Portfolio Backend - Battle Tracking System

A WebSocket server for real-time coding battles with integrated Supabase database tracking.

## Features

- Real-time WebSocket communication for coding battles
- Player management and test result tracking
- Battle history and statistics storage in Supabase
- RESTful API endpoints for battle data
- MongoDB user authentication integration

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Configuration

Create a `.env` file in the root directory:

```env
# Supabase Configuration
SUPABASE_URL=your_supabase_url_here
SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here

# Server Configuration
PORT=3001

# Admin Configuration
ADMIN_USER_ID=your_mongodb_user_id_here
```

### 3. Database Setup

1. **Get your database password from Supabase:**
   - Go to your Supabase Dashboard
   - Navigate to Settings > Database
   - Copy your database password
   - Update the `DATABASE_URL` in your `.env` file with the actual password

2. **Run migrations:**
   ```bash
   # Check migration status
   npm run migrate:status
   
   # Run pending migrations
   npm run migrate:up
   ```

3. **Verify setup:**
   - Check your Supabase Table Editor
   - You should see `battles`, `battle_participations`, and `pgmigrations` tables

### 4. Start the Server

```bash
# Development (with auto-restart)
npm run dev

# Production
npm start
```

## Database Migrations

This project uses `node-pg-migrate` for database migrations, similar to Django's migration system.

### Migration Commands

```bash
# Create a new migration
npm run migrate:create migration-name

# Check migration status
npm run migrate:status

# Run pending migrations
npm run migrate:up

# Rollback last migration
npm run migrate:down

# Rollback specific number of migrations
npm run migrate:down 2
```

### Creating Migrations

```bash
# Example: Add a new column
npm run migrate:create add-user-email-column
```

This creates a new migration file in the `migrations/` directory that you can edit.

## Database Schema

### Tables

#### `battles`
- Tracks individual coding battles
- Stores room information, status, and participant data
- Links to battle participations for detailed results

#### `battle_participations`
- Records individual user performance in battles
- Tracks placement, test results, and completion times
- Links user IDs (from MongoDB) to battle results

#### `battle_stats` (View)
- Provides aggregated statistics per user
- Calculates wins, average placement, best scores, etc.

## API Endpoints

### REST API

- `GET /` - Health check
- `GET /room/:roomId/players` - Get all players in a room
- `GET /room/:roomId/battle` - Get current battle status for a room
- `GET /rooms/status?roomIds=room1,room2,room3` - Get status of multiple rooms at once
- `GET /user/:userId/battles` - Get user's battle history
- `GET /user/:userId/stats` - Get user's battle statistics

### WebSocket Messages

#### Client to Server

```javascript
// Join a room
{ type: 'join', roomId: 'room123', userId: 'user456' }

// Start battle (admin only)
{ type: 'start-battle' }

// Update test results (only when battle is active)
{ type: 'test-results', passed: 5, total: 10 }

// Request player list
{ type: 'get-players' }

// Complete battle (admin only)
{ type: 'complete-battle', completionTime: 1234 }

// Watch room statuses (for entry screen monitoring)
{ type: 'watch-rooms', roomIds: ['room1', 'room2', 'room3'] }

// Stop watching room statuses
{ type: 'unwatch-rooms' }
```

#### Server to Client

```javascript
// Battle status when joining
{ type: 'battle-status', status: 'waiting', isAdmin: true, battleId: 'uuid' }

// Battle started notification
{ type: 'battle-started', battleId: 'uuid', startedAt: '2025-10-08T...' }

// Player list updates
{ type: 'players-list', players: [...] }

// Test result updates
{ type: 'test-results-update', userId: 'user123', passed: 5, total: 10 }

// Battle completion
{ type: 'battle-completed', battleId: 'uuid', results: [...] }

// Room status updates (for watchers)
{ type: 'room-statuses', rooms: { 'room1': { status: 'waiting', canJoin: true, ... }, ... } }
{ type: 'room-status-update', roomId: 'room1', status: 'active', canJoin: true, change: 'battle-started', ... }

// Watcher confirmations
{ type: 'unwatched', message: 'No longer watching room statuses' }

// Error messages
{ type: 'error', message: 'Error description' }
```

## Usage Example

### Frontend Integration

```javascript
const ws = new WebSocket('ws://localhost:3001');

// Join a room
ws.send(JSON.stringify({
  type: 'join',
  roomId: 'coding-battle-123',
  userId: 'user-mongo-id'
}));

// Send test results
ws.send(JSON.stringify({
  type: 'test-results',
  passed: 8,
  total: 10
}));

// Complete battle when done
ws.send(JSON.stringify({
  type: 'complete-battle',
  completionTime: Date.now() - startTime
}));

// Listen for updates
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  switch (message.type) {
    case 'players-list':
      updatePlayerList(message.players);
      break;
    case 'test-results-update':
      updatePlayerScore(message.userId, message.passed, message.total);
      break;
    case 'battle-completed':
      showBattleResults(message.results);
      break;
  }
};
```

### Fetch User Statistics

```javascript
// Get user's battle history
const response = await fetch(`/user/${userId}/battles?limit=20`);
const { battles } = await response.json();

// Get user's statistics
const statsResponse = await fetch(`/user/${userId}/stats`);
const { stats } = await statsResponse.json();
console.log(stats.wins, stats.totalBattles, stats.averagePlacement);
```

## Battle Flow

1. **Battle Creation**: Automatically created in "waiting" state when first user joins a room
2. **Admin Control**: Only the designated admin can start and complete battles
3. **Battle Start**: Admin triggers battle start, changing status from "waiting" to "active"
4. **Player Tracking**: Real-time updates of test results only during active battles
5. **Battle Completion**: Admin triggers completion, calculates final placements
6. **Data Persistence**: Results stored in Supabase for historical tracking
7. **Statistics**: Aggregated data available via API endpoints

### Battle States
- **waiting**: Battle created, players can join, waiting for admin to start
- **active**: Battle in progress, players can submit test results
- **completed**: Battle finished, results calculated and stored

## Development

The server uses ES modules and includes:
- Express.js for REST endpoints
- WebSocket server for real-time communication
- Supabase client for database operations
- Environment variable configuration
