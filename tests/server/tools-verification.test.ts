import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleCreateEncounter, handleAddToken, handleRollInitiative, clearCombatState } from '../../src/server/combat-tools';
import { handleCreateWorld, handleDeleteWorld } from '../../src/server/crud-tools';
import { closeDb, initDB } from '../../src/storage/index.js';

// Helper to extract embedded JSON from human-readable output
function extractJson(text: string, tag: string): any {
    const regex = new RegExp(`<!-- ${tag}_JSON\\n([\\s\\S]*?)\\n${tag}_JSON -->`);
    const match = text.match(regex);
    if (match) return JSON.parse(match[1]);
    // Try plain JSON
    try { return JSON.parse(text); } catch { return {}; }
}

describe('Registered Tools Verification', () => {
    let testWorldId: string;
    const mockCtx = { sessionId: 'test-session' };

    beforeEach(async () => {
        closeDb();
        initDB(':memory:');
        clearCombatState();

        // Create world for combat tests
        const worldResult = await handleCreateWorld({
            name: 'Verification Test World',
            seed: 'verification-test',
            width: 50,
            height: 50
        }, mockCtx);
        const world = extractJson(worldResult.content[0].text, 'WORLD');
        testWorldId = world.id;
    });

    afterEach(() => {
        clearCombatState();
        closeDb();
    });

    describe('Combat Tools', () => {
        it('should create an encounter', async () => {
            // Create encounter
            const result = await handleCreateEncounter({
                worldId: testWorldId,
                seed: 'test-combat'
            }, mockCtx);

            const encounterData = extractJson(result.content[0].text, 'STATE');
            const encounterId = encounterData.encounter?.id || encounterData.encounterId;
            expect(encounterId).toBeDefined();

            // Add tokens - handleAddToken expects flat parameters, not nested token object
            await handleAddToken({
                encounterId,
                characterId: 'char-p1',
                name: 'Player',
                initiativeBonus: 2,
                isEnemy: false,
                hp: 10,
                maxHp: 10,
                positionX: 0,
                positionY: 0
            }, mockCtx);

            await handleAddToken({
                encounterId,
                characterId: 'char-e1',
                name: 'Enemy',
                initiativeBonus: 1,
                isEnemy: true,
                hp: 10,
                maxHp: 10,
                positionX: 5,
                positionY: 0
            }, mockCtx);

            // Roll initiative
            const initResult = await handleRollInitiative({ encounterId, seed: 'init-test' }, mockCtx);
            const initData = extractJson(initResult.content[0].text, 'STATE');

            // handleRollInitiative returns { initiativeOrder: [...] }
            expect(initData.initiativeOrder).toBeDefined();
            expect(Array.isArray(initData.initiativeOrder)).toBe(true);
        });
    });

    describe('CRUD Tools', () => {
        it('should create and delete a world', async () => {
            // Create a new world (separate from beforeEach world)
            const createResult = await handleCreateWorld({
                name: 'CRUD Test World',
                seed: 'crud-test-seed',
                width: 50,
                height: 50
            }, mockCtx);
            const created = extractJson(createResult.content[0].text, 'WORLD');
            expect(created.id).toBeDefined();

            // Delete
            const deleteResult = await handleDeleteWorld({ id: created.id }, mockCtx);
            const deleteText = deleteResult.content[0].text;
            // Delete returns plain text, not JSON
            expect(deleteText.toLowerCase()).toContain('deleted');
        });
    });
});
