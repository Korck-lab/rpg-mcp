import Database from 'better-sqlite3';
import { RepositoryResult, RepositoryError } from './base.repo.js';

/**
 * Valid status values for event inbox entries.
 */
export type EventInboxStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'expired';

/**
 * Valid event types for the inbox (matches database CHECK constraint).
 */
export type EventInboxEventType =
    | 'npc_action'
    | 'combat_update'
    | 'world_change'
    | 'quest_update'
    | 'time_passage'
    | 'environmental'
    | 'system';

/**
 * Valid source types for events.
 */
export type EventInboxSourceType = 'npc' | 'combat' | 'world' | 'system' | 'scheduler';

/**
 * Represents an entry in the event inbox for async/deferred processing.
 */
export interface EventInboxEntry {
    id: number;
    event_type: EventInboxEventType;
    payload: string; // JSON string
    source_type: EventInboxSourceType | null;
    source_id: string | null;
    priority: number;
    created_at: string;
    consumed_at: string | null;
    expires_at: string | null;
    // Extended fields for processing state (not in original table but useful)
    status: EventInboxStatus;
    attempts: number;
    last_error: string | null;
    processed_at: string | null;
    process_after: string | null;
    world_id: string;
}

/**
 * Database row structure for event_inbox table.
 */
interface EventInboxRow {
    id: number;
    event_type: string;
    payload: string;
    source_type: string | null;
    source_id: string | null;
    priority: number;
    created_at: string;
    consumed_at: string | null;
    expires_at: string | null;
}

/**
 * Options for enqueueing an event.
 */
export interface EnqueueOptions {
    /** Defer processing until this time */
    process_after?: Date;
    /** Event expires at this time (auto-cleanup) */
    expires_at?: Date;
    /** Source type for the event */
    source_type?: EventInboxSourceType;
    /** Source entity ID */
    source_id?: string;
    /** Priority (higher = more urgent, default 0) */
    priority?: number;
}

/**
 * Repository for managing the event inbox - a queue for deferred/async event processing.
 * 
 * The event inbox enables polling-based event delivery for "autonomous" NPC actions,
 * combat updates, world changes, and other events that need to be processed asynchronously.
 * 
 * Note: This repository does NOT extend BaseRepository because the event_inbox table
 * uses an INTEGER PRIMARY KEY AUTOINCREMENT (not a string UUID), and has a different
 * structure than entity tables.
 * 
 * @example
 * ```typescript
 * const inbox = new EventInboxRepository(db);
 * 
 * // Enqueue an immediate event
 * inbox.enqueue('world_001', 'npc_action', { npcId: 'npc_1', action: 'speak' });
 * 
 * // Enqueue a deferred event (process in 5 minutes)
 * inbox.enqueue('world_001', 'time_passage', { hours: 1 }, {
 *   process_after: new Date(Date.now() + 5 * 60 * 1000)
 * });
 * 
 * // Claim and process events
 * const event = inbox.claimNext('world_001');
 * if (event.success && event.data) {
 *   try {
 *     await processEvent(event.data);
 *     inbox.complete(event.data.id);
 *   } catch (err) {
 *     inbox.fail(event.data.id, err.message);
 *   }
 * }
 * ```
 */
export class EventInboxRepository {
    protected readonly db: Database.Database;
    protected readonly tableName = 'event_inbox';

    constructor(db: Database.Database) {
        this.db = db;
        // Ensure the extended columns exist (migration for processing state)
        this.ensureExtendedColumns();
    }

