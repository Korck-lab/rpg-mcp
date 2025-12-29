import { z } from 'zod';

export const CombatTokenSchema = z.object({
    id: z.string(),
    encounterId: z.string(),
    characterId: z.string(),
    name: z.string(),
    initiativeBonus: z.number(),
    initiative: z.number().nullable(),
    isEnemy: z.boolean(),
    hp: z.number().int().min(0),
    maxHp: z.number().int().min(1),
    positionX: z.number().int(),
    positionY: z.number().int(),
    positionZ: z.number().int().default(0),
    movementSpeed: z.number().int().min(0),
    movementRemaining: z.number().int().min(0),
    size: z.enum(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']),
    hasReaction: z.boolean().default(true),
    hasAction: z.boolean().default(true),
    hasBonusAction: z.boolean().default(true),
    conditions: z.array(z.string()).default([]),
    metadata: z.record(z.any()).default({}),
    abilityScores: z.object({
        strength: z.number(),
        dexterity: z.number(),
        constitution: z.number(),
        intelligence: z.number(),
        wisdom: z.number(),
        charisma: z.number()
    }).optional()
});

export type CombatToken = z.infer<typeof CombatTokenSchema>;