/**
 * Event Log Repository for event sourcing with hash chain verification.
 *
 * Implements append-only event logging with cryptographic hash chaining
 * for tamper detection. Each event includes a hash of the previous event,
 * creating an immutable audit trail.
 *
 * @module storage/event-log.repo
 */

import Database from 'better-sqlite3';
import { BaseRepository, RepositoryResult } from './base.repo.js';
import { computeEventHash, GENESIS_HASH, EventHashInput } from './utils/hash.js';
import { canonicalStringify } from './utils/canonical-json.js';
import { SnapshotRepository, Snapshot } from './snapshot.repo.js';

/**
 * T039: Interval for automatic snapshot creation.
 * A snapshot is created every SNAPSHOT_INTERVAL events.
 */
export const SNAPSHOT_INTERVAL = 1000;

/**
 * Valid event types for the event log system.
 */
export type EventType = 'combat' | 'movement' | 'spell' | 'item' | 'quest' | 'social' | 'system';

/**
 * Represents a single event log entry in the event sourcing system.
 */
export interface EventLogEntry {
    /** Auto-incremented unique identifier */
    id: number;
    /** World/session this event belongs to */
    world_id: string;
    /** ISO 8601 timestamp of event creation */
    timestamp: string;
    /** Category of the event */
    event_type: EventType;
    /** ID of the entity performing the action, null for system events */
    actor_id: string | null;
    /** ID of the target entity, null if not applicable */
    target_id: string | null;
    /** JSON-encoded event-specific data */
    payload: string;
    /** Hash of the previous event in the chain (or GENESIS_HASH for first) */
    prev_hash: string;
    /** SHA-256 hash of this event's canonical representation */
    hash: string;
}

/**
 * Filter options for querying event logs.
 */
export interface EventFilter {
    /** Required: filter by world */
    world_id: string;
    /** Filter by event type */
    event_type?: EventType;
    /** Filter by actor */
    actor_id?: string;
    /** Filter events after this timestamp (inclusive) */
    from_timestamp?: string;
    /** Filter events before this timestamp (inclusive) */
    to_timestamp?: string;
    /** Filter events with ID >= this value */
    from_event_id?: number;
    /** Filter events with ID <= this value */
    to_event_id?: number;
    /** Maximum number of events to return (default: 100, max: 1000) */
    limit?: number;
}

/**
 * Result of a filtered event query with pagination info.
 */
export interface EventLogQueryResult {
    /** Array of matching events */
    events: EventLogEntry[];
    /** Total count of events matching the filter (before limit) */
    total_count: number;
    /** Whether there are more events beyond the limit */
    has_more: boolean;
}

/**
 * Result of hash chain verification.
 */
export interface ChainVerificationResult {
    /** Whether the entire verified range is valid */
    valid: boolean;
    /** Number of events successfully verified */
    verified_count: number;
    /** Error details if verification failed */
    error?: {
        /** ID of the event that failed verification */
        event_id: number;
        /** The hash that was expected based on computation */
        expected_hash: string;
        /** The hash stored in the database */
        actual_hash: string;
        /** Human-readable error description */
        message: string;
    };
}

/**
 * Database row type for event_logs table.
 */
interface EventLogRow {
    id: number;
    world_id: string;
    timestamp: string;
    event_type: string;
    actor_id: string | null;
    target_id: string | null;
    payload: string;
    prev_hash: string;
    hash: string;
}

/**
 * Repository for event log operations with hash chain support.
 *
 * This repository extends BaseRepository but overrides the entity type
 * to use numeric IDs instead of string IDs (auto-increment).
 *
 * @example
 * ```typescript
 * const repo = new EventLogRepository(db);
 *
 * // Append a new event
 * const result = repo.append(
 *   'world_001',
 *   'combat',
 *   'char_001',
 *   'goblin_001',
 *   { action: 'attack', damage: 8 }
 * );
 *
 * // Verify chain integrity
 * const verification = repo.verifyChain('world_001');
 * if (!verification.data?.valid) {
 *   console.error('Chain tampered!', verification.data?.error);
 * }
 *
 * // Query with filters
 * const events = repo.queryByFilters({
 *   world_id: 'world_001',
 *   event_type: 'combat',
 *   limit: 50
 * });
 * ```
 */
export class EventLogRepository extends BaseRepository<EventLogEntry & { id: string }> {
    constructor(db: Database.Database) {
        super(db, 'event_logs');
    }

