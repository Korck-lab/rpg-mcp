import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuid } from 'uuid';
import { handleCreateEncounter, handleExecuteCombatAction, clearCombatState } from '../../src/server/combat-tools.js';
import { closeDb, getDb } from '../../src/storage/index.js';
import { WorldRepository } from '../../src/storage/repos/world.repo.js';
import { RegionRepository } from '../../src/storage/repos/region.repo.js';
import { SpatialRepository } from '../../src/storage/repos/spatial.repo.js';
import { CharacterRepository } from '../../src/storage/repos/character.repo.js';

const mockCtx = { sessionId: 'test-session' };

// Helper to create test characters
async function createTestCharacter(overrides: any = {}, roomId?: string) {
    const db = getDb();
    const charRepo = new CharacterRepository(db);

    const now = new Date().toISOString();
    const defaults = {
        id: uuid(),
        name: 'Test Character',
        stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        hp: 30,
        maxHp: 30,
        ac: 10,
        level: 1,
        characterClass: 'fighter',
        race: 'human',
        conditions: [],
        currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
        xp: 0,
        currentRoomId: roomId || '123e4567-e89b-12d3-a456-426614174003', // Use test room ID
        perceptionBonus: 0,
        stealthBonus: 0,
        createdAt: now,
        updatedAt: now
    };

    const merged = { ...defaults, ...overrides };
    charRepo.create(merged);
    return merged;
}

/**
 * CRIT-003: Spatial Collision Not Enforced
 *
 * Tests for spatial positioning and movement collision in combat.
 * Movement should be blocked by obstacles and other combatants.
 */
