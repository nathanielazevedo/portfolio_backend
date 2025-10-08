import dotenv from 'dotenv';
dotenv.config();

// Extract connection details from Supabase URL
const supabaseUrl = process.env.SUPABASE_URL;
if (!supabaseUrl) {
  throw new Error('SUPABASE_URL environment variable is required');
}

// Parse Supabase URL to get connection details
// Format: https://[project-ref].supabase.co
const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');

// Build PostgreSQL connection string for Supabase
// Note: You'll need to get your database password from Supabase dashboard
const databaseUrl = `postgresql://postgres:${process.env.SUPABASE_DB_PASSWORD || '[YOUR_DB_PASSWORD]'}@db.${projectRef}.supabase.co:5432/postgres`;

export default {
  databaseUrl,
  migrationsTable: 'pgmigrations',
  dir: 'migrations',
  direction: 'up',
  count: 1,
  ignorePattern: '.*\\.map',
  schema: 'public',
  createSchema: false,
  'single-transaction': true
};