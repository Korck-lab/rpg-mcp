/**
 * TILE REPOSITORY
 *
 * Manages tiles within regions - the fundamental spatial unit for world maps.
 * Each tile has terrain, elevation, features, and exploration state.
 *
 * Key features:
 * - T049: Create tiles with terrain and feature data
 * - Query tiles by position or area
 * - Track exploration state
 * - Bulk create tiles for efficient world generation
 *
 * @see specs/001-database-architecture/data-model.md
 * @module storage/tile.repo
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { BaseRepository, RepositoryResult } from './base.repo.js';

/**
 * Represents a tile entity for repository operations.
 * Note: Named TileEntity to avoid conflict with schema Tile type.
 */
export interface TileEntity {
    /** Unique tile identifier (UUID) */
    id: string;
    /** Parent region ID */
    region_id: string;
    /** X coordinate within the world */
    x: number;
    /** Y coordinate within the world */
    y: number;
    /** Terrain type (grass, water, rock, etc.) */
    terrain: string;
    /** Biome type (inherited from region or overridden) */
    biome: string | null;
    /** Elevation level (0-100) */
    elevation: number;
    /** JSON-encoded array of features (trees, rocks, etc.) */
    features_json: string;
    /** Optional reference to a structure on this tile */
    structure_id: string | null;
    /** Whether the tile has been explored by players */
    is_explored: boolean;
}

/**
 * Bounding box for area queries.
 */
export interface TileBounds {
    min_x: number;
    min_y: number;
    max_x: number;
    max_y: number;
}

/**
 * Database row type for tiles table.
 */
interface TileRow {
    id: string;
    world_id: string;
    x: number;
    y: number;
    biome: string;
    elevation: number;
    moisture: number;
    temperature: number;
    region_id: string | null;
}

/**
 * Repository for tile management operations.
 *
 * Tiles are the fundamental spatial units in the world map. They define terrain,
 * elevation, and can contain features or structures.
 *
 * @example
 * ```typescript
 * const repo = new TileRepository(db);
 *
 * // Create a single tile
 * const result = repo.create('region_001', 10, 20, {
 *   terrain: 'grass',
 *   elevation: 50,
 * });
 *
 * // Get tile at specific position
 * const tile = repo.getAt('region_001', 10, 20);
 *
 * // Get tiles in an area
 * const tiles = repo.getInArea('region_001', {
 *   min_x: 0, min_y: 0, max_x: 10, max_y: 10
 * });
 *
 * // Bulk create tiles for world generation
 * const count = repo.bulkCreate([
 *   { region_id: 'region_001', x: 0, y: 0, terrain: 'grass' },
 *   { region_id: 'region_001', x: 1, y: 0, terrain: 'water' },
 * ]);
 * ```
 */
export class TileRepository extends BaseRepository<TileEntity> {
    constructor(db: Database.Database) {
        super(db, 'tiles');
    }

