import { z } from 'zod';

export const ItemSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    type: z.enum(['weapon', 'armor', 'consumable', 'quest', 'misc']),
    weight: z.number().min(0).default(0),
    value: z.number().min(0).default(0),
    properties: z.record(z.any()).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
});

export const InventoryItemSchema = z.object({
    itemId: z.string(),
    quantity: z.number().int().min(1),
    equipped: z.boolean().default(false),
    slot: z.string().optional() // 'mainhand', 'offhand', 'armor', etc.
});

export const InventorySchema = z.object({
    characterId: z.string(),
    items: z.array(InventoryItemSchema),
    capacity: z.number().default(100), // Weight limit
    currency: z.object({
        gold: z.number().int().min(0).default(0),
        silver: z.number().int().min(0).default(0),
        copper: z.number().int().min(0).default(0)
    }).default({})
});

export type Item = z.infer<typeof ItemSchema>;
export type InventoryItem = z.infer<typeof InventoryItemSchema>;
export type Inventory = z.infer<typeof InventorySchema>;
