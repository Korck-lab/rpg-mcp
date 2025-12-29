import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { initDB } from '../../src/storage/db';
import { migrate } from '../../src/storage/migrations';
import { EncounterRepository } from '../../src/storage/repos/encounter.repo';
import { RegionRepository } from '../../src/storage/repos/region.repo';
import { WorldRepository } from '../../src/storage/repos/world.repo';
import { CharacterRepository } from '../../src/storage/repos/character.repo';
import { World } from '../../src/schema/world';
import { Region } from '../../src/schema/region';
import { Encounter } from '../../src/schema/encounter';
import { Character } from '../../src/schema/character';
import { FIXED_TIMESTAMP } from '../fixtures';

const TEST_DB_PATH = 'test-encounter-repo.db';

describe('EncounterRepository', () => {
    let db: ReturnType<typeof initDB>;
    let repo: EncounterRepository;
    let regionRepo: RegionRepository;
    let worldRepo: WorldRepository;
    let characterRepo: CharacterRepository;

    beforeEach(() => {
        if (fs.existsSync(TEST_DB_PATH)) {
            fs.unlinkSync(TEST_DB_PATH);
        }
        db = initDB(TEST_DB_PATH);
        migrate(db);
        repo = new EncounterRepository(db);
        regionRepo = new RegionRepository(db);
        worldRepo = new WorldRepository(db);
        characterRepo = new CharacterRepository(db);

        const world: World = {
            id: 'world-1',
            name: 'Test World',
            seed: 'seed-1',
            width: 100,
            height: 100,
            createdAt: FIXED_TIMESTAMP,
            updatedAt: FIXED_TIMESTAMP,
        };
        worldRepo.create(world);

        const region: Region = {
            id: 'region-1',
            worldId: 'world-1',
            name: 'Test Region',
            type: 'wilderness',
            centerX: 0,
            centerY: 0,
            color: '#000',
            createdAt: FIXED_TIMESTAMP,
            updatedAt: FIXED_TIMESTAMP,
        };
        regionRepo.create(region);

        const character: Character = {
            id: 'char-1',
            name: 'Test Character',
            stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
            hp: 10,
            maxHp: 10,
            ac: 10,
            level: 1,
            xp: 0,
            characterType: 'pc',
            perceptionBonus: 0,
            stealthBonus: 0,
            characterClass: 'fighter',
            race: 'Human',
            knownSpells: [],
            preparedSpells: [],
            cantripsKnown: [],
            maxSpellLevel: 0,
            concentratingOn: null,
            conditions: [],
            resistances: [],
            vulnerabilities: [],
            immunities: [],
            currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
            currentRoomId: undefined,
            createdAt: FIXED_TIMESTAMP,
            updatedAt: FIXED_TIMESTAMP,
        };
        characterRepo.create(character);
    });

    afterEach(() => {
        db.close();
        if (fs.existsSync(TEST_DB_PATH)) {
            fs.unlinkSync(TEST_DB_PATH);
        }
    });

    it('should create and retrieve an encounter', () => {
        const encounter: Encounter = {
            id: 'enc-1',
            worldId: 'world-1',
            regionId: 'region-1',
            tokens: [
                {
                    id: 't1',
                    encounterId: 'enc-1',
                    characterId: 'char-1',
                    name: 'Hero',
                    initiativeBonus: 0,
                    initiative: 10,
                    isEnemy: false,
                    hp: 10,
                    maxHp: 10,
                    positionX: 5,
                    positionY: 5,
                    positionZ: 0,
                    movementSpeed: 30,
                    movementRemaining: 30,
                    size: 'medium',
                    hasReaction: true,
                    hasAction: true,
                    hasBonusAction: true,
                    conditions: [],
                    metadata: {}
                },
            ],
            round: 1,
            activeTokenId: 't1',
            status: 'active',
            gridMinX: 0,
            gridMaxX: 20,
            gridMinY: 0,
            gridMaxY: 20,
            createdAt: FIXED_TIMESTAMP,
            updatedAt: FIXED_TIMESTAMP,
        };

        repo.create(encounter);

        const retrieved = repo.findByRegionId('region-1');
        expect(retrieved).toHaveLength(1);
        expect(retrieved[0]).toEqual(encounter);
    });
});