    /**
     * T019: Append a new event to the log with automatic hash chaining.
     *
     * Creates a new event entry with:
     * - Current timestamp
     * - prev_hash linking to the previous event (or GENESIS_HASH)
     * - Computed hash of the event's canonical representation
     *
     * @param world_id - The world/session this event belongs to
     * @param event_type - Category of the event
     * @param actor_id - ID of the acting entity (null for system events)
     * @param target_id - ID of the target entity (null if not applicable)
     * @param payload - Event-specific data object (will be JSON-encoded)
     * @returns Repository result with the created event entry
     */
    append(
        world_id: string,
        event_type: EventType,
        actor_id: string | null,
        target_id: string | null,
        payload: object
    ): RepositoryResult<EventLogEntry> {
        try {
            return this.transaction(() => {
                // Get the previous hash for this world's chain
                const prevHash = this.getLastHash(world_id);

                // Generate timestamp
                const timestamp = new Date().toISOString();

                // Serialize payload using canonical JSON for deterministic hashing
                const payloadJson = canonicalStringify(payload);

                // Insert the event to get the auto-generated ID
                // Note: We include both 'type' (original column) and 'event_type' (new column)
                // for backward compatibility with existing schema
                const insertSql = `
                    INSERT INTO ${this.tableName}
                    (world_id, timestamp, type, event_type, actor_id, target_id, payload, prev_hash, hash)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

                // Insert with temporary hash (we'll update after getting the ID)
                const tempHash = 'pending';
                const result = this.execute(insertSql, [
                    world_id,
                    timestamp,
                    event_type, // for 'type' column (legacy)
                    event_type, // for 'event_type' column (new)
                    actor_id,
                    target_id,
                    payloadJson,
                    prevHash,
                    tempHash,
                ]);

                const eventId = Number(result.lastInsertRowid);

                // Now compute the actual hash with the real ID
                const hashInput: EventHashInput = {
                    id: eventId,
                    timestamp,
                    event_type,
                    actor_id,
                    target_id,
                    payload: payloadJson,
                    prev_hash: prevHash,
                };
                const computedHash = computeEventHash(hashInput);

                // Update the hash
                this.execute(
                    `UPDATE ${this.tableName} SET hash = ? WHERE id = ?`,
                    [computedHash, eventId]
                );

                // Return the complete event
                const event: EventLogEntry = {
                    id: eventId,
                    world_id,
                    timestamp,
                    event_type,
                    actor_id,
                    target_id,
                    payload: payloadJson,
                    prev_hash: prevHash,
                    hash: computedHash,
                };

                // T039: Auto-create snapshot every SNAPSHOT_INTERVAL events
                if (eventId % SNAPSHOT_INTERVAL === 0) {
                    this.createAutoSnapshot(world_id, eventId);
                }

                return this.success(event);
            });
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * T020: Verify the integrity of the hash chain for a world.
     *
     * Checks that:
     * 1. Each event's hash matches its computed canonical hash
     * 2. Each event's prev_hash matches the previous event's hash
     * 3. The first event's prev_hash equals GENESIS_HASH
     *
     * @param world_id - The world/session to verify
     * @param from_id - Optional start event ID (inclusive)
     * @param to_id - Optional end event ID (inclusive)
     * @returns Repository result with verification outcome
     */
    verifyChain(
        world_id: string,
        from_id?: number,
        to_id?: number
    ): RepositoryResult<ChainVerificationResult> {
        try {
            // Build query with optional ID range
            let sql = `
                SELECT id, world_id, timestamp, event_type, actor_id, target_id, payload, prev_hash, hash
                FROM ${this.tableName}
                WHERE world_id = ?
            `;
            const params: unknown[] = [world_id];

            if (from_id !== undefined) {
                sql += ' AND id >= ?';
                params.push(from_id);
            }
            if (to_id !== undefined) {
                sql += ' AND id <= ?';
                params.push(to_id);
            }

            sql += ' ORDER BY id ASC';

            const rows = this.query<EventLogRow>(sql, params);

            if (rows.length === 0) {
                return this.success({
                    valid: true,
                    verified_count: 0,
                });
            }

            // Track the expected prev_hash for chain verification
            // If starting from a specific ID, we need the hash of the event before it
            let expectedPrevHash: string;

            if (from_id !== undefined && from_id > 1) {
                // Get the hash of the event immediately before from_id
                const prevEvent = this.queryOne<EventLogRow>(
                    `SELECT hash FROM ${this.tableName} WHERE world_id = ? AND id < ? ORDER BY id DESC LIMIT 1`,
                    [world_id, from_id]
                );
                expectedPrevHash = prevEvent?.hash ?? GENESIS_HASH;
            } else {
                // Starting from the beginning - expect genesis hash
                expectedPrevHash = GENESIS_HASH;
            }

            // Verify each event
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];

                // Verify prev_hash chain
                if (row.prev_hash !== expectedPrevHash) {
                    return this.success({
                        valid: false,
                        verified_count: i,
                        error: {
                            event_id: row.id,
                            expected_hash: expectedPrevHash,
                            actual_hash: row.prev_hash,
                            message: `Chain broken: event ${row.id} prev_hash does not match previous event's hash`,
                        },
                    });
                }

