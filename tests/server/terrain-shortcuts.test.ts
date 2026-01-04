import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    handleCreateEncounter,
    handleUpdateTerrain,
    handleGenerateTerrainPattern,
    handleAddToken,
    handleRollInitiative,
    clearCombatState
} from '../../src/server/combat-tools';
import { handleCreateWorld } from '../../src/server/crud-tools';
import { closeDb, initDB } from '../../src/storage/index.js';
import { generateMaze, generateMazeWithRooms } from '../../src/server/terrain-patterns';

let testCounter = 0;
const getMockCtx = () => ({ sessionId: `test-terrain-session-${testCounter++}` });

function extractJson(text: string, tag: string): any {
    const regex = new RegExp(`<!-- ${tag}_JSON\\n([\\s\\S]*?)\\n${tag}_JSON -->`);
    const match = text.match(regex);
    if (match) return JSON.parse(match[1]);
    // Try plain JSON
    try { return JSON.parse(text); } catch { return {}; }
}

describe('Terrain Range Shortcuts', () => {
    let encounterId: string;
    let testWorldId: string;
    let mockCtx: { sessionId: string };

    beforeEach(async () => {
        closeDb();
        initDB(':memory:');
        clearCombatState();
        mockCtx = getMockCtx();

        // Create world first
        const worldResult = await handleCreateWorld({
            name: 'Terrain Test World',
            seed: `terrain-world-${testCounter}`,
            width: 50,
            height: 50
        }, mockCtx);
        const world = extractJson(worldResult.content[0].text, 'WORLD');
        testWorldId = world.id;

        // Create encounter
        const result = await handleCreateEncounter({
            worldId: testWorldId,
            seed: `terrain-test-${testCounter}`
        }, mockCtx);
        const encounterData = extractJson(result.content[0].text, 'STATE');
        encounterId = encounterData.encounter?.id || encounterData.encounterId;

        // Add a token - flat parameters, not nested token object
        await handleAddToken({
            encounterId,
            characterId: 'char-p1',
            name: 'Test',
            initiativeBonus: 0,
            isEnemy: false,
            hp: 10,
            maxHp: 10,
            positionX: 5,
            positionY: 5
        }, mockCtx);

        await handleRollInitiative({ encounterId, seed: `init-${testCounter}` }, mockCtx);
    });

    afterEach(() => {
        clearCombatState();
        closeDb();
    });

    describe('update_terrain with ranges', () => {
        it('should add obstacles using row shortcut', async () => {
            const result = await handleUpdateTerrain({
                encounterId,
                operation: 'add',
                terrainType: 'obstacles',
                ranges: ['row:5'],
                gridWidth: 10,
                gridHeight: 10
            }, mockCtx);

            const state = extractJson(result.content[0].text, 'STATE');
            // Row 5 should have tiles from x=0 to x=9
            expect(state.terrain.obstacles).toContain('0,5');
            expect(state.terrain.obstacles).toContain('9,5');
            expect(state.terrain.obstacles.length).toBe(10);
        });

        it('should add obstacles using col shortcut', async () => {
            const result = await handleUpdateTerrain({
                encounterId,
                operation: 'add',
                terrainType: 'obstacles',
                ranges: ['col:3'],
                gridWidth: 10,
                gridHeight: 10
            }, mockCtx);

            const state = extractJson(result.content[0].text, 'STATE');
            expect(state.terrain.obstacles).toContain('3,0');
            expect(state.terrain.obstacles).toContain('3,9');
            expect(state.terrain.obstacles.length).toBe(10);
        });

        it('should add obstacles using x= shortcut', async () => {
            const result = await handleUpdateTerrain({
                encounterId,
                operation: 'add',
                terrainType: 'obstacles',
                ranges: ['x=7:2:5'],
                gridWidth: 10,
                gridHeight: 10
            }, mockCtx);

            const state = extractJson(result.content[0].text, 'STATE');
            // x=7 from y=2 to y=5
            expect(state.terrain.obstacles).toContain('7,2');
            expect(state.terrain.obstacles).toContain('7,5');
            expect(state.terrain.obstacles).not.toContain('7,1');
            expect(state.terrain.obstacles.length).toBe(4);
        });

        it('should add obstacles using y= shortcut', async () => {
            const result = await handleUpdateTerrain({
                encounterId,
                operation: 'add',
                terrainType: 'obstacles',
                ranges: ['y=3:1:4'],
                gridWidth: 10,
                gridHeight: 10
            }, mockCtx);

            const state = extractJson(result.content[0].text, 'STATE');
            // y=3 from x=1 to x=4
            expect(state.terrain.obstacles).toContain('1,3');
            expect(state.terrain.obstacles).toContain('4,3');
            expect(state.terrain.obstacles.length).toBe(4);
        });

        it('should add obstacles using line shortcut (Bresenham)', async () => {
            const result = await handleUpdateTerrain({
                encounterId,
                operation: 'add',
                terrainType: 'obstacles',
                ranges: ['line:0,0,9,9'],
                gridWidth: 10,
                gridHeight: 10
            }, mockCtx);

            const state = extractJson(result.content[0].text, 'STATE');
            // Diagonal line from (0,0) to (9,9)
            expect(state.terrain.obstacles).toContain('0,0');
            expect(state.terrain.obstacles).toContain('9,9');
            expect(state.terrain.obstacles.length).toBe(10); // Bresenham diagonal
        });

        it('should add obstacles using rect shortcut', async () => {
            const result = await handleUpdateTerrain({
                encounterId,
                operation: 'add',
                terrainType: 'obstacles',
                ranges: ['rect:2,2,3,3'],
                gridWidth: 10,
                gridHeight: 10
            }, mockCtx);

            const state = extractJson(result.content[0].text, 'STATE');
            // 3x3 filled rectangle at (2,2)
            expect(state.terrain.obstacles).toContain('2,2');
            expect(state.terrain.obstacles).toContain('4,4');
            expect(state.terrain.obstacles.length).toBe(9);
        });

        it('should add obstacles using box shortcut (hollow)', async () => {
            const result = await handleUpdateTerrain({
                encounterId,
                operation: 'add',
                terrainType: 'obstacles',
                ranges: ['box:1,1,4,4'],
                gridWidth: 10,
                gridHeight: 10
            }, mockCtx);

            const state = extractJson(result.content[0].text, 'STATE');
            // 4x4 hollow box - should have perimeter only
            expect(state.terrain.obstacles).toContain('1,1');
            expect(state.terrain.obstacles).toContain('4,1');
            expect(state.terrain.obstacles).toContain('1,4');
            expect(state.terrain.obstacles).toContain('4,4');
            // Center should be empty
            expect(state.terrain.obstacles).not.toContain('2,2');
            expect(state.terrain.obstacles).not.toContain('3,3');
            expect(state.terrain.obstacles.length).toBe(12); // 4*4 - 2*2 = 12
        });

        it('should add obstacles using border shortcut', async () => {
            const result = await handleUpdateTerrain({
                encounterId,
                operation: 'add',
                terrainType: 'obstacles',
                ranges: ['border:0'],
                gridWidth: 10,
                gridHeight: 10
            }, mockCtx);

            const state = extractJson(result.content[0].text, 'STATE');
            // Border at margin 0 = outer edge
            expect(state.terrain.obstacles).toContain('0,0');
            expect(state.terrain.obstacles).toContain('9,0');
            expect(state.terrain.obstacles).toContain('0,9');
            expect(state.terrain.obstacles).toContain('9,9');
            // Center should be empty
            expect(state.terrain.obstacles).not.toContain('5,5');
            // 10*4 - 4 corners counted once = 36
            expect(state.terrain.obstacles.length).toBe(36);
        });

        it('should add obstacles using circle shortcut', async () => {
            const result = await handleUpdateTerrain({
                encounterId,
                operation: 'add',
                terrainType: 'obstacles',
                ranges: ['circle:5,5,2'],
                gridWidth: 10,
                gridHeight: 10
            }, mockCtx);

            const state = extractJson(result.content[0].text, 'STATE');
            // Center should be in circle
            expect(state.terrain.obstacles).toContain('5,5');
            // Should not contain distant points
            expect(state.terrain.obstacles).not.toContain('0,0');
        });

        it('should add multiple ranges in one call', async () => {
            const result = await handleUpdateTerrain({
                encounterId,
                operation: 'add',
                terrainType: 'obstacles',
                ranges: ['row:0', 'row:9', 'col:0', 'col:9'],
                gridWidth: 10,
                gridHeight: 10
            }, mockCtx);

            const state = extractJson(result.content[0].text, 'STATE');
            // Should form a border (with some overlap at corners)
            expect(state.terrain.obstacles).toContain('0,0');
            expect(state.terrain.obstacles).toContain('9,9');
            expect(state.terrain.obstacles).toContain('5,0');
            expect(state.terrain.obstacles).toContain('0,5');
        });

        it('should support algebraic expressions', async () => {
            const result = await handleUpdateTerrain({
                encounterId,
                operation: 'add',
                terrainType: 'obstacles',
                ranges: ['y=x:0:9'],
                gridWidth: 10,
                gridHeight: 10
            }, mockCtx);

            const state = extractJson(result.content[0].text, 'STATE');
            // y=x diagonal
            expect(state.terrain.obstacles).toContain('0,0');
            expect(state.terrain.obstacles).toContain('5,5');
            expect(state.terrain.obstacles).toContain('9,9');
            expect(state.terrain.obstacles.length).toBe(10);
        });
    });
});

