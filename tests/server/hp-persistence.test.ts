import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    handleCreateEncounter,
    handleExecuteCombatAction,
    handleEndEncounter,
    handleGetEncounterState,
    handleAdvanceTurn,
    handleAddToken,
    handleRollInitiative,
    clearCombatState
} from '../../src/server/combat-tools';
import {
    handleCreateCharacter,
    handleGetCharacter,
    handleCreateWorld
} from '../../src/server/crud-tools';
import { closeDb, initDB } from '../../src/storage';

const mockCtx = { sessionId: 'test-session' };

// Helper to extract JSON from formatted response
function extractJson(text: string, tag: string): any {
    const regex = new RegExp(`<!-- ${tag}_JSON\\n([\\s\\S]*?)\\n${tag}_JSON -->`);
    const match = text.match(regex);
    if (match) return JSON.parse(match[1]);
    return JSON.parse(text);
}

let testWorldId: string;

/**
 * CRIT-001: HP Desynchronization After Combat
 *
 * Player Experience:
 * I created a character with 50 HP. Entered combat, took 20 damage (now at 30 HP).
 * Combat ended. Later I checked my character and they're back at 50 HP.
 * I basically can't die because damage doesn't persist.
 *
 * Root Cause:
 * Combat encounter has its own participant state that includes HP, but this HP
 * isn't synced back to the character table when the encounter ends.
 */
