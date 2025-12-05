import { z } from 'zod';
import { CharacterTypeSchema } from './party.js';
import {
    CharacterClassSchema,
    SubclassSchema,
    SpellSlotsSchema,
    PactMagicSlotsSchema,
    SpellcastingAbilitySchema
} from './spell.js';

export const CharacterSchema = z.object({
    id: z.string(),
    name: z.string(),
    stats: z.object({
        str: z.number().int().min(0),
        dex: z.number().int().min(0),
        con: z.number().int().min(0),
        int: z.number().int().min(0),
        wis: z.number().int().min(0),
        cha: z.number().int().min(0),
    }),
    hp: z.number().int().min(0),
    maxHp: z.number().int().min(0),
    ac: z.number().int().min(0),
    level: z.number().int().min(1),
    characterType: CharacterTypeSchema.optional().default('pc'),

    // Spellcasting fields (CRIT-002/006)
    characterClass: CharacterClassSchema.optional().default('fighter'),
    subclass: SubclassSchema.optional(),
    spellSlots: SpellSlotsSchema.optional(),
    pactMagicSlots: PactMagicSlotsSchema.optional(), // Warlock only
    knownSpells: z.array(z.string()).optional().default([]),
    preparedSpells: z.array(z.string()).optional().default([]),
    cantripsKnown: z.array(z.string()).optional().default([]),
    maxSpellLevel: z.number().int().min(0).max(9).optional().default(0),
    spellcastingAbility: SpellcastingAbilitySchema.optional(),
    spellSaveDC: z.number().int().optional(),
    spellAttackBonus: z.number().int().optional(),
    concentratingOn: z.string().nullable().optional().default(null),
    activeSpells: z.array(z.string()).optional().default([]),
    conditions: z.array(z.string()).optional().default([]),
    position: z.object({
        x: z.number(),
        y: z.number()
    }).optional(),

    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});

export type Character = z.infer<typeof CharacterSchema>;

export const NPCSchema = CharacterSchema.extend({
    factionId: z.string().optional(),
    behavior: z.string().optional(),
});

export type NPC = z.infer<typeof NPCSchema>;
