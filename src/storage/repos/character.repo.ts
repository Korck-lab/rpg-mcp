import Database from 'better-sqlite3';
import { Character, CharacterSchema, NPC, NPCSchema } from '../../schema/character.js';

export class CharacterRepository {
    constructor(private db: Database.Database) { }

    create(character: Character | NPC): void {
        // Determine if it's an NPC or Character for validation
        const isNPC = 'factionId' in character || 'behavior' in character;
        const validChar = isNPC ? NPCSchema.parse(character) : CharacterSchema.parse(character);

        const stmt = this.db.prepare(`
      INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, faction_id, behavior, created_at, updated_at)
      VALUES (@id, @name, @stats, @hp, @maxHp, @ac, @level, @factionId, @behavior, @createdAt, @updatedAt)
    `);

        stmt.run({
            id: validChar.id,
            name: validChar.name,
            stats: JSON.stringify(validChar.stats),
            hp: validChar.hp,
            maxHp: validChar.maxHp,
            ac: validChar.ac,
            level: validChar.level,
            factionId: (validChar as NPC).factionId || null,
            behavior: (validChar as NPC).behavior || null,
            createdAt: validChar.createdAt,
            updatedAt: validChar.updatedAt,
        });
    }

    findById(id: string): Character | NPC | null {
        const stmt = this.db.prepare('SELECT * FROM characters WHERE id = ?');
        const row = stmt.get(id) as CharacterRow | undefined;

        if (!row) return null;
        return this.rowToCharacter(row);
    }

    findAll(): (Character | NPC)[] {
        const stmt = this.db.prepare('SELECT * FROM characters');
        const rows = stmt.all() as CharacterRow[];
        return rows.map(row => this.rowToCharacter(row));
    }

    update(id: string, updates: Partial<Character | NPC>): Character | NPC | null {
        const existing = this.findById(id);
        if (!existing) return null;

        const updated = {
            ...existing,
            ...updates,
            updatedAt: new Date().toISOString()
        };

        // Validate
        const isNPC = 'factionId' in updated || 'behavior' in updated;
        const validChar = isNPC ? NPCSchema.parse(updated) : CharacterSchema.parse(updated);

        const stmt = this.db.prepare(`
            UPDATE characters
            SET name = ?, stats = ?, hp = ?, max_hp = ?, ac = ?, level = ?,
                faction_id = ?, behavior = ?, updated_at = ?
            WHERE id = ?
        `);

        stmt.run(
            validChar.name,
            JSON.stringify(validChar.stats),
            validChar.hp,
            validChar.maxHp,
            validChar.ac,
            validChar.level,
            (validChar as NPC).factionId || null,
            (validChar as NPC).behavior || null,
            validChar.updatedAt,
            id
        );

        return validChar;
    }

    private rowToCharacter(row: CharacterRow): Character | NPC {
        const base = {
            id: row.id,
            name: row.name,
            stats: JSON.parse(row.stats),
            hp: row.hp,
            maxHp: row.max_hp,
            ac: row.ac,
            level: row.level,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };

        if (row.faction_id || row.behavior) {
            return NPCSchema.parse({
                ...base,
                factionId: row.faction_id || undefined,
                behavior: row.behavior || undefined,
            });
        }

        return CharacterSchema.parse(base);
    }
}

interface CharacterRow {
    id: string;
    name: string;
    stats: string;
    hp: number;
    max_hp: number;
    ac: number;
    level: number;
    faction_id: string | null;
    behavior: string | null;
    created_at: string;
    updated_at: string;
}
