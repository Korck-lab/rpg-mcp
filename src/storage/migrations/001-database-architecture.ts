/**
 * Migration 001: Database Architecture for Portals-RPG
 * 
 * This migration adds comprehensive schema support for:
 * - Hash-chained event logs with SHA-256 verification
 * - Snapshots for fast state recovery
 * - RNG state tracking for deterministic reproducibility
 * - Enhanced world data (node_networks, room_exits)
 * - Character spells, conditions, concentration tracking
 * - Combat tokens, auras, battlefields
 * - Quest objectives and narrative notes
 * - NPC relationships and conversation memories
 * - Reputation tracking and faction definitions
 * - Cultures, lore entries, NPC backgrounds
 * - Secrets with visibility control
 * 
 * @see specs/001-database-architecture/data-model.md
 */

import Database from 'better-sqlite3';

/**
 * Genesis hash constant for the first event in any chain.
 * Computed as SHA-256("genesis") = "..."
 */
export const GENESIS_HASH = 'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a';

/**
 * Run the 001-database-architecture migration.
 * This function is idempotent - safe to run multiple times.
 */
export function migrate001DatabaseArchitecture(db: Database.Database): void {
  console.error('[Migration 001] Starting database architecture migration...');

  // ============================================================
  // DOMAIN 1: Event Sourcing Layer
  // ============================================================

  // 1.1 Event logs table with hash chaining
  // Commented out - handled by main migrate

  // 1.2 Snapshots table for fast replay recovery (T030)
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      event_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      description TEXT,
      state_json TEXT NOT NULL,
      checksum TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      is_auto INTEGER NOT NULL DEFAULT 0,
      
      FOREIGN KEY (world_id) REFERENCES worlds(id),
      FOREIGN KEY (event_id) REFERENCES event_logs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_world ON snapshots(world_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_snapshots_event ON snapshots(event_id);
  `);



  // 1.4 RNG state tracking for deterministic reproducibility (T031)
  db.exec(`
    CREATE TABLE IF NOT EXISTS rng_state (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      context TEXT NOT NULL,
      seed TEXT NOT NULL,
      call_index INTEGER NOT NULL DEFAULT 0,
      last_value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      
      UNIQUE(world_id, context),
      FOREIGN KEY (world_id) REFERENCES worlds(id)
    );

    CREATE INDEX IF NOT EXISTS idx_rng_state_world ON rng_state(world_id);
  `);

  // 1.5 Event inbox table for asynchronous event processing
  // Events that need deferred handling (e.g., timed effects, scheduled actions)
  // Check if table exists from base migration
  const inboxExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='event_inbox'").get();
  
  if (!inboxExists) {
    console.error('[Migration 001] Creating event_inbox table');
    db.exec(`
      CREATE TABLE IF NOT EXISTS event_inbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        world_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        process_after TEXT,  -- NULL = immediate, datetime = deferred
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'expired')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        processed_at TEXT,
        expires_at TEXT,  -- Auto-expire if not processed
        FOREIGN KEY (world_id) REFERENCES worlds(id)
      );
    `);
  } else {
    // Table exists (likely from base migration), check for world_id
    const inboxColumns = db.prepare("PRAGMA table_info(event_inbox)").all() as { name: string }[];
    const hasWorldId = inboxColumns.some(col => col.name === 'world_id');
    
    if (!hasWorldId) {
      console.error('[Migration 001] Adding world_id column to event_inbox');
      db.exec(`ALTER TABLE event_inbox ADD COLUMN world_id TEXT NOT NULL DEFAULT 'default';`);
    }
    
    // Check for other missing columns that might be needed
    const hasProcessAfter = inboxColumns.some(col => col.name === 'process_after');
    const hasStatus = inboxColumns.some(col => col.name === 'status');
    const hasExpiresAt = inboxColumns.some(col => col.name === 'expires_at');
    
    if (!hasProcessAfter) {
      console.error('[Migration 001] Adding process_after column to event_inbox');
      db.exec(`ALTER TABLE event_inbox ADD COLUMN process_after TEXT;`);
    }
    if (!hasStatus) {
      console.error('[Migration 001] Adding status column to event_inbox');
      db.exec(`ALTER TABLE event_inbox ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';`);
    }
    if (!hasExpiresAt) {
      console.error('[Migration 001] Adding expires_at column to event_inbox');
      db.exec(`ALTER TABLE event_inbox ADD COLUMN expires_at TEXT;`);
    }
  }

  // Create indexes (safe to run even if table existed)
  console.error('[Migration 001] Creating event_inbox indexes');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_event_inbox_pending ON event_inbox(world_id, status, process_after);
    CREATE INDEX IF NOT EXISTS idx_event_inbox_expires ON event_inbox(expires_at) WHERE status = 'pending';
  `);

  // ============================================================
  // DOMAIN 2: World Data Enhancements
  // ============================================================

  // 2.1 Add environment column to worlds table
  const worldColumns = db.prepare("PRAGMA table_info(worlds)").all() as { name: string }[];
  const hasEnvironment = worldColumns.some(col => col.name === 'environment');
  if (!hasEnvironment) {
    console.error('[Migration 001] Adding environment column to worlds');
    db.exec(`ALTER TABLE worlds ADD COLUMN environment TEXT NOT NULL DEFAULT '{"timeOfDay":"morning","season":"summer","weather":"clear","temperature":"mild","lighting":"bright"}';`);
  }

  // 2.2 Regions table (T043)
  db.exec(`
    CREATE TABLE IF NOT EXISTS regions (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      name TEXT NOT NULL,
      biome TEXT NOT NULL,
      climate TEXT,
      description TEXT,
      bounds_json TEXT,  -- {min_x, min_y, max_x, max_y}
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      
      FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_regions_world ON regions(world_id);
  `);

  // 2.3 Structures table (T045) - created before tiles since tiles references it
  const structuresExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='structures'").get();

  if (!structuresExists) {
    console.error('[Migration 001] Creating structures table');
    db.exec(`
      CREATE TABLE IF NOT EXISTS structures (
        id TEXT PRIMARY KEY,
        region_id TEXT NOT NULL,
        type TEXT NOT NULL,  -- 'dungeon', 'town', 'cave', 'ruins', etc.
        name TEXT NOT NULL,
        tile_x INTEGER NOT NULL,
        tile_y INTEGER NOT NULL,
        entrance_room_id TEXT,
        is_observed INTEGER NOT NULL DEFAULT 0,  -- boolean: 1 = observed/canonical, 0 = procedural
        metadata_json TEXT DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),

        FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE,
        FOREIGN KEY (entrance_room_id) REFERENCES room_nodes(id)
      );
    `);
  } else {
    // Migrate existing table
    const structCols = db.prepare("PRAGMA table_info(structures)").all() as { name: string }[];
    const colNames = structCols.map(c => c.name);
    console.error('[Migration 001] Existing structures columns:', colNames.join(', '));

    const hasX = colNames.includes('x');
    const hasTileX = colNames.includes('tile_x');
    const hasMetadata = colNames.includes('metadata');
    const hasMetadataJson = colNames.includes('metadata_json');
    const hasEntrance = colNames.includes('entrance_room_id');
    const hasIsObserved = colNames.includes('is_observed');

    if (hasX && !hasTileX) {
      console.error('[Migration 001] Renaming x/y to tile_x/tile_y in structures');
      try {
        db.exec(`ALTER TABLE structures RENAME COLUMN x TO tile_x;`);
        db.exec(`ALTER TABLE structures RENAME COLUMN y TO tile_y;`);
      } catch (e) {
        console.error('[Migration 001] Failed to rename columns:', (e as Error).message);
      }
    }
    
    if (hasMetadata && !hasMetadataJson) {
       console.error('[Migration 001] Renaming metadata to metadata_json in structures');
       try {
         db.exec(`ALTER TABLE structures RENAME COLUMN metadata TO metadata_json;`);
       } catch (e) {
         console.error('[Migration 001] Failed to rename metadata:', (e as Error).message);
       }
    }

    if (!hasEntrance) {
       console.error('[Migration 001] Adding entrance_room_id to structures');
       try {
         db.exec(`ALTER TABLE structures ADD COLUMN entrance_room_id TEXT REFERENCES room_nodes(id);`);
       } catch (e) {
         console.error('[Migration 001] Failed to add entrance column:', (e as Error).message);
       }
    }

    if (!hasIsObserved) {
       console.log('[Migration 001] Adding is_observed column to structures');
       try {
         db.exec(`ALTER TABLE structures ADD COLUMN is_observed INTEGER NOT NULL DEFAULT 0;`);
       } catch (e) {
         console.error('[Migration 001] Failed to add is_observed column:', (e as Error).message);
       }
    }
  }

  // Create indexes only if columns exist
  try {
    const checkCols = db.prepare("PRAGMA table_info(structures)").all() as { name: string }[];
    const currentCols = checkCols.map(c => c.name);
    if (currentCols.includes('tile_x') && currentCols.includes('tile_y')) {
      console.error('[Migration 001] Creating structures indexes');
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_structures_region ON structures(region_id);
        CREATE INDEX IF NOT EXISTS idx_structures_tile ON structures(region_id, tile_x, tile_y);
      `);
    } else {
      console.error('[Migration 001] Skipping structures index creation: tile_x/tile_y missing');
    }
  } catch (e) {
    console.error('[Migration 001] Failed to create structures indexes:', (e as Error).message);
  }

  // 2.4 Tiles table (T044)
  // Check if table exists; create or add missing columns
  const tilesExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='tiles'"
  ).get();

  if (!tilesExists) {
    console.error('[Migration 001] Creating tiles table');
    db.exec(`
      CREATE TABLE IF NOT EXISTS tiles (
        id TEXT PRIMARY KEY,
        region_id TEXT NOT NULL,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        terrain TEXT NOT NULL DEFAULT 'normal',
        biome TEXT,
        elevation INTEGER DEFAULT 0,
        features_json TEXT DEFAULT '[]',
        structure_id TEXT,
        is_explored INTEGER DEFAULT 0,
        
        UNIQUE(region_id, x, y),
        FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE,
        FOREIGN KEY (structure_id) REFERENCES structures(id)
      );
      CREATE INDEX IF NOT EXISTS idx_tiles_region_pos ON tiles(region_id, x, y);
    `);
  } else {
    // Table exists - add missing columns if needed
    const tileColumns = db.prepare("PRAGMA table_info(tiles)").all() as { name: string }[];
    const hasTileRegionId = tileColumns.some(col => col.name === 'region_id');
    const hasTileTerrain = tileColumns.some(col => col.name === 'terrain');
    const hasTileBiome = tileColumns.some(col => col.name === 'biome');
    const hasTileElevation = tileColumns.some(col => col.name === 'elevation');
    const hasTileFeaturesJson = tileColumns.some(col => col.name === 'features_json');
    const hasTileStructureId = tileColumns.some(col => col.name === 'structure_id');
    const hasTileIsExplored = tileColumns.some(col => col.name === 'is_explored');

    if (!hasTileRegionId) {
      console.error('[Migration 001] Adding region_id column to tiles');
      db.exec(`ALTER TABLE tiles ADD COLUMN region_id TEXT REFERENCES regions(id) ON DELETE CASCADE;`);
    }
    if (!hasTileTerrain) {
      console.error('[Migration 001] Adding terrain column to tiles');
      db.exec(`ALTER TABLE tiles ADD COLUMN terrain TEXT NOT NULL DEFAULT 'normal';`);
    }
    if (!hasTileBiome) {
      console.error('[Migration 001] Adding biome column to tiles');
      db.exec(`ALTER TABLE tiles ADD COLUMN biome TEXT;`);
    }
    if (!hasTileElevation) {
      console.error('[Migration 001] Adding elevation column to tiles');
      db.exec(`ALTER TABLE tiles ADD COLUMN elevation INTEGER DEFAULT 0;`);
    }
    if (!hasTileFeaturesJson) {
      console.error('[Migration 001] Adding features_json column to tiles');
      db.exec(`ALTER TABLE tiles ADD COLUMN features_json TEXT DEFAULT '[]';`);
    }
    if (!hasTileStructureId) {
      console.error('[Migration 001] Adding structure_id column to tiles');
      db.exec(`ALTER TABLE tiles ADD COLUMN structure_id TEXT REFERENCES structures(id);`);
    }
    if (!hasTileIsExplored) {
      console.error('[Migration 001] Adding is_explored column to tiles');
      db.exec(`ALTER TABLE tiles ADD COLUMN is_explored INTEGER DEFAULT 0;`);
    }
  }

  // Ensure tiles indexes exist
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tiles_region ON tiles(region_id);
    CREATE INDEX IF NOT EXISTS idx_tiles_region_pos ON tiles(region_id, x, y);
  `);

  // 2.5 Room nodes table (T046)
  // Check if table exists; create or add missing columns
  const roomNodesExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='room_nodes'"
  ).get();

  if (!roomNodesExists) {
    console.error('[Migration 001] Creating room_nodes table');
    db.exec(`
      CREATE TABLE IF NOT EXISTS room_nodes (
        id TEXT PRIMARY KEY,
        structure_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        biome_context TEXT,
        lighting TEXT DEFAULT 'normal',
        room_type TEXT,
        contents_json TEXT DEFAULT '{}',
        state_json TEXT DEFAULT '{}',
        is_observed INTEGER NOT NULL DEFAULT 0,  -- boolean: 1 = observed/canonical, 0 = procedural
        created_at TEXT NOT NULL DEFAULT (datetime('now')),

        FOREIGN KEY (structure_id) REFERENCES structures(id) ON DELETE CASCADE
      );
    `);
  } else {
    // Table exists - add missing columns if needed
    const roomNodeColumns = db.prepare("PRAGMA table_info(room_nodes)").all() as { name: string }[];
    const hasRoomStructureId = roomNodeColumns.some(col => col.name === 'structure_id');
    const hasRoomBiomeContext = roomNodeColumns.some(col => col.name === 'biome_context');
    const hasRoomLighting = roomNodeColumns.some(col => col.name === 'lighting');
    const hasRoomType = roomNodeColumns.some(col => col.name === 'room_type');
    const hasRoomContentsJson = roomNodeColumns.some(col => col.name === 'contents_json');
    const hasRoomStateJson = roomNodeColumns.some(col => col.name === 'state_json');
    const hasRoomIsObserved = roomNodeColumns.some(col => col.name === 'is_observed');

    if (!hasRoomStructureId) {
      console.error('[Migration 001] Adding structure_id column to room_nodes');
      db.exec(`ALTER TABLE room_nodes ADD COLUMN structure_id TEXT REFERENCES structures(id) ON DELETE CASCADE;`);
    }
    if (!hasRoomBiomeContext) {
      console.error('[Migration 001] Adding biome_context column to room_nodes');
      db.exec(`ALTER TABLE room_nodes ADD COLUMN biome_context TEXT;`);
    }
    if (!hasRoomLighting) {
      console.error('[Migration 001] Adding lighting column to room_nodes');
      db.exec(`ALTER TABLE room_nodes ADD COLUMN lighting TEXT DEFAULT 'normal';`);
    }
    if (!hasRoomType) {
      console.error('[Migration 001] Adding room_type column to room_nodes');
      db.exec(`ALTER TABLE room_nodes ADD COLUMN room_type TEXT;`);
    }
    if (!hasRoomContentsJson) {
      console.error('[Migration 001] Adding contents_json column to room_nodes');
      db.exec(`ALTER TABLE room_nodes ADD COLUMN contents_json TEXT DEFAULT '{}';`);
    }
    if (!hasRoomStateJson) {
      console.error('[Migration 001] Adding state_json column to room_nodes');
      db.exec(`ALTER TABLE room_nodes ADD COLUMN state_json TEXT DEFAULT '{}';`);
    }
    if (!hasRoomIsObserved) {
      console.log('[Migration 001] Adding is_observed column to room_nodes');
      db.exec(`ALTER TABLE room_nodes ADD COLUMN is_observed INTEGER NOT NULL DEFAULT 0;`);
    }
  }

  // Ensure room_nodes index exists
  db.exec(`CREATE INDEX IF NOT EXISTS idx_room_nodes_structure ON room_nodes(structure_id);`);

  console.error('[Migration 001] Processing room_exits...');
  // 2.6 Room exits table (separate from embedded JSON)
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_exits (
      id TEXT PRIMARY KEY,
      from_room_id TEXT NOT NULL,
      to_room_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'open',
      dc INTEGER,
      description TEXT,
      travel_time INTEGER DEFAULT 1,
      terrain TEXT DEFAULT 'normal',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(from_room_id) REFERENCES room_nodes(id) ON DELETE CASCADE,
      FOREIGN KEY(to_room_id) REFERENCES room_nodes(id) ON DELETE CASCADE,
      UNIQUE(from_room_id, direction)
    );

    CREATE INDEX IF NOT EXISTS idx_room_exits_from ON room_exits(from_room_id);
    CREATE INDEX IF NOT EXISTS idx_room_exits_to ON room_exits(to_room_id);
  `);

  // ============================================================
  // DOMAIN 3: Character & Entity Enhancements
  // ============================================================

  // 3.1 Characters table (T059)
  // Commented out - handled by main migrate

  console.error('[Migration 001] Processing npcs...');
  // 3.2 NPCs table (T060) - extended NPC data
  db.exec(`
    CREATE TABLE IF NOT EXISTS npcs (
      character_id TEXT PRIMARY KEY,
      disposition TEXT NOT NULL DEFAULT 'neutral',
      occupation TEXT,
      schedule_json TEXT DEFAULT '{}',
      memory_json TEXT DEFAULT '[]',
      secrets_json TEXT DEFAULT '[]',
      dialogue_state_json TEXT DEFAULT '{}',
      last_interaction TEXT,
      
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );
  `);

  console.error('[Migration 001] Processing monsters...');
  // 3.3 Monsters table (T061)
  const monstersExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='monsters'").get();
  console.error(`[Migration 001] Monsters table exists: ${!!monstersExists}`);
  
  if (!monstersExists) {
    console.error('[Migration 001] Creating monsters table');
    db.exec(`
      CREATE TABLE IF NOT EXISTS monsters (
        id TEXT PRIMARY KEY,
        world_id TEXT NOT NULL,
        template_id TEXT NOT NULL,
        name TEXT,
        current_hp INTEGER NOT NULL,
        max_hp INTEGER NOT NULL,
        conditions_json TEXT DEFAULT '[]',
        location_room_id TEXT,
        lair_room_id TEXT,
        loot_table_id TEXT,
        state TEXT DEFAULT 'alive' CHECK (state IN ('alive', 'unconscious', 'dead', 'fled')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        
        FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE,
        FOREIGN KEY (location_room_id) REFERENCES room_nodes(id),
        FOREIGN KEY (lair_room_id) REFERENCES room_nodes(id)
      );
    `);
  } else {
    // Check for columns if table exists
    const monsterCols = db.prepare("PRAGMA table_info(monsters)").all() as { name: string }[];
    const colNames = monsterCols.map(c => c.name);
    console.error('[Migration 001] Existing monsters columns:', colNames.join(', '));

    const hasLocation = colNames.includes('location_room_id');
    const hasLair = colNames.includes('lair_room_id');
    
    if (!hasLocation) {
        console.error('[Migration 001] Adding location_room_id to monsters');
        db.exec(`ALTER TABLE monsters ADD COLUMN location_room_id TEXT REFERENCES room_nodes(id);`);
    }
    if (!hasLair) {
        console.error('[Migration 001] Adding lair_room_id to monsters');
        db.exec(`ALTER TABLE monsters ADD COLUMN lair_room_id TEXT REFERENCES room_nodes(id);`);
    }
  }

  console.error('[Migration 001] Creating monsters indexes');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_monsters_world ON monsters(world_id);
    CREATE INDEX IF NOT EXISTS idx_monsters_location ON monsters(location_room_id);
    CREATE INDEX IF NOT EXISTS idx_monsters_state ON monsters(world_id, state);
  `);

  // 3.4 Corpses table (T062)
  const corpsesExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='corpses'").get();
  console.error(`[Migration 001] Corpses table exists: ${!!corpsesExists}`);

  if (!corpsesExists) {
    console.error('[Migration 001] Creating corpses table');
    db.exec(`
      CREATE TABLE IF NOT EXISTS corpses (
        id TEXT PRIMARY KEY,
        world_id TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK (source_type IN ('character', 'monster', 'npc')),
        source_id TEXT NOT NULL,
        name TEXT NOT NULL,
        location_room_id TEXT NOT NULL,
        loot_json TEXT DEFAULT '[]',
        state TEXT DEFAULT 'fresh' CHECK (state IN ('fresh', 'decaying', 'skeletal', 'gone')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        decay_at TEXT,
        
        FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE,
        FOREIGN KEY (location_room_id) REFERENCES room_nodes(id)
      );
    `);
  } else {
    // Check for columns
    const corpseCols = db.prepare("PRAGMA table_info(corpses)").all() as { name: string }[];
    const colNames = corpseCols.map(c => c.name);
    console.error('[Migration 001] Existing corpses columns:', colNames.join(', '));

    const hasLocation = colNames.includes('location_room_id');
    const hasLootJson = colNames.includes('loot_json');
    
    if (!hasLocation) {
        console.error('[Migration 001] Adding location_room_id to corpses');
        db.exec(`ALTER TABLE corpses ADD COLUMN location_room_id TEXT REFERENCES room_nodes(id);`);
    }
    if (!hasLootJson) {
        console.error('[Migration 001] Adding loot_json to corpses');
        db.exec(`ALTER TABLE corpses ADD COLUMN loot_json TEXT DEFAULT '[]';`);
    }
  }

  console.error('[Migration 001] Creating corpses indexes');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_corpses_location ON corpses(location_room_id);
    CREATE INDEX IF NOT EXISTS idx_corpses_state ON corpses(world_id, state);
  `);

  // 3.5 Character spells table (normalized from JSON column)
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_spells (
      character_id TEXT PRIMARY KEY,
      spell_slots TEXT NOT NULL DEFAULT '{}',
      pact_slots TEXT,
      known_spells TEXT NOT NULL DEFAULT '[]',
      prepared_spells TEXT NOT NULL DEFAULT '[]',
      cantrips TEXT NOT NULL DEFAULT '[]',
      max_spell_level INTEGER NOT NULL DEFAULT 0,
      spellcasting_ability TEXT,
      spell_save_dc INTEGER,
      spell_attack_bonus INTEGER,
      FOREIGN KEY(character_id) REFERENCES characters(id) ON DELETE CASCADE
    );
  `);

  // 3.2 Character conditions table (normalized)
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_conditions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id TEXT NOT NULL,
      condition_name TEXT NOT NULL,
      source_id TEXT,
      source_type TEXT,
      duration_type TEXT NOT NULL DEFAULT 'permanent',
      duration_value INTEGER,
      rounds_remaining INTEGER,
      applied_at TEXT NOT NULL,
      expires_at TEXT,
      FOREIGN KEY(character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_character_conditions_char ON character_conditions(character_id);
  `);

  // 3.3 Concentration tracking table
  db.exec(`DROP TABLE IF EXISTS concentration_tracking`);
  db.exec(`
    CREATE TABLE concentration_tracking (
      character_id TEXT PRIMARY KEY,
      spell_name TEXT NOT NULL,
      spell_level INTEGER NOT NULL,
      target_ids TEXT NOT NULL DEFAULT '[]',
      started_at INTEGER NOT NULL,
      max_duration INTEGER,
      save_dc_base INTEGER NOT NULL DEFAULT 10
    );
  `);

  // 3.5 Add attunement columns to inventory_items
  const inventoryColumns = db.prepare("PRAGMA table_info(inventory_items)").all() as { name: string }[];
  const hasAttuned = inventoryColumns.some(col => col.name === 'attuned');
  if (!hasAttuned) {
    console.error('[Migration 001] Adding attuned column to inventory_items');
    db.exec(`ALTER TABLE inventory_items ADD COLUMN attuned INTEGER NOT NULL DEFAULT 0;`);
  }

  // 3.5 Add item rarity and attunement columns
  const itemColumns = db.prepare("PRAGMA table_info(items)").all() as { name: string }[];
  const hasRarity = itemColumns.some(col => col.name === 'rarity');
  const hasRequiresAttunement = itemColumns.some(col => col.name === 'requires_attunement');
  const hasAttunementReqs = itemColumns.some(col => col.name === 'attunement_requirements');

  if (!hasRarity) {
    console.error('[Migration 001] Adding rarity column to items');
    db.exec(`ALTER TABLE items ADD COLUMN rarity TEXT DEFAULT 'common';`);
  }
  if (!hasRequiresAttunement) {
    console.error('[Migration 001] Adding requires_attunement column to items');
    db.exec(`ALTER TABLE items ADD COLUMN requires_attunement INTEGER NOT NULL DEFAULT 0;`);
  }
  if (!hasAttunementReqs) {
    console.error('[Migration 001] Adding attunement_requirements column to items');
    db.exec(`ALTER TABLE items ADD COLUMN attunement_requirements TEXT;`);
  }

  // ============================================================
  // DOMAIN 4: Combat Enhancements
  // ============================================================

  // 4.1 Combat tokens table (normalized from encounters.tokens JSON)
  db.exec(`
    CREATE TABLE IF NOT EXISTS combat_tokens (
      id TEXT PRIMARY KEY,
      encounter_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      name TEXT NOT NULL,
      initiative_bonus INTEGER NOT NULL DEFAULT 0,
      initiative INTEGER,
      is_enemy INTEGER NOT NULL DEFAULT 0,
      hp INTEGER NOT NULL,
      max_hp INTEGER NOT NULL,
      position_x INTEGER NOT NULL DEFAULT 0,
      position_y INTEGER NOT NULL DEFAULT 0,
      position_z INTEGER DEFAULT 0,
      movement_speed INTEGER NOT NULL DEFAULT 30,
      movement_remaining INTEGER NOT NULL DEFAULT 30,
      size TEXT NOT NULL DEFAULT 'medium',
      has_reaction INTEGER NOT NULL DEFAULT 1,
      has_action INTEGER NOT NULL DEFAULT 1,
      has_bonus_action INTEGER NOT NULL DEFAULT 1,
      conditions TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}',
      FOREIGN KEY(encounter_id) REFERENCES encounters(id) ON DELETE CASCADE
      -- Note: character_id is NOT a foreign key - tokens can represent monsters, NPCs, or other entities without character records
    );

    CREATE INDEX IF NOT EXISTS idx_combat_tokens_encounter ON combat_tokens(encounter_id);
    CREATE INDEX IF NOT EXISTS idx_combat_tokens_initiative ON combat_tokens(encounter_id, initiative DESC);
  `);

   // 4.2 Encounters table
   db.exec(`
     CREATE TABLE IF NOT EXISTS encounters (
       id TEXT PRIMARY KEY,
       world_id TEXT NOT NULL,
       region_id TEXT,
       room_id TEXT,
       round INTEGER NOT NULL DEFAULT 1,
       active_token_id TEXT,
       status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused')),
       terrain TEXT DEFAULT '{}',
       props TEXT DEFAULT '[]',
       grid_min_x INTEGER DEFAULT 0,
       grid_max_x INTEGER DEFAULT 20,
       grid_min_y INTEGER DEFAULT 0,
       grid_max_y INTEGER DEFAULT 20,
       seed TEXT,
       ended_at TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE
     );
   `);

   // 4.3 Auras table
   db.exec(`
     CREATE TABLE IF NOT EXISTS auras (
       id TEXT PRIMARY KEY,
       encounter_id TEXT,
       owner_id TEXT NOT NULL,
       spell_name TEXT NOT NULL,
       spell_level INTEGER NOT NULL,
       radius INTEGER NOT NULL,
       affects_allies INTEGER NOT NULL DEFAULT 1,
       affects_enemies INTEGER NOT NULL DEFAULT 1,
       affects_self INTEGER NOT NULL DEFAULT 0,
       effects TEXT NOT NULL DEFAULT '[]',
       requires_concentration INTEGER NOT NULL DEFAULT 0,
       FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE CASCADE
     );
   `);

  // ============================================================
  // DOMAIN 5: Quest Enhancements
  // ============================================================

  // 5.1 Quest objectives table (normalized)
  db.exec(`
    CREATE TABLE IF NOT EXISTS quest_objectives (
      id TEXT PRIMARY KEY,
      quest_id TEXT NOT NULL,
      description TEXT NOT NULL,
      type TEXT NOT NULL,
      target TEXT,
      required INTEGER NOT NULL DEFAULT 1,
      current INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      order_index INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(quest_id) REFERENCES quests(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_quest_objectives_quest ON quest_objectives(quest_id);
  `);

  // 5.2 Add time_limit and timing columns to quests
  const questColumns = db.prepare("PRAGMA table_info(quests)").all() as { name: string }[];
  const hasTimeLimit = questColumns.some(col => col.name === 'time_limit');
  const hasQuestType = questColumns.some(col => col.name === 'type');
  const hasAcceptedAt = questColumns.some(col => col.name === 'accepted_at');
  const hasCompletedAt = questColumns.some(col => col.name === 'completed_at');
  const hasGiverId = questColumns.some(col => col.name === 'giver_id');

  if (!hasTimeLimit) {
    db.exec(`ALTER TABLE quests ADD COLUMN time_limit INTEGER;`);
  }
  if (!hasQuestType) {
    db.exec(`ALTER TABLE quests ADD COLUMN type TEXT NOT NULL DEFAULT 'side';`);
  }
  if (!hasAcceptedAt) {
    db.exec(`ALTER TABLE quests ADD COLUMN accepted_at TEXT;`);
  }
  if (!hasCompletedAt) {
    db.exec(`ALTER TABLE quests ADD COLUMN completed_at TEXT;`);
  }
  if (!hasGiverId) {
    db.exec(`ALTER TABLE quests ADD COLUMN giver_id TEXT REFERENCES characters(id) ON DELETE SET NULL;`);
  }

  // 5.3 Quest logs table (T086)
  const questLogsExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='quest_logs'").get();
  if (!questLogsExists) {
    console.error('[Migration 001] Creating quest_logs table');
    db.exec(`
      CREATE TABLE IF NOT EXISTS quest_logs(
        character_id TEXT PRIMARY KEY,
        active_quests_json TEXT NOT NULL DEFAULT '[]',
        completed_quests_json TEXT NOT NULL DEFAULT '[]',
        failed_quests_json TEXT NOT NULL DEFAULT '[]',
        FOREIGN KEY(character_id) REFERENCES characters(id) ON DELETE CASCADE
      );
    `);
  } else {
    // Check for column naming conventions
    const qlCols = db.prepare("PRAGMA table_info(quest_logs)").all() as { name: string }[];
    const colNames = qlCols.map(c => c.name);

    if (colNames.includes('active_quests') && !colNames.includes('active_quests_json')) {
      console.error('[Migration 001] Renaming active_quests to active_quests_json in quest_logs');
      db.exec(`ALTER TABLE quest_logs RENAME COLUMN active_quests TO active_quests_json;`);
    }
    if (colNames.includes('completed_quests') && !colNames.includes('completed_quests_json')) {
      console.error('[Migration 001] Renaming completed_quests to completed_quests_json in quest_logs');
      db.exec(`ALTER TABLE quest_logs RENAME COLUMN completed_quests TO completed_quests_json;`);
    }
    if (colNames.includes('failed_quests') && !colNames.includes('failed_quests_json')) {
      console.error('[Migration 001] Renaming failed_quests to failed_quests_json in quest_logs');
      db.exec(`ALTER TABLE quest_logs RENAME COLUMN failed_quests TO failed_quests_json;`);
    }
  }

  // 5.4 Narrative notes table (T087)
  const narrativeNotesExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='narrative_notes'").get();
  if (!narrativeNotesExists) {
    console.error('[Migration 001] Creating narrative_notes table');
    db.exec(`
      CREATE TABLE IF NOT EXISTS narrative_notes(
        id TEXT PRIMARY KEY,
        world_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('plot_thread', 'canonical_moment', 'npc_voice', 'foreshadowing', 'session_log')),
        content TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        visibility TEXT NOT NULL DEFAULT 'dm_only' CHECK(visibility IN ('dm_only', 'player_visible')),
        tags_json TEXT NOT NULL DEFAULT '[]',
        entity_id TEXT,
        entity_type TEXT,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'resolved', 'dormant', 'archived')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
      );
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_narrative_notes_world ON narrative_notes(world_id);
      CREATE INDEX IF NOT EXISTS idx_narrative_notes_type ON narrative_notes(type);
      CREATE INDEX IF NOT EXISTS idx_narrative_notes_entity ON narrative_notes(entity_id, entity_type);
    `);
  } else {
    // Check columns and rename if needed
    const nnCols = db.prepare("PRAGMA table_info(narrative_notes)").all() as { name: string }[];
    const colNames = nnCols.map(c => c.name);
    
    if (colNames.includes('metadata') && !colNames.includes('metadata_json')) {
        console.error('[Migration 001] Renaming metadata to metadata_json in narrative_notes');
        db.exec(`ALTER TABLE narrative_notes RENAME COLUMN metadata TO metadata_json;`);
    }
    if (colNames.includes('tags') && !colNames.includes('tags_json')) {
        console.error('[Migration 001] Renaming tags to tags_json in narrative_notes');
        db.exec(`ALTER TABLE narrative_notes RENAME COLUMN tags TO tags_json;`);
    }

    // Ensure indexes exist even if table existed
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_narrative_notes_world ON narrative_notes(world_id);
      CREATE INDEX IF NOT EXISTS idx_narrative_notes_type ON narrative_notes(type);
      CREATE INDEX IF NOT EXISTS idx_narrative_notes_entity ON narrative_notes(entity_id, entity_type);
    `);
  }

  // ============================================================
  // DOMAIN 6: Social System Enhancements
  // ============================================================

  // 6.1 Add trust column to npc_relationships
  const npcRelColumns = db.prepare("PRAGMA table_info(npc_relationships)").all() as { name: string }[];
  const hasTrust = npcRelColumns.some(col => col.name === 'trust');
  if (!hasTrust) {
    db.exec(`ALTER TABLE npc_relationships ADD COLUMN trust INTEGER NOT NULL DEFAULT 50;`);
  }

  // 6.2 Add promises and secrets to conversation_memories
  const convMemColumns = db.prepare("PRAGMA table_info(conversation_memories)").all() as { name: string }[];
  const hasPromises = convMemColumns.some(col => col.name === 'promises_made');
  const hasSecretsRevealed = convMemColumns.some(col => col.name === 'secrets_revealed');
  if (!hasPromises) {
    db.exec(`ALTER TABLE conversation_memories ADD COLUMN promises_made TEXT;`);
  }
  if (!hasSecretsRevealed) {
    db.exec(`ALTER TABLE conversation_memories ADD COLUMN secrets_revealed TEXT;`);
  }

  // 6.3 Reputation tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS reputation_tracking (
      character_id TEXT NOT NULL,
      faction_id TEXT NOT NULL,
      reputation INTEGER NOT NULL DEFAULT 0,
      tier TEXT NOT NULL DEFAULT 'neutral',
      title TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(character_id, faction_id),
      FOREIGN KEY(character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_reputation_character ON reputation_tracking(character_id);
    CREATE INDEX IF NOT EXISTS idx_reputation_faction ON reputation_tracking(faction_id);
  `);

  // ============================================================
  // DOMAIN 7: World Design Layer
  // ============================================================

  // 7.1 Cultures table
  db.exec(`
    CREATE TABLE IF NOT EXISTS cultures (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      regions TEXT NOT NULL DEFAULT '[]',
      dominant_races TEXT NOT NULL DEFAULT '[]',
      cultural_values TEXT NOT NULL DEFAULT '{}',
      taboos TEXT NOT NULL DEFAULT '[]',
      customs TEXT NOT NULL DEFAULT '[]',
      religion TEXT NOT NULL DEFAULT '{}',
      government_type TEXT NOT NULL DEFAULT 'feudal',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_cultures_world ON cultures(world_id);
  `);

  // 7.2 Faction definitions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS faction_definitions (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'guild',
      description TEXT NOT NULL,
      motto TEXT,
      symbol TEXT,
      alignment_tendency TEXT,
      goals TEXT NOT NULL DEFAULT '{}',
      resources TEXT NOT NULL DEFAULT '[]',
      territory TEXT NOT NULL DEFAULT '[]',
      headquarters TEXT,
      population INTEGER,
      military_strength TEXT DEFAULT 'moderate',
      key_npcs TEXT NOT NULL DEFAULT '[]',
      secrets TEXT NOT NULL DEFAULT '[]',
      reputation_tiers TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_faction_definitions_world ON faction_definitions(world_id);
    CREATE INDEX IF NOT EXISTS idx_faction_definitions_type ON faction_definitions(type);
  `);

  // 7.3 Faction relationships table
  db.exec(`
    CREATE TABLE IF NOT EXISTS faction_relationships (
      from_faction_id TEXT NOT NULL,
      to_faction_id TEXT NOT NULL,
      stance TEXT NOT NULL DEFAULT 'neutral',
      reason TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(from_faction_id, to_faction_id),
      FOREIGN KEY(from_faction_id) REFERENCES faction_definitions(id) ON DELETE CASCADE,
      FOREIGN KEY(to_faction_id) REFERENCES faction_definitions(id) ON DELETE CASCADE
    );
  `);

  // 7.4 Lore entries table
  db.exec(`
    CREATE TABLE IF NOT EXISTS lore_entries (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'historical_event',
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      full_text TEXT NOT NULL,
      era TEXT,
      years_ago INTEGER,
      participants TEXT NOT NULL DEFAULT '[]',
      locations_involved TEXT NOT NULL DEFAULT '[]',
      consequences TEXT NOT NULL DEFAULT '[]',
      known_by TEXT NOT NULL DEFAULT '{}',
      is_true INTEGER NOT NULL DEFAULT 1,
      secret_truth TEXT,
      quest_hooks TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_lore_entries_world ON lore_entries(world_id);
    CREATE INDEX IF NOT EXISTS idx_lore_entries_type ON lore_entries(type);
    CREATE INDEX IF NOT EXISTS idx_lore_entries_era ON lore_entries(era);
  `);

  // 7.5 NPC backgrounds table
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_backgrounds (
      npc_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      personality TEXT NOT NULL DEFAULT '{}',
      voice TEXT NOT NULL DEFAULT '{}',
      goals TEXT NOT NULL DEFAULT '{}',
      backstory TEXT NOT NULL DEFAULT '{}',
      faction_memberships TEXT NOT NULL DEFAULT '[]',
      relationships TEXT NOT NULL DEFAULT '[]',
      secrets TEXT NOT NULL DEFAULT '[]',
      knowledge TEXT NOT NULL DEFAULT '[]',
      schedule TEXT NOT NULL DEFAULT '[]',
      rumors_about TEXT NOT NULL DEFAULT '[]',
      notable_skills TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(npc_id) REFERENCES characters(id) ON DELETE CASCADE
    );
  `);

  // ============================================================
  // DOMAIN 8: Schema Metadata
  // ============================================================

  // Create schema version tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Record this migration
  db.prepare(`
    INSERT OR REPLACE INTO _schema_meta (key, value, updated_at)
    VALUES ('migration_001_database_architecture', 'completed', datetime('now'))
  `).run();

  console.error('[Migration 001] Database architecture migration completed successfully.');
}

