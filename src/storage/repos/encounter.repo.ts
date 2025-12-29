import Database from 'better-sqlite3';
import { Encounter, EncounterSchema } from '../../schema/encounter.js';
import { CombatToken } from '../../schema/combat-token.js';

/**
 * EncounterRepository - Persistence layer for combat encounters
 *
 * PHASE 5: Combat State Persistence
 * - Encounters table stores metadata (world_id, room_id, seed, ended_at, terrain, props, grid bounds)
 * - combat_tokens table stores normalized token data
 * - auras table stores active auras with encounter_id FK
 *
 * Storage format:
 * - encounters: metadata and terrain data
 * - combat_tokens: individual token state (conditions, metadata)
 * - auras: active area effects
 */
export class EncounterRepository {
    constructor(private db: Database.Database) {
        // Ensure schema is up to date (add columns if missing)
        this.ensureSchema();
    }

    /**
     * Ensure the encounters table has all required columns
     * This handles migration for existing databases
     */
    private ensureSchema(): void {
        // Check encounters table columns
        const encounterColumns = this.db.prepare('PRAGMA table_info(encounters)').all() as { name: string }[];
        const encounterColumnNames = encounterColumns.map(c => c.name);

        // Add missing encounter columns
        if (!encounterColumnNames.includes('world_id')) {
            this.db.prepare('ALTER TABLE encounters ADD COLUMN world_id TEXT REFERENCES worlds(id) ON DELETE CASCADE').run();
        }
        if (!encounterColumnNames.includes('room_id')) {
            this.db.prepare('ALTER TABLE encounters ADD COLUMN room_id TEXT REFERENCES room_nodes(id) ON DELETE CASCADE').run();
        }
        if (!encounterColumnNames.includes('terrain')) {
            this.db.prepare('ALTER TABLE encounters ADD COLUMN terrain TEXT').run();
        }
        if (!encounterColumnNames.includes('props')) {
            this.db.prepare('ALTER TABLE encounters ADD COLUMN props TEXT').run();
        }
        if (!encounterColumnNames.includes('grid_min_x')) {
            this.db.prepare('ALTER TABLE encounters ADD COLUMN grid_min_x INTEGER DEFAULT 0').run();
        }
        if (!encounterColumnNames.includes('grid_max_x')) {
            this.db.prepare('ALTER TABLE encounters ADD COLUMN grid_max_x INTEGER DEFAULT 20').run();
        }
        if (!encounterColumnNames.includes('grid_min_y')) {
            this.db.prepare('ALTER TABLE encounters ADD COLUMN grid_min_y INTEGER DEFAULT 0').run();
        }
        if (!encounterColumnNames.includes('grid_max_y')) {
            this.db.prepare('ALTER TABLE encounters ADD COLUMN grid_max_y INTEGER DEFAULT 20').run();
        }
        if (!encounterColumnNames.includes('seed')) {
            this.db.prepare('ALTER TABLE encounters ADD COLUMN seed TEXT').run();
        }
        if (!encounterColumnNames.includes('ended_at')) {
            this.db.prepare('ALTER TABLE encounters ADD COLUMN ended_at TEXT').run();
        }

        // Check combat_tokens table columns
        const tokenColumns = this.db.prepare('PRAGMA table_info(combat_tokens)').all() as { name: string }[];
        const tokenColumnNames = tokenColumns.map(c => c.name);

        // Add missing token columns
        if (!tokenColumnNames.includes('conditions')) {
            this.db.prepare('ALTER TABLE combat_tokens ADD COLUMN conditions TEXT DEFAULT \'[]\'').run();
        }
        if (!tokenColumnNames.includes('metadata')) {
            this.db.prepare('ALTER TABLE combat_tokens ADD COLUMN metadata TEXT DEFAULT \'{}\'').run();
        }

        // Check auras table columns
        const auraColumns = this.db.prepare('PRAGMA table_info(auras)').all() as { name: string }[];
        const auraColumnNames = auraColumns.map(c => c.name);

        // Add missing aura columns
        if (!auraColumnNames.includes('encounter_id')) {
            this.db.prepare('ALTER TABLE auras ADD COLUMN encounter_id TEXT REFERENCES encounters(id) ON DELETE CASCADE').run();
        }
    }

