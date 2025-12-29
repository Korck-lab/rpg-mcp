/**
 * AUDIT LOG REPOSITORY
 *
 * Human-readable audit trail separate from technical event logs.
 *
 * Purpose:
 * - event_logs: Technical, for replay and verification (JSON payloads, hash-chained)
 * - audit_logs: Human-readable, for player/DM viewing (text descriptions)
 *
 * Example entries:
 * - "Gandalf casts Fireball, dealing 32 damage to 3 goblins" (category: combat, importance: high)
 * - "Party enters the Dusty Tavern" (category: exploration, importance: normal)
 * - "Quest 'Rescue the Prince' completed" (category: quest, importance: high)
 *
 * @see specs/001-database-architecture/data-model.md
 */

import Database from 'better-sqlite3';
import { BaseRepository, RepositoryResult } from './base.repo.js';

/**
 * Category of audit log entry.
 * Used to filter and organize the audit trail.
 */
export type AuditCategory = 'combat' | 'exploration' | 'social' | 'quest' | 'system' | 'dm';

/**
 * Importance level of audit log entry.
 * Used to highlight significant events.
 */
export type AuditImportance = 'low' | 'normal' | 'high' | 'critical';

/**
 * Audit log entry for human-readable game history.
 */
export interface AuditLogEntry {
  /** Auto-incremented primary key (used as string for BaseRepository compatibility) */
  id: string;
  /** World this entry belongs to */
  world_id: string;
  /** Session this entry was created in (null for system events) */
  session_id: string | null;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Category for filtering */
  category: AuditCategory;
  /** Name of the actor (character name, not ID) */
  actor_name: string | null;
  /** Human-readable description of what happened */
  description: string;
  /** Optional additional details (JSON string) */
  details: string | null;
  /** Importance level for highlighting */
  importance: AuditImportance;
  /** Link to technical event log entry (for cross-reference) */
  event_log_id: number | null;
}

/**
 * Input for creating a new audit log entry.
 * id and timestamp are auto-generated.
 */
export type AuditLogCreate = Omit<AuditLogEntry, 'id' | 'timestamp'>;

/**
 * Filter options for querying audit logs.
 */
export interface AuditFilter {
  /** Required: World to query */
  world_id: string;
  /** Filter by session */
  session_id?: string;
  /** Filter by category */
  category?: AuditCategory;
  /** Filter by minimum importance */
  importance?: AuditImportance;
  /** Filter entries after this timestamp */
  from_timestamp?: string;
  /** Filter entries before this timestamp */
  to_timestamp?: string;
  /** Maximum number of entries to return (default: 100) */
  limit?: number;
  /** Offset for pagination (default: 0) */
  offset?: number;
}

/**
 * Summary of audit log entries grouped by category.
 */
export interface CategorySummary {
  category: AuditCategory;
  count: number;
}

/**
 * Database row type for audit_logs table.
 */
interface AuditLogRow {
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
  // Legacy columns (ignored but may be present)
  action?: string;
  actor_id?: string;
  target_id?: string;
}

/**
 * Valid categories for type checking.
 */
const VALID_CATEGORIES: AuditCategory[] = [
  'combat',
  'exploration',
  'social',
  'quest',
  'system',
  'dm',
];

/**
 * Valid importance levels for type checking.
 */
const VALID_IMPORTANCE: AuditImportance[] = ['low', 'normal', 'high', 'critical'];

/**
 * Importance level ordering for filtering (higher = more important).
 */
const IMPORTANCE_ORDER: Record<AuditImportance, number> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
};

/**
 * Repository for human-readable audit logs.
 *
 * Note: Unlike most repositories, AuditLogEntry uses numeric id internally
 * but exposes it as string for BaseRepository compatibility. The actual
 * primary key is auto-incremented by SQLite.
 */
export class AuditLogRepository extends BaseRepository<AuditLogEntry> {
  constructor(db: Database.Database) {
    super(db, 'audit_logs');
  }