describe('CRIT-003: Spatial Combat Movement', () => {
    let testRoomId: string;

    beforeEach(() => {
        closeDb();
        const db = getDb(':memory:');
        clearCombatState();

        // Seed required data for foreign keys
        const worldRepo = new WorldRepository(db);
        const regionRepo = new RegionRepository(db);
        const spatialRepo = new SpatialRepository(db);
        const charRepo = new CharacterRepository(db);

        testRoomId = '123e4567-e89b-12d3-a456-426614174003';
        
        const now = new Date().toISOString();
        const validUuid1 = '123e4567-e89b-12d3-a456-426614174001';
        const validUuid2 = '123e4567-e89b-12d3-a456-426614174002';
        const validUuid3 = '123e4567-e89b-12d3-a456-426614174003';

        worldRepo.create({ 
            id: validUuid1, 
            name: 'Test World', 
            seed: 'test-seed', 
            width: 100, 
            height: 100, 
            createdAt: now, 
            updatedAt: now 
        });
        
        regionRepo.create({ 
            id: validUuid2, 
            worldId: validUuid1, 
            name: 'Test Region', 
            type: 'forest', 
            centerX: 0, 
            centerY: 0, 
            color: '#000000', 
            createdAt: now, 
            updatedAt: now 
        });
        
        spatialRepo.create({ 
            id: validUuid3, 
            name: 'Test Room', 
            baseDescription: 'This is a valid detailed description for the test room that exceeds the minimum length requirement.', 
            biomeContext: 'forest', 
            atmospherics: [], 
            exits: [], 
            entityIds: [], 
            createdAt: now, 
            updatedAt: now, 
            visitedCount: 0, 
            isObserved: false 
        });
    });

    describe('Movement with Positions', () => {
        it('should support position data on participants', async () => {
            // Create character records for participants
            await createTestCharacter({ id: 'hero-1', name: 'Hero', hp: 30, maxHp: 30 });
            await createTestCharacter({ id: 'goblin-1', name: 'Goblin', hp: 7, maxHp: 7 });

            const result = await handleCreateEncounter({
                worldId: '123e4567-e89b-12d3-a456-426614174001',
                regionId: '123e4567-e89b-12d3-a456-426614174002',
                roomId: '123e4567-e89b-12d3-a456-426614174003',
                seed: 'pos-test-1',
                participants: [
                    {
                        id: 'hero-1',
                        name: 'Hero',
                        initiativeBonus: 2,
                        hp: 30,
                        maxHp: 30,
                        position: { x: 0, y: 0 }
                    },
                    {
                        id: 'goblin-1',
                        name: 'Goblin',
                        initiativeBonus: 1,
                        hp: 7,
                        maxHp: 7,
                        isEnemy: true,
                        position: { x: 5, y: 0 }
                    }
                ]
            }, mockCtx);

            const text = result.content[0].text;
            // Encounter created successfully with positions
            expect(text).toContain('hero-1');
            expect(text).toContain('goblin-1');
        });

        it('should execute move action to new position', async () => {
            // Create character records for participants
            await createTestCharacter({ id: 'hero-1', name: 'Hero', hp: 30, maxHp: 30 });
            await createTestCharacter({ id: 'goblin-1', name: 'Goblin', hp: 7, maxHp: 7 });

            // Create encounter with positions
            const createResult = await handleCreateEncounter({
                worldId: '123e4567-e89b-12d3-a456-426614174001',
                regionId: '123e4567-e89b-12d3-a456-426614174002',
                roomId: '123e4567-e89b-12d3-a456-426614174003',
                seed: 'move-test-1',
                participants: [
                    {
                        id: 'hero-1',
                        name: 'Hero',
                        initiativeBonus: 5,
                        hp: 30,
                        maxHp: 30,
                        position: { x: 0, y: 0 }
                    },
                    {
                        id: 'goblin-1',
                        name: 'Goblin',
                        initiativeBonus: 1,
                        hp: 7,
                        maxHp: 7,
                        isEnemy: true,
                        position: { x: 10, y: 0 }
                    }
                ]
            }, mockCtx);
            const createData = JSON.parse(createResult.content[0].text.match(/<!-- STATE_JSON\n([\s\S]*?)\nSTATE_JSON -->/)?.[1] || '{}');
            const encounterId = createData.encounter.id;

            // Execute move action
            const moveResult = await handleExecuteCombatAction({
                encounterId,
                action: 'move',
                actorId: 'hero-1',
                targetPosition: { x: 3, y: 0 }
            }, mockCtx);

            const moveText = moveResult.content[0].text;
            expect(moveText).toContain('move');
            // Position should be updated
            expect(moveText).toContain('3');
        });

        it('should block movement onto occupied squares', async () => {
            // Create character records for participants
            await createTestCharacter({ id: 'hero-1', name: 'Hero', hp: 30, maxHp: 30 });
            await createTestCharacter({ id: 'goblin-1', name: 'Goblin', hp: 7, maxHp: 7 });

            // Create encounter with goblin at a specific position
            const createResult = await handleCreateEncounter({
                worldId: '123e4567-e89b-12d3-a456-426614174001',
                regionId: '123e4567-e89b-12d3-a456-426614174002',
                roomId: '123e4567-e89b-12d3-a456-426614174003',
                seed: 'block-test-1',
                participants: [
                    {
                        id: 'hero-1',
                        name: 'Hero',
                        initiativeBonus: 5,
                        hp: 30,
                        maxHp: 30,
                        position: { x: 0, y: 0 }
                    },
                    {
                        id: 'goblin-1',
                        name: 'Goblin',
                        initiativeBonus: 1,
                        hp: 7,
                        maxHp: 7,
                        isEnemy: true,
                        position: { x: 2, y: 0 }
                    }
                ]
            }, mockCtx);
            const createData = JSON.parse(createResult.content[0].text.match(/<!-- STATE_JSON\n([\s\S]*?)\nSTATE_JSON -->/)?.[1] || '{}');
            const encounterId = createData.encounter.id;

            // Try to move ONTO the goblin's position - should be blocked
            const moveResult = await handleExecuteCombatAction({
                encounterId,
                action: 'move',
                actorId: 'hero-1',
                targetPosition: { x: 2, y: 0 } // Same as goblin position
            }, mockCtx);

            const moveText = moveResult.content[0].text;
            // Should fail - destination is occupied
            expect(moveText).toMatch(/blocked|cannot/i);
        });
    });

    describe('Terrain Obstacles', () => {
        it('should block movement onto terrain obstacles', async () => {
            // Create character records for participants
            await createTestCharacter({ id: 'hero-1', name: 'Hero', hp: 30, maxHp: 30 });

            // Create encounter with terrain
            const inputData = {
                worldId: '123e4567-e89b-12d3-a456-426614174001',
                regionId: '123e4567-e89b-12d3-a456-426614174002',
                roomId: '123e4567-e89b-12d3-a456-426614174003',
                seed: 'terrain-test-1',
                participants: [
                    {
                        id: 'hero-1',
                        name: 'Hero',
                        initiativeBonus: 5,
                        hp: 30,
                        maxHp: 30,
                        position: { x: 0, y: 0 }
                    }
                ],
                terrain: {
                    obstacles: ['2,0'] // Wall tile
                }
            };
            const createResult = await handleCreateEncounter(inputData, mockCtx);
            console.log('DEBUG: Create result:', createResult.content[0].text.substring(0, 500));
            const createData = JSON.parse(createResult.content[0].text.match(/<!-- STATE_JSON\n([\s\S]*?)\nSTATE_JSON -->/)?.[1] || '{}');
            console.log('DEBUG: Parsed terrain from response:', JSON.stringify(createData.visualState?.terrain));
            const encounterId = createData.encounter.id;

            // Try to move ONTO the wall tile - should fail
            const moveResult = await handleExecuteCombatAction({
                encounterId,
                action: 'move',
                actorId: 'hero-1',
                targetPosition: { x: 2, y: 0 } // The wall position
            }, mockCtx);

            const moveText = moveResult.content[0].text;
            // Should be blocked - destination is an obstacle
            expect(moveText).toMatch(/blocked|cannot/i);
        });
    });
});
