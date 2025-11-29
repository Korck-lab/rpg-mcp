import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleCreateItemTemplate, handleGiveItem, handleRemoveItem, handleEquipItem, handleUnequipItem, handleGetInventory } from '../../src/server/inventory-tools';
import { handleCreateCharacter } from '../../src/server/crud-tools';
import { closeTestDb } from '../../src/server/crud-tools';

describe('Inventory System', () => {
    const mockCtx = { sessionId: 'test-session' };
    let characterId: string;
    let swordId: string;
    let shieldId: string;

    afterEach(() => {
        closeTestDb();
    });

    beforeEach(async () => {
        closeTestDb();
        // Force DB init
        const { getDb } = await import('../../src/storage');
        const db = getDb(':memory:');
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        console.log('Tables in test:', tables.map((t: any) => t.name));
    });

    it('should create item templates', async () => {
        const result = await handleCreateItemTemplate({
            name: 'Iron Sword',
            type: 'weapon',
            weight: 5,
            value: 10,
            properties: { damage: '1d8' }
        }, mockCtx);

        const item = JSON.parse(result.content[0].text);
        expect(item.name).toBe('Iron Sword');
        expect(item.id).toBeDefined();
        swordId = item.id;

        // Create a shield too
        const shieldResult = await handleCreateItemTemplate({
            name: 'Wooden Shield',
            type: 'armor',
            weight: 3,
            value: 5
        }, mockCtx);
        shieldId = JSON.parse(shieldResult.content[0].text).id;
    });

    it('should give items to character', async () => {
        // Create character first
        const charResult = await handleCreateCharacter({
            name: 'Inventory Tester',
            hp: 10,
            maxHp: 10,
            ac: 10,
            level: 1,
            stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }
        }, mockCtx);
        characterId = JSON.parse(charResult.content[0].text).id;

        // Give sword
        await handleGiveItem({
            characterId,
            itemId: swordId,
            quantity: 1
        }, mockCtx);

        // Verify inventory
        const invResult = await handleGetInventory({ characterId }, mockCtx);
        const inventory = JSON.parse(invResult.content[0].text);

        expect(inventory.items).toHaveLength(1);
        expect(inventory.items[0].itemId).toBe(swordId);
        expect(inventory.items[0].quantity).toBe(1);
    });

    it('should equip and unequip items', async () => {
        // Equip sword
        await handleEquipItem({
            characterId,
            itemId: swordId,
            slot: 'mainhand'
        }, mockCtx);

        let invResult = await handleGetInventory({ characterId }, mockCtx);
        let inventory = JSON.parse(invResult.content[0].text);
        expect(inventory.items[0].equipped).toBe(true);
        expect(inventory.items[0].slot).toBe('mainhand');

        // Unequip sword
        await handleUnequipItem({
            characterId,
            itemId: swordId
        }, mockCtx);

        invResult = await handleGetInventory({ characterId }, mockCtx);
        inventory = JSON.parse(invResult.content[0].text);
        expect(inventory.items[0].equipped).toBe(false);
        expect(inventory.items[0].slot).toBeUndefined();
    });

    it('should remove items', async () => {
        await handleRemoveItem({
            characterId,
            itemId: swordId,
            quantity: 1
        }, mockCtx);

        const invResult = await handleGetInventory({ characterId }, mockCtx);
        const inventory = JSON.parse(invResult.content[0].text);
        expect(inventory.items).toHaveLength(0);
    });

    it('should handle stacking items', async () => {
        // Give 5 potions
        const potionResult = await handleCreateItemTemplate({
            name: 'Health Potion',
            type: 'consumable',
            weight: 0.5,
            value: 5
        }, mockCtx);
        const potionId = JSON.parse(potionResult.content[0].text).id;

        await handleGiveItem({ characterId, itemId: potionId, quantity: 5 }, mockCtx);

        // Give 3 more
        await handleGiveItem({ characterId, itemId: potionId, quantity: 3 }, mockCtx);

        const invResult = await handleGetInventory({ characterId }, mockCtx);
        const inventory = JSON.parse(invResult.content[0].text);

        expect(inventory.items[0].quantity).toBe(8);
    });
});
