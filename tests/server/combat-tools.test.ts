import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    handleCreateEncounter,
    handleGetEncounterState,
    handleExecuteCombatAction,
    handleAdvanceTurn,
    handleEndEncounter,
    handleLoadEncounter,
    handleAddToken,
    handleRollInitiative,
    clearCombatState
} from '../../src/server/combat-tools';
import { getCombatManager } from '../../src/server/state/combat-manager';
import { handleCreateWorld, closeTestDb } from '../../src/server/crud-tools';
import { closeDb, initDB } from '../../src/storage';

const mockCtx = { sessionId: 'test-session' };

// Test world ID - created in beforeEach
let testWorldId: string;

/**
 * Helper to extract JSON state from combat tool responses.
 * The combat tools now return human-readable text with embedded JSON in
 * <!-- STATE_JSON ... STATE_JSON --> comments.
 */
function extractStateJson(responseText: string): any {
    const match = responseText.match(/<!-- STATE_JSON\n([\s\S]*?)\nSTATE_JSON -->/);
    if (match) {
        return JSON.parse(match[1]);
    }
    // Fallback: try parsing directly (for backwards compatibility)
    try {
        return JSON.parse(responseText);
    } catch {
        throw new Error('Could not extract state JSON from response');
    }
}

/**
 * Helper to extract JSON from WORLD_JSON embedded format.
 */
function extractWorldJson(responseText: string): any {
    const match = responseText.match(/<!-- WORLD_JSON\n([\s\S]*?)\nWORLD_JSON -->/);
    if (match) {
        return JSON.parse(match[1]);
    }
    // Fallback: try parsing directly
    try {
        return JSON.parse(responseText);
    } catch {
        throw new Error('Could not extract world JSON from response');
    }
}

/**
 * Helper to create an encounter with participants using the new API flow:
 * 1. Create encounter with worldId
 * 2. Add tokens via handleAddToken
 * 3. Roll initiative via handleRollInitiative
 */
async function createEncounterWithParticipants(
    seed: string,
    participants: Array<{
        id: string;
        name: string;
        initiativeBonus: number;
        hp: number;
        maxHp: number;
        isEnemy?: boolean;
        conditions?: string[];
    }>
): Promise<string> {
    // Create the encounter
    const createResult = await handleCreateEncounter({
        worldId: testWorldId,
        seed
    }, mockCtx);
    
    const encounterText = createResult.content[0].text;
    const stateJson = extractStateJson(encounterText);
    const encounterId = stateJson.encounter.id;
    
    // Add each participant as a token
    for (const p of participants) {
        await handleAddToken({
            encounterId,
            characterId: p.id,
            name: p.name,
            initiativeBonus: p.initiativeBonus,
            isEnemy: p.isEnemy ?? false,
            hp: p.hp,
            maxHp: p.maxHp,
            positionX: 0,
            positionY: 0
        }, mockCtx);
    }
    
    // Roll initiative to set up turn order
    await handleRollInitiative({ encounterId }, mockCtx);
    
    return encounterId;
}

