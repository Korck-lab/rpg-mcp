/**
 * EVENT LOG TOOLS
 *
 * MCP tools for event log operations (hash-chained event sourcing):
 * - event_log_append: Append event to log with hash chaining
 * - event_log_query: Query events with filters
 * - event_log_verify_chain: Verify hash chain integrity
 * - event_log_get_last: Get last N events
 *
 * MCP tools for audit log operations (human-readable):
 * - audit_log_create: Create human-readable audit entry
 * - audit_log_query: Query audit logs
 *
 * MCP tools for event inbox operations:
 * - event_inbox_enqueue: Add event to inbox for deferred processing
 * - event_inbox_process: Process pending inbox events
 *
 * @see specs/001-database-architecture/data-model.md
 */

import { z } from 'zod';
import { getDb } from '../storage/index.js';
import { EventLogRepository, EventType } from '../storage/event-log.repo.js';
import { AuditLogRepository, AuditCategory, AuditImportance } from '../storage/audit-log.repo.js';
// Note: EventInboxRepository types imported for reference but inbox operations use direct SQL
// import { EventInboxRepository, EventType as InboxEventType, SourceType } from '../storage/repos/event-inbox.repo.js';
import { SessionContext } from './types.js';

// ============================================================
// Schema Definitions
// ============================================================

const EventTypeEnum = z.enum(['combat', 'movement', 'spell', 'item', 'quest', 'social', 'system']);
const AuditCategoryEnum = z.enum(['combat', 'exploration', 'social', 'quest', 'system', 'dm']);
const AuditImportanceEnum = z.enum(['low', 'normal', 'high', 'critical']);
const InboxEventTypeEnum = z.enum([
  'npc_action', 'combat_update', 'world_change', 'quest_update',
  'time_passage', 'environmental', 'system'
]);
const InboxSourceTypeEnum = z.enum(['npc', 'combat', 'world', 'system', 'scheduler']);
// Status values: 'pending', 'processing', 'completed', 'failed', 'expired'

// ============================================================
// Event Log Tool Definitions
// ============================================================

export const EventLogTools = {
  EVENT_LOG_APPEND: {
    name: 'event_log_append',
    description: `Append an event to the event log with automatic hash chaining.

Events are immutably stored with cryptographic hash linking for tamper detection.
Each event's hash incorporates the previous event's hash, creating a verifiable chain.

Use for: Combat actions, item transactions, quest updates, character movements - any
game state change that needs an audit trail.

Returns the created event with its computed hash.`,
    inputSchema: z.object({
      world_id: z.string().min(1).describe('World/session this event belongs to'),
      event_type: EventTypeEnum.describe('Category of the event'),
      actor_id: z.string().optional().describe('ID of entity performing the action'),
      target_id: z.string().optional().describe('ID of target entity'),
      payload: z.record(z.unknown()).default({}).describe('Event-specific data (JSON object)')
    })
  },

  EVENT_LOG_QUERY: {
    name: 'event_log_query',
    description: `Query events with flexible filtering and pagination.

Supports filtering by event type, actor, timestamp range, and event ID range.
Returns events in chronological order (oldest first).

Use for: Replaying events, debugging, investigating game history.`,
    inputSchema: z.object({
      world_id: z.string().min(1).describe('World to query'),
      event_type: EventTypeEnum.optional().describe('Filter by event category'),
      actor_id: z.string().optional().describe('Filter by actor'),
      from_timestamp: z.string().optional().describe('Filter events after this ISO timestamp'),
      to_timestamp: z.string().optional().describe('Filter events before this ISO timestamp'),
      from_event_id: z.number().int().optional().describe('Filter events with ID >= this'),
      to_event_id: z.number().int().optional().describe('Filter events with ID <= this'),
      limit: z.number().int().min(1).max(1000).default(100).describe('Max events to return')
    })
  },

  EVENT_LOG_VERIFY_CHAIN: {
    name: 'event_log_verify_chain',
    description: `Verify the integrity of the hash chain for a world.

Checks that:
1. Each event's hash matches its computed canonical hash
2. Each event's prev_hash matches the previous event's hash
3. The first event's prev_hash equals GENESIS_HASH

Use for: Tamper detection, data integrity verification, debugging.`,
    inputSchema: z.object({
      world_id: z.string().min(1).describe('World to verify'),
      from_id: z.number().int().optional().describe('Start verification from this event ID'),
      to_id: z.number().int().optional().describe('End verification at this event ID')
    })
  },

  EVENT_LOG_GET_LAST: {
    name: 'event_log_get_last',
    description: `Get the last N events for a world.

Returns events in reverse chronological order (most recent first).
Useful for getting recent activity without complex queries.`,
    inputSchema: z.object({
      world_id: z.string().min(1).describe('World to query'),
      limit: z.number().int().min(1).max(100).default(10).describe('Number of events to return')
    })
  }
} as const;

