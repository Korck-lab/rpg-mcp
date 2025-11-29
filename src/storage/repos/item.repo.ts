import Database from 'better-sqlite3';
import { Item, ItemSchema } from '../../schema/inventory';

export class ItemRepository {
    constructor(private db: Database.Database) { }

    create(item: Item): void {
        const validItem = ItemSchema.parse(item);

        const stmt = this.db.prepare(`
            INSERT INTO items (id, name, description, type, weight, value, properties, created_at, updated_at)
            VALUES (@id, @name, @description, @type, @weight, @value, @properties, @createdAt, @updatedAt)
        `);

        stmt.run({
            id: validItem.id,
            name: validItem.name,
            description: validItem.description || null,
            type: validItem.type,
            weight: validItem.weight,
            value: validItem.value,
            properties: JSON.stringify(validItem.properties || {}),
            createdAt: validItem.createdAt,
            updatedAt: validItem.updatedAt
        });
    }

    findById(id: string): Item | null {
        const stmt = this.db.prepare('SELECT * FROM items WHERE id = ?');
        const row = stmt.get(id) as ItemRow | undefined;

        if (!row) return null;
        return this.rowToItem(row);
    }

    findAll(): Item[] {
        const stmt = this.db.prepare('SELECT * FROM items');
        const rows = stmt.all() as ItemRow[];
        return rows.map(row => this.rowToItem(row));
    }

    delete(id: string): void {
        const stmt = this.db.prepare('DELETE FROM items WHERE id = ?');
        stmt.run(id);
    }

    private rowToItem(row: ItemRow): Item {
        return ItemSchema.parse({
            id: row.id,
            name: row.name,
            description: row.description || undefined,
            type: row.type,
            weight: row.weight,
            value: row.value,
            properties: row.properties ? JSON.parse(row.properties) : undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        });
    }
}

interface ItemRow {
    id: string;
    name: string;
    description: string | null;
    type: string;
    weight: number;
    value: number;
    properties: string | null;
    created_at: string;
    updated_at: string;
}
