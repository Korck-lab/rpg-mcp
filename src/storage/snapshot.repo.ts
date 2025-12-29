/**
 * SNAPSHOT REPOSITORY
 *
 * Manages snapshots of world state for fast recovery during event replay.
 * Snapshots capture the complete state at a specific event_id, allowing
 * rollback or fast-forward operations without replaying all events.
 *
 * Key features:
 * - T032: Create snapshots from current world state
 * - T033: Find nearest snapshot for rollback (at or before event_id)
 * - T034: Cleanup old snapshots to manage storage
 *
 * @see specs/001-database-architecture/data-model.md
 * @module storage/snapshot.repo
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { BaseRepository, RepositoryResult } from './base.repo.js';
import { computeHash } from './utils/hash.js';
import { canonicalStringify } from './utils/canonical-json.js';

/**
 * Represents a snapshot of world state at a specific event.
 */
export interface Snapshot {
  /** Unique snapshot identifier (UUID) */
  id: string;
  /** World this snapshot belongs to */
  world_id: string;
  /** Event ID this snapshot was taken at */
  event_id: number;
  /** ISO 8601 timestamp of snapshot creation */
  created_at: string;
  /** Optional human-readable description */
  description: string | null;
  /** JSON-encoded complete world state */
  state_json: string;
  /** SHA-256 hash of state_json for integrity verification */
  checksum: string;
  /** Size of state_json in bytes */
  size_bytes: number;
  /** True if this was created automatically (e.g., periodic snapshots) */
  is_auto: boolean;
}

/**
 * Input for creating a new snapshot.
 * id, created_at, checksum, and size_bytes are auto-generated.
 */
export interface SnapshotCreate {
  world_id: string;
  event_id: number;
  state: object;
  description?: string;
  is_auto?: boolean;
}

/**
 * Database row type for snapshots table.
 */
interface SnapshotRow {
  id: string;
  world_id: string;
  event_id: number;
  created_at: string;
  description: string | null;
  state_json: string;
  checksum: string;
  size_bytes: number;
  is_auto: number; // SQLite stores boolean as 0/1
}

/**
 * Repository for world state snapshots.
 *
 * Snapshots enable efficient state recovery by storing complete world state
 * at key points, eliminating the need to replay all events from the beginning.
 *
 * @example
 * ```typescript
 * const repo = new SnapshotRepository(db);
 *
 * // Create a snapshot after important events
 * const result = repo.create({
 *   world_id: 'world_001',
 *   event_id: 500,
 *   state: worldState,
 *   description: 'Before boss fight',
 * });
 *
 * // Find nearest snapshot for rollback
 * const nearest = repo.getNearest('world_001', 450);
 * if (nearest.data) {
 *   const state = JSON.parse(nearest.data.state_json);
 *   // Replay events from nearest.data.event_id to current
 * }
 *
 * // Cleanup old snapshots, keeping last 10
 * const deleted = repo.cleanup('world_001', 10);
 * ```
 */
export class SnapshotRepository extends BaseRepository<Snapshot> {
  constructor(db: Database.Database) {
    super(db, 'snapshots');
  }