// ============================================================
// Audit Log Tool Definitions
// ============================================================

export const AuditLogTools = {
  AUDIT_LOG_CREATE: {
    name: 'audit_log_create',
    description: `Create a human-readable audit log entry.

Audit logs are separate from technical event logs:
- event_logs: Technical, for replay and verification (JSON payloads, hash-chained)
- audit_logs: Human-readable, for player/DM viewing (text descriptions)

Example: "Gandalf casts Fireball, dealing 32 damage to 3 goblins"

Categories:
- combat: Combat actions, damage, healing
- exploration: Movement, entering areas, discovering locations
- social: NPC interactions, dialogue, persuasion
- quest: Quest acceptance, objectives, completion
- system: World events, time passage, environmental changes
- dm: DM-initiated events, rule adjudications`,
    inputSchema: z.object({
      world_id: z.string().min(1).describe('World this entry belongs to'),
      session_id: z.string().optional().describe('Session this entry was created in'),
      category: AuditCategoryEnum.describe('Category for filtering'),
      actor_name: z.string().optional().describe('Human-readable actor name'),
      description: z.string().min(1).describe('Human-readable description of what happened'),
      details: z.record(z.unknown()).optional().describe('Optional additional details (JSON)'),
      importance: AuditImportanceEnum.default('normal').describe('Importance level'),
      event_log_id: z.number().int().optional().describe('Link to technical event log entry')
    })
  },

  AUDIT_LOG_QUERY: {
    name: 'audit_log_query',
    description: `Query audit logs with filters.

Returns entries in reverse chronological order (most recent first).
Supports filtering by session, category, importance level, and timestamp range.

Use for: Session recaps, player history, DM review.`,
    inputSchema: z.object({
      world_id: z.string().min(1).describe('World to query'),
      session_id: z.string().optional().describe('Filter by session'),
      category: AuditCategoryEnum.optional().describe('Filter by category'),
      importance: AuditImportanceEnum.optional().describe('Filter by minimum importance'),
      from_timestamp: z.string().optional().describe('Filter entries after this timestamp'),
      to_timestamp: z.string().optional().describe('Filter entries before this timestamp'),
      limit: z.number().int().min(1).max(500).default(100).describe('Max entries to return'),
      offset: z.number().int().min(0).default(0).describe('Offset for pagination')
    })
  }
} as const;

// ============================================================
// Event Inbox Tool Definitions (Extended)
// ============================================================

