import Database from 'better-sqlite3';
import { Inventory, InventoryItem, InventorySchema } from '../../schema/inventory';

export class InventoryRepository {
    constructor(private db: Database.Database) { }

    getInventory(characterId: string): Inventory {
        const stmt = this.db.prepare(`
            SELECT i.*, ii.quantity, ii.equipped, ii.slot
            FROM inventory_items ii
            JOIN items i ON ii.item_id = i.id
            WHERE ii.character_id = ?
        `);

        const rows = stmt.all(characterId) as InventoryRow[];

        const items: InventoryItem[] = rows.map(row => ({
            itemId: row.id,
            quantity: row.quantity,
            equipped: Boolean(row.equipped),
            slot: row.slot || undefined
        }));

        // Note: Capacity and currency would typically be stored on the character or a separate table.
        // For now, we'll use defaults or mock values as they aren't in the schema yet.
        // In a real implementation, we'd likely join with the characters table or an inventory_metadata table.
        return InventorySchema.parse({
            characterId,
            items,
            capacity: 100, // Default
            currency: { gold: 0, silver: 0, copper: 0 } // Default
        });
    }

    addItem(characterId: string, itemId: string, quantity: number = 1): void {
        const stmt = this.db.prepare(`
            INSERT INTO inventory_items (character_id, item_id, quantity)
            VALUES (?, ?, ?)
            ON CONFLICT(character_id, item_id) DO UPDATE SET
            quantity = quantity + excluded.quantity
        `);
        stmt.run(characterId, itemId, quantity);
    }

    removeItem(characterId: string, itemId: string, quantity: number = 1): boolean {
        const getStmt = this.db.prepare('SELECT quantity FROM inventory_items WHERE character_id = ? AND item_id = ?');
        const row = getStmt.get(characterId, itemId) as { quantity: number } | undefined;

        if (!row || row.quantity < quantity) return false;

        if (row.quantity === quantity) {
            const delStmt = this.db.prepare('DELETE FROM inventory_items WHERE character_id = ? AND item_id = ?');
            delStmt.run(characterId, itemId);
        } else {
            const updateStmt = this.db.prepare('UPDATE inventory_items SET quantity = quantity - ? WHERE character_id = ? AND item_id = ?');
            updateStmt.run(quantity, characterId, itemId);
        }
        return true;
    }

    equipItem(characterId: string, itemId: string, slot: string): void {
        // First, unequip anything in that slot
        const unequipStmt = this.db.prepare('UPDATE inventory_items SET equipped = 0, slot = NULL WHERE character_id = ? AND slot = ?');
        unequipStmt.run(characterId, slot);

        // Then equip the new item
        const equipStmt = this.db.prepare('UPDATE inventory_items SET equipped = 1, slot = ? WHERE character_id = ? AND item_id = ?');
        equipStmt.run(slot, characterId, itemId);
    }

    unequipItem(characterId: string, itemId: string): void {
        const stmt = this.db.prepare('UPDATE inventory_items SET equipped = 0, slot = NULL WHERE character_id = ? AND item_id = ?');
        stmt.run(characterId, itemId);
    }
}

interface InventoryRow {
    id: string;
    name: string;
    type: string;
    weight: number;
    value: number;
    quantity: number;
    equipped: number;
    slot: string | null;
}
