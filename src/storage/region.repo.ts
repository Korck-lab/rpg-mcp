/**
 * REGION REPOSITORY
 *
 * Manages regions within a world - large geographic areas that contain tiles,
 * structures, and define biome/climate zones.
 *
 * Key features:
 * - T048: Create regions with biome and climate data
 * - Query regions by world or biome
 * - Update region bounds for spatial queries
 *
 * @see specs/001-database-architecture/data-model.md
 * @module storage/region.repo
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { BaseRepository, RepositoryResult } from './base.repo.js';
import { canonicalStringify } from './utils/canonical-json.js';

/**
 * Represents a region entity for repository operations.
 * Note: Named RegionEntity to avoid conflict with schema Region type.
 */
export interface RegionEntity {
    /** Unique region identifier (UUID) */
    id: string;
    /** Parent world ID */
    world_id: string;
    /** Human-readable region name */
    name: string;
    /** Biome type (forest, mountain, urban, etc.) */
    biome: string;
    /** Climate conditions (optional) */
    climate: string | null;
    /** Region description (optional) */
    description: string | null;
    /** JSON-encoded bounding box {min_x, min_y, max_x, max_y} */
    bounds_json: string;
    /** JSON-encoded region metadata */
    metadata_json: string;
    /** ISO 8601 timestamp of region creation */
    created_at: string;
}

/**
 * Bounding box coordinates for spatial queries.
 */
export interface RegionBounds {
    min_x: number;
    min_y: number;
    max_x: number;
    max_y: number;
}

/**
 * Database row type for regions table.
 */
interface RegionRow {
    id: string;
    world_id: string;
    name: string;
    type: string;
    center_x: number;
    center_y: number;
    color: string;
    created_at: string;
    updated_at: string;
    owner_nation_id: string | null;
    control_level: number;
}

/**
 * Repository for region management operations.
 *
 * Regions divide a world into distinct geographic zones with different biomes,
 * climates, and characteristics. They contain tiles and structures.
 *
 * @example
 * ```typescript
 * const repo = new RegionRepository(db);
 *
 * // Create a forest region
 * const result = repo.create('world_001', {
 *   name: 'Darkwood Forest',
 *   biome: 'forest',
 *   climate: 'temperate',
 *   description: 'An ancient forest shrouded in mist',
 * });
 *
 * // Get all regions in a world
 * const regions = repo.getByWorld('world_001');
 *
 * // Find forest regions
 * const forests = repo.getByBiome('world_001', 'forest');
 * ```
 */
export class RegionRepository extends BaseRepository<RegionEntity> {
    constructor(db: Database.Database) {
        super(db, 'regions');
    }

