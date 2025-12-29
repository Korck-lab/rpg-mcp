import Database from 'better-sqlite3';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { RepositoryResult } from '../base.repo.js';

/**
 * T063: MonsterRepository
 * 
 * Manages monsters (enemy NPCs spawned from templates).
 * Monsters are separate from characters - they use monster stat blocks
 * and are typically spawned into encounters.
 */

// Monster schema
export const MonsterStatsSchema = z.object({
    str: z.number().int().min(0),
    dex: z.number().int().min(0),
    con: z.number().int().min(0),
    int: z.number().int().min(0),
    wis: z.number().int().min(0),
    cha: z.number().int().min(0),
});

export const MonsterSchema = z.object({
    id: z.string(),
    worldId: z.string(),
    templateId: z.string().describe('Reference to monster template'),
    name: z.string(),
    hp: z.number().int().min(0),
    maxHp: z.number().int().min(1),
    ac: z.number().int().min(0),
    cr: z.number().min(0),
    xp: z.number().int().min(0),
    stats: MonsterStatsSchema,
    size: z.enum(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']).default('medium'),
    creatureType: z.string().describe('Creature type: beast, dragon, undead, etc.'),
    alignment: z.string().optional(),
    speed: z.number().int().min(0).default(30),
    roomId: z.string().nullable(),
    positionX: z.number().int().nullable(),
    positionY: z.number().int().nullable(),
    positionZ: z.number().int().nullable().default(0),
    encounterId: z.string().nullable(),
    isAlive: z.boolean().default(true),
    conditions: z.array(z.string()).default([]),
    resistances: z.array(z.string()).default([]),
    vulnerabilities: z.array(z.string()).default([]),
    immunities: z.array(z.string()).default([]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});

export type Monster = z.infer<typeof MonsterSchema>;
export type MonsterStats = z.infer<typeof MonsterStatsSchema>;

export interface MonsterCreateInput {
    name: string;
    hp: number;
    maxHp: number;
    ac: number;
    cr: number;
    xp: number;
    stats: MonsterStats;
    size?: string;
    creatureType: string;
    alignment?: string;
    speed?: number;
    roomId?: string;
    positionX?: number;
    positionY?: number;
    positionZ?: number;
    encounterId?: string;
    conditions?: string[];
    resistances?: string[];
    vulnerabilities?: string[];
    immunities?: string[];
}

interface MonsterRow {
    id: string;
    world_id: string;
    template_id: string;
    name: string;
    hp: number;
    max_hp: number;
    ac: number;
    cr: number;
    xp: number;
    stats: string;
    size: string;
    creature_type: string;
    alignment: string | null;
    speed: number;
    room_id: string | null;
    position_x: number | null;
    position_y: number | null;
    position_z: number | null;
    encounter_id: string | null;
    is_alive: number;
    conditions: string;
    resistances: string;
    vulnerabilities: string;
    immunities: string;
    created_at: string;
    updated_at: string;
}

export class MonsterRepository {
    constructor(private db: Database.Database) {
        this.ensureTable();
    }

    private ensureTable(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS monsters (
                id TEXT PRIMARY KEY,
                world_id TEXT NOT NULL,
                template_id TEXT NOT NULL,
                name TEXT NOT NULL,
                hp INTEGER NOT NULL,
                max_hp INTEGER NOT NULL,
                ac INTEGER NOT NULL,
                cr REAL NOT NULL,
                xp INTEGER NOT NULL,
                stats TEXT NOT NULL,
                size TEXT NOT NULL DEFAULT 'medium',
                creature_type TEXT NOT NULL,
                alignment TEXT,
                speed INTEGER NOT NULL DEFAULT 30,
                room_id TEXT,
                position_x INTEGER,
                position_y INTEGER,
                position_z INTEGER DEFAULT 0,
                encounter_id TEXT,
                is_alive INTEGER NOT NULL DEFAULT 1,
                conditions TEXT NOT NULL DEFAULT '[]',
                resistances TEXT NOT NULL DEFAULT '[]',
                vulnerabilities TEXT NOT NULL DEFAULT '[]',
                immunities TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        `);

        // Create indexes
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_monsters_world_id ON monsters(world_id);
            CREATE INDEX IF NOT EXISTS idx_monsters_room_id ON monsters(room_id);
            CREATE INDEX IF NOT EXISTS idx_monsters_encounter_id ON monsters(encounter_id);
            CREATE INDEX IF NOT EXISTS idx_monsters_is_alive ON monsters(is_alive);
        `);
    }

    /**
     * Create a new monster from a template.
     */
    create(
        worldId: string,
        templateId: string,
        roomId: string,
        data: MonsterCreateInput
    ): RepositoryResult<Monster> {
        try {
            const now = new Date().toISOString();
            const id = randomUUID();

            const monster: Monster = {
                id,
                worldId,
                templateId,
                name: data.name,
                hp: data.hp,
                maxHp: data.maxHp,
                ac: data.ac,
                cr: data.cr,
                xp: data.xp,
                stats: data.stats,
                size: (data.size as Monster['size']) || 'medium',
                creatureType: data.creatureType,
                alignment: data.alignment,
                speed: data.speed ?? 30,
                roomId,
                positionX: data.positionX ?? null,
                positionY: data.positionY ?? null,
                positionZ: data.positionZ ?? 0,
                encounterId: data.encounterId ?? null,
                isAlive: true,
                conditions: data.conditions ?? [],
                resistances: data.resistances ?? [],
                vulnerabilities: data.vulnerabilities ?? [],
                immunities: data.immunities ?? [],
                createdAt: now,
                updatedAt: now,
            };

            const stmt = this.db.prepare(`
                INSERT INTO monsters (
                    id, world_id, template_id, name, hp, max_hp, ac, cr, xp, stats,
                    size, creature_type, alignment, speed, room_id,
                    position_x, position_y, position_z, encounter_id, is_alive,
                    conditions, resistances, vulnerabilities, immunities,
                    created_at, updated_at
                ) VALUES (
                    @id, @worldId, @templateId, @name, @hp, @maxHp, @ac, @cr, @xp, @stats,
                    @size, @creatureType, @alignment, @speed, @roomId,
                    @positionX, @positionY, @positionZ, @encounterId, @isAlive,
                    @conditions, @resistances, @vulnerabilities, @immunities,
                    @createdAt, @updatedAt
                )
            `);

            stmt.run({
                id: monster.id,
                worldId: monster.worldId,
                templateId: monster.templateId,
                name: monster.name,
                hp: monster.hp,
                maxHp: monster.maxHp,
                ac: monster.ac,
                cr: monster.cr,
                xp: monster.xp,
                stats: JSON.stringify(monster.stats),
                size: monster.size,
                creatureType: monster.creatureType,
                alignment: monster.alignment || null,
                speed: monster.speed,
                roomId: monster.roomId,
                positionX: monster.positionX,
                positionY: monster.positionY,
                positionZ: monster.positionZ,
                encounterId: monster.encounterId,
                isAlive: monster.isAlive ? 1 : 0,
                conditions: JSON.stringify(monster.conditions),
                resistances: JSON.stringify(monster.resistances),
                vulnerabilities: JSON.stringify(monster.vulnerabilities),
                immunities: JSON.stringify(monster.immunities),
                createdAt: monster.createdAt,
                updatedAt: monster.updatedAt,
            });

            return { success: true, data: monster };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }

    /**
     * Find a monster by ID.
     */
    findById(id: string): RepositoryResult<Monster> {
        try {
            const stmt = this.db.prepare('SELECT * FROM monsters WHERE id = ?');
            const row = stmt.get(id) as MonsterRow | undefined;

            if (!row) {
                return { success: false, error: `Monster not found: ${id}` };
            }

            return { success: true, data: this.rowToMonster(row) };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }

    /**
     * Get all monsters in a room.
     */
    getByLocation(roomId: string): RepositoryResult<Monster[]> {
        try {
            const stmt = this.db.prepare('SELECT * FROM monsters WHERE room_id = ?');
            const rows = stmt.all(roomId) as MonsterRow[];
            return { success: true, data: rows.map(row => this.rowToMonster(row)) };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }

    /**
     * Get all living monsters in a world.
     */
    getAlive(worldId: string): RepositoryResult<Monster[]> {
        try {
            const stmt = this.db.prepare(
                'SELECT * FROM monsters WHERE world_id = ? AND is_alive = 1'
            );
            const rows = stmt.all(worldId) as MonsterRow[];
            return { success: true, data: rows.map(row => this.rowToMonster(row)) };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }

    /**
     * Get all monsters in an encounter.
     */
    getByEncounter(encounterId: string): RepositoryResult<Monster[]> {
        try {
            const stmt = this.db.prepare('SELECT * FROM monsters WHERE encounter_id = ?');
            const rows = stmt.all(encounterId) as MonsterRow[];
            return { success: true, data: rows.map(row => this.rowToMonster(row)) };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }

    /**
     * Update monster HP.
     */
    updateHP(id: string, currentHp: number): RepositoryResult<Monster> {
        try {
            const now = new Date().toISOString();
            const stmt = this.db.prepare(`
                UPDATE monsters SET hp = ?, updated_at = ? WHERE id = ?
            `);
            const result = stmt.run(Math.max(0, currentHp), now, id);

            if (result.changes === 0) {
                return { success: false, error: `Monster not found: ${id}` };
            }

            return this.findById(id);
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }

    /**
     * Mark a monster as dead.
     */
    kill(id: string): RepositoryResult<Monster> {
        try {
            const now = new Date().toISOString();
            const stmt = this.db.prepare(`
                UPDATE monsters SET is_alive = 0, hp = 0, updated_at = ? WHERE id = ?
            `);
            const result = stmt.run(now, id);

            if (result.changes === 0) {
                return { success: false, error: `Monster not found: ${id}` };
            }

            return this.findById(id);
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }

    /**
     * Move monster to a room.
     */
    moveToRoom(id: string, roomId: string): RepositoryResult<Monster> {
        try {
            const now = new Date().toISOString();
            const stmt = this.db.prepare(`
                UPDATE monsters SET room_id = ?, updated_at = ? WHERE id = ?
            `);
            const result = stmt.run(roomId, now, id);

            if (result.changes === 0) {
                return { success: false, error: `Monster not found: ${id}` };
            }

            return this.findById(id);
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }

    /**
     * Update monster conditions.
     */
    updateConditions(id: string, conditions: string[]): RepositoryResult<Monster> {
        try {
            const now = new Date().toISOString();
            const stmt = this.db.prepare(`
                UPDATE monsters SET conditions = ?, updated_at = ? WHERE id = ?
            `);
            const result = stmt.run(JSON.stringify(conditions), now, id);

            if (result.changes === 0) {
                return { success: false, error: `Monster not found: ${id}` };
            }

            return this.findById(id);
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }

    /**
     * Update monster position.
     */
    updatePosition(
        id: string,
        x: number,
        y: number,
        z: number = 0
    ): RepositoryResult<Monster> {
        try {
            const now = new Date().toISOString();
            const stmt = this.db.prepare(`
                UPDATE monsters 
                SET position_x = ?, position_y = ?, position_z = ?, updated_at = ? 
                WHERE id = ?
            `);
            const result = stmt.run(x, y, z, now, id);

            if (result.changes === 0) {
                return { success: false, error: `Monster not found: ${id}` };
            }

            return this.findById(id);
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }

    /**
     * Delete a monster.
     */
    delete(id: string): RepositoryResult<void> {
        try {
            const stmt = this.db.prepare('DELETE FROM monsters WHERE id = ?');
            const result = stmt.run(id);

            if (result.changes === 0) {
                return { success: false, error: `Monster not found: ${id}` };
            }

            return { success: true };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }

    private rowToMonster(row: MonsterRow): Monster {
        return {
            id: row.id,
            worldId: row.world_id,
            templateId: row.template_id,
            name: row.name,
            hp: row.hp,
            maxHp: row.max_hp,
            ac: row.ac,
            cr: row.cr,
            xp: row.xp,
            stats: JSON.parse(row.stats),
            size: row.size as Monster['size'],
            creatureType: row.creature_type,
            alignment: row.alignment || undefined,
            speed: row.speed,
            roomId: row.room_id,
            positionX: row.position_x,
            positionY: row.position_y,
            positionZ: row.position_z,
            encounterId: row.encounter_id,
            isAlive: row.is_alive === 1,
            conditions: JSON.parse(row.conditions),
            resistances: JSON.parse(row.resistances),
            vulnerabilities: JSON.parse(row.vulnerabilities),
            immunities: JSON.parse(row.immunities),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}
