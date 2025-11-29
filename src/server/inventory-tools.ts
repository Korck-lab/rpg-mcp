import { z } from 'zod';
import { randomUUID } from 'crypto';
import { ItemRepository } from '../storage/repos/item.repo';
import { InventoryRepository } from '../storage/repos/inventory.repo';
import { ItemSchema } from '../schema/inventory';
import { getDb } from '../storage';
import { SessionContext } from './types';

function ensureDb() {
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
    const itemRepo = new ItemRepository(db);
    const inventoryRepo = new InventoryRepository(db);
    return { itemRepo, inventoryRepo };
}

export const InventoryTools = {
    CREATE_ITEM_TEMPLATE: {
        name: 'create_item_template',
        description: 'Define a new type of item (e.g., "Iron Sword").',
        inputSchema: ItemSchema.omit({ id: true, createdAt: true, updatedAt: true })
    },
    GIVE_ITEM: {
        name: 'give_item',
        description: 'Add an item to a character\'s inventory.',
        inputSchema: z.object({
            characterId: z.string(),
            itemId: z.string(),
            quantity: z.number().int().min(1).default(1)
        })
    },
    REMOVE_ITEM: {
        name: 'remove_item',
        description: 'Remove an item from a character\'s inventory.',
        inputSchema: z.object({
            characterId: z.string(),
            itemId: z.string(),
            quantity: z.number().int().min(1).default(1)
        })
    },
    EQUIP_ITEM: {
        name: 'equip_item',
        description: 'Equip an item in a specific slot.',
        inputSchema: z.object({
            characterId: z.string(),
            itemId: z.string(),
            slot: z.enum(['mainhand', 'offhand', 'armor', 'head', 'feet', 'accessory'])
        })
    },
    UNEQUIP_ITEM: {
        name: 'unequip_item',
        description: 'Unequip an item.',
        inputSchema: z.object({
            characterId: z.string(),
            itemId: z.string()
        })
    },
    GET_INVENTORY: {
        name: 'get_inventory',
        description: 'List all items in a character\'s inventory.',
        inputSchema: z.object({
            characterId: z.string()
        })
    }
} as const;

export async function handleCreateItemTemplate(args: unknown, _ctx: SessionContext) {
    const { itemRepo } = ensureDb();
    const parsed = InventoryTools.CREATE_ITEM_TEMPLATE.inputSchema.parse(args);

    const now = new Date().toISOString();
    const item = {
        ...parsed,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now
    };

    itemRepo.create(item);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify(item, null, 2)
        }]
    };
}

export async function handleGiveItem(args: unknown, _ctx: SessionContext) {
    const { inventoryRepo } = ensureDb();
    const parsed = InventoryTools.GIVE_ITEM.inputSchema.parse(args);

    inventoryRepo.addItem(parsed.characterId, parsed.itemId, parsed.quantity);

    return {
        content: [{
            type: 'text' as const,
            text: `Added ${parsed.quantity} of item ${parsed.itemId} to character ${parsed.characterId}`
        }]
    };
}

export async function handleRemoveItem(args: unknown, _ctx: SessionContext) {
    const { inventoryRepo } = ensureDb();
    const parsed = InventoryTools.REMOVE_ITEM.inputSchema.parse(args);

    const success = inventoryRepo.removeItem(parsed.characterId, parsed.itemId, parsed.quantity);

    if (!success) {
        throw new Error(`Failed to remove item. Character may not have enough quantity.`);
    }

    return {
        content: [{
            type: 'text' as const,
            text: `Removed ${parsed.quantity} of item ${parsed.itemId} from character ${parsed.characterId}`
        }]
    };
}

export async function handleEquipItem(args: unknown, _ctx: SessionContext) {
    const { inventoryRepo } = ensureDb();
    const parsed = InventoryTools.EQUIP_ITEM.inputSchema.parse(args);

    // Verify ownership first
    const inventory = inventoryRepo.getInventory(parsed.characterId);
    const hasItem = inventory.items.some(i => i.itemId === parsed.itemId && i.quantity > 0);

    if (!hasItem) {
        throw new Error(`Character does not own item ${parsed.itemId}`);
    }

    inventoryRepo.equipItem(parsed.characterId, parsed.itemId, parsed.slot);

    return {
        content: [{
            type: 'text' as const,
            text: `Equipped item ${parsed.itemId} in slot ${parsed.slot}`
        }]
    };
}

export async function handleUnequipItem(args: unknown, _ctx: SessionContext) {
    const { inventoryRepo } = ensureDb();
    const parsed = InventoryTools.UNEQUIP_ITEM.inputSchema.parse(args);

    inventoryRepo.unequipItem(parsed.characterId, parsed.itemId);

    return {
        content: [{
            type: 'text' as const,
            text: `Unequipped item ${parsed.itemId}`
        }]
    };
}

export async function handleGetInventory(args: unknown, _ctx: SessionContext) {
    const { inventoryRepo } = ensureDb();
    const parsed = InventoryTools.GET_INVENTORY.inputSchema.parse(args);

    const inventory = inventoryRepo.getInventory(parsed.characterId);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify(inventory, null, 2)
        }]
    };
}