describe('Maze Generator', () => {
    it('should generate a maze with corridors and walls', () => {
        const result = generateMaze(0, 0, 20, 20, 'test-seed', 1);

        expect(result.obstacles.length).toBeGreaterThan(0);
        // Maze should have some passable areas (not all walls)
        expect(result.obstacles.length).toBeLessThan(20 * 20);
        // Should have outer walls
        expect(result.obstacles).toContain('0,0');
    });

    it('should generate reproducible mazes with same seed', () => {
        const result1 = generateMaze(0, 0, 30, 30, 'same-seed', 1);
        const result2 = generateMaze(0, 0, 30, 30, 'same-seed', 1);

        expect(result1.obstacles).toEqual(result2.obstacles);
    });

    it('should generate different mazes with different seeds', () => {
        const result1 = generateMaze(0, 0, 30, 30, 'seed-a', 1);
        const result2 = generateMaze(0, 0, 30, 30, 'seed-b', 1);

        expect(result1.obstacles).not.toEqual(result2.obstacles);
    });

    it('should support wider corridors', () => {
        const narrow = generateMaze(0, 0, 30, 30, 'test', 1);
        const wide = generateMaze(0, 0, 30, 30, 'test', 2);

        // Wider corridors = fewer walls
        expect(wide.obstacles.length).toBeLessThan(narrow.obstacles.length);
    });
});

