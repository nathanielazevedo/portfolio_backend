import { supabase } from './database.js';

// Database migration function
export async function runMigrations() {
  console.log('Running database migrations...');
  
  try {
    // Check if tables already exist
    const { data: tables, error: tablesError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .in('table_name', ['battles', 'battle_participations']);
    
    if (tablesError) {
      console.log('Cannot check existing tables, proceeding with migration...');
    }
    
    const existingTables = tables?.map(t => t.table_name) || [];
    
    if (existingTables.includes('battles') && existingTables.includes('battle_participations')) {
      console.log('Database tables already exist, skipping migration');
      return;
    }
    
    console.log('Creating database tables...');
    
    // Read schema file and execute
    const fs = await import('fs/promises');
    const path = await import('path');
    const __dirname = path.dirname(new URL(import.meta.url).pathname);
    
    const schemaSQL = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
    
    // Split by semicolon and execute each statement
    const statements = schemaSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    for (const statement of statements) {
      const { error } = await supabase.rpc('exec_sql', { sql: statement });
      if (error) {
        console.error('Migration error:', error);
        // Continue with other statements
      }
    }
    
    console.log('Database migration completed successfully');
    
  } catch (error) {
    console.error('Migration failed:', error);
    console.log('Please run the schema.sql file manually in Supabase SQL Editor');
  }
}

// Alternative: Direct SQL execution (if rpc is not available)
export async function createTablesDirectly() {
  console.log('Creating tables directly...');
  
  try {
    // Create battles table
    const { error: battlesError } = await supabase.sql`
      CREATE TABLE IF NOT EXISTS battles (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        room_id VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'completed', 'cancelled')),
        started_at TIMESTAMP WITH TIME ZONE,
        completed_at TIMESTAMP WITH TIME ZONE,
        participants JSONB DEFAULT '[]'::jsonb,
        results JSONB,
        admin_user_id VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;
    
    if (battlesError) throw battlesError;
    
    // Create battle_participations table
    const { error: participationsError } = await supabase.sql`
      CREATE TABLE IF NOT EXISTS battle_participations (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        battle_id UUID REFERENCES battles(id) ON DELETE CASCADE,
        user_id VARCHAR(255) NOT NULL,
        placement INTEGER NOT NULL,
        tests_passed INTEGER DEFAULT 0,
        total_tests INTEGER DEFAULT 0,
        score INTEGER DEFAULT 0,
        completion_time INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;
    
    if (participationsError) throw participationsError;
    
    console.log('Tables created successfully');
    
  } catch (error) {
    console.error('Direct table creation failed:', error);
    throw error;
  }
}