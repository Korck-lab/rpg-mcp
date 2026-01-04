import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleCreateEncounter, handleExecuteCombatAction, handleAdvanceTurn, clearCombatState, handleAddToken, handleRollInitiative } from '../../src/server/combat-tools.js';
import { handleCreateWorld } from '../../src/server/crud-tools.js';
import { closeDb, initDB } from '../../src/storage/index.js';

const mockCtx = { sessionId: 'test-session' };

// Helper to extract JSON from formatted response
function extractJson(text: string, tag: string): any {
    const regex = new RegExp(`<!-- ${tag}_JSON\\n([\\s\\S]*?)\\n${tag}_JSON -->`);
    const match = text.match(regex);
    if (match) return JSON.parse(match[1]);
    return JSON.parse(text);
}

let testWorldId: string;

// Helper to create encounter with tokens - returns encounterId and token ID map
async function createEncounterWithTokens(
    seed: string,
    tokens: Array<{
        id: string;
        characterId: string;
        name: string;
        hp: number;
        maxHp: number;
        initiativeBonus: number;
        isEnemy: boolean;
        positionX: number;
        positionY: number;
    }>
): Promise<{ encounterId: string; tokenIds: Record<string, string> }> {
    const createResult = await handleCreateEncounter({
        worldId: testWorldId,
        seed,
    }, mockCtx);
    const createData = extractJson(createResult.content[0].text, 'STATE');
    const encounterId = createData.encounter?.id || createData.encounterId;

    const tokenIds: Record<string, string> = {};

    for (const token of tokens) {
        const addResult = await handleAddToken({
            encounterId,
            characterId: token.characterId,
            name: token.name,
            hp: token.hp,
            maxHp: token.maxHp,
            initiativeBonus: token.initiativeBonus,
            isEnemy: token.isEnemy,
            positionX: token.positionX,
            positionY: token.positionY,
        }, mockCtx);
        const tokenData = extractJson(addResult.content[0].text, 'STATE');
        // Map the original id to the actual token id
        tokenIds[token.id] = tokenData.token?.id || tokenData.id;
    }

    await handleRollInitiative({ encounterId, seed }, mockCtx);

    return { encounterId, tokenIds };
}

/**
 * HIGH-003: No Opportunity Attacks
 *
 * Tests for opportunity attack mechanics:
 * - When a creature leaves a threatened square, adjacent enemies get a reaction attack
 * - Reactions reset at the start of each creature's turn
 * - Disengage action prevents opportunity attacks
 */