export const EventInboxExtendedTools = {
  EVENT_INBOX_ENQUEUE: {
    name: 'event_inbox_enqueue',
    description: `Add an event to the inbox for deferred or scheduled processing.

Unlike push_event (immediate notification), enqueue is for events that need
processing at a specific time or after certain conditions are met.

Use for:
- Timed effects expiring
- Scheduled NPC actions
- Delayed consequences
- World events triggered by time passage

Set process_after for deferred processing, expires_at for auto-expiration.`,
    inputSchema: z.object({
      world_id: z.string().min(1).describe('World this event belongs to'),
      event_type: InboxEventTypeEnum.describe('Type of event'),
      payload: z.record(z.unknown()).default({}).describe('Event data (JSON object)'),
      process_after: z.string().optional().describe('ISO timestamp to process after (null = immediate)'),
      expires_at: z.string().optional().describe('ISO timestamp when event expires'),
      source_type: InboxSourceTypeEnum.optional().describe('Source of event'),
      source_id: z.string().optional().describe('ID of source entity')
    })
  },

  EVENT_INBOX_PROCESS: {
    name: 'event_inbox_process',
    description: `Process pending inbox events that are ready.

Retrieves pending events where process_after <= now (or null).
Returns events to be processed and optionally marks them as processing.

Use at the start of turns, time advances, or periodic processing.`,
    inputSchema: z.object({
      world_id: z.string().min(1).describe('World to process events for'),
      limit: z.number().int().min(1).max(50).default(10).describe('Max events to process'),
      mark_processing: z.boolean().default(true).describe('Mark events as processing (prevents double-processing)')
    })
  },

  EVENT_INBOX_COMPLETE: {
    name: 'event_inbox_complete',
    description: `Mark inbox events as completed after successful processing.`,
    inputSchema: z.object({
      event_ids: z.array(z.number().int()).min(1).describe('IDs of events to mark complete')
    })
  },

  EVENT_INBOX_FAIL: {
    name: 'event_inbox_fail',
    description: `Mark inbox events as failed with error message.`,
    inputSchema: z.object({
      event_ids: z.array(z.number().int()).min(1).describe('IDs of events that failed'),
      error: z.string().describe('Error message describing the failure')
    })
  }
} as const;

// ============================================================
// Event Log Tool Handlers
// ============================================================

export async function handleEventLogAppend(
  args: z.infer<typeof EventLogTools.EVENT_LOG_APPEND.inputSchema>,
  _ctx: SessionContext
) {
  const repo = new EventLogRepository(getDb());
  const result = repo.append(
    args.world_id,
    args.event_type as EventType,
    args.actor_id ?? null,
    args.target_id ?? null,
    args.payload
  );

  if (!result.success) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: false, error: result.error })
      }]
    };
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        success: true,
        event: {
          id: result.data!.id,
          world_id: result.data!.world_id,
          timestamp: result.data!.timestamp,
          event_type: result.data!.event_type,
          actor_id: result.data!.actor_id,
          target_id: result.data!.target_id,
          hash: result.data!.hash,
          prev_hash: result.data!.prev_hash
        }
      }, null, 2)
    }]
  };
}

export async function handleEventLogQuery(
  args: z.infer<typeof EventLogTools.EVENT_LOG_QUERY.inputSchema>,
  _ctx: SessionContext
) {
  const repo = new EventLogRepository(getDb());
  const result = repo.queryByFilters({
    world_id: args.world_id,
    event_type: args.event_type as EventType | undefined,
    actor_id: args.actor_id,
    from_timestamp: args.from_timestamp,
    to_timestamp: args.to_timestamp,
    from_event_id: args.from_event_id,
    to_event_id: args.to_event_id,
    limit: args.limit
  });

  if (!result.success) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: false, error: result.error })
      }]
    };
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        success: true,
        total_count: result.data!.total_count,
        has_more: result.data!.has_more,
        events: result.data!.events.map(e => ({
          id: e.id,
          timestamp: e.timestamp,
          event_type: e.event_type,
          actor_id: e.actor_id,
          target_id: e.target_id,
          payload: JSON.parse(e.payload),
          hash: e.hash
        }))
      }, null, 2)
    }]
  };
}

export async function handleEventLogVerifyChain(
  args: z.infer<typeof EventLogTools.EVENT_LOG_VERIFY_CHAIN.inputSchema>,
  _ctx: SessionContext
) {
  const repo = new EventLogRepository(getDb());
  const result = repo.verifyChain(args.world_id, args.from_id, args.to_id);

  if (!result.success) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: false, error: result.error })
      }]
    };
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        success: true,
        verification: result.data
      }, null, 2)
    }]
  };
}

