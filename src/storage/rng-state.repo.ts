/**
 * RNG STATE REPOSITORY
 *
 * Manages RNG (Random Number Generator) state for deterministic reproducibility.
 * Each world can have multiple RNG contexts (e.g., 'combat', 'loot', 'encounter'),
 * each tracking its own seed and call_index.
 *
 * Key features:
 * - T035: Track RNG state per world and context
 * - Increment call_index for each random operation
 * - Reset to specific state for replay
 * - Snapshot/restore all RNG states for a world
 *
 * The call_index ensures that replaying the same sequence of random operations
 * produces identical results, enabling deterministic gameplay.
 *
 * @see specs/001-database-architecture/data-model.md
 * @module storage/rng-state.repo
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { BaseRepository, RepositoryResult } from './base.repo.js';

/**
 * Represents the state of an RNG context.
 */
export interface RNGState {
  /** Unique identifier (UUID) */
  id: string;
  /** World this RNG state belongs to */
  world_id: string;
  /** Context name (e.g., 'combat', 'loot', 'encounter') */
  context: string;
  /** The seed used for this context */
  seed: string;
  /** Number of random calls made (for reproducibility) */
  call_index: number;
  /** Last generated value (for debugging/verification) */
  last_value: string | null;
  /** ISO 8601 timestamp of last update */
  updated_at: string;
}

/**
 * Database row type for rng_state table.
 */
interface RNGStateRow {
  id: string;
  world_id: string;
  context: string;
  seed: string;
  call_index: number;
  last_value: string | null;
  updated_at: string;
}

/**
 * Repository for RNG state management.
 *
 * Ensures deterministic random number generation by tracking:
 * - Seed: Initial value for the PRNG
 * - Call index: Number of times the RNG has been called
 *
 * By storing this state, we can replay any sequence of random operations
 * and get identical results.
 *
 * @example
 * ```typescript
 * const repo = new RNGStateRepository(db);
 *
 * // Get or create RNG state for combat context
 * const state = repo.getOrCreate('world_001', 'combat', 'initial_seed_123');
 *
 * // After generating a random number, increment the index
 * const updated = repo.increment('world_001', 'combat', '0.7823');
 *
 * // For replay, reset to a specific call_index
 * repo.reset('world_001', 'combat', 0);
 *
 * // Snapshot all RNG states for a world
 * const allStates = repo.getAllForWorld('world_001');
 *
 * // Restore from snapshot
 * repo.restoreFromSnapshot('world_001', savedStates);
 * ```
 */
export class RNGStateRepository extends BaseRepository<RNGState> {
  constructor(db: Database.Database) {
    super(db, 'rng_state');
  }

