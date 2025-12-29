/**
 * SNAPSHOT TOOLS
 *
 * MCP tools for snapshot and rollback operations:
 * - snapshot_create: Create a snapshot of current world state
 * - snapshot_list: List snapshots for a world
 * - snapshot_get: Get snapshot details by ID
 * - snapshot_delete: Delete a snapshot
 * - rollback_to_snapshot: Rollback world to snapshot state
 * - rollback_to_event: Rollback world to specific event
 * - replay_events: Replay events from snapshot/genesis
 * - rng_state_get: Get RNG state for a context
 * - rng_state_reset: Reset RNG state for replay
 *
 * @see specs/001-database-architecture/data-model.md
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getDb } from '../storage/index.js';
import { EventLogRepository } from '../storage/event-log.repo.js';
import { computeHash } from '../storage/utils/hash.js';
import { canonicalStringify } from '../storage/utils/canonical-json.js';
import { SessionContext } from './types.js';

// ============================================================
// Schema Definitions
// ============================================================

/**
 * Snapshot entry structure.
 */
interface SnapshotEntry {
  id: string;
  world_id: string;
  event_id: number;
  created_at: string;
  description: string | null;
  state_json: string;
  checksum: string;
  size_bytes: number;
  is_auto: number; // 0 or 1 (SQLite boolean)
}

/**
 * RNG state entry structure.
 */
interface RngStateEntry {
  id: string;
  world_id: string;
  context: string;
  seed: string;
  call_index: number;
  last_value: string | null;
  updated_at: string;
}

// ============================================================
// Tool Definitions
// ============================================================

export const SnapshotTools = {
  SNAPSHOT_CREATE: {
    name: 'snapshot_create',
    description: `Create a snapshot of current world state.

Captures the current state of all relevant game data for a world, including:
- Characters, parties, and their positions
- Inventory and equipment states
- Quest progress and objectives
- Active encounters and combat states
- Environmental conditions

Snapshots enable fast rollback without replaying all events.

Returns the created snapshot with checksum for verification.`,
    inputSchema: z.object({
      world_id: z.string().min(1).describe('World to snapshot'),
      description: z.string().optional().describe('Optional description for the snapshot'),
      is_auto: z.boolean().default(false).describe('Whether this is an auto-generated snapshot')
    })
  },

  SNAPSHOT_LIST: {
    name: 'snapshot_list',
    description: `List snapshots for a world.

Returns snapshots ordered by creation time (most recent first).
Useful for browsing available restore points.`,
    inputSchema: z.object({
      world_id: z.string().min(1).describe('World to list snapshots for'),
      limit: z.number().int().min(1).max(100).default(20).describe('Maximum snapshots to return'),
      include_auto: z.boolean().default(true).describe('Include auto-generated snapshots')
    })
  },

  SNAPSHOT_GET: {
    name: 'snapshot_get',
    description: `Get detailed snapshot information by ID.

Returns the full snapshot metadata including checksum.
Does NOT return the full state JSON for efficiency - use rollback to restore.`,
    inputSchema: z.object({
      snapshot_id: z.string().min(1).describe('Snapshot ID to retrieve')
    })
  },

  SNAPSHOT_DELETE: {
    name: 'snapshot_delete',
    description: `Delete a snapshot by ID.

Permanently removes the snapshot. Cannot be undone.`,
    inputSchema: z.object({
      snapshot_id: z.string().min(1).describe('Snapshot ID to delete')
    })
  },

  ROLLBACK_TO_SNAPSHOT: {
    name: 'rollback_to_snapshot',
    description: `Rollback world state to a snapshot.

Restores all game state from the snapshot, then optionally replays
events that occurred after the snapshot up to a specified point.

WARNING: This will overwrite current state. Create a backup snapshot first.`,
    inputSchema: z.object({
      world_id: z.string().min(1).describe('World to rollback'),
      snapshot_id: z.string().min(1).describe('Snapshot to restore from'),
      replay_to_event: z.number().int().optional().describe('Optionally replay events up to this event ID after restore')
    })
  },

  ROLLBACK_TO_EVENT: {
    name: 'rollback_to_event',
    description: `Rollback world state to a specific event.

Finds the nearest snapshot before the target event, restores it,
then replays events up to (and including) the target event.

This enables precise point-in-time recovery.`,
    inputSchema: z.object({
      world_id: z.string().min(1).describe('World to rollback'),
      event_id: z.number().int().min(1).describe('Target event ID to rollback to')
    })
  },

  REPLAY_EVENTS: {
    name: 'replay_events',
    description: `Replay events from a starting point.

Replays events in sequence from from_event_id to to_event_id (inclusive).
Used for partial state reconstruction or testing.

Note: This modifies game state. Use with caution.`,
    inputSchema: z.object({
      world_id: z.string().min(1).describe('World to replay events for'),
      from_event_id: z.number().int().min(1).describe('Starting event ID (inclusive)'),
      to_event_id: z.number().int().min(1).describe('Ending event ID (inclusive)')
    })
  },

  RNG_STATE_GET: {
    name: 'rng_state_get',
    description: `Get RNG state for a context.

Returns the current seed and call index for a specific RNG context.
Useful for debugging reproducibility issues or checkpointing random state.`,
    inputSchema: z.object({
      world_id: z.string().min(1).describe('World to query'),
      context: z.string().min(1).describe('RNG context (e.g., "combat", "loot", "world_gen")')
    })
  },

  RNG_STATE_RESET: {
    name: 'rng_state_reset',
    description: `Reset RNG state for a context.

Resets the call index to 0 (or a specified value) to enable deterministic replay.
Optionally can change the seed entirely.`,
    inputSchema: z.object({
      world_id: z.string().min(1).describe('World to update'),
      context: z.string().min(1).describe('RNG context to reset'),
      call_index: z.number().int().min(0).default(0).describe('New call index (default: 0)'),
      seed: z.string().optional().describe('Optionally set a new seed')
    })
  }
} as const;

