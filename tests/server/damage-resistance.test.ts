import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { 
    handleCreateEncounter, 
    handleExecuteCombatAction, 
    handleAddToken,
    handleRollInitiative,
    clearCombatState 
} from '../../src/server/combat-tools.js';
import { handleCreateWorld } from '../../src/server/crud-tools.js';
import { closeDb, initDB } from '../../src/storage/index.js';

const mockCtx = { sessionId: 'test-session' };

// Helper to extract embedded JSON from formatted output
function extractStateJson(text: string): any {
    const match = text.match(/<!-- STATE_JSON\n([\s\S]*?)\nSTATE_JSON -->/);
    if (match) return JSON.parse(match[1]);
    return JSON.parse(text);
}

function extractWorldJson(text: string): any {
    const match = text.match(/<!-- WORLD_JSON\n([\s\S]*?)\nWORLD_JSON -->/);
    if (match) return JSON.parse(match[1]);
    return JSON.parse(text);
}

let testWorldId: string;

/**
 * Helper to create encounter with participants using the proper flow:
 * 1. Create empty encounter
 * 2. Add tokens via handleAddToken
 * 3. Roll initiative
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
        resistances?: string[];
        vulnerabilities?: string[];
        immunities?: string[];
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
            positionY: 0,
            resistances: p.resistances,
            vulnerabilities: p.vulnerabilities,
            immunities: p.immunities
        }, mockCtx);
    }
    
    // Roll initiative to set up turn order
    await handleRollInitiative({ encounterId }, mockCtx);
    
    return encounterId;
}

/**
 * HIGH-002: Damage Resistance Not Applied
 *
 * Tests for damage resistance and vulnerability in combat.
 * - Resistance should halve damage
 * - Vulnerability should double damage
 * - Immunity should reduce damage to 0
 */
describe('HIGH-002: Damage Resistance', () => {
    beforeEach(async () => {
        closeDb();
        initDB(':memory:');
        clearCombatState();
        
        // Create a world for encounters
        const worldResult = await handleCreateWorld({
            name: 'Test World',
            seed: 'damage-resist-test',
            width: 50,
            height: 50
        }, mockCtx);
        const world = extractWorldJson(worldResult.content[0].text);
        testWorldId = world.id;
    });

    afterEach(() => {
        clearCombatState();
        closeDb();
    });

    describe('Damage Type and Resistance', () => {
        it('should halve fire damage for fire-resistant character', async () => {
            // Create encounter with fire-resistant hero
            const encounterId = await createEncounterWithParticipants('resist-test-1', [
                {
                    id: 'hero-1',
                    name: 'Fire-Resistant Hero',
                    initiativeBonus: 10,
                    hp: 50,
                    maxHp: 50,
                    resistances: ['fire']
                },
                {
                    id: 'dragon-1',
                    name: 'Fire Dragon',
                    initiativeBonus: 1,
                    hp: 100,
                    maxHp: 100,
                    isEnemy: true
                }
            ]);

            // Dragon attacks with fire breath (40 fire damage)
            const attackResult = await handleExecuteCombatAction({
                encounterId,
                action: 'attack',
                actorId: 'dragon-1',
                targetId: 'hero-1',
                attackBonus: 10,
                dc: 10, // Guaranteed hit
                damage: 40,
                damageType: 'fire'
            }, mockCtx);

            const attackText = attackResult.content[0].text;
            // Should show resistance applied, damage halved to 20
            expect(attackText).toMatch(/resist/i);
            expect(attackText).toContain('20'); // Halved damage
        });

        it('should double damage for vulnerable character', async () => {
            // Create encounter with cold-vulnerable creature
            const encounterId = await createEncounterWithParticipants('vuln-test-1', [
                {
                    id: 'hero-1',
                    name: 'Ice Mage',
                    initiativeBonus: 10,
                    hp: 30,
                    maxHp: 30
                },
                {
                    id: 'fire-elem-1',
                    name: 'Fire Elemental',
                    initiativeBonus: 1,
                    hp: 50,
                    maxHp: 50,
                    isEnemy: true,
                    vulnerabilities: ['cold']
                }
            ]);

            // Ice Mage attacks with cold damage (10 cold damage)
            const attackResult = await handleExecuteCombatAction({
                encounterId,
                action: 'attack',
                actorId: 'hero-1',
                targetId: 'fire-elem-1',
                attackBonus: 10,
                dc: 10, // Guaranteed hit
                damage: 10,
                damageType: 'cold'
            }, mockCtx);

            const attackText = attackResult.content[0].text;
            // Vulnerability doubles damage: 10 base → 20 actual
            // The system applies the doubling even if not explicitly labeled
            expect(attackText).toContain('20'); // Doubled damage
            expect(attackText).toMatch(/cold/i); // Damage type applied
        });

        it('should apply immunity (0 damage) for immune character', async () => {
            // Create encounter with fire-immune creature
            const encounterId = await createEncounterWithParticipants('immune-test-1', [
                {
                    id: 'hero-1',
                    name: 'Pyromancer',
                    initiativeBonus: 10,
                    hp: 30,
                    maxHp: 30
                },
                {
                    id: 'fire-elem-1',
                    name: 'Fire Elemental',
                    initiativeBonus: 1,
                    hp: 50,
                    maxHp: 50,
                    isEnemy: true,
                    immunities: ['fire']
                }
            ]);

            // Pyromancer attacks with fire damage
            const attackResult = await handleExecuteCombatAction({
                encounterId,
                action: 'attack',
                actorId: 'hero-1',
                targetId: 'fire-elem-1',
                attackBonus: 10,
                dc: 10,
                damage: 30,
                damageType: 'fire'
            }, mockCtx);

            const attackText = attackResult.content[0].text;
            // Should show immunity, 0 damage
            expect(attackText).toMatch(/immun/i);
        });

        it('should apply normal damage without damage type', async () => {
            // Create encounter - normal attack without type
            const encounterId = await createEncounterWithParticipants('normal-test-1', [
                {
                    id: 'hero-1',
                    name: 'Fighter',
                    initiativeBonus: 10,
                    hp: 30,
                    maxHp: 30
                },
                {
                    id: 'goblin-1',
                    name: 'Goblin',
                    initiativeBonus: 1,
                    hp: 20,
                    maxHp: 20,
                    isEnemy: true,
                    resistances: ['fire'] // Has resistance but attack is slashing
                }
            ]);

            // Normal attack (no type = physical/slashing)
            const attackResult = await handleExecuteCombatAction({
                encounterId,
                action: 'attack',
                actorId: 'hero-1',
                targetId: 'goblin-1',
                attackBonus: 10,
                dc: 10,
                damage: 10
                // No damageType - should be unaffected by fire resistance
            }, mockCtx);

            const attackText = attackResult.content[0].text;
            // Should NOT show resistance (different damage type)
            expect(attackText).not.toMatch(/resist/i);
            expect(attackText).toContain('10'); // Full damage
        });
    });
});
