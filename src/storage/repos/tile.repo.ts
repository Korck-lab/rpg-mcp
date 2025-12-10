import Database from 'better-sqlite3';
import { Tile, TileSchema } from '../../schema/tile.js';

export class TileRepository {
    constructor(private db: Database.Database) { }

    create(tile: Tile): void {
        const validTile = TileSchema.parse(tile);
        const stmt = this.db.prepare(`
      INSERT INTO tiles (id, world_id, x, y, biome, elevation, moisture, temperature)
      VALUES (@id, @worldId, @x, @y, @biome, @elevation, @moisture, @temperature)
    `);
        stmt.run({
            id: validTile.id,
            worldId: validTile.worldId,
            x: validTile.x,
            y: validTile.y,
            biome: validTile.biome,
            elevation: validTile.elevation,
            moisture: validTile.moisture,
            temperature: validTile.temperature,
        });
    }

    /**
     * Create multiple tiles in a single transaction.
     * Uses prepared statement batching for optimal performance during worldgen.
     *
     * @param tiles - Array of tiles to create
     * @returns Number of tiles created
     *
     * @example
     * // Create 10,000 tiles from worldgen data
     * const tiles = [];
     * for (let y = 0; y < 100; y++) {
     *   for (let x = 0; x < 100; x++) {
     *     tiles.push({
     *       id: `tile-${x}-${y}`,
     *       worldId: 'world-1',
     *       x, y,
     *       biome: biomes[y][x],
     *       elevation: elevation[y * 100 + x],
     *       moisture: moisture[y * 100 + x] / 100,
     *       temperature: temperature[y * 100 + x]
     *     });
     *   }
     * }
     * tileRepo.createBatch(tiles); // ~50x faster than individual inserts
     */
    createBatch(tiles: Tile[]): number {
        if (tiles.length === 0) return 0;

        const stmt = this.db.prepare(`
            INSERT INTO tiles (id, world_id, x, y, biome, elevation, moisture, temperature)
            VALUES (@id, @worldId, @x, @y, @biome, @elevation, @moisture, @temperature)
        `);

        const insertMany = this.db.transaction((tilesToInsert: Tile[]) => {
            let count = 0;
            for (const tile of tilesToInsert) {
                const validTile = TileSchema.parse(tile);
                stmt.run({
                    id: validTile.id,
                    worldId: validTile.worldId,
                    x: validTile.x,
                    y: validTile.y,
                    biome: validTile.biome,
                    elevation: validTile.elevation,
                    moisture: validTile.moisture,
                    temperature: validTile.temperature,
                });
                count++;
            }
            return count;
        });

        return insertMany(tiles);
    }

    /**
     * Create tiles from worldgen data arrays efficiently.
     * Directly maps array indices to tile coordinates.
     *
     * @param worldId - World ID
     * @param width - World width
     * @param height - World height
     * @param biomes - 2D biome array [y][x]
     * @param elevation - Flat elevation array (y * width + x)
     * @param moisture - Flat moisture array (y * width + x), values 0-100
     * @param temperature - Flat temperature array (y * width + x)
     * @param idPrefix - Optional ID prefix (default: 'tile')
     * @returns Number of tiles created
     */
    createFromWorldgen(
        worldId: string,
        width: number,
        height: number,
        biomes: string[][],
        elevation: Uint8Array | number[],
        moisture: Uint8Array | number[],
        temperature: Int8Array | number[],
        idPrefix: string = 'tile'
    ): number {
        const stmt = this.db.prepare(`
            INSERT INTO tiles (id, world_id, x, y, biome, elevation, moisture, temperature)
            VALUES (@id, @worldId, @x, @y, @biome, @elevation, @moisture, @temperature)
        `);

        const insertAll = this.db.transaction(() => {
            let count = 0;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = y * width + x;
                    stmt.run({
                        id: `${idPrefix}-${worldId}-${x}-${y}`,
                        worldId,
                        x,
                        y,
                        biome: biomes[y][x],
                        elevation: elevation[idx],
                        moisture: moisture[idx] / 100, // Convert 0-100 to 0-1
                        temperature: temperature[idx],
                    });
                    count++;
                }
            }
            return count;
        });

        return insertAll();
    }

    /**
     * Delete all tiles for a world (useful before regenerating)
     */
    deleteByWorldId(worldId: string): number {
        const stmt = this.db.prepare('DELETE FROM tiles WHERE world_id = ?');
        const result = stmt.run(worldId);
        return result.changes;
    }

    findByCoordinates(worldId: string, x: number, y: number): Tile | null {
        const stmt = this.db.prepare('SELECT * FROM tiles WHERE world_id = ? AND x = ? AND y = ?');
        const row = stmt.get(worldId, x, y) as TileRow | undefined;

        if (!row) return null;

        return TileSchema.parse({
            id: row.id,
            worldId: row.world_id,
            x: row.x,
            y: row.y,
            biome: row.biome,
            elevation: row.elevation,
            moisture: row.moisture,
            temperature: row.temperature,
        });
    }

    findByWorldId(worldId: string): Tile[] {
        const stmt = this.db.prepare('SELECT * FROM tiles WHERE world_id = ?');
        const rows = stmt.all(worldId) as TileRow[];

        return rows.map((row) =>
            TileSchema.parse({
                id: row.id,
                worldId: row.world_id,
                x: row.x,
                y: row.y,
                biome: row.biome,
                elevation: row.elevation,
                moisture: row.moisture,
                temperature: row.temperature,
            })
        );
    }
}

interface TileRow {
    id: string;
    world_id: string;
    x: number;
    y: number;
    biome: string;
    elevation: number;
    moisture: number;
    temperature: number;
}