  /**
   * Create a new audit log entry.
   *
   * @param entry - Entry data (id and timestamp are auto-generated)
   * @returns The created entry with generated id and timestamp
   */
  create(entry: AuditLogCreate): RepositoryResult<AuditLogEntry> {
    try {
      // Validate category
      if (!VALID_CATEGORIES.includes(entry.category)) {
        return this.failure(`Invalid category: ${entry.category}`);
      }

      // Validate importance
      if (!VALID_IMPORTANCE.includes(entry.importance)) {
        return this.failure(`Invalid importance: ${entry.importance}`);
      }

      const timestamp = new Date().toISOString();

      const sql = `
        INSERT INTO audit_logs (
          world_id, session_id, timestamp, category,
          actor_name, description, details, importance, event_log_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const result = this.execute(sql, [
        entry.world_id,
        entry.session_id,
        timestamp,
        entry.category,
        entry.actor_name,
        entry.description,
        entry.details,
        entry.importance,
        entry.event_log_id,
      ]);

      const created: AuditLogEntry = {
        id: String(result.lastInsertRowid),
        world_id: entry.world_id,
        session_id: entry.session_id,
        timestamp,
        category: entry.category,
        actor_name: entry.actor_name,
        description: entry.description,
        details: entry.details,
        importance: entry.importance,
        event_log_id: entry.event_log_id,
      };

      return this.success(created);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Create an audit log entry from a technical event log entry.
   * Links the audit entry to the event log via event_log_id.
   *
   * @param event_log_id - ID of the event_logs entry to link
   * @param actor_name - Human-readable actor name
   * @param description - Human-readable description
   * @param importance - Importance level (default: 'normal')
   * @returns The created audit entry
   */
  createFromEvent(
    event_log_id: number,
    actor_name: string,
    description: string,
    importance: AuditImportance = 'normal'
  ): RepositoryResult<AuditLogEntry> {
    try {
      // Look up the event log entry to get world_id and category
      const eventRow = this.queryOne<{
        world_id: string;
        event_type: string;
        timestamp: string;
      }>('SELECT world_id, event_type, timestamp FROM event_logs WHERE id = ?', [
        event_log_id,
      ]);

      if (!eventRow) {
        return this.failure(`Event log entry ${event_log_id} not found`);
      }

      // Map event_type to audit category
      const category = this.mapEventTypeToCategory(eventRow.event_type);

      return this.create({
        world_id: eventRow.world_id,
        session_id: null, // Events don't have session context
        category,
        actor_name,
        description,
        details: null,
        importance,
        event_log_id,
      });
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Query audit logs with filters.
   * Returns entries in reverse chronological order (most recent first).
   *
   * @param filter - Query filter options
   * @returns Array of matching audit entries
   */
  queryByFilter(filter: AuditFilter): RepositoryResult<AuditLogEntry[]> {
    try {
      const conditions: string[] = ['world_id = ?'];
      const params: unknown[] = [filter.world_id];

      if (filter.session_id) {
        conditions.push('session_id = ?');
        params.push(filter.session_id);
      }

      if (filter.category) {
        if (!VALID_CATEGORIES.includes(filter.category)) {
          return this.failure(`Invalid category: ${filter.category}`);
        }
        conditions.push('category = ?');
        params.push(filter.category);
      }

      if (filter.importance) {
        if (!VALID_IMPORTANCE.includes(filter.importance)) {
          return this.failure(`Invalid importance: ${filter.importance}`);
        }
        // Filter by minimum importance level
        const minLevel = IMPORTANCE_ORDER[filter.importance];
        const validImportances = VALID_IMPORTANCE.filter(
          (i) => IMPORTANCE_ORDER[i] >= minLevel
        );
        const placeholders = validImportances.map(() => '?').join(', ');
        conditions.push(`importance IN (${placeholders})`);
        params.push(...validImportances);
      }

      if (filter.from_timestamp) {
        conditions.push('timestamp >= ?');
        params.push(filter.from_timestamp);
      }

      if (filter.to_timestamp) {
        conditions.push('timestamp <= ?');
        params.push(filter.to_timestamp);
      }

      const limit = filter.limit ?? 100;
      const offset = filter.offset ?? 0;

      const sql = `
        SELECT id, world_id, session_id, timestamp, category,
               actor_name, description, details, importance, event_log_id
        FROM audit_logs
        WHERE ${conditions.join(' AND ')}
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `;

      params.push(limit, offset);

      const rows = this.runQuery<AuditLogRow>(sql, params);
      const entries = rows.map((row) => this.toEntity(row));

      return this.success(entries);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Get a summary of audit log entries grouped by category.
   *
   * @param session_id - Session to summarize
   * @returns Array of category counts
   */
  getSessionSummary(session_id: string): RepositoryResult<CategorySummary[]> {
    try {
      const sql = `
        SELECT category, COUNT(*) as count
        FROM audit_logs
        WHERE session_id = ?
        GROUP BY category
        ORDER BY count DESC
      `;

      const rows = this.runQuery<{ category: string; count: number }>(sql, [session_id]);

      const summaries: CategorySummary[] = rows.map((row) => ({
        category: row.category as AuditCategory,
        count: row.count,
      }));

      return this.success(summaries);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Delete old audit logs to manage storage.
   * Keeps entries from the last N days.
   *
   * @param world_id - World to clean up
   * @param keepDays - Number of days to keep (default: 30)
   * @returns Number of entries deleted
   */
  cleanup(world_id: string, keepDays: number = 30): RepositoryResult<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - keepDays);
      const cutoffTimestamp = cutoffDate.toISOString();

      const sql = `
        DELETE FROM audit_logs
        WHERE world_id = ? AND timestamp < ?
      `;

      const result = this.execute(sql, [world_id, cutoffTimestamp]);

      return this.success(result.changes);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Get recent entries for a specific actor.
   *
   * @param world_id - World to query
   * @param actor_name - Actor name to filter by
   * @param limit - Maximum entries to return
   * @returns Array of audit entries for the actor
   */
  getByActor(
    world_id: string,
    actor_name: string,
    limit: number = 50
  ): RepositoryResult<AuditLogEntry[]> {
    try {
      const sql = `
        SELECT id, world_id, session_id, timestamp, category,
               actor_name, description, details, importance, event_log_id
        FROM audit_logs
        WHERE world_id = ? AND actor_name = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `;

      const rows = this.runQuery<AuditLogRow>(sql, [world_id, actor_name, limit]);
      const entries = rows.map((row) => this.toEntity(row));

      return this.success(entries);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Get high-importance entries (for session recap).
   *
   * @param world_id - World to query
   * @param session_id - Optional session filter
   * @param limit - Maximum entries to return
   * @returns Array of high/critical importance entries
   */
  getHighlights(
    world_id: string,
    session_id?: string,
    limit: number = 20
  ): RepositoryResult<AuditLogEntry[]> {
    try {
      const conditions = ['world_id = ?', "importance IN ('high', 'critical')"];
      const params: unknown[] = [world_id];

      if (session_id) {
        conditions.push('session_id = ?');
        params.push(session_id);
      }

      params.push(limit);

      const sql = `
        SELECT id, world_id, session_id, timestamp, category,
               actor_name, description, details, importance, event_log_id
        FROM audit_logs
        WHERE ${conditions.join(' AND ')}
        ORDER BY timestamp DESC
        LIMIT ?
      `;

      const rows = this.runQuery<AuditLogRow>(sql, params);
      const entries = rows.map((row) => this.toEntity(row));

      return this.success(entries);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Execute a raw SQL query (wrapper to avoid shadowing parent's query method).
   * @private
   */
  private runQuery<R>(sql: string, params?: unknown[]): R[] {
    // Call the parent's protected query method
    const stmt = this.db.prepare(sql);
    const rows = params ? stmt.all(...params) : stmt.all();
    return rows as R[];
  }

  /**
   * Convert a database row to an AuditLogEntry entity.
   */
  protected toEntity(row: unknown): AuditLogEntry {
    const r = row as AuditLogRow;
    return {
      id: String(r.id),
      world_id: r.world_id,
      session_id: r.session_id,
      timestamp: r.timestamp,
      category: r.category as AuditCategory,
      actor_name: r.actor_name,
      description: r.description,
      details: r.details,
      importance: r.importance as AuditImportance,
      event_log_id: r.event_log_id,
    };
  }

  /**
   * Convert an AuditLogEntry to a database row format.
   */
  protected toRow(entity: Partial<AuditLogEntry>): Record<string, unknown> {
    const row: Record<string, unknown> = {};

    if (entity.id !== undefined) {
      row.id = parseInt(entity.id, 10);
    }
    if (entity.world_id !== undefined) {
      row.world_id = entity.world_id;
    }
    if (entity.session_id !== undefined) {
      row.session_id = entity.session_id;
    }
    if (entity.timestamp !== undefined) {
      row.timestamp = entity.timestamp;
    }
    if (entity.category !== undefined) {
      row.category = entity.category;
    }
    if (entity.actor_name !== undefined) {
      row.actor_name = entity.actor_name;
    }
    if (entity.description !== undefined) {
      row.description = entity.description;
    }
    if (entity.details !== undefined) {
      row.details = entity.details;
    }
    if (entity.importance !== undefined) {
      row.importance = entity.importance;
    }
    if (entity.event_log_id !== undefined) {
      row.event_log_id = entity.event_log_id;
    }

    return row;
  }

  /**
   * Map event_logs.event_type to audit category.
   */
  private mapEventTypeToCategory(eventType: string): AuditCategory {
    switch (eventType) {
      case 'combat':
        return 'combat';
      case 'movement':
        return 'exploration';
      case 'spell':
        return 'combat'; // Most spells are combat-related
      case 'item':
        return 'exploration';
      case 'quest':
        return 'quest';
      case 'social':
        return 'social';
      case 'system':
      default:
        return 'system';
    }
  }
}