    /**
     * Ensure extended columns exist for processing state tracking.
     * These columns may not exist in older databases.
     */
    private ensureExtendedColumns(): void {
        const columns = this.db.prepare(`PRAGMA table_info(${this.tableName})`).all() as Array<{ name: string }>;
        const columnNames = new Set(columns.map(c => c.name));

        if (!columnNames.has('world_id')) {
            this.db.exec(`ALTER TABLE ${this.tableName} ADD COLUMN world_id TEXT NOT NULL DEFAULT '';`);
        }
        if (!columnNames.has('status')) {
            this.db.exec(`ALTER TABLE ${this.tableName} ADD COLUMN status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'expired'));`);
        }
        if (!columnNames.has('attempts')) {
            this.db.exec(`ALTER TABLE ${this.tableName} ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;`);
        }
        if (!columnNames.has('last_error')) {
            this.db.exec(`ALTER TABLE ${this.tableName} ADD COLUMN last_error TEXT;`);
        }
        if (!columnNames.has('processed_at')) {
            this.db.exec(`ALTER TABLE ${this.tableName} ADD COLUMN processed_at TEXT;`);
        }
        if (!columnNames.has('process_after')) {
            this.db.exec(`ALTER TABLE ${this.tableName} ADD COLUMN process_after TEXT;`);
        }

        // Create index for world_id if not exists
        try {
            this.db.exec(`CREATE INDEX IF NOT EXISTS idx_event_inbox_world ON ${this.tableName}(world_id);`);
            this.db.exec(`CREATE INDEX IF NOT EXISTS idx_event_inbox_status ON ${this.tableName}(status);`);
            this.db.exec(`CREATE INDEX IF NOT EXISTS idx_event_inbox_process_after ON ${this.tableName}(process_after);`);
        } catch {
            // Index may already exist
        }
    }

