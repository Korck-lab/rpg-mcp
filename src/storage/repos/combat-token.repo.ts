import Database from 'better-sqlite3';
import { CombatToken, CombatTokenSchema } from '../../schema/combat-token.js';

export class CombatTokenRepository {
    constructor(private db: Database.Database) {}

    /**
     * Create a new combat token
     */
    create(token: CombatToken): void {
        const valid = CombatTokenSchema.parse(token);

        const stmt = this.db.prepare(`
            INSERT INTO combat_tokens (
                id, encounter_id, character_id, name, initiative_bonus, initiative,
                is_enemy, hp, max_hp, position_x, position_y, position_z,
                movement_speed, movement_remaining, size, has_reaction, has_action,
                has_bonus_action, conditions, metadata
            )
            VALUES (
                @id, @encounterId, @characterId, @name, @initiativeBonus, @initiative,
                @isEnemy, @hp, @maxHp, @positionX, @positionY, @positionZ,
                @movementSpeed, @movementRemaining, @size, @hasReaction, @hasAction,
                @hasBonusAction, @conditions, @metadata
            )
        `);

        stmt.run({
            id: valid.id,
            encounterId: valid.encounterId,
            characterId: valid.characterId,
            name: valid.name,
            initiativeBonus: valid.initiativeBonus,
            initiative: valid.initiative,
            isEnemy: valid.isEnemy ? 1 : 0,
            hp: valid.hp,
            maxHp: valid.maxHp,
            positionX: valid.positionX ?? 0,
            positionY: valid.positionY ?? 0,
            positionZ: valid.positionZ ?? 0,
            movementSpeed: valid.movementSpeed ?? 30,
            movementRemaining: valid.movementRemaining ?? (valid.movementSpeed ?? 30),
            size: valid.size ?? 'medium',
            hasReaction: valid.hasReaction ?? true ? 1 : 0,
            hasAction: valid.hasAction ?? true ? 1 : 0,
            hasBonusAction: valid.hasBonusAction ?? true ? 1 : 0,
            conditions: JSON.stringify(valid.conditions || []),
            metadata: JSON.stringify(valid.metadata || {}),
        });
    }

    /**
     * Find a token by ID
     */
    findById(tokenId: string): CombatToken | null {
        const stmt = this.db.prepare('SELECT * FROM combat_tokens WHERE id = ?');
        const row = stmt.get(tokenId) as CombatTokenRow | undefined;

        if (!row) return null;

        return this.rowToCombatToken(row);
    }

    /**
     * Find all tokens for an encounter
     */
    findByEncounterId(encounterId: string): CombatToken[] {
        const stmt = this.db.prepare('SELECT * FROM combat_tokens WHERE encounter_id = ? ORDER BY initiative DESC, id');
        const rows = stmt.all(encounterId) as CombatTokenRow[];

        return rows.map(row => this.rowToCombatToken(row));
    }

    /**
     * Update a token
     */
    update(tokenId: string, updates: Partial<CombatToken>): boolean {
        const fields: string[] = [];
        const params: any = { id: tokenId };

        if (updates.name !== undefined) {
            fields.push('name = @name');
            params.name = updates.name;
        }
        if (updates.initiative !== undefined) {
            fields.push('initiative = @initiative');
            params.initiative = updates.initiative;
        }
        if (updates.hp !== undefined) {
            fields.push('hp = @hp');
            params.hp = updates.hp;
        }
        if (updates.maxHp !== undefined) {
            fields.push('max_hp = @maxHp');
            params.maxHp = updates.maxHp;
        }
        if (updates.positionX !== undefined) {
            fields.push('position_x = @positionX');
            params.positionX = updates.positionX;
        }
        if (updates.positionY !== undefined) {
            fields.push('position_y = @positionY');
            params.positionY = updates.positionY;
        }
        if (updates.positionZ !== undefined) {
            fields.push('position_z = @positionZ');
            params.positionZ = updates.positionZ;
        }
        if (updates.movementRemaining !== undefined) {
            fields.push('movement_remaining = @movementRemaining');
            params.movementRemaining = updates.movementRemaining;
        }
        if (updates.hasReaction !== undefined) {
            fields.push('has_reaction = @hasReaction');
            params.hasReaction = updates.hasReaction ? 1 : 0;
        }
        if (updates.hasAction !== undefined) {
            fields.push('has_action = @hasAction');
            params.hasAction = updates.hasAction ? 1 : 0;
        }
        if (updates.hasBonusAction !== undefined) {
            fields.push('has_bonus_action = @hasBonusAction');
            params.hasBonusAction = updates.hasBonusAction ? 1 : 0;
        }
        if (updates.conditions !== undefined) {
            fields.push('conditions = @conditions');
            params.conditions = JSON.stringify(updates.conditions);
        }
        if (updates.metadata !== undefined) {
            fields.push('metadata = @metadata');
            params.metadata = JSON.stringify(updates.metadata);
        }

        if (fields.length === 0) return false;

        const stmt = this.db.prepare(`
            UPDATE combat_tokens SET ${fields.join(', ')} WHERE id = @id
        `);

        const result = stmt.run(params);
        return result.changes > 0;
    }

    /**
     * Delete a token
     */
    delete(tokenId: string): boolean {
        const stmt = this.db.prepare('DELETE FROM combat_tokens WHERE id = ?');
        const result = stmt.run(tokenId);
        return result.changes > 0;
    }

    /**
     * Delete all tokens for an encounter
     */
    deleteByEncounterId(encounterId: string): number {
        const stmt = this.db.prepare('DELETE FROM combat_tokens WHERE encounter_id = ?');
        const result = stmt.run(encounterId);
        return result.changes;
    }

    /**
     * Convert database row to CombatToken
     */
    private rowToCombatToken(row: CombatTokenRow): CombatToken {
        return CombatTokenSchema.parse({
            id: row.id,
            encounterId: row.encounter_id,
            characterId: row.character_id,
            name: row.name,
            initiativeBonus: row.initiative_bonus,
            initiative: row.initiative,
            isEnemy: row.is_enemy === 1,
            hp: row.hp,
            maxHp: row.max_hp,
            positionX: row.position_x,
            positionY: row.position_y,
            positionZ: row.position_z,
            movementSpeed: row.movement_speed,
            movementRemaining: row.movement_remaining,
            size: row.size,
            hasReaction: row.has_reaction === 1,
            hasAction: row.has_action === 1,
            hasBonusAction: row.has_bonus_action === 1,
            conditions: JSON.parse(row.conditions || '[]'),
            metadata: JSON.parse(row.metadata || '{}'),
        });
    }
}

interface CombatTokenRow {
    id: string;
    encounter_id: string;
    character_id: string;
    name: string;
    initiative_bonus: number;
    initiative: number | null;
    is_enemy: number;
    hp: number;
    max_hp: number;
    position_x: number;
    position_y: number;
    position_z: number;
    movement_speed: number;
    movement_remaining: number;
    size: string;
    has_reaction: number;
    has_action: number;
    has_bonus_action: number;
    conditions: string;
    metadata: string;
}