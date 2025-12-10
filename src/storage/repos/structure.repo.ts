import Database from 'better-sqlite3';
import { Structure, StructureSchema } from '../../schema/structure.js';

export class StructureRepository {
    constructor(private db: Database.Database) { }

    create(structure: Structure): void {
        const validStructure = StructureSchema.parse(structure);
        const stmt = this.db.prepare(`
      INSERT INTO structures (id, world_id, region_id, name, type, x, y, population, created_at, updated_at)
      VALUES (@id, @worldId, @regionId, @name, @type, @x, @y, @population, @createdAt, @updatedAt)
    `);
        stmt.run({
            id: validStructure.id,
            worldId: validStructure.worldId,
            regionId: validStructure.regionId || null,
            name: validStructure.name,
            type: validStructure.type,
            x: validStructure.x,
            y: validStructure.y,
            population: validStructure.population,
            createdAt: validStructure.createdAt,
            updatedAt: validStructure.updatedAt,
        });
    }

    /**
     * Create multiple structures in a single transaction.
     * Optimized for worldgen structure placement.
     *
     * @param structures - Array of structures to create
     * @returns Number of structures created
     *
     * @example
     * const structures = [
     *   { id: 's1', worldId: 'w1', name: 'City', type: 'city', x: 50, y: 50, population: 10000, ... },
     *   { id: 's2', worldId: 'w1', name: 'Town', type: 'town', x: 30, y: 70, population: 2000, ... },
     * ];
     * structureRepo.createBatch(structures);
     */
    createBatch(structures: Structure[]): number {
        if (structures.length === 0) return 0;

        const stmt = this.db.prepare(`
            INSERT INTO structures (id, world_id, region_id, name, type, x, y, population, created_at, updated_at)
            VALUES (@id, @worldId, @regionId, @name, @type, @x, @y, @population, @createdAt, @updatedAt)
        `);

        const insertMany = this.db.transaction((toInsert: Structure[]) => {
            let count = 0;
            for (const structure of toInsert) {
                const valid = StructureSchema.parse(structure);
                stmt.run({
                    id: valid.id,
                    worldId: valid.worldId,
                    regionId: valid.regionId || null,
                    name: valid.name,
                    type: valid.type,
                    x: valid.x,
                    y: valid.y,
                    population: valid.population,
                    createdAt: valid.createdAt,
                    updatedAt: valid.updatedAt,
                });
                count++;
            }
            return count;
        });

        return insertMany(structures);
    }

    /**
     * Find a structure by its ID
     */
    findById(id: string): Structure | null {
        const stmt = this.db.prepare('SELECT * FROM structures WHERE id = ?');
        const row = stmt.get(id) as StructureRow | undefined;

        if (!row) return null;

        return StructureSchema.parse({
            id: row.id,
            worldId: row.world_id,
            regionId: row.region_id || undefined,
            name: row.name,
            type: row.type,
            x: row.x,
            y: row.y,
            population: row.population,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        });
    }

    /**
     * Find structures by coordinates
     */
    findByCoordinates(worldId: string, x: number, y: number): Structure | null {
        const stmt = this.db.prepare('SELECT * FROM structures WHERE world_id = ? AND x = ? AND y = ?');
        const row = stmt.get(worldId, x, y) as StructureRow | undefined;

        if (!row) return null;

        return StructureSchema.parse({
            id: row.id,
            worldId: row.world_id,
            regionId: row.region_id || undefined,
            name: row.name,
            type: row.type,
            x: row.x,
            y: row.y,
            population: row.population,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        });
    }

    /**
     * Find structures by type
     */
    findByType(worldId: string, type: string): Structure[] {
        const stmt = this.db.prepare('SELECT * FROM structures WHERE world_id = ? AND type = ?');
        const rows = stmt.all(worldId, type) as StructureRow[];

        return rows.map((row) =>
            StructureSchema.parse({
                id: row.id,
                worldId: row.world_id,
                regionId: row.region_id || undefined,
                name: row.name,
                type: row.type,
                x: row.x,
                y: row.y,
                population: row.population,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            })
        );
    }

    /**
     * Delete all structures for a world
     */
    deleteByWorldId(worldId: string): number {
        const stmt = this.db.prepare('DELETE FROM structures WHERE world_id = ?');
        const result = stmt.run(worldId);
        return result.changes;
    }

    findByWorldId(worldId: string): Structure[] {
        const stmt = this.db.prepare('SELECT * FROM structures WHERE world_id = ?');
        const rows = stmt.all(worldId) as StructureRow[];

        return rows.map((row) =>
            StructureSchema.parse({
                id: row.id,
                worldId: row.world_id,
                regionId: row.region_id || undefined,
                name: row.name,
                type: row.type,
                x: row.x,
                y: row.y,
                population: row.population,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            })
        );
    }
}

interface StructureRow {
    id: string;
    world_id: string;
    region_id: string | null;
    name: string;
    type: string;
    x: number;
    y: number;
    population: number;
    created_at: string;
    updated_at: string;
}