/**
 * Check if this migration has already been applied.
 */
export function isMigration001Applied(db: Database.Database): boolean {
  try {
    const result = db.prepare(`
      SELECT value FROM _schema_meta WHERE key = 'migration_001_database_architecture'
    `).get() as { value: string } | undefined;
    return result?.value === 'completed';
  } catch {
    // Table doesn't exist yet
    return false;
  }
}

/**
 * Rollback migration 001 (for development/testing only).
 * WARNING: This will drop tables and lose data!
 */
export function rollback001DatabaseArchitecture(db: Database.Database): void {
  console.error('[Migration 001] Rolling back database architecture migration...');
  
  // Drop indexes first (before dropping any tables that might reference them)
  const indexesToDrop = [
    // event_logs indexes
    'idx_event_logs_world_time',
    'idx_event_logs_hash',
    'idx_event_logs_type',
    'idx_event_logs_actor',
    'idx_event_logs_prev_hash',
    // snapshots indexes (T030)
    'idx_snapshots_world',
    'idx_snapshots_event',
    // rng_state indexes (T031)
    'idx_rng_state_world',
    // audit_logs indexes
    'idx_audit_logs_world_time',
    'idx_audit_logs_session',
    'idx_audit_logs_category',
    'idx_audit_logs_importance',
    // event_inbox indexes
    'idx_event_inbox_pending',
    'idx_event_inbox_expires',
    // world data indexes (T043-T046)
    'idx_regions_world',
    'idx_tiles_region',
    'idx_tiles_region_pos',
    'idx_structures_region',
    'idx_structures_tile',
    'idx_room_nodes_structure',
    // character/entity indexes (T059-T062)
    'idx_characters_world',
    'idx_characters_location',
    'idx_characters_type',
    'idx_monsters_world',
    'idx_monsters_location',
    'idx_monsters_state',
    'idx_corpses_location',
    'idx_corpses_state',
  ];

  for (const index of indexesToDrop) {
    try {
      db.exec(`DROP INDEX IF EXISTS ${index};`);
      console.error(`[Migration 001] Dropped index: ${index}`);
    } catch (e) {
      console.error(`[Migration 001] Failed to drop index ${index}:`, (e as Error).message);
    }
  }

  // Drop new tables in reverse dependency order
  const tablesToDrop = [
    'npc_backgrounds',
    'lore_entries',
    'faction_relationships',
    'faction_definitions',
    'cultures',
    'reputation_tracking',
    'quest_objectives',
    'combat_tokens',
    'concentration_tracking',
    'character_conditions',
    'character_spells',
    'corpses',        // T062: Drop corpses before characters (references source_id)
    'monsters',       // T061: Drop monsters before room_nodes (FK dependency)
    'npcs',           // T060: Drop npcs before characters (FK dependency)
    'characters',     // T059: Drop characters after dependent tables
    'room_exits',
    'room_nodes',     // T046: Drop room_nodes before structures (FK dependency)
    'tiles',          // T044: Drop tiles before structures and regions (FK dependencies)
    'structures',     // T045: Drop structures before regions (FK dependency)
    'regions',        // T043: Drop regions after dependent tables
    'rng_state',
    'event_inbox',    // Drop event_inbox table (async event processing)
    'snapshots',
    'event_logs',     // Drop event_logs table (created by this migration)
  ];

  for (const table of tablesToDrop) {
    try {
      db.exec(`DROP TABLE IF EXISTS ${table};`);
      console.error(`[Migration 001] Dropped table: ${table}`);
    } catch (e) {
      console.error(`[Migration 001] Failed to drop ${table}:`, (e as Error).message);
    }
  }

  // Remove migration record
  try {
    db.prepare(`DELETE FROM _schema_meta WHERE key = 'migration_001_database_architecture'`).run();
  } catch {
    // Ignore if _schema_meta doesn't exist
  }

  console.error('[Migration 001] Rollback completed.');
}
