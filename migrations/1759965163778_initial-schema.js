/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // Create battles table
  pgm.createTable('battles', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    room_id: {
      type: 'varchar(255)',
      notNull: true
    },
    status: {
      type: 'varchar(50)',
      default: 'waiting',
      check: "status IN ('waiting', 'active', 'completed', 'cancelled')"
    },
    started_at: {
      type: 'timestamp with time zone',
      notNull: false
    },
    completed_at: {
      type: 'timestamp with time zone',
      notNull: false
    },
    participants: {
      type: 'jsonb',
      default: pgm.func("'[]'::jsonb")
    },
    results: {
      type: 'jsonb',
      notNull: false
    },
    admin_user_id: {
      type: 'varchar(255)',
      notNull: false
    },
    created_at: {
      type: 'timestamp with time zone',
      default: pgm.func('NOW()'),
      notNull: true
    },
    updated_at: {
      type: 'timestamp with time zone',
      default: pgm.func('NOW()'),
      notNull: true
    }
  });

  // Create battle_participations table
  pgm.createTable('battle_participations', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    battle_id: {
      type: 'uuid',
      notNull: true,
      references: 'battles(id)',
      onDelete: 'CASCADE'
    },
    user_id: {
      type: 'varchar(255)',
      notNull: true
    },
    placement: {
      type: 'integer',
      notNull: true
    },
    tests_passed: {
      type: 'integer',
      default: 0
    },
    total_tests: {
      type: 'integer',
      default: 0
    },
    score: {
      type: 'integer',
      default: 0
    },
    completion_time: {
      type: 'integer',
      notNull: false
    },
    created_at: {
      type: 'timestamp with time zone',
      default: pgm.func('NOW()'),
      notNull: true
    }
  });

  // Create indexes
  pgm.createIndex('battles', 'room_id');
  pgm.createIndex('battles', 'status');
  pgm.createIndex('battles', 'admin_user_id');
  pgm.createIndex('battle_participations', 'user_id');
  pgm.createIndex('battle_participations', 'battle_id');
  pgm.createIndex('battle_participations', 'placement');

  // Create function for updating updated_at
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ language 'plpgsql';
  `);

  // Create trigger for updated_at
  pgm.sql(`
    CREATE TRIGGER update_battles_updated_at 
      BEFORE UPDATE ON battles 
      FOR EACH ROW 
      EXECUTE FUNCTION update_updated_at_column();
  `);

  // Create battle stats view
  pgm.sql(`
    CREATE VIEW battle_stats AS
    SELECT 
      bp.user_id,
      COUNT(*) as total_battles,
      COUNT(CASE WHEN bp.placement = 1 THEN 1 END) as wins,
      COUNT(CASE WHEN bp.placement = 2 THEN 1 END) as second_place,
      COUNT(CASE WHEN bp.placement = 3 THEN 1 END) as third_place,
      AVG(bp.placement) as average_placement,
      AVG(bp.tests_passed) as average_tests_passed,
      MAX(bp.tests_passed) as best_score,
      AVG(bp.completion_time) as average_completion_time
    FROM battle_participations bp
    JOIN battles b ON bp.battle_id = b.id
    WHERE b.status = 'completed'
    GROUP BY bp.user_id;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Drop view
  pgm.dropView('battle_stats');
  
  // Drop trigger and function
  pgm.sql('DROP TRIGGER IF EXISTS update_battles_updated_at ON battles;');
  pgm.sql('DROP FUNCTION IF EXISTS update_updated_at_column();');
  
  // Drop tables (battle_participations first due to foreign key)
  pgm.dropTable('battle_participations');
  pgm.dropTable('battles');
};