describe('Combat MCP Tools', () => {
    beforeEach(async () => {
        // Initialize in-memory database with migrations
        closeDb();
        initDB(':memory:');
        
        // Clear any existing combat state
        clearCombatState();
        
        // Create a test world for encounters
        const worldResult = await handleCreateWorld({
            name: 'Test World',
            seed: 'test-world-seed',
            width: 50,
            height: 50
        }, mockCtx);
        const worldData = extractWorldJson(worldResult.content[0].text);
        testWorldId = worldData.id;
    });
    
    afterEach(() => {
        closeTestDb();
    });

    describe('create_encounter', () => {
        it('should create a new combat encounter with participants', async () => {
            const encounterId = await createEncounterWithParticipants('test-combat-1', [
                {
                    id: 'hero-1',
                    name: 'Fighter',
                    initiativeBonus: 2,
                    hp: 30,
                    maxHp: 30
                },
                {
                    id: 'goblin-1',
                    name: 'Goblin',
                    initiativeBonus: 1,
                    hp: 10,
                    maxHp: 10,
                    isEnemy: true
                }
            ]);

            expect(encounterId).toBeDefined();
            
            // Get the encounter state to verify participants
            const stateResult = await handleGetEncounterState({ encounterId }, mockCtx);
            const stateText = stateResult.content[0].text;
            const state = extractStateJson(stateText);
            
            expect(state.tokens).toBeDefined();
            expect(state.tokens.length).toBe(2);
            expect(state.encounter.round).toBe(1);
        });

        it('should allow multiple concurrent encounters', async () => {
            const id1 = await createEncounterWithParticipants('test-combat-2', [{
                id: 'hero-1',
                name: 'Fighter',
                initiativeBonus: 2,
                hp: 30,
                maxHp: 30
            }]);

            const id2 = await createEncounterWithParticipants('test-combat-3', [{
                id: 'hero-2',
                name: 'Wizard',
                initiativeBonus: 1,
                hp: 20,
                maxHp: 20
            }]);

            expect(id1).not.toBe(id2);

            // Verify both exist
            await expect(handleGetEncounterState({ encounterId: id1 }, mockCtx)).resolves.toBeDefined();
            await expect(handleGetEncounterState({ encounterId: id2 }, mockCtx)).resolves.toBeDefined();
        });
    });

    describe('get_encounter_state', () => {
        it('should return current encounter state', async () => {
            const encounterId = await createEncounterWithParticipants('test-state-1', [
                {
                    id: 'hero-1',
                    name: 'Wizard',
                    initiativeBonus: 1,
                    hp: 25,
                    maxHp: 25
                }
            ]);

            // handleGetEncounterState returns content with embedded state JSON
            const stateResult = await handleGetEncounterState({ encounterId }, mockCtx);
            const state = extractStateJson(stateResult.content[0].text);

            expect(state.tokens).toBeDefined();
            expect(state.encounter.round).toBe(1);
        });

        it('should throw error when no encounter exists', async () => {
            await expect(handleGetEncounterState({ encounterId: 'non-existent' }, mockCtx)).rejects.toThrow('Encounter non-existent not found');
        });
    });

    describe('execute_combat_action', () => {
        async function createTestEncounter() {
            return await createEncounterWithParticipants('test-actions', [
                {
                    id: 'attacker',
                    name: 'Fighter',
                    initiativeBonus: 3,
                    hp: 30,
                    maxHp: 30
                },
                {
                    id: 'defender',
                    name: 'Orc',
                    initiativeBonus: 1,
                    hp: 20,
                    maxHp: 20,
                    isEnemy: true
                }
            ]);
        }

        it('should execute attack action and apply damage', async () => {
            const encounterId = await createTestEncounter();
            const result = await handleExecuteCombatAction({
                encounterId,
                action: 'attack',
                actorId: 'attacker',
                targetId: 'defender',
                attackBonus: 5,
                dc: 12,
                damage: 8
            }, mockCtx);

            expect(result.content).toHaveLength(1);
            // Attack result is human-readable with embedded state JSON
            // Check that the text contains attack info
            const text = result.content[0].text;
            expect(text).toContain('ATTACK');
            // The embedded JSON has state info
            const stateJson = extractStateJson(text);
            expect(stateJson.participants).toBeDefined();
        });

        it('should execute heal action', async () => {
            // Create a fresh encounter with unique seed for this test
            const encounterId = await createEncounterWithParticipants('test-heal-action', [
                {
                    id: 'healer',
                    name: 'Cleric',
                    initiativeBonus: 3,
                    hp: 30,
                    maxHp: 30
                },
                {
                    id: 'wounded',
                    name: 'Fighter',
                    initiativeBonus: 1,
                    hp: 15, // Start with reduced HP so heal is meaningful
                    maxHp: 20
                }
            ]);
            const result = await handleExecuteCombatAction({
                encounterId,
                action: 'heal',
                actorId: 'healer',
                targetId: 'wounded',
                amount: 5
            }, mockCtx);

            expect(result.content).toHaveLength(1);
            // Heal result is human-readable with embedded state JSON
            const text = result.content[0].text;
            expect(text).toContain('HEAL');
            expect(text).toContain('5');
        });

        it('should throw error when no encounter exists', async () => {
            await expect(handleExecuteCombatAction({
                encounterId: 'non-existent',
                action: 'attack',
                actorId: 'attacker',
                targetId: 'defender',
                attackBonus: 5,
                dc: 12
            }, mockCtx)).rejects.toThrow('Encounter non-existent not found');
        });
    });

    describe('advance_turn', () => {
        async function createTestEncounter() {
            return await createEncounterWithParticipants('test-turn', [
                {
                    id: 'p1',
                    name: 'Hero',
                    initiativeBonus: 2,
                    hp: 30,
                    maxHp: 30
                },
                {
                    id: 'p2',
                    name: 'Enemy',
                    initiativeBonus: 1,
                    hp: 20,
                    maxHp: 20,
                    isEnemy: true
                }
            ]);
        }

        it('should advance to next participant turn', async () => {
            const encounterId = await createTestEncounter();
            const result = await handleAdvanceTurn({ encounterId }, mockCtx);

            expect(result.content).toHaveLength(1);
            const response = extractStateJson(result.content[0].text);

            expect(response.currentTurn).toBeDefined();
            expect(response.round).toBeDefined();
        });

        it('should increment round when cycling through all participants', async () => {
            const encounterId = await createTestEncounter();
            // Advance through both participants
            await handleAdvanceTurn({ encounterId }, mockCtx);
            const result = await handleAdvanceTurn({ encounterId }, mockCtx);

            const response = extractStateJson(result.content[0].text);
            expect(response.round).toBe(2);
        });

        it('should throw error when no encounter exists', async () => {
            await expect(handleAdvanceTurn({ encounterId: 'non-existent' }, mockCtx)).rejects.toThrow('Encounter non-existent not found');
        });
    });

    describe('end_encounter', () => {
        it('should end active encounter', async () => {
            const encounterId = await createEncounterWithParticipants('test-end', [{
                id: 'p1',
                name: 'Hero',
                initiativeBonus: 1,
                hp: 30,
                maxHp: 30
            }]);

            const result = await handleEndEncounter({ encounterId }, mockCtx);

            expect(result.content).toHaveLength(1);
            // End encounter now returns human-readable text
            const text = result.content[0].text;
            expect(text).toContain('COMBAT ENDED');

            // Note: handleGetEncounterState can auto-load from DB, so we check
            // that the encounter was deleted from memory by verifying the manager
            expect(getCombatManager().get(`${mockCtx.sessionId}:${encounterId}`)).toBeNull();
        });

        it('should throw error when no encounter exists', async () => {
            await expect(handleEndEncounter({ encounterId: 'non-existent' }, mockCtx)).rejects.toThrow('Encounter non-existent not found');
        });
    });

    describe('persistence', () => {
        it('should save and load encounter state', async () => {
            // 1. Create encounter with participants
            const encounterId = await createEncounterWithParticipants('test-persistence', [{
                id: 'p1',
                name: 'Hero',
                initiativeBonus: 1,
                hp: 30,
                maxHp: 30
            }, {
                id: 'p2',
                name: 'Enemy',
                initiativeBonus: 0,
                hp: 30,
                maxHp: 30,
                isEnemy: true
            }]);

            // 2. Advance turn to change state
            await handleAdvanceTurn({ encounterId }, mockCtx);

            // 3. Verify state changed (round might be 1, but turn index changed)
            const stateBeforeResult = await handleGetEncounterState({ encounterId }, mockCtx);
            const stateBefore = extractStateJson(stateBeforeResult.content[0].text);

            // 4. "Forget" encounter from memory
            // Note: In the new implementation, we need to delete using the namespaced ID
            getCombatManager().delete(`${mockCtx.sessionId}:${encounterId}`);

            // Verify it's gone from memory
            expect(getCombatManager().get(`${mockCtx.sessionId}:${encounterId}`)).toBeNull();

            // 5. Load from DB
            const loadResult = await handleLoadEncounter({ encounterId }, mockCtx);
            expect(loadResult.content[0].text).toContain('ENCOUNTER LOADED');

            // 6. Verify state is restored
            const stateAfterResult = await handleGetEncounterState({ encounterId }, mockCtx);
            const stateAfter = extractStateJson(stateAfterResult.content[0].text);

            expect(stateAfter.visualState.currentTurn).toEqual(stateBefore.visualState.currentTurn);
            expect(stateAfter.encounter.round).toBe(stateBefore.encounter.round);
            expect(stateAfter.tokens.length).toBe(stateBefore.tokens.length);
        });
    });
});