  /**
   * T032: Create a snapshot from current world state.
   *
   * Creates a new snapshot entry with:
   * - Unique UUID identifier
   * - Current timestamp
   * - SHA-256 checksum of canonical JSON state
   * - Computed size in bytes
   *
   * @param input - Snapshot creation parameters
   * @returns Repository result with the created snapshot
   */
  create(input: SnapshotCreate): RepositoryResult<Snapshot> {
    try {
      // Serialize state using canonical JSON for consistent checksums
      const stateJson = canonicalStringify(input.state);
      const sizeBytes = Buffer.byteLength(stateJson, 'utf8');
      const checksum = computeHash(stateJson);
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      const isAuto = input.is_auto ?? false;

      const sql = `
        INSERT INTO snapshots (
          id, world_id, event_id, created_at, description,
          state_json, checksum, size_bytes, is_auto
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      this.execute(sql, [
        id,
        input.world_id,
        input.event_id,
        createdAt,
        input.description ?? null,
        stateJson,
        checksum,
        sizeBytes,
        isAuto ? 1 : 0,
      ]);

      const snapshot: Snapshot = {
        id,
        world_id: input.world_id,
        event_id: input.event_id,
        created_at: createdAt,
        description: input.description ?? null,
        state_json: stateJson,
        checksum,
        size_bytes: sizeBytes,
        is_auto: isAuto,
      };

      return this.success(snapshot);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * T033: Get the nearest snapshot at or before the specified event_id.
   *
   * Used for rollback operations - finds the most recent snapshot that
   * can be used as a starting point, then replay events from there.
   *
   * @param world_id - World to query
   * @param event_id - Target event ID (inclusive)
   * @returns Repository result with the nearest snapshot or null if none exists
   */
  getNearest(world_id: string, event_id: number): RepositoryResult<Snapshot | null> {
    try {
      const sql = `
        SELECT id, world_id, event_id, created_at, description,
               state_json, checksum, size_bytes, is_auto
        FROM snapshots
        WHERE world_id = ? AND event_id <= ?
        ORDER BY event_id DESC
        LIMIT 1
      `;

      const row = this.queryOne<SnapshotRow>(sql, [world_id, event_id]);

      if (!row) {
        return this.success(null);
      }

      return this.success(this.toEntity(row));
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Get the latest snapshot for a world.
   *
   * @param world_id - World to query
   * @returns Repository result with the latest snapshot or null if none exists
   */
  getLatest(world_id: string): RepositoryResult<Snapshot | null> {
    try {
      const sql = `
        SELECT id, world_id, event_id, created_at, description,
               state_json, checksum, size_bytes, is_auto
        FROM snapshots
        WHERE world_id = ?
        ORDER BY event_id DESC
        LIMIT 1
      `;

      const row = this.queryOne<SnapshotRow>(sql, [world_id]);

      if (!row) {
        return this.success(null);
      }

      return this.success(this.toEntity(row));
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * List all snapshots for a world, ordered by event_id descending.
   *
   * @param world_id - World to query
   * @param limit - Maximum number of snapshots to return (default: 100)
   * @returns Repository result with array of snapshots
   */
  list(world_id: string, limit: number = 100): RepositoryResult<Snapshot[]> {
    try {
      const sql = `
        SELECT id, world_id, event_id, created_at, description,
               state_json, checksum, size_bytes, is_auto
        FROM snapshots
        WHERE world_id = ?
        ORDER BY event_id DESC
        LIMIT ?
      `;

      const rows = this.query<SnapshotRow>(sql, [world_id, limit]);
      const snapshots = rows.map((row) => this.toEntity(row));

      return this.success(snapshots);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * T034: Cleanup old snapshots, keeping the most recent N.
   *
   * Deletes older snapshots to manage storage. Preserves the most recent
   * `keepCount` snapshots for each world. Auto-snapshots and manual
   * snapshots are treated equally.
   *
   * @param world_id - World to clean up
   * @param keepCount - Number of recent snapshots to preserve
   * @returns Repository result with number of snapshots deleted
   */
  cleanup(world_id: string, keepCount: number): RepositoryResult<number> {
    try {
      if (keepCount < 0) {
        return this.failure('keepCount must be non-negative');
      }

      // Find the event_id threshold - snapshots at or after this should be kept
      const thresholdSql = `
        SELECT event_id FROM snapshots
        WHERE world_id = ?
        ORDER BY event_id DESC
        LIMIT 1 OFFSET ?
      `;

      const thresholdRow = this.queryOne<{ event_id: number }>(thresholdSql, [
        world_id,
        keepCount - 1, // 0-indexed, so keepCount - 1 gives us the Nth item
      ]);

      if (!thresholdRow) {
        // Not enough snapshots to delete anything
        return this.success(0);
      }

      // Delete snapshots older than threshold
      const deleteSql = `
        DELETE FROM snapshots
        WHERE world_id = ? AND event_id < ?
      `;

      const result = this.execute(deleteSql, [world_id, thresholdRow.event_id]);

      return this.success(result.changes);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Verify snapshot integrity by comparing stored checksum with computed checksum.
   *
   * @param id - Snapshot ID to verify
   * @returns Repository result with true if valid, false if corrupted
   */
  verify(id: string): RepositoryResult<boolean> {
    try {
      const sql = `
        SELECT state_json, checksum FROM snapshots WHERE id = ?
      `;

      const row = this.queryOne<{ state_json: string; checksum: string }>(sql, [id]);

      if (!row) {
        return this.failure(`Snapshot with id '${id}' not found`);
      }

      const computedChecksum = computeHash(row.state_json);
      const isValid = computedChecksum === row.checksum;

      return this.success(isValid);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Get a snapshot by ID.
   *
   * @param id - Snapshot ID
   * @returns Repository result with the snapshot
   */
  getById(id: string): RepositoryResult<Snapshot> {
    return this.findById(id);
  }

  /**
   * Count total snapshots for a world.
   *
   * @param world_id - World to count
   * @returns Repository result with count
   */
  countByWorld(world_id: string): RepositoryResult<number> {
    try {
      const result = this.queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM snapshots WHERE world_id = ?`,
        [world_id]
      );

      return this.success(result?.count ?? 0);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Get total size of all snapshots for a world.
   *
   * @param world_id - World to query
   * @returns Repository result with total size in bytes
   */
  getTotalSize(world_id: string): RepositoryResult<number> {
    try {
      const result = this.queryOne<{ total: number | null }>(
        `SELECT SUM(size_bytes) as total FROM snapshots WHERE world_id = ?`,
        [world_id]
      );

      return this.success(result?.total ?? 0);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Convert a database row to a Snapshot entity.
   */
  protected toEntity(row: unknown): Snapshot {
    const r = row as SnapshotRow;
    return {
      id: r.id,
      world_id: r.world_id,
      event_id: r.event_id,
      created_at: r.created_at,
      description: r.description,
      state_json: r.state_json,
      checksum: r.checksum,
      size_bytes: r.size_bytes,
      is_auto: r.is_auto === 1,
    };
  }

  /**
   * Convert a Snapshot to a database row format.
   */
  protected toRow(entity: Partial<Snapshot>): Record<string, unknown> {
    const row: Record<string, unknown> = {};

    if (entity.id !== undefined) {
      row.id = entity.id;
    }
    if (entity.world_id !== undefined) {
      row.world_id = entity.world_id;
    }
    if (entity.event_id !== undefined) {
      row.event_id = entity.event_id;
    }
    if (entity.created_at !== undefined) {
      row.created_at = entity.created_at;
    }
    if (entity.description !== undefined) {
      row.description = entity.description;
    }
    if (entity.state_json !== undefined) {
      row.state_json = entity.state_json;
    }
    if (entity.checksum !== undefined) {
      row.checksum = entity.checksum;
    }
    if (entity.size_bytes !== undefined) {
      row.size_bytes = entity.size_bytes;
    }
    if (entity.is_auto !== undefined) {
      row.is_auto = entity.is_auto ? 1 : 0;
    }

    return row;
  }
}