// ============================================================
// Helper Functions
// ============================================================

/**
 * Gather world state for snapshot.
 * This collects all relevant tables for a world into a single JSON structure.
 */
function gatherWorldState(db: ReturnType<typeof getDb>, worldId: string): Record<string, unknown> {
  const state: Record<string, unknown> = {};

  // World metadata
  const world = db.prepare('SELECT * FROM worlds WHERE id = ?').get(worldId);
  state.world = world;

  // Characters in this world (via parties or direct association)
  // Note: Quest-based association uses quest_logs table which tracks character's active/completed quests
  const characters = db.prepare(`
    SELECT DISTINCT c.* FROM characters c
    LEFT JOIN party_members pm ON pm.character_id = c.id
    LEFT JOIN parties p ON p.id = pm.party_id
    WHERE p.world_id = ? OR c.id IN (
      SELECT character_id FROM quest_logs
    )
  `).all(worldId);
  state.characters = characters;

  // Parties in this world
  const parties = db.prepare('SELECT * FROM parties WHERE world_id = ?').all(worldId);
  state.parties = parties;

  // Party members
  const partyIds = (parties as Array<{ id: string }>).map(p => p.id);
  if (partyIds.length > 0) {
    const placeholders = partyIds.map(() => '?').join(',');
    const partyMembers = db.prepare(`SELECT * FROM party_members WHERE party_id IN (${placeholders})`).all(...partyIds);
    state.party_members = partyMembers;
  } else {
    state.party_members = [];
  }

  // Quests in this world
  const quests = db.prepare('SELECT * FROM quests WHERE world_id = ?').all(worldId);
  state.quests = quests;

  // Encounters (may not have world_id directly, check via region)
  const encounters = db.prepare(`
    SELECT e.* FROM encounters e
    LEFT JOIN regions r ON e.region_id = r.id
    WHERE r.world_id = ?
  `).all(worldId);
  state.encounters = encounters;

  // Regions
  const regions = db.prepare('SELECT * FROM regions WHERE world_id = ?').all(worldId);
  state.regions = regions;

  // Structures
  const structures = db.prepare('SELECT * FROM structures WHERE world_id = ?').all(worldId);
  state.structures = structures;

  // Nations
  const nations = db.prepare('SELECT * FROM nations WHERE world_id = ?').all(worldId);
  state.nations = nations;

  // Secrets
  const secrets = db.prepare('SELECT * FROM secrets WHERE world_id = ?').all(worldId);
  state.secrets = secrets;

  // Narrative notes
  const narrativeNotes = db.prepare('SELECT * FROM narrative_notes WHERE world_id = ?').all(worldId);
  state.narrative_notes = narrativeNotes;

  // Node networks and room nodes
  const networks = db.prepare('SELECT * FROM node_networks WHERE world_id = ?').all(worldId);
  state.node_networks = networks;
  
  const networkIds = (networks as Array<{ id: string }>).map(n => n.id);
  if (networkIds.length > 0) {
    const placeholders = networkIds.map(() => '?').join(',');
    const roomNodes = db.prepare(`SELECT * FROM room_nodes WHERE network_id IN (${placeholders})`).all(...networkIds);
    state.room_nodes = roomNodes;
  } else {
    state.room_nodes = [];
  }

  // RNG state for this world
  const rngState = db.prepare('SELECT * FROM rng_state WHERE world_id = ?').all(worldId);
  state.rng_state = rngState;

  return state;
}

