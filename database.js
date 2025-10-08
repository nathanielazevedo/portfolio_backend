import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// Database logging function
const dbLog = {
  info: (message, data = null) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] DB-INFO: ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  error: (message, error = null) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] DB-ERROR: ${message}`, error || '');
  },
  debug: (message, data = null) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] DB-DEBUG: ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }
};

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

dbLog.info('Initializing Supabase client', {
  url: supabaseUrl ? 'SET' : 'NOT SET',
  serviceKey: supabaseServiceRoleKey ? 'SET' : 'NOT SET'
});

if (!supabaseUrl || !supabaseServiceRoleKey) {
  dbLog.error('Missing Supabase environment variables');
  process.exit(1);
}

// Using service role key for server-side operations
export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
dbLog.info('Supabase client initialized successfully');

// Battle tracking functions
export class BattleService {
  
  // Create a new battle record in waiting state
  static async createBattle(roomId, adminUserId, participants = []) {
    dbLog.info('Creating new battle', { roomId, adminUserId, participantCount: participants.length });
    
    try {
      const { data, error } = await supabase
        .from('battles')
        .insert({
          room_id: roomId,
          status: 'waiting',
          admin_user_id: adminUserId,
          participants: participants
        })
        .select()
        .single();

      if (error) {
        dbLog.error('Supabase error creating battle:', error);
        throw error;
      }
      
      dbLog.info('Battle created successfully', { battleId: data.id, status: data.status });
      return data;
    } catch (error) {
      dbLog.error('Error creating battle:', error);
      throw error;
    }
  }

  // Start a battle (change from waiting to active)
  static async startBattle(roomId, adminUserId) {
    dbLog.info('Starting battle', { roomId, adminUserId });
    
    try {
      const { data, error } = await supabase
        .from('battles')
        .update({
          status: 'active',
          started_at: new Date().toISOString()
        })
        .eq('room_id', roomId)
        .eq('status', 'waiting')
        .eq('admin_user_id', adminUserId)
        .select()
        .single();

      if (error) {
        dbLog.error('Supabase error starting battle:', error);
        throw error;
      }
      
      if (data) {
        dbLog.info('Battle started successfully', { 
          battleId: data.id, 
          startedAt: data.started_at,
          status: data.status 
        });
      } else {
        dbLog.error('No battle data returned - battle may not exist or user not authorized');
      }
      
      return data;
    } catch (error) {
      dbLog.error('Error starting battle:', error);
      throw error;
    }
  }

  // Update battle with results
  static async completeBattle(roomId, results) {
    try {
      const { data, error } = await supabase
        .from('battles')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          results: results
        })
        .eq('room_id', roomId)
        .eq('status', 'active')
        .select()
        .single();

      if (error) throw error;

      // Create individual battle participation records
      if (results && results.length > 0) {
        await this.createBattleParticipations(data.id, results);
      }

      return data;
    } catch (error) {
      console.error('Error completing battle:', error);
      throw error;
    }
  }

  // Create battle participation records for each user
  static async createBattleParticipations(battleId, results) {
    try {
      const participations = results.map((result, index) => ({
        battle_id: battleId,
        user_id: result.userId,
        placement: index + 1, // 1st place, 2nd place, etc.
        tests_passed: result.testsPassed,
        total_tests: result.totalTests,
        score: result.testsPassed,
        completion_time: result.completionTime || null
      }));

      const { data, error } = await supabase
        .from('battle_participations')
        .insert(participations)
        .select();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error creating battle participations:', error);
      throw error;
    }
  }

  // Get user's battle history
  static async getUserBattleHistory(userId, limit = 50) {
    try {
      const { data, error } = await supabase
        .from('battle_participations')
        .select(`
          *,
          battles (
            room_id,
            started_at,
            completed_at,
            status
          )
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error fetching user battle history:', error);
      throw error;
    }
  }

  // Get user statistics
  static async getUserStats(userId) {
    try {
      const { data, error } = await supabase
        .from('battle_participations')
        .select('placement, tests_passed, total_tests')
        .eq('user_id', userId);

      if (error) throw error;

      const stats = {
        totalBattles: data.length,
        wins: data.filter(b => b.placement === 1).length,
        secondPlace: data.filter(b => b.placement === 2).length,
        thirdPlace: data.filter(b => b.placement === 3).length,
        averageTestsPassed: data.length > 0 ? 
          data.reduce((sum, b) => sum + b.tests_passed, 0) / data.length : 0,
        averagePlacement: data.length > 0 ? 
          data.reduce((sum, b) => sum + b.placement, 0) / data.length : 0
      };

      return stats;
    } catch (error) {
      console.error('Error fetching user stats:', error);
      throw error;
    }
  }

  // Get active battle for a room
  static async getActiveBattle(roomId) {
    try {
      const { data, error } = await supabase
        .from('battles')
        .select('*')
        .eq('room_id', roomId)
        .eq('status', 'active')
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 is "not found"
      return data;
    } catch (error) {
      console.error('Error fetching active battle:', error);
      throw error;
    }
  }

  // Get any battle (waiting or active) for a room
  static async getBattle(roomId) {
    try {
      const { data, error } = await supabase
        .from('battles')
        .select('*')
        .eq('room_id', roomId)
        .in('status', ['waiting', 'active'])
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 is "not found"
      return data;
    } catch (error) {
      console.error('Error fetching battle:', error);
      throw error;
    }
  }

  // Check if user is admin for a battle
  static async isAdminForBattle(roomId, userId) {
    try {
      const { data, error } = await supabase
        .from('battles')
        .select('admin_user_id')
        .eq('room_id', roomId)
        .in('status', ['waiting', 'active'])
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data?.admin_user_id === userId;
    } catch (error) {
      console.error('Error checking admin status:', error);
      return false;
    }
  }

  // Update participant in active battle
  static async updateBattleParticipant(roomId, userId, testsPassed, totalTests) {
    try {
      const battle = await this.getActiveBattle(roomId);
      if (!battle) return null;

      // Update the participants array in the battle record
      const participants = battle.participants || [];
      const existingParticipantIndex = participants.findIndex(p => p.userId === userId);
      
      const participantData = {
        userId,
        testsPassed,
        totalTests,
        updatedAt: new Date().toISOString()
      };

      if (existingParticipantIndex >= 0) {
        participants[existingParticipantIndex] = participantData;
      } else {
        participants.push(participantData);
      }

      const { data, error } = await supabase
        .from('battles')
        .update({ participants })
        .eq('id', battle.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error updating battle participant:', error);
      throw error;
    }
  }

  // Add participant to waiting battle
  static async addParticipantToBattle(roomId, userId) {
    try {
      const battle = await this.getBattle(roomId);
      if (!battle) return null;

      const participants = battle.participants || [];
      const existingParticipantIndex = participants.findIndex(p => p.userId === userId);
      
      if (existingParticipantIndex === -1) {
        participants.push({
          userId,
          joinedAt: new Date().toISOString(),
          testsPassed: 0,
          totalTests: 0
        });

        const { data, error } = await supabase
          .from('battles')
          .update({ participants })
          .eq('id', battle.id)
          .select()
          .single();

        if (error) throw error;
        return data;
      }

      return battle;
    } catch (error) {
      console.error('Error adding participant to battle:', error);
      throw error;
    }
  }
}