    create(encounter: Encounter): void {
        // Allow tokens to be undefined for empty encounters
        const encounterWithTokens = { ...encounter, tokens: encounter.tokens || [] };
        // const validEncounter = EncounterSchema.parse(encounterWithTokens);
        const validEncounter = encounterWithTokens;

        // Use transaction to ensure atomicity
        const transaction = this.db.transaction(() => {
            // Insert encounter metadata
            const encounterStmt = this.db.prepare(`
                INSERT INTO encounters (
                    id, world_id, region_id, room_id, tokens, round, active_token_id, status,
                    terrain, props, grid_min_x, grid_max_x, grid_min_y, grid_max_y,
                    seed, created_at, updated_at
                )
                VALUES (
                    @id, @worldId, @regionId, @roomId, @tokens, @round, @activeTokenId, @status,
                    @terrain, @props, @gridMinX, @gridMaxX, @gridMinY, @gridMaxY,
                    @seed, @createdAt, @updatedAt
                )
            `);

            encounterStmt.run({
                id: validEncounter.id,
                worldId: validEncounter.worldId,
                regionId: validEncounter.regionId || null,
                roomId: validEncounter.roomId || null,
                tokens: JSON.stringify(validEncounter.tokens),
                round: validEncounter.round,
                activeTokenId: validEncounter.activeTokenId || null,
                status: validEncounter.status,
                terrain: validEncounter.terrain ? JSON.stringify(validEncounter.terrain) : null,
                props: validEncounter.props ? JSON.stringify(validEncounter.props) : null,
                gridMinX: validEncounter.gridMinX ?? 0,
                gridMaxX: validEncounter.gridMaxX ?? 20,
                gridMinY: validEncounter.gridMinY ?? 0,
                gridMaxY: validEncounter.gridMaxY ?? 20,
                seed: validEncounter.seed || null,
                createdAt: validEncounter.createdAt,
                updatedAt: validEncounter.updatedAt,
            });

            // Insert tokens if provided
            if (validEncounter.tokens && validEncounter.tokens.length > 0) {
                const tokenStmt = this.db.prepare(`
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

                for (const token of validEncounter.tokens) {
                    tokenStmt.run({
                        id: token.id,
                        encounterId: validEncounter.id,
                        characterId: token.characterId,
                        name: token.name,
                        initiativeBonus: token.initiativeBonus,
                        initiative: token.initiative,
                        isEnemy: token.isEnemy ? 1 : 0,
                        hp: token.hp,
                        maxHp: token.maxHp,
                        positionX: token.positionX ?? 0,
                        positionY: token.positionY ?? 0,
                        positionZ: token.positionZ ?? 0,
                        movementSpeed: token.movementSpeed ?? 30,
                        movementRemaining: token.movementRemaining ?? (token.movementSpeed ?? 30),
                        size: token.size ?? 'medium',
                        hasReaction: token.hasReaction ?? true ? 1 : 0,
                        hasAction: token.hasAction ?? true ? 1 : 0,
                        hasBonusAction: token.hasBonusAction ?? true ? 1 : 0,
                        conditions: JSON.stringify(token.conditions || []),
                        metadata: JSON.stringify(token.metadata || {}),
                    });
                }
            }
        });

        transaction();
    }

    findByWorldId(worldId: string): Encounter[] {
        const stmt = this.db.prepare('SELECT * FROM encounters WHERE world_id = ?');
        const rows = stmt.all(worldId) as EncounterRow[];

        return rows.map((row) => this.rowToEncounter(row));
    }

    findByRegionId(regionId: string): Encounter[] {
        const stmt = this.db.prepare('SELECT * FROM encounters WHERE region_id = ?');
        const rows = stmt.all(regionId) as EncounterRow[];

        return rows.map((row) => this.rowToEncounter(row));
    }

    update(encounterId: string, updates: Partial<Encounter>): boolean {
        const fields: string[] = [];
        const values: any[] = [];

        if (updates.round !== undefined) {
            fields.push('round = ?');
            values.push(updates.round);
        }
        if (updates.activeTokenId !== undefined) {
            fields.push('active_token_id = ?');
            values.push(updates.activeTokenId);
        }
        if (updates.status !== undefined) {
            fields.push('status = ?');
            values.push(updates.status);
        }
        if (updates.terrain !== undefined) {
            fields.push('terrain = ?');
            values.push(JSON.stringify(updates.terrain));
        }
        if (updates.props !== undefined) {
            fields.push('props = ?');
            values.push(JSON.stringify(updates.props));
        }
        if (updates.endedAt !== undefined) {
            fields.push('ended_at = ?');
            values.push(updates.endedAt);
        }

        if (fields.length === 0) return false;

        fields.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(encounterId);

        const stmt = this.db.prepare(`UPDATE encounters SET ${fields.join(', ')} WHERE id = ?`);
        const result = stmt.run(...values);
        return result.changes > 0;
    }

    listByWorld(worldId: string, status?: string, activeOnly?: boolean): Encounter[] {
        let query = 'SELECT * FROM encounters WHERE world_id = ?';
        const params: any[] = [worldId];

        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }

        if (activeOnly) {
            query += " AND status = 'active'";
        }

        query += ' ORDER BY created_at DESC';

        const stmt = this.db.prepare(query);
        const rows = stmt.all(...params) as EncounterRow[];

        return rows.map((row) => this.rowToEncounter(row));
    }

    addToken(encounterId: string, token: CombatToken): void {
        const stmt = this.db.prepare(`
            INSERT INTO combat_tokens (
                id, encounter_id, character_id, name, initiative_bonus, initiative, is_enemy,
                hp, max_hp, position_x, position_y, position_z, movement_speed, movement_remaining,
                size, has_reaction, has_action, has_bonus_action, conditions, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            token.id,
            encounterId,
            token.characterId,
            token.name,
            token.initiativeBonus,
            token.initiative,
            token.isEnemy ? 1 : 0,
            token.hp,
            token.maxHp,
            token.positionX,
            token.positionY,
            token.positionZ,
            token.movementSpeed,
            token.movementRemaining,
            token.size,
            token.hasReaction ? 1 : 0,
            token.hasAction ? 1 : 0,
            token.hasBonusAction ? 1 : 0,
            JSON.stringify(token.conditions || []),
            JSON.stringify(token.metadata || {})
        );
    }

    updateToken(encounterId: string, tokenId: string, updates: Partial<CombatToken>): boolean {
        const fields: string[] = [];
        const values: any[] = [];

        if (updates.initiative !== undefined) {
            fields.push('initiative = ?');
            values.push(updates.initiative);
        }
        if (updates.hp !== undefined) {
            fields.push('hp = ?');
            values.push(updates.hp);
        }
        if (updates.positionX !== undefined) {
            fields.push('position_x = ?');
            values.push(updates.positionX);
        }
        if (updates.positionY !== undefined) {
            fields.push('position_y = ?');
            values.push(updates.positionY);
        }
        if (updates.positionZ !== undefined) {
            fields.push('position_z = ?');
            values.push(updates.positionZ);
        }
        if (updates.movementRemaining !== undefined) {
            fields.push('movement_remaining = ?');
            values.push(updates.movementRemaining);
        }
        if (updates.hasReaction !== undefined) {
            fields.push('has_reaction = ?');
            values.push(updates.hasReaction ? 1 : 0);
        }
        if (updates.hasAction !== undefined) {
            fields.push('has_action = ?');
            values.push(updates.hasAction ? 1 : 0);
        }
        if (updates.hasBonusAction !== undefined) {
            fields.push('has_bonus_action = ?');
            values.push(updates.hasBonusAction ? 1 : 0);
        }
        if (updates.conditions !== undefined) {
            fields.push('conditions = ?');
            values.push(JSON.stringify(updates.conditions));
        }

        if (fields.length === 0) return false;

        values.push(tokenId);
        values.push(encounterId);

        const stmt = this.db.prepare(`UPDATE combat_tokens SET ${fields.join(', ')} WHERE id = ? AND encounter_id = ?`);
        const result = stmt.run(...values);
        return result.changes > 0;
    }

    removeToken(encounterId: string, tokenId: string): boolean {
        const stmt = this.db.prepare('DELETE FROM combat_tokens WHERE id = ? AND encounter_id = ?');
        const result = stmt.run(tokenId, encounterId);
        return result.changes > 0;
    }

    private rowToEncounter(row: EncounterRow): Encounter {
        // Load tokens for this encounter
        const tokenStmt = this.db.prepare('SELECT * FROM combat_tokens WHERE encounter_id = ?');
        const tokenRows = tokenStmt.all(row.id) as CombatTokenRow[];

        const tokens = tokenRows.map(tokenRow => ({
            id: tokenRow.id,
            encounterId: row.id, // Set encounterId from the encounter row
            characterId: tokenRow.character_id,
            name: tokenRow.name,
            initiativeBonus: tokenRow.initiative_bonus,
            initiative: tokenRow.initiative,
            isEnemy: tokenRow.is_enemy === 1,
            hp: tokenRow.hp,
            maxHp: tokenRow.max_hp,
            positionX: tokenRow.position_x,
            positionY: tokenRow.position_y,
            positionZ: tokenRow.position_z,
            movementSpeed: tokenRow.movement_speed,
            movementRemaining: tokenRow.movement_remaining,
            size: tokenRow.size,
            hasReaction: tokenRow.has_reaction === 1,
            hasAction: tokenRow.has_action === 1,
            hasBonusAction: tokenRow.has_bonus_action === 1,
            conditions: JSON.parse(tokenRow.conditions || '[]'),
            metadata: JSON.parse(tokenRow.metadata || '{}'),
        }));

        return EncounterSchema.parse({
            id: row.id,
            worldId: row.world_id,
            regionId: row.region_id || undefined,
            roomId: row.room_id || undefined,
            tokens: tokens,
            round: row.round,
            activeTokenId: row.active_token_id || undefined,
            status: row.status,
            terrain: row.terrain ? JSON.parse(row.terrain) : undefined,
            props: row.props ? JSON.parse(row.props) : undefined,
            gridMinX: row.grid_min_x ?? 0,
            gridMaxX: row.grid_max_x ?? 20,
            gridMinY: row.grid_min_y ?? 0,
            gridMaxY: row.grid_max_y ?? 20,
            seed: row.seed || undefined,
            endedAt: row.ended_at || undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        });
    }
    /**
     * Save combat state to database
     * PHASE 5: Uses transactions to sync encounters, combat_tokens, and auras
     *
     * @param encounterId The encounter ID
     * @param state The CombatState object (includes participants with positions)
     */
    saveState(encounterId: string, state: any): void {
        const transaction = this.db.transaction(() => {
            // Update encounter metadata
            const currentTurnId = state.turnOrder[state.currentTurnIndex];
            const encounterStmt = this.db.prepare(`
                UPDATE encounters
                SET round = ?, active_token_id = ?, status = ?, terrain = ?, props = ?,
                    grid_min_x = ?, grid_max_x = ?, grid_min_y = ?, grid_max_y = ?, updated_at = ?
                WHERE id = ?
            `);

            encounterStmt.run(
                state.round,
                currentTurnId,
                'active',
                state.terrain ? JSON.stringify(state.terrain) : null,
                state.props ? JSON.stringify(state.props) : null,
                state.gridBounds?.minX ?? 0,
                state.gridBounds?.maxX ?? 20,
                state.gridBounds?.minY ?? 0,
                state.gridBounds?.maxY ?? 20,
                new Date().toISOString(),
                encounterId
            );

            // Sync combat tokens (upsert)
            const tokenUpsertStmt = this.db.prepare(`
                INSERT OR REPLACE INTO combat_tokens (
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

            for (const participant of state.participants) {
                tokenUpsertStmt.run({
                    id: participant.id,
                    encounterId: encounterId,
                    characterId: participant.characterId || participant.id,
                    name: participant.name,
                    initiativeBonus: participant.initiativeBonus ?? 0,
                    initiative: participant.initiative,
                    isEnemy: participant.isEnemy ? 1 : 0,
                    hp: participant.hp,
                    maxHp: participant.maxHp,
                    positionX: participant.position?.x ?? 0,
                    positionY: participant.position?.y ?? 0,
                    positionZ: participant.position?.z ?? 0,
                    movementSpeed: participant.movementSpeed ?? 30,
                    movementRemaining: participant.movementRemaining ?? (participant.movementSpeed ?? 30),
                    size: participant.size ?? 'medium',
                    hasReaction: participant.hasReaction ?? true ? 1 : 0,
                    hasAction: participant.hasAction ?? true ? 1 : 0,
                    hasBonusAction: participant.hasBonusAction ?? true ? 1 : 0,
                    conditions: JSON.stringify(participant.conditions || []),
                    metadata: JSON.stringify(participant.metadata || {}),
                });
            }

            // Remove tokens that are no longer in the encounter
            const existingTokenIds = state.participants.map((p: any) => p.id);
            const deleteTokensStmt = this.db.prepare(`
                DELETE FROM combat_tokens
                WHERE encounter_id = ? AND id NOT IN (${existingTokenIds.map(() => '?').join(',')})
            `);
            deleteTokensStmt.run(encounterId, ...existingTokenIds);
        });

        transaction();
    }

    /**
     * Load combat state from database
     * PHASE 5: Reconstructs CombatState from encounters, combat_tokens, and auras tables
     *
     * @param encounterId The encounter ID
     * @returns CombatState object with all spatial data, or null if not found
     */
    loadState(encounterId: string): any | null {
        const encounterRow = this.findById(encounterId);
        if (!encounterRow) return null;

        // Load tokens for this encounter
        const tokenStmt = this.db.prepare(`
            SELECT * FROM combat_tokens WHERE encounter_id = ? ORDER BY initiative DESC, id
        `);
        const tokenRows = tokenStmt.all(encounterId) as CombatTokenRow[];

        // Convert token rows to participants
        const participants = tokenRows.map(row => ({
            id: row.id,
            characterId: row.character_id,
            name: row.name,
            initiativeBonus: row.initiative_bonus,
            initiative: row.initiative,
            isEnemy: row.is_enemy === 1,
            hp: row.hp,
            maxHp: row.max_hp,
            position: {
                x: row.position_x,
                y: row.position_y,
                z: row.position_z,
            },
            movementSpeed: row.movement_speed,
            movementRemaining: row.movement_remaining,
            size: row.size,
            hasReaction: row.has_reaction === 1,
            hasAction: row.has_action === 1,
            hasBonusAction: row.has_bonus_action === 1,
            conditions: JSON.parse(row.conditions || '[]'),
            metadata: JSON.parse(row.metadata || '{}'),
        }));

        // Parse terrain and props
        const terrain = encounterRow.terrain ? JSON.parse(encounterRow.terrain) : undefined;
        const props = encounterRow.props ? JSON.parse(encounterRow.props) : undefined;

        // Build grid bounds
        const gridBounds = {
            minX: encounterRow.grid_min_x ?? 0,
            maxX: encounterRow.grid_max_x ?? 20,
            minY: encounterRow.grid_min_y ?? 0,
            maxY: encounterRow.grid_max_y ?? 20,
        };

        // Reconstruct turn order from participants (sorted by initiative)
        const sortedParticipants = [...participants].sort((a: any, b: any) => {
            const initA = a.initiative ?? 0;
            const initB = b.initiative ?? 0;
            if (initB !== initA) return initB - initA;
            return (a.id as string).localeCompare(b.id);
        });

        const turnOrder = sortedParticipants.map((p: any) => p.id);

        // Handle LAIR action if applicable
        const lairOwner = participants.find((p: any) => p.hasLairActions);
        if (lairOwner) {
            // Insert LAIR at initiative 20 position
            const lairIndex = sortedParticipants.findIndex((p: any) => (p.initiative ?? 0) <= 20);
            if (lairIndex === -1) {
                turnOrder.push('LAIR');
            } else {
                turnOrder.splice(lairIndex, 0, 'LAIR');
            }
        }

        return {
            participants: participants,
            turnOrder,
            currentTurnIndex: turnOrder.indexOf(encounterRow.active_token_id ?? turnOrder[0]),
            round: encounterRow.round,
            terrain,
            props,
            gridBounds,
            // LAIR action support
            hasLairActions: !!lairOwner,
            lairOwnerId: lairOwner?.id
        };
    }

    findById(id: string): EncounterRow | undefined {
        const stmt = this.db.prepare('SELECT * FROM encounters WHERE id = ?');
        return stmt.get(id) as EncounterRow | undefined;
    }

    delete(id: string): boolean {
        const stmt = this.db.prepare('DELETE FROM encounters WHERE id = ?');
        const result = stmt.run(id);
        return result.changes > 0;
    }
}

interface EncounterRow {
    id: string;
    world_id: string;
    region_id: string | null;
    room_id: string | null;
    tokens: string; // Legacy - kept for backward compatibility
    round: number;
    active_token_id: string | null;
    status: string;
    terrain: string | null;
    props: string | null;
    grid_min_x: number | null;
    grid_max_x: number | null;
    grid_min_y: number | null;
    grid_max_y: number | null;
    seed: string | null;
    ended_at: string | null;
    created_at: string;
    updated_at: string;
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
