import Database from 'better-sqlite3';
import { Item, ItemSchema } from '../../schema/inventory.js';
import { BaseRepository, RepositoryResult } from '../base.repo.js';

export class ItemRepository extends BaseRepository<Item> {
    constructor(db: Database.Database) {
        super(db, 'items');
    }

    protected toEntity(row: unknown): Item {
        const r = row as ItemRow;
        return ItemSchema.parse({
            id: r.id,
            name: r.name,
            description: r.description || undefined,
            type: r.type,
            rarity: r.rarity || 'common',
            requiresAttunement: Boolean(r.requires_attunement),
            attunementRequirements: r.attunement_requirements || undefined,
            weight: r.weight,
            value: r.value,
            properties: r.properties ? JSON.parse(r.properties) : undefined,
            createdAt: r.created_at,
            updatedAt: r.updated_at
        });
    }

    protected toRow(entity: Partial<Item>): Record<string, unknown> {
        return {
            id: entity.id,
            name: entity.name,
            description: entity.description || null,
            type: entity.type,
            rarity: entity.rarity || 'common',
            requires_attunement: entity.requiresAttunement ? 1 : 0,
            attunement_requirements: entity.attunementRequirements || null,
            weight: entity.weight ?? 0,
            value: entity.value ?? 0,
            properties: entity.properties ? JSON.stringify(entity.properties) : null,
            created_at: entity.createdAt,
            updated_at: entity.updatedAt
        };
    }

    create(item: Item): RepositoryResult<Item> {
        return this.insert(item);
    }

    delete(id: string): RepositoryResult<void> {
        return super.delete(id);
    }

    findByName(name: string): RepositoryResult<Item[]> {
        try {
            const rows = this.query('SELECT * FROM items WHERE LOWER(name) LIKE LOWER(?)', [`%${name}%`]);
            const items = rows.map(row => this.toEntity(row));
            return { success: true, data: items };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }

    findByType(type: string): RepositoryResult<Item[]> {
        try {
            const rows = this.query('SELECT * FROM items WHERE type = ?', [type]);
            const items = rows.map(row => this.toEntity(row));
            return { success: true, data: items };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }

    search(query: { name?: string; type?: string; minValue?: number; maxValue?: number }): RepositoryResult<Item[]> {
        try {
            let sql = 'SELECT * FROM items WHERE 1=1';
            const params: unknown[] = [];

            if (query.name) {
                sql += ' AND LOWER(name) LIKE LOWER(?)';
                params.push(`%${query.name}%`);
            }
            if (query.type) {
                sql += ' AND type = ?';
                params.push(query.type);
            }
            if (query.minValue !== undefined) {
                sql += ' AND value >= ?';
                params.push(query.minValue);
            }
            if (query.maxValue !== undefined) {
                sql += ' AND value <= ?';
                params.push(query.maxValue);
            }

            const rows = this.query(sql, params);
            const items = rows.map(row => this.toEntity(row));
            return { success: true, data: items };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }


}

interface ItemRow {
    id: string;
    name: string;
    description: string | null;
    type: string;
    rarity: string | null;
    requires_attunement: number;
    attunement_requirements: string | null;
    weight: number;
    value: number;
    properties: string | null;
    created_at: string;
    updated_at: string;
}
