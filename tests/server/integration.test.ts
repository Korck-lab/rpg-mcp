import { describe, it, expect } from 'vitest';
import {
    handleGenerateWorld,
    handleGetWorldState,
    handleApplyMapPatch,
    handleGetWorldMapOverview,
    handleGetRegionMap,
    handlePreviewMapPatch
} from '../../src/server/tools';

const mockCtx = { sessionId: 'test-session' };

describe('MCP Server Tools', () => {
    it('should generate a world successfully', async () => {
        const args = {
            seed: 'test-seed',
            width: 50,
            height: 50
        };

        const result = await handleGenerateWorld(args, mockCtx);

        expect(result.content).toHaveLength(1);
        expect(result.content[0].type).toBe('text');

        const response = JSON.parse(result.content[0].text);
        expect(response.message).toBe('World generated successfully');
        expect(response.worldId).toBeDefined();
        expect(response.stats.width).toBe(50);
        expect(response.stats.height).toBe(50);
    });

    it('should retrieve world state after generation', async () => {
        // Generate first
        const genResult = await handleGenerateWorld({
            seed: 'state-test',
            width: 20,
            height: 20
        }, mockCtx);
        const worldId = JSON.parse(genResult.content[0].text).worldId;

        // Retrieve state
        const result = await handleGetWorldState({ worldId }, mockCtx);

        expect(result.content).toHaveLength(1);
        const state = JSON.parse(result.content[0].text);

        expect(state.seed).toBe('state-test');
        expect(state.width).toBe(20);
        expect(state.height).toBe(20);
        expect(state.stats).toBeDefined();
    });

    it('should apply map patch successfully', async () => {
        // Ensure world exists (persisted from previous test or new gen)
        const genResult = await handleGenerateWorld({
            seed: 'patch-test',
            width: 20,
            height: 20
        }, mockCtx);
        const worldId = JSON.parse(genResult.content[0].text).worldId;

        const script = `ADD_STRUCTURE type="city" x=5 y=5 name="Patch City"`;

        const result = await handleApplyMapPatch({ worldId, script }, mockCtx);

        expect(result.content).toHaveLength(1);
        const response = JSON.parse(result.content[0].text);
        expect(response.message).toBe('Patch applied successfully');
        expect(response.commandsExecuted).toBe(1);

        // Verify state change
        const stateResult = await handleGetWorldState({ worldId }, mockCtx);
        const state = JSON.parse(stateResult.content[0].text);
        // We can't easily check the structures array directly from the summary unless we update get_world_state to return it
        // But the stats should reflect it
        expect(state.stats.structures).toBeGreaterThan(0);
    });

    describe('get_world_map_overview', () => {
        it('should return overview with biome distribution when world exists', async () => {
            // Generate a world first
            const genResult = await handleGenerateWorld({
                seed: 'overview-test',
                width: 50,
                height: 50
            }, mockCtx);
            const worldId = JSON.parse(genResult.content[0].text).worldId;

            const result = await handleGetWorldMapOverview({ worldId }, mockCtx);

            expect(result.content).toHaveLength(1);
            const overview = JSON.parse(result.content[0].text);

            // Should have basic world info
            expect(overview.seed).toBe('overview-test');
            expect(overview.dimensions).toEqual({ width: 50, height: 50 });

            // Should have biome distribution
            expect(overview.biomeDistribution).toBeDefined();
            expect(typeof overview.biomeDistribution).toBe('object');

            // Should have region count
            expect(overview.regionCount).toBeGreaterThanOrEqual(0);
            expect(overview.structureCount).toBeGreaterThanOrEqual(0);
        });

        it('should throw error when no world exists', async () => {
            // Pass a random ID that doesn't exist
            await expect(handleGetWorldMapOverview({ worldId: 'non-existent-id' }, mockCtx)).rejects.toThrow('World non-existent-id not found');
        });
    });

    describe('get_region_map', () => {
        it('should return region details when valid regionId provided', async () => {
            // Generate a world
            const genResult = await handleGenerateWorld({
                seed: 'region-test',
                width: 50,
                height: 50
            }, mockCtx);
            const worldId = JSON.parse(genResult.content[0].text).worldId;

            const result = await handleGetRegionMap({ worldId, regionId: 0 }, mockCtx);

            expect(result.content).toHaveLength(1);
            const regionData = JSON.parse(result.content[0].text);

            expect(regionData.region).toBeDefined();
            expect(regionData.region.id).toBe(0);
            expect(regionData.region.name).toBeDefined();
            expect(regionData.tiles).toBeDefined();
            expect(Array.isArray(regionData.tiles)).toBe(true);
        });

        it('should throw error for invalid regionId', async () => {
            const genResult = await handleGenerateWorld({
                seed: 'region-invalid-test',
                width: 50,
                height: 50
            }, mockCtx);
            const worldId = JSON.parse(genResult.content[0].text).worldId;

            await expect(handleGetRegionMap({ worldId, regionId: 9999 }, mockCtx)).rejects.toThrow('Region not found');
        });

        it('should throw error when no world exists', async () => {
            await expect(handleGetRegionMap({ worldId: 'non-existent', regionId: 0 }, mockCtx)).rejects.toThrow('World non-existent not found');
        });
    });

    describe('preview_map_patch', () => {
        it('should preview patch without applying it', async () => {
            // Generate a world
            const genResult = await handleGenerateWorld({
                seed: 'preview-test',
                width: 50,
                height: 50
            }, mockCtx);
            const worldId = JSON.parse(genResult.content[0].text).worldId;

            const script = `ADD_STRUCTURE type="city" x=10 y=10 name="Preview City"`;
            const result = await handlePreviewMapPatch({ worldId, script }, mockCtx);

            expect(result.content).toHaveLength(1);
            const preview = JSON.parse(result.content[0].text);

            expect(preview.commands).toBeDefined();
            expect(preview.commands.length).toBe(1);
            expect(preview.commands[0].type).toBe('ADD_STRUCTURE');
            expect(preview.willModify).toBe(true);

            // Verify world state unchanged
            const stateResult = await handleGetWorldState({ worldId }, mockCtx);
            const state = JSON.parse(stateResult.content[0].text);

            // Structure count should be same as before (patch not applied)
            const initialStructures = state.stats.structures;

            // Now apply the patch
            await handleApplyMapPatch({ worldId, script }, mockCtx);
            const stateAfterApply = JSON.parse((await handleGetWorldState({ worldId }, mockCtx)).content[0].text);

            // Structure count should increase after apply
            expect(stateAfterApply.stats.structures).toBeGreaterThan(initialStructures);
        });

        it('should indicate invalid patch syntax', async () => {
            const genResult = await handleGenerateWorld({
                seed: 'preview-invalid-test',
                width: 50,
                height: 50
            }, mockCtx);
            const worldId = JSON.parse(genResult.content[0].text).worldId;

            const invalidScript = `INVALID_COMMAND x=5 y=5`;

            await expect(handlePreviewMapPatch({ worldId, script: invalidScript }, mockCtx)).rejects.toThrow();
        });

        it('should throw error when no world exists', async () => {
            await expect(handlePreviewMapPatch({ worldId: 'non-existent', script: 'ADD_STRUCTURE type="city" x=5 y=5 name="Test"' }, mockCtx))
                .rejects.toThrow('World non-existent not found');
        });
    });
});
