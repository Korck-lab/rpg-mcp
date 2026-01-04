import { describe, it, expect } from 'vitest';
import { EncounterSchema, TokenSchema } from '../../src/schema/encounter';
import { FIXED_TIMESTAMP } from '../fixtures';

describe('TokenSchema', () => {
    it('should validate a valid token', () => {
        const validToken = {
            id: 'token-1',
            encounterId: 'enc-1',
            characterId: 'char-1',
            name: 'Hero',
            initiativeBonus: 2,
            initiative: 15,
            isEnemy: false,
            hp: 20,
            maxHp: 20,
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
        };

        const result = TokenSchema.safeParse(validToken);
        expect(result.success).toBe(true);
    });
});

describe('EncounterSchema', () => {
    it('should validate a complete encounter', () => {
        const validEncounter = {
            id: 'enc-1',
            worldId: 'world-1',
            regionId: 'region-1',
            tokens: [
                {
                    id: 'token-1',
                    encounterId: 'enc-1',
                    characterId: 'char-1',
                    name: 'Hero',
                    initiativeBonus: 2,
                    initiative: 15,
                    isEnemy: false,
                    hp: 20,
                    maxHp: 20,
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
            activeTokenId: 'token-1',
            status: 'active',
            createdAt: FIXED_TIMESTAMP,
            updatedAt: FIXED_TIMESTAMP,
        };

        const result = EncounterSchema.safeParse(validEncounter);
        expect(result.success).toBe(true);
    });
});