                // Compute expected hash
                const hashInput: EventHashInput = {
                    id: row.id,
                    timestamp: row.timestamp,
                    event_type: row.event_type,
                    actor_id: row.actor_id,
                    target_id: row.target_id,
                    payload: row.payload,
                    prev_hash: row.prev_hash,
                };
                const computedHash = computeEventHash(hashInput);

                // Verify stored hash matches computed hash
                if (row.hash !== computedHash) {
                    return this.success({
                        valid: false,
                        verified_count: i,
                        error: {
                            event_id: row.id,
                            expected_hash: computedHash,
                            actual_hash: row.hash,
                            message: `Hash mismatch: event ${row.id} stored hash does not match computed hash (possible tampering)`,
                        },
                    });
                }

                // Update expected prev_hash for next iteration
                expectedPrevHash = row.hash;
            }

            return this.success({
                valid: true,
                verified_count: rows.length,
            });
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * T021: Query events with flexible filtering and pagination.
     *
     * Supports filtering by:
     * - world_id (required)
     * - event_type
     * - actor_id
     * - timestamp range
     * - event ID range
     *
     * @param filter - Filter criteria
     * @returns Repository result with matching events and pagination info
     */
    queryByFilters(filter: EventFilter): RepositoryResult<EventLogQueryResult> {
        try {
            // Validate and clamp limit
            const limit = Math.min(Math.max(filter.limit ?? 100, 1), 1000);

            // Build WHERE clause
            const conditions: string[] = ['world_id = ?'];
            const params: unknown[] = [filter.world_id];

            if (filter.event_type !== undefined) {
                conditions.push('event_type = ?');
                params.push(filter.event_type);
            }

            if (filter.actor_id !== undefined) {
                conditions.push('actor_id = ?');
                params.push(filter.actor_id);
            }

            if (filter.from_timestamp !== undefined) {
                conditions.push('timestamp >= ?');
                params.push(filter.from_timestamp);
            }

            if (filter.to_timestamp !== undefined) {
                conditions.push('timestamp <= ?');
                params.push(filter.to_timestamp);
            }

            if (filter.from_event_id !== undefined) {
                conditions.push('id >= ?');
                params.push(filter.from_event_id);
            }

            if (filter.to_event_id !== undefined) {
                conditions.push('id <= ?');
                params.push(filter.to_event_id);
            }

            const whereClause = conditions.join(' AND ');

            // Count total matching events
            const countSql = `SELECT COUNT(*) as count FROM ${this.tableName} WHERE ${whereClause}`;
            const countResult = this.queryOne<{ count: number }>(countSql, params);
            const totalCount = countResult?.count ?? 0;

            // Query events with limit
            const querySql = `
                SELECT id, world_id, timestamp, event_type, actor_id, target_id, payload, prev_hash, hash
                FROM ${this.tableName}
                WHERE ${whereClause}
                ORDER BY id ASC
                LIMIT ?
            `;
            const queryParams = [...params, limit];
            const rows = this.query<EventLogRow>(querySql, queryParams);

            // Convert rows to entities
            const events: EventLogEntry[] = rows.map(row => this.toEntity(row));

            return this.success({
                events,
                total_count: totalCount,
                has_more: totalCount > limit,
            });
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Get the last event's hash for a world, or GENESIS_HASH if no events exist.
     *
     * @param world_id - The world/session to check
     * @returns The hash of the last event or GENESIS_HASH
     */
    private getLastHash(world_id: string): string {
        const row = this.queryOne<{ hash: string }>(
            `SELECT hash FROM ${this.tableName} WHERE world_id = ? ORDER BY id DESC LIMIT 1`,
            [world_id]
        );
        return row?.hash ?? GENESIS_HASH;
    }

    /**
     * Get the last event for a world.
     *
     * @param world_id - The world/session to check
     * @returns Repository result with the last event or null
     */
    getLastEvent(world_id: string): RepositoryResult<EventLogEntry | null> {
        try {
            const row = this.queryOne<EventLogRow>(
                `SELECT * FROM ${this.tableName} WHERE world_id = ? ORDER BY id DESC LIMIT 1`,
                [world_id]
            );

            if (!row) {
                return this.success(null);
            }

            return this.success(this.toEntity(row));
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Get an event by its ID.
     *
     * @param id - The event ID
     * @returns Repository result with the event
     */
    getById(id: number): RepositoryResult<EventLogEntry> {
        try {
            const row = this.queryOne<EventLogRow>(
                `SELECT * FROM ${this.tableName} WHERE id = ?`,
                [id]
            );

            if (!row) {
                return this.failure(`Event with id '${id}' not found`);
            }

            return this.success(this.toEntity(row));
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Count events for a world.
     *
     * @param world_id - The world/session to count
     * @returns Repository result with the count
     */
    countByWorld(world_id: string): RepositoryResult<number> {
        try {
            const result = this.queryOne<{ count: number }>(
                `SELECT COUNT(*) as count FROM ${this.tableName} WHERE world_id = ?`,
                [world_id]
            );

            return this.success(result?.count ?? 0);
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Convert a database row to an EventLogEntry.
     */
    protected toEntity(row: unknown): EventLogEntry & { id: string } {
        const r = row as EventLogRow;
        // BaseRepository expects string id, but we use numeric id
        // We cast to satisfy the type system while maintaining numeric id in practice
        return {
            id: r.id,
            world_id: r.world_id,
            timestamp: r.timestamp,
            event_type: r.event_type as EventType,
            actor_id: r.actor_id,
            target_id: r.target_id,
            payload: r.payload,
            prev_hash: r.prev_hash,
            hash: r.hash,
        } as EventLogEntry & { id: string };
    }

    /**
     * Convert an EventLogEntry to a database row.
     */
    protected toRow(entity: Partial<EventLogEntry>): Record<string, unknown> {
        return {
            id: entity.id,
            world_id: entity.world_id,
            timestamp: entity.timestamp,
            event_type: entity.event_type,
            actor_id: entity.actor_id,
            target_id: entity.target_id,
            payload: entity.payload,
            prev_hash: entity.prev_hash,
            hash: entity.hash,
        };
    }

    // ============================================================
    // SNAPSHOT INTEGRATION (T039)
    // ============================================================

    /**
     * T039: Automatically create a snapshot at the current event.
     *
     * Called internally by append() every SNAPSHOT_INTERVAL events.
     * Creates a snapshot with is_auto=true.
     *
     * @param world_id - The world to snapshot
     * @param event_id - The event ID triggering the snapshot
     */
    private createAutoSnapshot(world_id: string, event_id: number): void {
        try {
            const snapshotRepo = new SnapshotRepository(this.db);
            const worldState = this.getWorldStateForSnapshot(world_id);

            snapshotRepo.create({
                world_id,
                event_id,
                state: worldState,
                description: `Auto-snapshot at event ${event_id}`,
                is_auto: true,
            });

            // Optional: cleanup old auto-snapshots, keeping last 3
            // snapshotRepo.cleanup(world_id, 3);
        } catch (error) {
            // Log but don't fail the event append
            console.error(`[EventLogRepository] Failed to create auto-snapshot at event ${event_id}:`, error);
        }
    }

    /**
     * Gather current world state for snapshot creation.
     *
     * This is a minimal implementation that will be expanded as more
     * repositories and tables are added. Currently captures:
     * - World ID
     * - Snapshot timestamp
     * - Event log metadata
     *
     * @param world_id - The world to gather state for
     * @returns Object representing current world state
     */
    private getWorldStateForSnapshot(world_id: string): object {
        // Get the last event for this world
        const lastEventResult = this.getLastEvent(world_id);
        const lastEvent = lastEventResult.success ? lastEventResult.data : null;

        // Get event count for this world
        const countResult = this.countByWorld(world_id);
        const eventCount = countResult.success ? countResult.data : 0;

        // Return basic world state
        // This will be expanded as more repositories are created to include:
        // - Characters and their states
        // - Rooms and spatial data
        // - Combat encounters
        // - Quest progress
        // - NPC relationships
        // - etc.
        return {
            world_id,
            snapshot_time: new Date().toISOString(),
            event_log: {
                last_event_id: lastEvent?.id ?? 0,
                last_event_hash: lastEvent?.hash ?? GENESIS_HASH,
                total_events: eventCount,
            },
            // Placeholder for future state collections
            characters: [],
            rooms: [],
            encounters: [],
            quests: [],
        };
    }

    /**
     * Manually create a snapshot at the current state.
     *
     * Unlike auto-snapshots, manual snapshots have is_auto=false and
     * can include a custom description.
     *
     * @param world_id - The world to snapshot
     * @param description - Optional description for the snapshot
     * @returns Repository result with the created snapshot
     */
    createSnapshot(world_id: string, description?: string): RepositoryResult<Snapshot> {
        try {
            const lastEventResult = this.getLastEvent(world_id);
            
            if (!lastEventResult.success || !lastEventResult.data) {
                return {
                    success: false,
                    error: `No events found for world '${world_id}'. Cannot create snapshot.`,
                };
            }

            const lastEvent = lastEventResult.data;
            const snapshotRepo = new SnapshotRepository(this.db);
            const worldState = this.getWorldStateForSnapshot(world_id);

            return snapshotRepo.create({
                world_id,
                event_id: lastEvent.id,
                state: worldState,
                description: description ?? `Manual snapshot at event ${lastEvent.id}`,
                is_auto: false,
            });
        } catch (error) {
            return this.handleError(error);
        }
    }
}