    /**
     * T049: Create a tile at the specified position.
     *
     * Creates a tile entry with:
     * - Unique UUID identifier
     * - Position coordinates
     * - Terrain and elevation data
     * - Optional features and structure reference
     *
     * @param region_id - Parent region ID
     * @param x - X coordinate
     * @param y - Y coordinate
     * @param data - Optional tile data (terrain, biome, elevation, features, etc.)
     * @returns Repository result with the created tile
     */
    create(region_id: string, x: number, y: number, data?: Partial<TileEntity>): RepositoryResult<TileEntity> {
        try {
            if (!region_id) {
                return this.failure('Region ID is required');
            }

            const id = randomUUID();
            const terrain = data?.terrain ?? 'grass';
            const biome = data?.biome ?? null;
            const elevation = data?.elevation ?? 50;
            const featuresJson = data?.features_json ?? '[]';

            // Need to get world_id from region
            const regionRow = this.queryOne<{ world_id: string }>(
                'SELECT world_id FROM regions WHERE id = ?',
                [region_id]
            );

            if (!regionRow) {
                return this.failure(`Region with id '${region_id}' not found`);
            }

            const sql = `
                INSERT INTO tiles (
                    id, world_id, x, y, biome, elevation, moisture, temperature, region_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            this.execute(sql, [
                id,
                regionRow.world_id,
                x,
                y,
                biome ?? terrain, // Use terrain as biome if not specified
                elevation,
                50, // Default moisture
                50, // Default temperature
                region_id,
            ]);

            const tile: TileEntity = {
                id,
                region_id,
                x,
                y,
                terrain,
                biome,
                elevation,
                features_json: featuresJson,
                structure_id: data?.structure_id ?? null,
                is_explored: data?.is_explored ?? false,
            };

            return this.success(tile);
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Get a tile at the specified position within a region.
     *
     * @param region_id - Parent region ID
     * @param x - X coordinate
     * @param y - Y coordinate
     * @returns Repository result with the tile or null if not found
     */
    getAt(region_id: string, x: number, y: number): RepositoryResult<TileEntity | null> {
        try {
            const sql = `
                SELECT id, world_id, x, y, biome, elevation, moisture, temperature, region_id
                FROM tiles
                WHERE region_id = ? AND x = ? AND y = ?
                LIMIT 1
            `;

            const row = this.queryOne<TileRow>(sql, [region_id, x, y]);

            if (!row) {
                return this.success(null);
            }

            return this.success(this.toEntity(row));
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Get all tiles within a bounding box in a region.
     *
     * @param region_id - Parent region ID
     * @param bounds - Bounding box coordinates (inclusive)
     * @returns Repository result with array of tiles
     */
    getInArea(region_id: string, bounds: TileBounds): RepositoryResult<TileEntity[]> {
        try {
            const sql = `
                SELECT id, world_id, x, y, biome, elevation, moisture, temperature, region_id
                FROM tiles
                WHERE region_id = ?
                  AND x >= ? AND x <= ?
                  AND y >= ? AND y <= ?
                ORDER BY y, x
            `;

            const rows = this.query<TileRow>(sql, [
                region_id,
                bounds.min_x,
                bounds.max_x,
                bounds.min_y,
                bounds.max_y,
            ]);

            const tiles = rows.map((row) => this.toEntity(row));

            return this.success(tiles);
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Mark a tile as explored.
     *
     * Note: Currently the tiles table doesn't have an is_explored column,
     * so this is a placeholder for when that column is added.
     *
     * @param region_id - Parent region ID
     * @param x - X coordinate
     * @param y - Y coordinate
     * @returns Repository result indicating success
     */
    setExplored(region_id: string, x: number, y: number): RepositoryResult<void> {
        try {
            // Check if tile exists
            const existingResult = this.getAt(region_id, x, y);
            if (!existingResult.success) {
                return this.failure(existingResult.error ?? 'Failed to get tile');
            }
            if (!existingResult.data) {
                return this.failure(`Tile at (${x}, ${y}) in region '${region_id}' not found`);
            }

            // Note: When is_explored column is added, uncomment:
            // const sql = `
            //     UPDATE tiles
            //     SET is_explored = 1
            //     WHERE region_id = ? AND x = ? AND y = ?
            // `;
            // this.execute(sql, [region_id, x, y]);

            return this.success(undefined);
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * T049: Bulk create tiles for efficient world generation.
     *
     * Creates multiple tiles in a single transaction for performance.
     *
     * @param tiles - Array of partial tile data (must include region_id, x, y)
     * @returns Repository result with count of tiles created
     */
    bulkCreate(tiles: Partial<TileEntity>[]): RepositoryResult<number> {
        try {
            if (tiles.length === 0) {
                return this.success(0);
            }

            // Group tiles by region to look up world_ids
            const regionIds = [...new Set(tiles.map(t => t.region_id).filter(Boolean))];
            const regionWorldMap = new Map<string, string>();

            for (const regionId of regionIds) {
                const regionRow = this.queryOne<{ world_id: string }>(
                    'SELECT world_id FROM regions WHERE id = ?',
                    [regionId]
                );
                if (regionRow) {
                    regionWorldMap.set(regionId!, regionRow.world_id);
                }
            }

            return this.transaction(() => {
                let createdCount = 0;

                const insertSql = `
                    INSERT OR REPLACE INTO tiles (
                        id, world_id, x, y, biome, elevation, moisture, temperature, region_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

                for (const tile of tiles) {
                    if (!tile.region_id || tile.x === undefined || tile.y === undefined) {
                        continue; // Skip invalid tiles
                    }

                    const worldId = regionWorldMap.get(tile.region_id);
                    if (!worldId) {
                        continue; // Skip tiles with invalid region
                    }

                    const id = tile.id ?? randomUUID();
                    const terrain = tile.terrain ?? 'grass';
                    const biome = tile.biome ?? terrain;
                    const elevation = tile.elevation ?? 50;

                    this.execute(insertSql, [
                        id,
                        worldId,
                        tile.x,
                        tile.y,
                        biome,
                        elevation,
                        50, // Default moisture
                        50, // Default temperature
                        tile.region_id,
                    ]);

                    createdCount++;
                }

                return this.success(createdCount);
            });
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Convert a database row to a TileEntity entity.
     */
    protected toEntity(row: unknown): TileEntity {
        const r = row as TileRow;
        return {
            id: r.id,
            region_id: r.region_id ?? '',
            x: r.x,
            y: r.y,
            terrain: r.biome, // biome column stores terrain type
            biome: r.biome,
            elevation: r.elevation,
            features_json: '[]', // Not stored in current schema
            structure_id: null, // Not stored in current schema
            is_explored: false, // Not stored in current schema
        };
    }

    /**
     * Convert a TileEntity to a database row format.
     */
    protected toRow(entity: Partial<TileEntity>): Record<string, unknown> {
        const row: Record<string, unknown> = {};

        if (entity.id !== undefined) {
            row.id = entity.id;
        }
        if (entity.region_id !== undefined) {
            row.region_id = entity.region_id;
        }
        if (entity.x !== undefined) {
            row.x = entity.x;
        }
        if (entity.y !== undefined) {
            row.y = entity.y;
        }
        if (entity.biome !== undefined || entity.terrain !== undefined) {
            row.biome = entity.biome ?? entity.terrain;
        }
        if (entity.elevation !== undefined) {
            row.elevation = entity.elevation;
        }

        return row;
    }
}