describe('Maze with Rooms Generator', () => {
    it('should generate a maze with carved-out rooms', () => {
        const result = generateMazeWithRooms(0, 0, 50, 50, 'room-test', 5, 4, 8);

        expect(result.obstacles.length).toBeGreaterThan(0);
        // Should have room markers as props
        expect(result.props.length).toBeGreaterThan(0);
        expect(result.props[0].label).toContain('Chamber');
    });

    it('should generate reproducible mazes with rooms', () => {
        const result1 = generateMazeWithRooms(0, 0, 50, 50, 'room-seed', 5);
        const result2 = generateMazeWithRooms(0, 0, 50, 50, 'room-seed', 5);

        expect(result1.obstacles).toEqual(result2.obstacles);
        expect(result1.props.length).toBe(result2.props.length);
    });
});

describe('generate_terrain_pattern tool with maze', () => {
    let encounterId: string;
    let testWorldId: string;
    let mazeCtx: { sessionId: string };

    beforeEach(async () => {
        closeDb();
        initDB(':memory:');
        clearCombatState();
        mazeCtx = getMockCtx();

        // Create world first
        const worldResult = await handleCreateWorld({
            name: 'Maze Test World',
            seed: `maze-world-${testCounter}`,
            width: 100,
            height: 100
        }, mazeCtx);
        const world = extractJson(worldResult.content[0].text, 'WORLD');
        testWorldId = world.id;

        // Create encounter
        const result = await handleCreateEncounter({
            worldId: testWorldId,
            seed: `maze-pattern-test-${testCounter}`
        }, mazeCtx);
        const encounterData = extractJson(result.content[0].text, 'STATE');
        encounterId = encounterData.encounter?.id || encounterData.encounterId;

        // Add a token - flat parameters, not nested token object
        await handleAddToken({
            encounterId,
            characterId: 'char-runner',
            name: 'Thomas',
            initiativeBonus: 0,
            isEnemy: false,
            hp: 30,
            maxHp: 30,
            positionX: 50,
            positionY: 50
        }, mazeCtx);

        await handleRollInitiative({ encounterId, seed: `maze-init-${testCounter}` }, mazeCtx);
    });

    afterEach(() => {
        clearCombatState();
        closeDb();
    });

    it('should generate a full 100x100 maze in one call', async () => {
        const result = await handleGenerateTerrainPattern({
            encounterId,
            pattern: 'maze',
            origin: { x: 0, y: 0 },
            width: 100,
            height: 100,
            seed: 'maze-runner-001'
        }, mazeCtx);

        const text = result.content[0].text;
        expect(text).toContain('TERRAIN PATTERN GENERATED');
        expect(text).toContain('MAZE');

        // Extract obstacle count from output
        const obstacleMatch = text.match(/Obstacles: (\d+)/);
        expect(obstacleMatch).toBeTruthy();
        const obstacleCount = parseInt(obstacleMatch![1], 10);

        // A 100x100 maze should have significant walls but not all walls
        expect(obstacleCount).toBeGreaterThan(1000);
        expect(obstacleCount).toBeLessThan(9000);
    });

    it('should generate maze_rooms pattern', async () => {
        const result = await handleGenerateTerrainPattern({
            encounterId,
            pattern: 'maze_rooms',
            origin: { x: 0, y: 0 },
            width: 60,
            height: 60,
            seed: 'dungeon-001',
            roomCount: 8
        }, mazeCtx);

        const text = result.content[0].text;
        expect(text).toContain('TERRAIN PATTERN GENERATED');
        expect(text).toContain('Props:');
    });
});
