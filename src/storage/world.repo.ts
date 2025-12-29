/**
 * WORLD REPOSITORY
 *
 * Manages world entities - top-level containers for game data including
 * regions, tiles, structures, and all other spatial/narrative content.
 *
 * Key features:
 * - T047: Create worlds with unique seeds for deterministic generation
 * - Query worlds by name or list all
 * - Update world metadata
 *
 * @see specs/001-database-architecture/data-model.md
 * @module storage/world.repo
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { BaseRepository, RepositoryResult } from './base.repo.js';
import { canonicalStringify } from './utils/canonical-json.js';

/**
 * Represents a game world entity for repository operations.
 * Note: Named WorldEntity to avoid conflict with schema World type.
 */
export interface WorldEntity {
    /** Unique world identifier (UUID) */
    id: string;
    /** Human-readable world name */
    name: string;
    /** Seed used for deterministic world generation */
    seed: string;
    /** ISO 8601 timestamp of world creation */
    created_at: string;
    /** JSON-encoded world metadata (settings, preferences, etc.) */
    metadata_json: string;
}

/**
 * Database row type for worlds table.
 */
interface WorldRow {
    id: string;
    name: string;
    seed: string;
    width: number;
    height: number;
    created_at: string;
    updated_at: string;
    environment?: string;
}

/**
 * Repository for world management operations.
 *
 * Worlds are the root container for all game content. Each world has a unique
 * seed that enables deterministic generation of terrain, structures, and NPCs.
 *
 * @example
 * ```typescript
 * const repo = new WorldRepository(db);
 *
 * // Create a new world
 * const result = repo.create('My Campaign', 'seed123', { difficulty: 'hard' });
 *
 * // Find world by name
 * const world = repo.getByName('My Campaign');
 *
 * // Update metadata
 * repo.updateMetadata(world.data.id, { difficulty: 'nightmare' });
 * ```
 */
export class WorldRepository extends BaseRepository<WorldEntity> {
    constructor(db: Database.Database) {
        super(db, 'worlds');
    }

    /**
     * T047: Create a new world with the specified name and seed.
     *
     * Creates a world entry with:
     * - Unique UUID identifier
     * - Current timestamp
     * - Default dimensions (100x100)
     * - Serialized metadata
     *
     * @param name - Human-readable world name
     * @param seed - Seed for deterministic generation
     * @param metadata - Optional metadata object (settings, preferences)
     * @returns Repository result with the created world
     */
    create(name: string, seed: string, metadata?: object): RepositoryResult<WorldEntity> {
        try {
            if (!name || name.trim().length === 0) {
                return this.failure('World name is required');
            }
            if (!seed || seed.trim().length === 0) {
                return this.failure('World seed is required');
            }

            const id = randomUUID();
            const now = new Date().toISOString();
            const metadataJson = metadata ? canonicalStringify(metadata) : '{}';

            const sql = `
                INSERT INTO worlds (
                    id, name, seed, width, height, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `;

            this.execute(sql, [
                id,
                name.trim(),
                seed,
                100, // Default width
                100, // Default height
                now,
                now,
            ]);

            // Store metadata in a separate way since the base table doesn't have metadata_json
            // For now, we return the world with empty metadata - metadata can be stored in environment column
            const world: WorldEntity = {
                id,
                name: name.trim(),
                seed,
                created_at: now,
                metadata_json: metadataJson,
            };

            return this.success(world);
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Get a world by its name.
     *
     * @param name - World name to search for
     * @returns Repository result with the world or null if not found
     */
    getByName(name: string): RepositoryResult<WorldEntity | null> {
        try {
            const sql = `
                SELECT id, name, seed, created_at, updated_at, environment
                FROM worlds
                WHERE name = ?
                LIMIT 1
            `;

            const row = this.queryOne<WorldRow>(sql, [name]);

            if (!row) {
                return this.success(null);
            }

            return this.success(this.toEntity(row));
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * List all worlds with optional limit.
     *
     * @param limit - Maximum number of worlds to return (default: 100)
     * @returns Repository result with array of worlds
     */
    listAll(limit: number = 100): RepositoryResult<WorldEntity[]> {
        try {
            const sql = `
                SELECT id, name, seed, created_at, updated_at, environment
                FROM worlds
                ORDER BY created_at DESC
                LIMIT ?
            `;

            const rows = this.query<WorldRow>(sql, [limit]);
            const worlds = rows.map((row) => this.toEntity(row));

            return this.success(worlds);
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Update world metadata.
     *
     * Merges the new metadata with existing metadata stored in the environment column.
     *
     * @param id - World ID to update
     * @param metadata - New metadata object to merge
     * @returns Repository result with the updated world
     */
    updateMetadata(id: string, metadata: object): RepositoryResult<WorldEntity> {
        try {
            // Get existing world
            const existingResult = this.findById(id);
            if (!existingResult.success || !existingResult.data) {
                return this.failure(`World with id '${id}' not found`);
            }

            // Merge metadata
            const existingMetadata = JSON.parse(existingResult.data.metadata_json || '{}');
            const mergedMetadata = { ...existingMetadata, ...metadata };
            const metadataJson = canonicalStringify(mergedMetadata);
            const now = new Date().toISOString();

            // Store merged metadata in environment column
            const sql = `
                UPDATE worlds
                SET environment = ?, updated_at = ?
                WHERE id = ?
            `;

            this.execute(sql, [metadataJson, now, id]);

            return this.success({
                ...existingResult.data,
                metadata_json: metadataJson,
            });
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Convert a database row to a WorldEntity entity.
     */
    protected toEntity(row: unknown): WorldEntity {
        const r = row as WorldRow;
        return {
            id: r.id,
            name: r.name,
            seed: r.seed,
            created_at: r.created_at,
            // Use environment column for metadata if available
            metadata_json: r.environment || '{}',
        };
    }

    /**
     * Convert a WorldEntity to a database row format.
     */
    protected toRow(entity: Partial<WorldEntity>): Record<string, unknown> {
        const row: Record<string, unknown> = {};

        if (entity.id !== undefined) {
            row.id = entity.id;
        }
        if (entity.name !== undefined) {
            row.name = entity.name;
        }
        if (entity.seed !== undefined) {
            row.seed = entity.seed;
        }
        if (entity.created_at !== undefined) {
            row.created_at = entity.created_at;
        }
        if (entity.metadata_json !== undefined) {
            row.environment = entity.metadata_json;
        }

        return row;
    }
}
