import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleGenerateWorld, clearWorld } from '../../src/server/tools';
import { handleListWorlds, handleDeleteWorld } from '../../src/server/crud-tools';
import { closeDb, initDB } from '../../src/storage/index.js';

// Helper to extract embedded JSON from human-readable output
function extractJson(text: string, tag: string): any {
    const regex = new RegExp(`<!-- ${tag}_JSON\\n([\\s\\S]*?)\\n${tag}_JSON -->`);
    const match = text.match(regex);
    if (match) return JSON.parse(match[1]);
    // Try plain JSON
    try { return JSON.parse(text); } catch { return {}; }
}

describe('World Repository Integration', () => {
    beforeEach(() => {
        closeDb();
        initDB(':memory:');
        clearWorld();
    });

    afterEach(() => {
        clearWorld();
        closeDb();
    });

    it('should persist generated world and allow list/delete', async () => {
        // Generate a world
        const genResult = await handleGenerateWorld({
            seed: 'integration-test',
            width: 30,
            height: 30
        }, { sessionId: 'test-session' });

        // handleGenerateWorld may return plain JSON or embedded
        let response: any;
        try {
            response = JSON.parse(genResult.content[0].text);
        } catch {
            response = extractJson(genResult.content[0].text, 'WORLD');
        }
        
        expect(response.worldId || response.id).toBeDefined();
        const worldId = response.worldId || response.id;

        // Verify it appears in list_worlds
        const listResult = await handleListWorlds({}, { sessionId: 'test-session' });
        let listData: any;
        try {
            listData = JSON.parse(listResult.content[0].text);
        } catch {
            listData = extractJson(listResult.content[0].text, 'WORLDS');
        }

        const worlds = listData.worlds || listData;
        const foundWorld = Array.isArray(worlds) 
            ? worlds.find((w: any) => w.id === worldId)
            : null;
        expect(foundWorld).toBeDefined();
        expect(foundWorld.seed).toBe('integration-test');
        expect(foundWorld.width).toBe(30);
        expect(foundWorld.height).toBe(30);

        // Verify we can delete it
        const deleteResult = await handleDeleteWorld({ id: worldId }, { sessionId: 'test-session' });
        const deleteText = deleteResult.content[0].text.toLowerCase();
        expect(deleteText).toContain('deleted');

        // Verify it's gone from list
        const listAfterDelete = await handleListWorlds({}, { sessionId: 'test-session' });
        let listAfterData: any;
        try {
            listAfterData = JSON.parse(listAfterDelete.content[0].text);
        } catch {
            listAfterData = extractJson(listAfterDelete.content[0].text, 'WORLDS');
        }
        
        const worldsAfter = listAfterData.worlds || listAfterData;
        const notFound = Array.isArray(worldsAfter)
            ? worldsAfter.find((w: any) => w.id === worldId)
            : undefined;
        expect(notFound).toBeUndefined();
    });
});