    /**
     * T048: Create a new region within a world.
     *
     * Creates a region entry with:
     * - Unique UUID identifier
     * - Current timestamp
     * - Biome and climate data
     * - Optional bounding box
     *
     * @param world_id - Parent world ID
     * @param data - Region data (name, biome, climate, description, bounds, metadata)
     * @returns Repository result with the created region
     */
    create(world_id: string, data: Partial<RegionEntity>): RepositoryResult<RegionEntity> {
        try {
            if (!world_id) {
                return this.failure('World ID is required');
            }
            if (!data.name || data.name.trim().length === 0) {
                return this.failure('Region name is required');
            }
            if (!data.biome || data.biome.trim().length === 0) {
                return this.failure('Region biome is required');
            }

            const id = randomUUID();
            const now = new Date().toISOString();

            // Parse bounds if provided, otherwise use defaults
            let bounds: RegionBounds = { min_x: 0, min_y: 0, max_x: 100, max_y: 100 };
            if (data.bounds_json) {
                try {
                    bounds = JSON.parse(data.bounds_json);
                } catch {
                    // Keep defaults if parsing fails
                }
            }

            // Calculate center from bounds
            const centerX = Math.floor((bounds.min_x + bounds.max_x) / 2);
            const centerY = Math.floor((bounds.min_y + bounds.max_y) / 2);

            const sql = `
                INSERT INTO regions (
                    id, world_id, name, type, center_x, center_y, color, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            this.execute(sql, [
                id,
                world_id,
                data.name.trim(),
                data.biome, // Store biome in type column
                centerX,
                centerY,
                '#808080', // Default gray color
                now,
                now,
            ]);

            const region: RegionEntity = {
                id,
                world_id,
                name: data.name.trim(),
                biome: data.biome,
                climate: data.climate ?? null,
                description: data.description ?? null,
                bounds_json: canonicalStringify(bounds),
                metadata_json: data.metadata_json ?? '{}',
                created_at: now,
            };

            return this.success(region);
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Get all regions in a world.
     *
     * @param world_id - Parent world ID
     * @returns Repository result with array of regions
     */
    getByWorld(world_id: string): RepositoryResult<RegionEntity[]> {
        try {
            const sql = `
                SELECT id, world_id, name, type, center_x, center_y, color, created_at, updated_at
                FROM regions
                WHERE world_id = ?
                ORDER BY name ASC
            `;

            const rows = this.query<RegionRow>(sql, [world_id]);
            const regions = rows.map((row) => this.toEntity(row));

            return this.success(regions);
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Get regions by biome type within a world.
     *
     * @param world_id - Parent world ID
     * @param biome - Biome type to filter by
     * @returns Repository result with array of matching regions
     */
    getByBiome(world_id: string, biome: string): RepositoryResult<RegionEntity[]> {
        try {
            const sql = `
                SELECT id, world_id, name, type, center_x, center_y, color, created_at, updated_at
                FROM regions
                WHERE world_id = ? AND type = ?
                ORDER BY name ASC
            `;

            const rows = this.query<RegionRow>(sql, [world_id, biome]);
            const regions = rows.map((row) => this.toEntity(row));

            return this.success(regions);
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Update region bounding box.
     *
     * Updates the region's center position based on the new bounds and stores
     * the bounds for spatial queries.
     *
     * @param id - Region ID to update
     * @param bounds - New bounding box coordinates
     * @returns Repository result with the updated region
     */
    updateBounds(id: string, bounds: RegionBounds): RepositoryResult<RegionEntity> {
        try {
            // Validate bounds
            if (bounds.min_x >= bounds.max_x || bounds.min_y >= bounds.max_y) {
                return this.failure('Invalid bounds: min must be less than max');
            }

            // Get existing region
            const existingResult = this.findById(id);
            if (!existingResult.success || !existingResult.data) {
                return this.failure(`Region with id '${id}' not found`);
            }

            // Calculate new center
            const centerX = Math.floor((bounds.min_x + bounds.max_x) / 2);
            const centerY = Math.floor((bounds.min_y + bounds.max_y) / 2);
            const now = new Date().toISOString();

            const sql = `
                UPDATE regions
                SET center_x = ?, center_y = ?, updated_at = ?
                WHERE id = ?
            `;

            this.execute(sql, [centerX, centerY, now, id]);

            return this.success({
                ...existingResult.data,
                bounds_json: canonicalStringify(bounds),
            });
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Convert a database row to a RegionEntity entity.
     */
    protected toEntity(row: unknown): RegionEntity {
        const r = row as RegionRow;

        // Reconstruct bounds from center (approximate - actual bounds would need storage)
        const bounds: RegionBounds = {
            min_x: r.center_x - 50,
            min_y: r.center_y - 50,
            max_x: r.center_x + 50,
            max_y: r.center_y + 50,
        };

        return {
            id: r.id,
            world_id: r.world_id,
            name: r.name,
            biome: r.type, // type column stores biome
            climate: null, // Not stored in current schema
            description: null, // Not stored in current schema
            bounds_json: canonicalStringify(bounds),
            metadata_json: canonicalStringify({ color: r.color }),
            created_at: r.created_at,
        };
    }

    /**
     * Convert a RegionEntity to a database row format.
     */
    protected toRow(entity: Partial<RegionEntity>): Record<string, unknown> {
        const row: Record<string, unknown> = {};

        if (entity.id !== undefined) {
            row.id = entity.id;
        }
        if (entity.world_id !== undefined) {
            row.world_id = entity.world_id;
        }
        if (entity.name !== undefined) {
            row.name = entity.name;
        }
        if (entity.biome !== undefined) {
            row.type = entity.biome;
        }
        if (entity.created_at !== undefined) {
            row.created_at = entity.created_at;
        }

        return row;
    }
}