export async function handleEventLogGetLast(
  args: z.infer<typeof EventLogTools.EVENT_LOG_GET_LAST.inputSchema>,
  _ctx: SessionContext
) {
  const repo = new EventLogRepository(getDb());
  
  // Query with reverse order to get last N events
  const result = repo.queryByFilters({
    world_id: args.world_id,
    limit: args.limit
  });

  if (!result.success) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: false, error: result.error })
      }]
    };
  }

  // Reverse to get most recent first
  const events = result.data!.events.reverse();

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        success: true,
        count: events.length,
        events: events.map(e => ({
          id: e.id,
          timestamp: e.timestamp,
          event_type: e.event_type,
          actor_id: e.actor_id,
          target_id: e.target_id,
          payload: JSON.parse(e.payload),
          hash: e.hash
        }))
      }, null, 2)
    }]
  };
}

// ============================================================
// Audit Log Tool Handlers
// ============================================================

export async function handleAuditLogCreate(
  args: z.infer<typeof AuditLogTools.AUDIT_LOG_CREATE.inputSchema>,
  _ctx: SessionContext
) {
  const repo = new AuditLogRepository(getDb());
  const result = repo.create({
    world_id: args.world_id,
    session_id: args.session_id ?? null,
    category: args.category as AuditCategory,
    actor_name: args.actor_name ?? null,
    description: args.description,
    details: args.details ? JSON.stringify(args.details) : null,
    importance: args.importance as AuditImportance,
    event_log_id: args.event_log_id ?? null
  });

  if (!result.success) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: false, error: result.error })
      }]
    };
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        success: true,
        entry: result.data
      }, null, 2)
    }]
  };
}

export async function handleAuditLogQuery(
  args: z.infer<typeof AuditLogTools.AUDIT_LOG_QUERY.inputSchema>,
  _ctx: SessionContext
) {
  const db = getDb();
  
  // Build dynamic query for audit logs
  const conditions: string[] = ['world_id = ?'];
  const params: unknown[] = [args.world_id];

  if (args.session_id) {
    conditions.push('session_id = ?');
    params.push(args.session_id);
  }

  if (args.category) {
    conditions.push('category = ?');
    params.push(args.category);
  }

  if (args.importance) {
    // Filter by minimum importance level
    const importanceOrder: Record<string, number> = {
      low: 0, normal: 1, high: 2, critical: 3
    };
    const minLevel = importanceOrder[args.importance] ?? 1;
    const validImportances = Object.entries(importanceOrder)
      .filter(([_, level]) => level >= minLevel)
      .map(([name]) => name);
    const placeholders = validImportances.map(() => '?').join(', ');
    conditions.push(`importance IN (${placeholders})`);
    params.push(...validImportances);
  }

  if (args.from_timestamp) {
    conditions.push('timestamp >= ?');
    params.push(args.from_timestamp);
  }

  if (args.to_timestamp) {
    conditions.push('timestamp <= ?');
    params.push(args.to_timestamp);
  }

  const limit = args.limit ?? 100;
  const offset = args.offset ?? 0;

  const sql = `
    SELECT id, world_id, session_id, timestamp, category,
           actor_name, description, details, importance, event_log_id
    FROM audit_logs
    WHERE ${conditions.join(' AND ')}
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `;

  params.push(limit, offset);

  try {
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as {
      id: number;
      world_id: string;
      session_id: string | null;
      timestamp: string;
      category: string;
      actor_name: string | null;
      description: string;
      details: string | null;
      importance: string;
      event_log_id: number | null;
    }[];

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          count: rows.length,
          entries: rows.map(e => ({
            id: String(e.id),
            timestamp: e.timestamp,
            category: e.category,
            actor_name: e.actor_name,
            description: e.description,
            importance: e.importance,
            details: e.details ? JSON.parse(e.details) : null
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

// ============================================================
// Event Inbox Extended Tool Handlers
// ============================================================

interface EventInboxRow {
  id: number;
  world_id: string;
  created_at: string;
  process_after: string | null;
  event_type: string;
  payload: string;
  status: string;
  attempts: number;
  last_error: string | null;
  processed_at: string | null;
  expires_at: string | null;
}

export async function handleEventInboxEnqueue(
  args: z.infer<typeof EventInboxExtendedTools.EVENT_INBOX_ENQUEUE.inputSchema>,
  _ctx: SessionContext
) {
  const db = getDb();
  
  const sql = `
    INSERT INTO event_inbox (
      world_id, event_type, payload, process_after, expires_at, status
    ) VALUES (?, ?, ?, ?, ?, 'pending')
  `;
  
  const stmt = db.prepare(sql);
  const result = stmt.run(
    args.world_id,
    args.event_type,
    JSON.stringify(args.payload),
    args.process_after ?? null,
    args.expires_at ?? null
  );

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        success: true,
        event_id: result.lastInsertRowid,
        message: `Event enqueued for ${args.process_after ? `processing after ${args.process_after}` : 'immediate processing'}`
      })
    }]
  };
}