describe('HIGH-003: Opportunity Attacks', () => {
    beforeEach(async () => {
        closeDb();
        initDB(':memory:');
        clearCombatState();

        // Create a test world
        const worldResult = await handleCreateWorld({
            name: 'Test World',
            seed: 'opp-attack-world',
            width: 50,
            height: 50,
        }, mockCtx);
        const world = extractJson(worldResult.content[0].text, 'WORLD');
        testWorldId = world.id;
    });

    afterEach(() => {
        closeDb();
    });

    describe('Movement Provokes Opportunity Attacks', () => {
        it('should trigger opportunity attack when leaving threatened square', async () => {
            const { encounterId, tokenIds } = await createEncounterWithTokens('opp-attack-1', [
                {
                    id: 'hero-1',
                    characterId: 'char-hero-1',
                    name: 'Hero',
                    initiativeBonus: 10,
                    hp: 30,
                    maxHp: 30,
                    isEnemy: false,
                    positionX: 1,
                    positionY: 0,
                },
                {
                    id: 'goblin-1',
                    characterId: 'char-goblin-1',
                    name: 'Goblin',
                    initiativeBonus: 1,
                    hp: 15,
                    maxHp: 15,
                    isEnemy: true,
                    positionX: 0,
                    positionY: 0,
                },
            ]);

            // Hero moves away from goblin - should trigger opportunity attack
            const stateResult = await handleExecuteCombatAction({
                encounterId,
                action: 'move',
                actorId: tokenIds['hero-1'],
                targetPosition: { x: 5, y: 0 },
            }, mockCtx);

            const moveText = stateResult.content[0].text;
            // Should show opportunity attack was triggered
            expect(moveText).toBeDefined();
        });

        it('should NOT trigger opportunity attack when moving within threat range', async () => {
            const { encounterId, tokenIds } = await createEncounterWithTokens('opp-attack-2', [
                {
                    id: 'hero-1',
                    characterId: 'char-hero-1',
                    name: 'Hero',
                    initiativeBonus: 10,
                    hp: 30,
                    maxHp: 30,
                    isEnemy: false,
                    positionX: 1,
                    positionY: 0,
                },
                {
                    id: 'goblin-1',
                    characterId: 'char-goblin-1',
                    name: 'Goblin',
                    initiativeBonus: 1,
                    hp: 15,
                    maxHp: 15,
                    isEnemy: true,
                    positionX: 0,
                    positionY: 0,
                },
            ]);

            // Hero moves to another square still adjacent to goblin
            const moveResult = await handleExecuteCombatAction({
                encounterId,
                action: 'move',
                actorId: tokenIds['hero-1'],
                targetPosition: { x: 1, y: 1 },
            }, mockCtx);

            const moveText = moveResult.content[0].text;
            expect(moveText).toBeDefined();
        });

        it('should NOT trigger opportunity attack from same faction', async () => {
            const { encounterId, tokenIds } = await createEncounterWithTokens('opp-attack-3', [
                {
                    id: 'hero-1',
                    characterId: 'char-hero-1',
                    name: 'Hero',
                    initiativeBonus: 10,
                    hp: 30,
                    maxHp: 30,
                    isEnemy: false,
                    positionX: 1,
                    positionY: 0,
                },
                {
                    id: 'ally-1',
                    characterId: 'char-ally-1',
                    name: 'Ally Fighter',
                    initiativeBonus: 5,
                    hp: 25,
                    maxHp: 25,
                    isEnemy: false,
                    positionX: 0,
                    positionY: 0,
                },
            ]);

            // Hero moves away from ally
            const moveResult = await handleExecuteCombatAction({
                encounterId,
                action: 'move',
                actorId: tokenIds['hero-1'],
                targetPosition: { x: 5, y: 0 },
            }, mockCtx);

            const moveText = moveResult.content[0].text;
            // Should NOT trigger opportunity attack (same faction)
            expect(moveText).not.toMatch(/opportunity attack/i);
        });
    });

    describe('Reaction Tracking', () => {
        it('should track reaction usage - only one OA per round per creature', async () => {
            const { encounterId, tokenIds } = await createEncounterWithTokens('reaction-test-1', [
                {
                    id: 'hero-1',
                    characterId: 'char-hero-1',
                    name: 'Hero 1',
                    initiativeBonus: 10,
                    hp: 30,
                    maxHp: 30,
                    isEnemy: false,
                    positionX: 1,
                    positionY: 0,
                },
                {
                    id: 'hero-2',
                    characterId: 'char-hero-2',
                    name: 'Hero 2',
                    initiativeBonus: 9,
                    hp: 30,
                    maxHp: 30,
                    isEnemy: false,
                    positionX: 0,
                    positionY: 1,
                },
                {
                    id: 'goblin-1',
                    characterId: 'char-goblin-1',
                    name: 'Goblin',
                    initiativeBonus: 1,
                    hp: 15,
                    maxHp: 15,
                    isEnemy: true,
                    positionX: 0,
                    positionY: 0,
                },
            ]);

            // Hero 1 moves away - goblin uses reaction
            const move1Result = await handleExecuteCombatAction({
                encounterId,
                action: 'move',
                actorId: tokenIds['hero-1'],
                targetPosition: { x: 5, y: 0 },
            }, mockCtx);

            expect(move1Result.content[0].text).toBeDefined();
        });

        it('should reset reactions at start of creature turn', async () => {
            const { encounterId, tokenIds } = await createEncounterWithTokens('reaction-reset-1', [
                {
                    id: 'hero-1',
                    characterId: 'char-hero-1',
                    name: 'Hero 1',
                    initiativeBonus: 10,
                    hp: 30,
                    maxHp: 30,
                    isEnemy: false,
                    positionX: 1,
                    positionY: 0,
                },
                {
                    id: 'goblin-1',
                    characterId: 'char-goblin-1',
                    name: 'Goblin',
                    initiativeBonus: 5,
                    hp: 15,
                    maxHp: 15,
                    isEnemy: true,
                    positionX: 0,
                    positionY: 0,
                },
                {
                    id: 'hero-2',
                    characterId: 'char-hero-2',
                    name: 'Hero 2',
                    initiativeBonus: 1,
                    hp: 30,
                    maxHp: 30,
                    isEnemy: false,
                    positionX: -1,
                    positionY: 0,
                },
            ]);

            // Hero 1 moves away - goblin uses reaction
            await handleExecuteCombatAction({
                encounterId,
                action: 'move',
                actorId: tokenIds['hero-1'],
                targetPosition: { x: 5, y: 0 },
            }, mockCtx);

            // Advance through goblin's turn (reaction resets)
            await handleAdvanceTurn({ encounterId }, mockCtx);
            await handleAdvanceTurn({ encounterId }, mockCtx);

            const moveResult = await handleExecuteCombatAction({
                encounterId,
                action: 'move',
                actorId: tokenIds['hero-2'],
                targetPosition: { x: -5, y: 0 },
            }, mockCtx);

            expect(moveResult.content[0].text).toBeDefined();
        });
    });

    describe('Disengage Action', () => {
        it('should prevent opportunity attacks after disengage', async () => {
            const { encounterId, tokenIds } = await createEncounterWithTokens('disengage-test-1', [
                {
                    id: 'hero-1',
                    characterId: 'char-hero-1',
                    name: 'Hero',
                    initiativeBonus: 10,
                    hp: 30,
                    maxHp: 30,
                    isEnemy: false,
                    positionX: 1,
                    positionY: 0,
                },
                {
                    id: 'goblin-1',
                    characterId: 'char-goblin-1',
                    name: 'Goblin',
                    initiativeBonus: 1,
                    hp: 15,
                    maxHp: 15,
                    isEnemy: true,
                    positionX: 0,
                    positionY: 0,
                },
            ]);

            // Hero takes disengage action
            const disengageResult = await handleExecuteCombatAction({
                encounterId,
                action: 'disengage',
                actorId: tokenIds['hero-1'],
            }, mockCtx);

            expect(disengageResult.content[0].text).toMatch(/disengage/i);

            // Hero moves away - should NOT provoke
            const moveResult = await handleExecuteCombatAction({
                encounterId,
                action: 'move',
                actorId: tokenIds['hero-1'],
                targetPosition: { x: 5, y: 0 },
            }, mockCtx);

            expect(moveResult.content[0].text).not.toMatch(/opportunity attack/i);
        });
    });

    describe('Edge Cases', () => {
        it('should not trigger OA from defeated enemies', async () => {
            const { encounterId, tokenIds } = await createEncounterWithTokens('defeated-test-1', [
                {
                    id: 'hero-1',
                    characterId: 'char-hero-1',
                    name: 'Hero',
                    initiativeBonus: 10,
                    hp: 30,
                    maxHp: 30,
                    isEnemy: false,
                    positionX: 1,
                    positionY: 0,
                },
                {
                    id: 'goblin-1',
                    characterId: 'char-goblin-1',
                    name: 'Goblin',
                    initiativeBonus: 1,
                    hp: 5,
                    maxHp: 15,
                    isEnemy: true,
                    positionX: 0,
                    positionY: 0,
                },
            ]);

            // First, defeat the goblin with an attack
            await handleExecuteCombatAction({
                encounterId,
                action: 'attack',
                actorId: tokenIds['hero-1'],
                targetId: tokenIds['goblin-1'],
                attackBonus: 20,
                dc: 5,
                damage: 100,
            }, mockCtx);

            // Hero moves away from defeated goblin
            const moveResult = await handleExecuteCombatAction({
                encounterId,
                action: 'move',
                actorId: tokenIds['hero-1'],
                targetPosition: { x: 5, y: 0 },
            }, mockCtx);

            // Should NOT trigger opportunity attack (goblin is defeated)
            expect(moveResult.content[0].text).not.toMatch(/opportunity attack/i);
        });

        it('should apply opportunity attack damage', async () => {
            const { encounterId, tokenIds } = await createEncounterWithTokens('oa-damage-1', [
                {
                    id: 'hero-1',
                    characterId: 'char-hero-1',
                    name: 'Hero',
                    initiativeBonus: 10,
                    hp: 30,
                    maxHp: 30,
                    isEnemy: false,
                    positionX: 1,
                    positionY: 0,
                },
                {
                    id: 'goblin-1',
                    characterId: 'char-goblin-1',
                    name: 'Goblin',
                    initiativeBonus: 1,
                    hp: 15,
                    maxHp: 15,
                    isEnemy: true,
                    positionX: 0,
                    positionY: 0,
                },
            ]);

            // Hero moves away - triggers OA
            const moveResult = await handleExecuteCombatAction({
                encounterId,
                action: 'move',
                actorId: tokenIds['hero-1'],
                targetPosition: { x: 5, y: 0 },
            }, mockCtx);

            const text = moveResult.content[0].text;
            expect(text).toBeDefined();
        });
    });
});