  /**
   * T035: Get or create RNG state for a context.
   *
   * If the context already exists, returns the existing state.
   * Otherwise, creates a new state with call_index = 0.
   *
   * @param world_id - World identifier
   * @param context - Context name (e.g., 'combat', 'loot')
   * @param seed - Seed to use if creating new state
   * @returns Repository result with the RNG state
   */
  getOrCreate(world_id: string, context: string, seed: string): RepositoryResult<RNGState> {
    try {
      // Try to find existing state
      const existingSql = `
        SELECT id, world_id, context, seed, call_index, last_value, updated_at
        FROM rng_state
        WHERE world_id = ? AND context = ?
      `;

      const existing = this.queryOne<RNGStateRow>(existingSql, [world_id, context]);

      if (existing) {
        return this.success(this.toEntity(existing));
      }

      // Create new state
      const id = randomUUID();
      const updatedAt = new Date().toISOString();

      const insertSql = `
        INSERT INTO rng_state (id, world_id, context, seed, call_index, last_value, updated_at)
        VALUES (?, ?, ?, ?, 0, NULL, ?)
      `;

      this.execute(insertSql, [id, world_id, context, seed, updatedAt]);

      const state: RNGState = {
        id,
        world_id,
        context,
        seed,
        call_index: 0,
        last_value: null,
        updated_at: updatedAt,
      };

      return this.success(state);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Get RNG state for a context (does not create if missing).
   *
   * @param world_id - World identifier
   * @param context - Context name
   * @returns Repository result with the RNG state or null
   */
  get(world_id: string, context: string): RepositoryResult<RNGState | null> {
    try {
      const sql = `
        SELECT id, world_id, context, seed, call_index, last_value, updated_at
        FROM rng_state
        WHERE world_id = ? AND context = ?
      `;

      const row = this.queryOne<RNGStateRow>(sql, [world_id, context]);

      if (!row) {
        return this.success(null);
      }

      return this.success(this.toEntity(row));
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Increment the call_index and optionally store the last generated value.
   *
   * Called after each random number generation to track progress
   * through the random sequence.
   *
   * @param world_id - World identifier
   * @param context - Context name
   * @param lastValue - Optional: the value that was just generated
   * @returns Repository result with the updated RNG state
   */
  increment(world_id: string, context: string, lastValue?: string): RepositoryResult<RNGState> {
    try {
      const updatedAt = new Date().toISOString();

      // Update call_index and optionally last_value
      const sql = lastValue !== undefined
        ? `
          UPDATE rng_state
          SET call_index = call_index + 1, last_value = ?, updated_at = ?
          WHERE world_id = ? AND context = ?
        `
        : `
          UPDATE rng_state
          SET call_index = call_index + 1, updated_at = ?
          WHERE world_id = ? AND context = ?
        `;

      const params = lastValue !== undefined
        ? [lastValue, updatedAt, world_id, context]
        : [updatedAt, world_id, context];

      const result = this.execute(sql, params);

      if (result.changes === 0) {
        return this.failure(`RNG state for world '${world_id}' context '${context}' not found`);
      }

      // Fetch and return the updated state
      return this.get(world_id, context) as RepositoryResult<RNGState>;
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Reset RNG state to a specific call_index (for replay).
   *
   * Used when replaying events from a snapshot - reset the call_index
   * to match the snapshot's state.
   *
   * @param world_id - World identifier
   * @param context - Context name
   * @param call_index - The call_index to reset to
   * @returns Repository result with the updated RNG state
   */
  reset(world_id: string, context: string, call_index: number): RepositoryResult<RNGState> {
    try {
      if (call_index < 0) {
        return this.failure('call_index must be non-negative');
      }

      const updatedAt = new Date().toISOString();

      const sql = `
        UPDATE rng_state
        SET call_index = ?, last_value = NULL, updated_at = ?
        WHERE world_id = ? AND context = ?
      `;

      const result = this.execute(sql, [call_index, updatedAt, world_id, context]);

      if (result.changes === 0) {
        return this.failure(`RNG state for world '${world_id}' context '${context}' not found`);
      }

      // Fetch and return the updated state
      return this.get(world_id, context) as RepositoryResult<RNGState>;
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Get all RNG states for a world (for snapshotting).
   *
   * Returns all context states, which can be saved as part of a snapshot
   * and later restored.
   *
   * @param world_id - World identifier
   * @returns Repository result with array of all RNG states
   */
  getAllForWorld(world_id: string): RepositoryResult<RNGState[]> {
    try {
      const sql = `
        SELECT id, world_id, context, seed, call_index, last_value, updated_at
        FROM rng_state
        WHERE world_id = ?
        ORDER BY context ASC
      `;

      const rows = this.query<RNGStateRow>(sql, [world_id]);
      const states = rows.map((row) => this.toEntity(row));

      return this.success(states);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Restore RNG states from snapshot data.
   *
   * Replaces all RNG states for a world with the provided states.
   * Used when loading a snapshot to restore deterministic state.
   *
   * @param world_id - World identifier
   * @param states - Array of RNG states to restore
   * @returns Repository result indicating success
   */
  restoreFromSnapshot(world_id: string, states: RNGState[]): RepositoryResult<void> {
    try {
      return this.transaction(() => {
        // Delete all existing states for this world
        this.execute('DELETE FROM rng_state WHERE world_id = ?', [world_id]);

        // Insert the snapshot states
        const insertSql = `
          INSERT INTO rng_state (id, world_id, context, seed, call_index, last_value, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `;

        for (const state of states) {
          this.execute(insertSql, [
            state.id,
            world_id, // Use the target world_id, not the one from state
            state.context,
            state.seed,
            state.call_index,
            state.last_value,
            state.updated_at,
          ]);
        }

        return this.success(undefined);
      });
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Delete all RNG states for a world.
   *
   * @param world_id - World identifier
   * @returns Repository result with number of deleted states
   */
  deleteAllForWorld(world_id: string): RepositoryResult<number> {
    try {
      const result = this.execute('DELETE FROM rng_state WHERE world_id = ?', [world_id]);
      return this.success(result.changes);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Delete a specific RNG context.
   *
   * @param world_id - World identifier
   * @param context - Context name to delete
   * @returns Repository result indicating success
   */
  deleteContext(world_id: string, context: string): RepositoryResult<void> {
    try {
      const result = this.execute(
        'DELETE FROM rng_state WHERE world_id = ? AND context = ?',
        [world_id, context]
      );

      if (result.changes === 0) {
        return this.failure(`RNG state for world '${world_id}' context '${context}' not found`);
      }

      return this.success(undefined);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * List all contexts for a world (without full state data).
   *
   * @param world_id - World identifier
   * @returns Repository result with array of context names
   */
  listContexts(world_id: string): RepositoryResult<string[]> {
    try {
      const sql = `
        SELECT context FROM rng_state
        WHERE world_id = ?
        ORDER BY context ASC
      `;

      const rows = this.query<{ context: string }>(sql, [world_id]);
      const contexts = rows.map((row) => row.context);

      return this.success(contexts);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Update the seed for an existing context.
   *
   * Typically used when reseeding is needed (e.g., new game session).
   * Resets call_index to 0 when seed changes.
   *
   * @param world_id - World identifier
   * @param context - Context name
   * @param seed - New seed value
   * @returns Repository result with the updated RNG state
   */
  updateSeed(world_id: string, context: string, seed: string): RepositoryResult<RNGState> {
    try {
      const updatedAt = new Date().toISOString();

      const sql = `
        UPDATE rng_state
        SET seed = ?, call_index = 0, last_value = NULL, updated_at = ?
        WHERE world_id = ? AND context = ?
      `;

      const result = this.execute(sql, [seed, updatedAt, world_id, context]);

      if (result.changes === 0) {
        return this.failure(`RNG state for world '${world_id}' context '${context}' not found`);
      }

      // Fetch and return the updated state
      return this.get(world_id, context) as RepositoryResult<RNGState>;
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Convert a database row to an RNGState entity.
   */
  protected toEntity(row: unknown): RNGState {
    const r = row as RNGStateRow;
    return {
      id: r.id,
      world_id: r.world_id,
      context: r.context,
      seed: r.seed,
      call_index: r.call_index,
      last_value: r.last_value,
      updated_at: r.updated_at,
    };
  }

  /**
   * Convert an RNGState to a database row format.
   */
  protected toRow(entity: Partial<RNGState>): Record<string, unknown> {
    const row: Record<string, unknown> = {};

    if (entity.id !== undefined) {
      row.id = entity.id;
    }
    if (entity.world_id !== undefined) {
      row.world_id = entity.world_id;
    }
    if (entity.context !== undefined) {
      row.context = entity.context;
    }
    if (entity.seed !== undefined) {
      row.seed = entity.seed;
    }
    if (entity.call_index !== undefined) {
      row.call_index = entity.call_index;
    }
    if (entity.last_value !== undefined) {
      row.last_value = entity.last_value;
    }
    if (entity.updated_at !== undefined) {
      row.updated_at = entity.updated_at;
    }

    return row;
  }
}