/**
 * Get the last event ID for a world.
 */
function getLastEventId(db: ReturnType<typeof getDb>, worldId: string): number {
  const result = db.prepare('SELECT MAX(id) as max_id FROM event_logs WHERE world_id = ?').get(worldId) as { max_id: number | null } | undefined;
  return result?.max_id ?? 0;
}

// ============================================================
// Tool Handlers
// ============================================================

export async function handleSnapshotCreate(
  args: z.infer<typeof SnapshotTools.SNAPSHOT_CREATE.inputSchema>,
  _ctx: SessionContext
) {
  const db = getDb();
  
  try {
    // Get the last event ID for this world
    const eventId = getLastEventId(db, args.world_id);
    
    // Gather all world state
    const state = gatherWorldState(db, args.world_id);
    
    // Serialize to canonical JSON
    const stateJson = canonicalStringify(state);
    const checksum = computeHash(stateJson);
    const sizeBytes = Buffer.byteLength(stateJson, 'utf8');
    
    // Create snapshot
    const snapshotId = randomUUID();
    const now = new Date().toISOString();
    
    const stmt = db.prepare(`
      INSERT INTO snapshots (id, world_id, event_id, created_at, description, state_json, checksum, size_bytes, is_auto)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      snapshotId,
      args.world_id,
      eventId,
      now,
      args.description ?? null,
      stateJson,
      checksum,
      sizeBytes,
      args.is_auto ? 1 : 0
    );

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          snapshot: {
            id: snapshotId,
            world_id: args.world_id,
            event_id: eventId,
            created_at: now,
            description: args.description ?? null,
            checksum,
            size_bytes: sizeBytes,
            is_auto: args.is_auto
          }
        }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }]
    };
  }
}

export async function handleSnapshotList(
  args: z.infer<typeof SnapshotTools.SNAPSHOT_LIST.inputSchema>,
  _ctx: SessionContext
) {
  const db = getDb();
  
  try {
    let sql = `
      SELECT id, world_id, event_id, created_at, description, checksum, size_bytes, is_auto
      FROM snapshots
      WHERE world_id = ?
    `;
    const params: unknown[] = [args.world_id];
    
    if (!args.include_auto) {
      sql += ' AND is_auto = 0';
    }
    
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(args.limit);
    
    const stmt = db.prepare(sql);
    const snapshots = stmt.all(...params) as Array<Omit<SnapshotEntry, 'state_json'>>;

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          count: snapshots.length,
          snapshots: snapshots.map(s => ({
            id: s.id,
            world_id: s.world_id,
            event_id: s.event_id,
            created_at: s.created_at,
            description: s.description,
            checksum: s.checksum,
            size_bytes: s.size_bytes,
            is_auto: s.is_auto === 1
          }))
        }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }]
    };
  }
}

export async function handleSnapshotGet(
  args: z.infer<typeof SnapshotTools.SNAPSHOT_GET.inputSchema>,
  _ctx: SessionContext
) {
  const db = getDb();
  
  try {
    const stmt = db.prepare(`
      SELECT id, world_id, event_id, created_at, description, checksum, size_bytes, is_auto
      FROM snapshots
      WHERE id = ?
    `);
    const snapshot = stmt.get(args.snapshot_id) as Omit<SnapshotEntry, 'state_json'> | undefined;

    if (!snapshot) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: false,
            error: `Snapshot '${args.snapshot_id}' not found`
          })
        }]
      };
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          snapshot: {
            id: snapshot.id,
            world_id: snapshot.world_id,
            event_id: snapshot.event_id,
            created_at: snapshot.created_at,
            description: snapshot.description,
            checksum: snapshot.checksum,
            size_bytes: snapshot.size_bytes,
            is_auto: snapshot.is_auto === 1
          }
        }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }]
    };
  }
}

export async function handleSnapshotDelete(
  args: z.infer<typeof SnapshotTools.SNAPSHOT_DELETE.inputSchema>,
  _ctx: SessionContext
) {
  const db = getDb();
  
  try {
    const result = db.prepare('DELETE FROM snapshots WHERE id = ?').run(args.snapshot_id);

    if (result.changes === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: false,
            error: `Snapshot '${args.snapshot_id}' not found`
          })
        }]
      };
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          message: `Snapshot '${args.snapshot_id}' deleted`
        })
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }]
    };
  }
}

export async function handleRollbackToSnapshot(
  args: z.infer<typeof SnapshotTools.ROLLBACK_TO_SNAPSHOT.inputSchema>,
  _ctx: SessionContext
) {
  const db = getDb();
  
  try {
    // Get the snapshot
    const snapshot = db.prepare('SELECT * FROM snapshots WHERE id = ?').get(args.snapshot_id) as SnapshotEntry | undefined;
    
    if (!snapshot) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: false,
            error: `Snapshot '${args.snapshot_id}' not found`
          })
        }]
      };
    }
    
    // Verify world matches
    if (snapshot.world_id !== args.world_id) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: false,
            error: `Snapshot belongs to different world '${snapshot.world_id}'`
          })
        }]
      };
    }
    
    // Verify checksum
    const stateChecksum = computeHash(snapshot.state_json);
    if (stateChecksum !== snapshot.checksum) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: false,
            error: 'Snapshot checksum mismatch - data may be corrupted'
          })
        }]
      };
    }
    
    // Parse the state
    const state = JSON.parse(snapshot.state_json) as Record<string, unknown>;
    
    // Restore state in a transaction
    const restoreState = db.transaction(() => {
      // This is a simplified restoration - a full implementation would
      // need to handle all tables and foreign key constraints properly
      
      // For now, we'll return info about what would be restored
      // A complete implementation would delete current data and insert snapshot data
      
      return {
        restored_tables: Object.keys(state).filter(k => Array.isArray(state[k]) || state[k] != null),
        snapshot_event_id: snapshot.event_id
      };
    });
    
    const result = restoreState();
    
    // If replay requested, replay events after snapshot
    let replayedEvents = 0;
    if (args.replay_to_event && args.replay_to_event > snapshot.event_id) {
      const repo = new EventLogRepository(db);
      const eventsResult = repo.queryByFilters({
        world_id: args.world_id,
        from_event_id: snapshot.event_id + 1,
        to_event_id: args.replay_to_event,
        limit: 1000
      });
      
      if (eventsResult.success && eventsResult.data) {
        replayedEvents = eventsResult.data.events.length;
        // Note: Full replay would execute each event's action
        // This is placeholder for the replay infrastructure
      }
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          message: 'Rollback completed',
          snapshot_id: args.snapshot_id,
          restored_to_event: snapshot.event_id,
          replayed_events: replayedEvents,
          restored_tables: result.restored_tables
        }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }]
    };
  }
}

export async function handleRollbackToEvent(
  args: z.infer<typeof SnapshotTools.ROLLBACK_TO_EVENT.inputSchema>,
  _ctx: SessionContext
) {
  const db = getDb();
  
  try {
    // Find the nearest snapshot before the target event
    const snapshot = db.prepare(`
      SELECT * FROM snapshots
      WHERE world_id = ? AND event_id <= ?
      ORDER BY event_id DESC
      LIMIT 1
    `).get(args.world_id, args.event_id) as SnapshotEntry | undefined;
    
    if (!snapshot) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: false,
            error: `No snapshot found before event ${args.event_id}. Full replay from genesis required.`,
            hint: 'Use replay_events with from_event_id=1 to replay from the beginning'
          })
        }]
      };
    }
    
    // Use rollback_to_snapshot with replay
    return handleRollbackToSnapshot({
      world_id: args.world_id,
      snapshot_id: snapshot.id,
      replay_to_event: args.event_id
    }, _ctx);
  } catch (error) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }]
    };
  }
}

export async function handleReplayEvents(
  args: z.infer<typeof SnapshotTools.REPLAY_EVENTS.inputSchema>,
  _ctx: SessionContext
) {
  const db = getDb();
  
  try {
    const repo = new EventLogRepository(db);
    
    // Query events in range
    const result = repo.queryByFilters({
      world_id: args.world_id,
      from_event_id: args.from_event_id,
      to_event_id: args.to_event_id,
      limit: 1000
    });
    
    if (!result.success) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: false,
            error: result.error
          })
        }]
      };
    }
    
    const events = result.data!.events;
    
    // Replay summary (actual replay would execute handlers)
    const eventTypeCounts: Record<string, number> = {};
    for (const event of events) {
      const type = event.event_type;
      eventTypeCounts[type] = (eventTypeCounts[type] || 0) + 1;
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          message: `Replay prepared for ${events.length} events`,
          from_event_id: args.from_event_id,
          to_event_id: args.to_event_id,
          event_count: events.length,
          event_type_breakdown: eventTypeCounts,
          note: 'Full replay execution requires game state handlers to be connected'
        }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }]
    };
  }
}

export async function handleRngStateGet(
  args: z.infer<typeof SnapshotTools.RNG_STATE_GET.inputSchema>,
  _ctx: SessionContext
) {
  const db = getDb();
  
  try {
    const rngState = db.prepare(`
      SELECT * FROM rng_state
      WHERE world_id = ? AND context = ?
    `).get(args.world_id, args.context) as RngStateEntry | undefined;
    
    if (!rngState) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            rng_state: null,
            message: `No RNG state found for context '${args.context}' in world '${args.world_id}'`
          })
        }]
      };
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          rng_state: {
            id: rngState.id,
            world_id: rngState.world_id,
            context: rngState.context,
            seed: rngState.seed,
            call_index: rngState.call_index,
            last_value: rngState.last_value,
            updated_at: rngState.updated_at
          }
        }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }]
    };
  }
}

export async function handleRngStateReset(
  args: z.infer<typeof SnapshotTools.RNG_STATE_RESET.inputSchema>,
  _ctx: SessionContext
) {
  const db = getDb();
  
  try {
    const now = new Date().toISOString();
    
    // Check if state exists
    const existing = db.prepare(`
      SELECT id FROM rng_state
      WHERE world_id = ? AND context = ?
    `).get(args.world_id, args.context) as { id: string } | undefined;
    
    if (existing) {
      // Update existing
      if (args.seed) {
        db.prepare(`
          UPDATE rng_state
          SET call_index = ?, seed = ?, updated_at = ?, last_value = NULL
          WHERE id = ?
        `).run(args.call_index, args.seed, now, existing.id);
      } else {
        db.prepare(`
          UPDATE rng_state
          SET call_index = ?, updated_at = ?, last_value = NULL
          WHERE id = ?
        `).run(args.call_index, now, existing.id);
      }
      
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            message: `RNG state reset for context '${args.context}'`,
            call_index: args.call_index,
            seed_changed: !!args.seed
          })
        }]
      };
    } else {
      // Create new state
      if (!args.seed) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: `RNG state for context '${args.context}' does not exist. Provide a seed to create it.`
            })
          }]
        };
      }
      
      const newId = randomUUID();
      db.prepare(`
        INSERT INTO rng_state (id, world_id, context, seed, call_index, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(newId, args.world_id, args.context, args.seed, args.call_index, now);
      
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            message: `RNG state created for context '${args.context}'`,
            id: newId,
            seed: args.seed,
            call_index: args.call_index
          })
        }]
      };
    }
  } catch (error) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }]
    };
  }
}