describe('CRIT-001: HP Persistence After Combat', () => {
    beforeEach(async () => {
        closeDb();
        initDB(':memory:');
        clearCombatState();
        
        // Create a world for encounters
        const worldResult = await handleCreateWorld({
            name: 'HP Test World',
            seed: 'hp-test',
            width: 50,
            height: 50
        }, mockCtx);
        const world = extractJson(worldResult.content[0].text, 'WORLD');
        testWorldId = world.id;
    });

    afterEach(() => {
        closeDb();
    });

    // Helper to create encounter with tokens
    async function createEncounterWithTokens(seed: string, tokens: Array<{
        id: string;
        characterId: string;
        name: string;
        hp: number;
        maxHp: number;
        ac: number;
        initiativeBonus: number;
        isEnemy: boolean;
        x: number;
        y: number;
    }>): Promise<{ encounterId: string; tokenIds: Map<string, string> }> {
        // Create empty encounter
        const encounterResult = await handleCreateEncounter({
            worldId: testWorldId,
            seed
        }, mockCtx);
        const encounterData = extractJson(encounterResult.content[0].text, 'STATE');
        const encounterId = encounterData.encounter?.id || encounterData.encounterId;
        
        // Add tokens and track their IDs
        const tokenIds = new Map<string, string>();
        for (const token of tokens) {
            const tokenResult = await handleAddToken({
                encounterId,
                name: token.name,
                hp: token.hp,
                maxHp: token.maxHp,
                ac: token.ac,
                initiativeBonus: token.initiativeBonus,
                isEnemy: token.isEnemy,
                positionX: token.x,
                positionY: token.y,
                characterId: token.characterId
            }, mockCtx);
            const tokenData = extractJson(tokenResult.content[0].text, 'STATE');
            const actualTokenId = tokenData.token?.id || tokenData.id;
            tokenIds.set(token.id, actualTokenId);
        }
        
        // Roll initiative
        await handleRollInitiative({ encounterId }, mockCtx);
        
        return { encounterId, tokenIds };
    }

    it('should persist HP changes after encounter ends', async () => {
        // 1. Create a character with 50 HP
        const charResult = await handleCreateCharacter({
            name: 'Test Hero',
            stats: { str: 16, dex: 14, con: 15, int: 10, wis: 12, cha: 8 },
            hp: 50,
            maxHp: 50,
            ac: 16,
            level: 3
        }, mockCtx);
        const charData = extractJson(charResult.content[0].text, 'CHARACTER');
        const character = charData.character || charData;
        expect(character.hp).toBe(50);

        // 2. Create an encounter with this character and an enemy
        const { encounterId, tokenIds } = await createEncounterWithTokens('hp-persistence-test', [
            {
                id: 'hero',
                characterId: character.id,
                name: character.name,
                hp: character.hp,
                maxHp: character.maxHp,
                ac: 16,
                initiativeBonus: 2,
                isEnemy: false,
                x: 5,
                y: 5
            },
            {
                id: 'goblin',
                characterId: 'enemy-goblin',
                name: 'Goblin',
                hp: 10,
                maxHp: 10,
                ac: 13,
                initiativeBonus: 1,
                isEnemy: true,
                x: 7,
                y: 5
            }
        ]);

        const heroTokenId = tokenIds.get('hero')!;
        const goblinTokenId = tokenIds.get('goblin')!;

        // 3. Execute an attack that deals damage to the character
        const attackResult = await handleExecuteCombatAction({
            encounterId,
            action: 'attack',
            actorId: goblinTokenId,
            targetId: heroTokenId,
            attackBonus: 20,  // Very high bonus to guarantee hit
            dc: 10,          // Low DC to ensure hit
            damage: 20       // Base damage (may be doubled on crit)
        }, mockCtx);

        // Verify the attack hit
        const attackText = attackResult.content[0].text;
        expect(attackText).toContain('HIT');

        // 4. Verify HP changed in encounter state
        const stateResponse = await handleGetEncounterState({ encounterId }, mockCtx);
        const stateResult = extractJson(stateResponse.content[0].text, 'STATE');
        const heroInEncounter = stateResult.tokens?.find(
            (p: any) => p.character_id === heroTokenId || p.id === heroTokenId
        );

        expect(heroInEncounter).toBeDefined();
        // HP should be less than 50 (took damage)
        expect(heroInEncounter.hp).toBeLessThan(50);
        const hpAfterCombat = heroInEncounter.hp;

        // 5. End the encounter
        await handleEndEncounter({ encounterId }, mockCtx);

        // 6. CRITICAL TEST: Check if HP persisted back to character record
        const reloadedResult = await handleGetCharacter({ id: character.id }, mockCtx);
        const reloadedData = extractJson(reloadedResult.content[0].text, 'CHARACTER');
        const reloadedCharacter = reloadedData.character || reloadedData;

        // HP in character record should match the HP at end of combat
        expect(reloadedCharacter.hp).toBe(hpAfterCombat);
    });

    it('should persist HP changes for multiple characters', async () => {
        // Create two characters
        const hero1Result = await handleCreateCharacter({
            name: 'Fighter',
            stats: { str: 16, dex: 14, con: 15, int: 10, wis: 12, cha: 8 },
            hp: 40,
            maxHp: 40,
            ac: 18,
            level: 3
        }, mockCtx);
        const hero1Data = extractJson(hero1Result.content[0].text, 'CHARACTER');
        const hero1 = hero1Data.character || hero1Data;

        const hero2Result = await handleCreateCharacter({
            name: 'Wizard',
            stats: { str: 8, dex: 14, con: 12, int: 18, wis: 13, cha: 10 },
            hp: 25,
            maxHp: 25,
            ac: 12,
            level: 3
        }, mockCtx);
        const hero2Data = extractJson(hero2Result.content[0].text, 'CHARACTER');
        const hero2 = hero2Data.character || hero2Data;

        // Create encounter
        const { encounterId, tokenIds } = await createEncounterWithTokens('multi-hp-test', [
            {
                id: 'hero1',
                characterId: hero1.id,
                name: hero1.name,
                hp: hero1.hp,
                maxHp: hero1.maxHp,
                ac: 18,
                initiativeBonus: 2,
                isEnemy: false,
                x: 5,
                y: 5
            },
            {
                id: 'hero2',
                characterId: hero2.id,
                name: hero2.name,
                hp: hero2.hp,
                maxHp: hero2.maxHp,
                ac: 12,
                initiativeBonus: 1,
                isEnemy: false,
                x: 5,
                y: 7
            },
            {
                id: 'orc',
                characterId: 'enemy-orc',
                name: 'Orc',
                hp: 15,
                maxHp: 15,
                ac: 13,
                initiativeBonus: 0,
                isEnemy: true,
                x: 7,
                y: 6
            }
        ]);

        const hero1TokenId = tokenIds.get('hero1')!;
        const hero2TokenId = tokenIds.get('hero2')!;
        const orcTokenId = tokenIds.get('orc')!;

        // Damage both heroes (use high bonus to guarantee hits)
        await handleExecuteCombatAction({
            encounterId,
            action: 'attack',
            actorId: orcTokenId,
            targetId: hero1TokenId,
            attackBonus: 20,
            dc: 10,
            damage: 15
        }, mockCtx);

        // Advance turn to reset action economy for the orc
        await handleAdvanceTurn({ encounterId }, mockCtx);
        await handleAdvanceTurn({ encounterId }, mockCtx);
        await handleAdvanceTurn({ encounterId }, mockCtx);

        // Attack hero2
        await handleExecuteCombatAction({
            encounterId,
            action: 'attack',
            actorId: orcTokenId,
            targetId: hero2TokenId,
            attackBonus: 20,
            dc: 10,
            damage: 10
        }, mockCtx);

        // Get HP values after combat (before ending encounter)
        const stateResponse = await handleGetEncounterState({ encounterId }, mockCtx);
        const stateResult = extractJson(stateResponse.content[0].text, 'STATE');
        const hero1InEncounter = stateResult.tokens?.find((p: any) => p.character_id === hero1TokenId || p.id === hero1TokenId);
        const hero2InEncounter = stateResult.tokens?.find((p: any) => p.character_id === hero2TokenId || p.id === hero2TokenId);

        expect(hero1InEncounter.hp).toBeLessThan(40); // Took damage
        expect(hero2InEncounter.hp).toBeLessThan(25); // Took damage

        const hp1AfterCombat = hero1InEncounter.hp;
        const hp2AfterCombat = hero2InEncounter.hp;

        // End encounter
        await handleEndEncounter({ encounterId }, mockCtx);

        // Verify both characters have updated HP that matches combat state
        const reloaded1Data = extractJson(
            (await handleGetCharacter({ id: hero1.id }, mockCtx)).content[0].text,
            'CHARACTER'
        );
        const reloaded1 = reloaded1Data.character || reloaded1Data;
        
        const reloaded2Data = extractJson(
            (await handleGetCharacter({ id: hero2.id }, mockCtx)).content[0].text,
            'CHARACTER'
        );
        const reloaded2 = reloaded2Data.character || reloaded2Data;

        expect(reloaded1.hp).toBe(hp1AfterCombat);
        expect(reloaded2.hp).toBe(hp2AfterCombat);
    });

    it('should not sync HP for enemies/NPCs that are not in character table', async () => {
        // Create a player character
        const heroResult = await handleCreateCharacter({
            name: 'Hero',
            stats: { str: 14, dex: 14, con: 14, int: 14, wis: 14, cha: 14 },
            hp: 30,
            maxHp: 30,
            ac: 15,
            level: 2
        }, mockCtx);
        const heroData = extractJson(heroResult.content[0].text, 'CHARACTER');
        const hero = heroData.character || heroData;

        // Create encounter with ad-hoc enemy (not in character table)
        const { encounterId, tokenIds } = await createEncounterWithTokens('adhoc-enemy-test', [
            {
                id: 'hero',
                characterId: hero.id,
                name: hero.name,
                hp: hero.hp,
                maxHp: hero.maxHp,
                ac: 15,
                initiativeBonus: 2,
                isEnemy: false,
                x: 5,
                y: 5
            },
            {
                id: 'goblin',
                characterId: 'random-goblin-123',
                name: 'Random Goblin',
                hp: 7,
                maxHp: 7,
                ac: 13,
                initiativeBonus: 1,
                isEnemy: true,
                x: 7,
                y: 5
            }
        ]);

        const heroTokenId = tokenIds.get('hero')!;
        const goblinTokenId = tokenIds.get('goblin')!;

        // Hero takes damage (use high bonus to guarantee hit)
        await handleExecuteCombatAction({
            encounterId,
            action: 'attack',
            actorId: goblinTokenId,
            targetId: heroTokenId,
            attackBonus: 20,
            dc: 10,
            damage: 12
        }, mockCtx);

        // Get hero HP after combat
        const stateResponse = await handleGetEncounterState({ encounterId }, mockCtx);
        const stateResult = extractJson(stateResponse.content[0].text, 'STATE');
        const heroInEncounter = stateResult.tokens?.find((p: any) => p.character_id === heroTokenId || p.id === heroTokenId);
        expect(heroInEncounter.hp).toBeLessThan(30); // Took damage
        const hpAfterCombat = heroInEncounter.hp;

        // End encounter - should NOT throw error for missing enemy in DB
        await handleEndEncounter({ encounterId }, mockCtx);

        // Hero HP should be synced to match combat state
        const reloadedData = extractJson(
            (await handleGetCharacter({ id: hero.id }, mockCtx)).content[0].text,
            'CHARACTER'
        );
        const reloadedHero = reloadedData.character || reloadedData;
        expect(reloadedHero.hp).toBe(hpAfterCombat);

        // Ad-hoc enemy should not cause any errors (it's not in character table)
        // This test passes if no exception was thrown
    });
});
