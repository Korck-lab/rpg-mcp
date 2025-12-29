import Database from 'better-sqlite3';
import { ConcentrationState, ConcentrationStateSchema } from '../../schema/concentration.js';

export class ConcentrationRepository {
    constructor(private db: Database.Database) { }

    /**
     * Start concentration on a spell
     */
    create(concentration: ConcentrationState): void {
        const valid = ConcentrationStateSchema.parse(concentration);

        const stmt = this.db.prepare(`
            INSERT INTO concentration_tracking (
                character_id, spell_name, spell_level, target_ids,
                started_at, max_duration, save_dc_base
            )
            VALUES (@characterId, @activeSpell, @spellLevel, @targetIds,
                    @startedAt, @maxDuration, @saveDCBase)
        `);

        stmt.run({
            characterId: valid.characterId,
            activeSpell: valid.activeSpell,
            spellLevel: valid.spellLevel,
            targetIds: valid.targetIds ? JSON.stringify(valid.targetIds) : null,
            startedAt: valid.startedAt,
            maxDuration: valid.maxDuration ?? null,
            saveDCBase: valid.saveDCBase,
        });
    }

    /**
     * Get active concentration for a character
     */
    findByCharacterId(characterId: string): ConcentrationState | null {
        const stmt = this.db.prepare(`
            SELECT 
                character_id as characterId,
                spell_name as activeSpell,
                spell_level as spellLevel,
                target_ids as targetIds,
                started_at as startedAt,
                max_duration as maxDuration,
                save_dc_base as saveDCBase
            FROM concentration_tracking WHERE character_id = ?
        `);
        const row = stmt.get(characterId) as ConcentrationRow | undefined;

        if (!row) return null;

        return ConcentrationStateSchema.parse({
            characterId: row.characterId,
            activeSpell: row.activeSpell,
            spellLevel: row.spellLevel,
            targetIds: row.targetIds ? JSON.parse(row.targetIds) : undefined,
            startedAt: row.startedAt,
            maxDuration: row.maxDuration ?? undefined,
            saveDCBase: row.saveDCBase,
        });
    }

    /**
     * Break concentration (delete the record)
     */
    delete(characterId: string): boolean {
        const stmt = this.db.prepare(`
            DELETE FROM concentration_tracking WHERE character_id = ?
        `);
        const result = stmt.run(characterId);
        return result.changes > 0;
    }

    /**
     * Check if a character is concentrating
     */
    isConcentrating(characterId: string): boolean {
        const stmt = this.db.prepare(`
            SELECT COUNT(*) as count FROM concentration_tracking WHERE character_id = ?
        `);
        const row = stmt.get(characterId) as { count: number };
        return row.count > 0;
    }

    /**
     * Get all active concentrations (for debugging/admin)
     */
    findAll(): ConcentrationState[] {
        const stmt = this.db.prepare(`
            SELECT
                character_id as characterId,
                spell_name as activeSpell,
                spell_level as spellLevel,
                target_ids as targetIds,
                started_at as startedAt,
                max_duration as maxDuration,
                save_dc_base as saveDCBase
            FROM concentration_tracking
        `);
        const rows = stmt.all() as ConcentrationRow[];

        return rows.map(row => ConcentrationStateSchema.parse({
            characterId: row.characterId,
            activeSpell: row.activeSpell,
            spellLevel: row.spellLevel,
            targetIds: row.targetIds ? JSON.parse(row.targetIds) : undefined,
            startedAt: row.startedAt,
            maxDuration: row.maxDuration ?? undefined,
            saveDCBase: row.saveDCBase,
        }));
    }
}

interface ConcentrationRow {
    characterId: string;
    activeSpell: string;
    spellLevel: number;
    targetIds: string | null;
    startedAt: number;
    maxDuration: number | null;
    saveDCBase: number;
}