export async function handleEventInboxProcess(
  args: z.infer<typeof EventInboxExtendedTools.EVENT_INBOX_PROCESS.inputSchema>,
  _ctx: SessionContext
) {
  const db = getDb();
  const now = new Date().toISOString();

  // Get pending events that are ready to process
  const selectSql = `
    SELECT * FROM event_inbox
    WHERE world_id = ?
      AND status = 'pending'
      AND (process_after IS NULL OR process_after <= ?)
      AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY created_at ASC
    LIMIT ?
  `;

  const stmt = db.prepare(selectSql);
  const rows = stmt.all(args.world_id, now, now, args.limit) as EventInboxRow[];

  if (rows.length === 0) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          count: 0,
          events: [],
          message: 'No pending events ready for processing'
        })
      }]
    };
  }

  // Optionally mark as processing to prevent double-processing
  if (args.mark_processing) {
    const ids = rows.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const updateSql = `
      UPDATE event_inbox
      SET status = 'processing', attempts = attempts + 1
      WHERE id IN (${placeholders})
    `;
    db.prepare(updateSql).run(...ids);
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        success: true,
        count: rows.length,
        events: rows.map(row => ({
          id: row.id,
          event_type: row.event_type,
          payload: JSON.parse(row.payload),
          created_at: row.created_at,
          process_after: row.process_after,
          attempts: row.attempts + (args.mark_processing ? 1 : 0)
        }))
      }, null, 2)
    }]
  };
}

export async function handleEventInboxComplete(
  args: z.infer<typeof EventInboxExtendedTools.EVENT_INBOX_COMPLETE.inputSchema>,
  _ctx: SessionContext
) {
  const db = getDb();
  const now = new Date().toISOString();
  
  const placeholders = args.event_ids.map(() => '?').join(',');
  const sql = `
    UPDATE event_inbox
    SET status = 'completed', processed_at = ?
    WHERE id IN (${placeholders})
  `;
  
  const result = db.prepare(sql).run(now, ...args.event_ids);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        success: true,
        updated: result.changes,
        message: `Marked ${result.changes} events as completed`
      })
    }]
  };
}

export async function handleEventInboxFail(
  args: z.infer<typeof EventInboxExtendedTools.EVENT_INBOX_FAIL.inputSchema>,
  _ctx: SessionContext
) {
  const db = getDb();
  
  const placeholders = args.event_ids.map(() => '?').join(',');
  const sql = `
    UPDATE event_inbox
    SET status = 'failed', last_error = ?
    WHERE id IN (${placeholders})
  `;
  
  const result = db.prepare(sql).run(args.error, ...args.event_ids);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        success: true,
        updated: result.changes,
        message: `Marked ${result.changes} events as failed`
      })
    }]
  };
}