    /**
     * Add an event to the inbox for immediate or deferred processing.
     * 
     * @param world_id - The world this event belongs to
     * @param event_type - Type of event (npc_action, combat_update, etc.)
     * @param payload - Event data (will be JSON stringified)
     * @param options - Optional settings for deferred processing, expiration, etc.
     * @returns The created event entry
     */
    enqueue(
        world_id: string,
        event_type: EventInboxEventType,
        payload: object,
        options?: EnqueueOptions
    ): RepositoryResult<EventInboxEntry> {
        try {
            const now = new Date().toISOString();
            const payloadJson = JSON.stringify(payload);

            const stmt = this.db.prepare(`
                INSERT INTO ${this.tableName} (
                    world_id, event_type, payload, source_type, source_id,
                    priority, created_at, expires_at, process_after, status, attempts
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0)
            `);

            const info = stmt.run(
                world_id,
                event_type,
                payloadJson,
                options?.source_type ?? null,
                options?.source_id ?? null,
                options?.priority ?? 0,
                now,
                options?.expires_at?.toISOString() ?? null,
                options?.process_after?.toISOString() ?? null
            );

            const entry: EventInboxEntry = {
                id: Number(info.lastInsertRowid),
                world_id,
                event_type,
                payload: payloadJson,
                source_type: options?.source_type ?? null,
                source_id: options?.source_id ?? null,
                priority: options?.priority ?? 0,
                created_at: now,
                consumed_at: null,
                expires_at: options?.expires_at?.toISOString() ?? null,
                process_after: options?.process_after?.toISOString() ?? null,
                status: 'pending',
                attempts: 0,
                last_error: null,
                processed_at: null,
            };

            return { success: true, data: entry };
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Claim the next pending event for processing.
     * Sets the event status to 'processing' and increments attempt count.
     * 
     * Events are selected by priority (highest first), then by creation time (oldest first).
     * Only events where process_after is null or in the past are considered.
     * 
     * @param world_id - The world to claim an event from
     * @returns The claimed event, or null if no pending events
     */
    claimNext(world_id: string): RepositoryResult<EventInboxEntry | null> {
        try {
            const now = new Date().toISOString();

            // Use a transaction to atomically select and update
            const result = this.db.transaction(() => {
                // Find next pending event that's ready for processing
                const selectStmt = this.db.prepare(`
                    SELECT * FROM ${this.tableName}
                    WHERE world_id = ?
                      AND status = 'pending'
                      AND (process_after IS NULL OR process_after <= ?)
                      AND (expires_at IS NULL OR expires_at > ?)
                    ORDER BY priority DESC, created_at ASC
                    LIMIT 1
                `);

                const row = selectStmt.get(world_id, now, now) as EventInboxRow | undefined;
                if (!row) {
                    return null;
                }

                // Update status to processing
                const updateStmt = this.db.prepare(`
                    UPDATE ${this.tableName}
                    SET status = 'processing', attempts = attempts + 1
                    WHERE id = ?
                `);
                updateStmt.run(row.id);

                return this.toEntity({ ...row, status: 'processing', attempts: (row as unknown as { attempts: number }).attempts + 1 });
            })();

            return { success: true, data: result };
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Mark an event as successfully completed.
     * 
     * @param id - The event ID to complete
     */
    complete(id: number): RepositoryResult<void> {
        try {
            const now = new Date().toISOString();
            const stmt = this.db.prepare(`
                UPDATE ${this.tableName}
                SET status = 'completed', processed_at = ?, consumed_at = ?
                WHERE id = ?
            `);

            const result = stmt.run(now, now, id);
            if (result.changes === 0) {
                return {
                    success: false,
                    error: `Event with id '${id}' not found`,
                };
            }

            return { success: true };
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Mark an event as failed with an error message.
     * 
     * @param id - The event ID that failed
     * @param error - Error message describing the failure
     */
    fail(id: number, error: string): RepositoryResult<void> {
        try {
            const stmt = this.db.prepare(`
                UPDATE ${this.tableName}
                SET status = 'failed', last_error = ?
                WHERE id = ?
            `);

            const result = stmt.run(error, id);
            if (result.changes === 0) {
                return {
                    success: false,
                    error: `Event with id '${id}' not found`,
                };
            }

            return { success: true };
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Get all pending events ready for processing.
     * 
     * @param world_id - The world to get events for
     * @param limit - Maximum number of events to return (default: 100)
     * @returns Array of pending events
     */
    getPending(world_id: string, limit: number = 100): RepositoryResult<EventInboxEntry[]> {
        try {
            const now = new Date().toISOString();
            const stmt = this.db.prepare(`
                SELECT * FROM ${this.tableName}
                WHERE world_id = ?
                  AND status = 'pending'
                  AND (process_after IS NULL OR process_after <= ?)
                  AND (expires_at IS NULL OR expires_at > ?)
                ORDER BY priority DESC, created_at ASC
                LIMIT ?
            `);

            const rows = stmt.all(world_id, now, now, limit) as unknown[];
            return {
                success: true,
                data: rows.map(row => this.toEntity(row)),
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Expire old pending events that have passed their expires_at time.
     * 
     * @returns Number of events expired
     */
    expireOld(): RepositoryResult<number> {
        try {
            const now = new Date().toISOString();
            const stmt = this.db.prepare(`
                UPDATE ${this.tableName}
                SET status = 'expired'
                WHERE status = 'pending'
                  AND expires_at IS NOT NULL
                  AND expires_at <= ?
            `);

            const result = stmt.run(now);
            return { success: true, data: result.changes };
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Clean up old completed/expired events.
     * 
     * @param keepDays - Delete events older than this many days
     * @returns Number of events deleted
     */
    cleanup(keepDays: number): RepositoryResult<number> {
        try {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - keepDays);
            const cutoffStr = cutoff.toISOString();

            const stmt = this.db.prepare(`
                DELETE FROM ${this.tableName}
                WHERE status IN ('completed', 'expired')
                  AND created_at < ?
            `);

            const result = stmt.run(cutoffStr);
            return { success: true, data: result.changes };
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Retry failed events by resetting their status to pending.
     * Only retries events that haven't exceeded the maximum attempt count.
     * 
     * @param world_id - The world to retry events for
     * @param max_attempts - Maximum attempts before giving up (default: 3)
     * @returns Number of events reset for retry
     */
    retryFailed(world_id: string, max_attempts: number = 3): RepositoryResult<number> {
        try {
            const stmt = this.db.prepare(`
                UPDATE ${this.tableName}
                SET status = 'pending', last_error = NULL
                WHERE world_id = ?
                  AND status = 'failed'
                  AND attempts < ?
            `);

            const result = stmt.run(world_id, max_attempts);
            return { success: true, data: result.changes };
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Get events by status for a world.
     * 
     * @param world_id - The world to query
     * @param status - Status filter
     * @param limit - Maximum results (default: 100)
     * @returns Events matching the criteria
     */
    getByStatus(world_id: string, status: EventInboxStatus, limit: number = 100): RepositoryResult<EventInboxEntry[]> {
        try {
            const stmt = this.db.prepare(`
                SELECT * FROM ${this.tableName}
                WHERE world_id = ? AND status = ?
                ORDER BY created_at DESC
                LIMIT ?
            `);

            const rows = stmt.all(world_id, status, limit) as unknown[];
            return {
                success: true,
                data: rows.map(row => this.toEntity(row)),
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Get a specific event by ID.
     * 
     * @param id - The event ID
     * @returns The event or null if not found
     */
    findById(id: number): RepositoryResult<EventInboxEntry | null> {
        try {
            const stmt = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE id = ?`);
            const row = stmt.get(id);

            if (!row) {
                return { success: true, data: null };
            }

            return { success: true, data: this.toEntity(row) };
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Count pending events for a world.
     * 
     * @param world_id - The world to count events for
     * @returns Number of pending events
     */
    countPending(world_id: string): RepositoryResult<number> {
        try {
            const now = new Date().toISOString();
            const stmt = this.db.prepare(`
                SELECT COUNT(*) as count FROM ${this.tableName}
                WHERE world_id = ?
                  AND status = 'pending'
                  AND (process_after IS NULL OR process_after <= ?)
                  AND (expires_at IS NULL OR expires_at > ?)
            `);

            const result = stmt.get(world_id, now, now) as { count: number };
            return { success: true, data: result.count };
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Delete a specific event by ID.
     * 
     * @param id - The event ID to delete
     */
    delete(id: number): RepositoryResult<void> {
        try {
            const stmt = this.db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`);
            const result = stmt.run(id);

            if (result.changes === 0) {
                return {
                    success: false,
                    error: `Event with id '${id}' not found`,
                };
            }

            return { success: true };
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Convert a database row to an EventInboxEntry entity.
     */
    protected toEntity(row: unknown): EventInboxEntry {
        const r = row as Record<string, unknown>;
        return {
            id: r.id as number,
            world_id: (r.world_id as string) ?? '',
            event_type: r.event_type as EventInboxEventType,
            payload: r.payload as string,
            source_type: r.source_type as EventInboxSourceType | null,
            source_id: r.source_id as string | null,
            priority: (r.priority as number) ?? 0,
            created_at: r.created_at as string,
            consumed_at: r.consumed_at as string | null,
            expires_at: r.expires_at as string | null,
            process_after: (r.process_after as string | null) ?? null,
            status: (r.status as EventInboxStatus) ?? 'pending',
            attempts: (r.attempts as number) ?? 0,
            last_error: (r.last_error as string | null) ?? null,
            processed_at: (r.processed_at as string | null) ?? null,
        };
    }

    /**
     * Convert an entity to a database row format.
     */
    protected toRow(entity: Partial<EventInboxEntry>): Record<string, unknown> {
        return {
            id: entity.id,
            world_id: entity.world_id,
            event_type: entity.event_type,
            payload: entity.payload,
            source_type: entity.source_type,
            source_id: entity.source_id,
            priority: entity.priority,
            created_at: entity.created_at,
            consumed_at: entity.consumed_at,
            expires_at: entity.expires_at,
            process_after: entity.process_after,
            status: entity.status,
            attempts: entity.attempts,
            last_error: entity.last_error,
            processed_at: entity.processed_at,
        };
    }

    /**
     * Handle errors and convert to RepositoryResult.
     */
    protected handleError<R>(error: unknown): RepositoryResult<R> {
        if (error instanceof RepositoryError) {
            return {
                success: false,
                error: error.message,
            };
        }

        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
            success: false,
            error: message,
        };
    }
}
