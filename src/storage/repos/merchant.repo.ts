import Database from 'better-sqlite3';
import { Merchant, MerchantSchema } from '../../schema/merchant.js';

export class MerchantRepository {
    constructor(private db: Database.Database) {
        this.initTable();
    }

    private initTable(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS merchants (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                disposition INTEGER NOT NULL,
                inventory TEXT NOT NULL,
                location TEXT,
                last_restock TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        `);
    }

    create(merchant: Merchant): { success: boolean; error?: string } {
        try {
            const validMerchant = MerchantSchema.parse(merchant);
            const stmt = this.db.prepare(`
                INSERT INTO merchants (id, name, type, disposition, inventory, location, last_restock, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            stmt.run(
                validMerchant.id,
                validMerchant.name,
                validMerchant.type,
                validMerchant.disposition,
                JSON.stringify(validMerchant.inventory),
                validMerchant.location || null,
                validMerchant.lastRestock || null,
                validMerchant.createdAt,
                validMerchant.updatedAt
            );

            return { success: true };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }

    findById(id: string): { success: boolean; data?: Merchant; error?: string } {
        try {
            const stmt = this.db.prepare('SELECT * FROM merchants WHERE id = ?');
            const row = stmt.get(id) as any;

            if (!row) {
                return { success: false, error: 'Merchant not found' };
            }

            const merchant: Merchant = {
                id: row.id,
                name: row.name,
                type: row.type,
                disposition: row.disposition,
                inventory: JSON.parse(row.inventory),
                location: row.location,
                lastRestock: row.last_restock,
                createdAt: row.created_at,
                updatedAt: row.updated_at
            };

            return { success: true, data: MerchantSchema.parse(merchant) };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }

    findAll(): { success: boolean; data?: Merchant[]; error?: string } {
        try {
            const stmt = this.db.prepare('SELECT * FROM merchants ORDER BY name');
            const rows = stmt.all() as any[];

            const merchants: Merchant[] = rows.map(row => ({
                id: row.id,
                name: row.name,
                type: row.type,
                disposition: row.disposition,
                inventory: JSON.parse(row.inventory),
                location: row.location,
                lastRestock: row.last_restock,
                createdAt: row.created_at,
                updatedAt: row.updated_at
            }));

            return { success: true, data: merchants.map(m => MerchantSchema.parse(m)) };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }

    update(id: string, updates: Partial<Merchant>): { success: boolean; data?: Merchant; error?: string } {
        try {
            const existing = this.findById(id);
            if (!existing.success || !existing.data) {
                return { success: false, error: existing.error };
            }

            const updatedMerchant = { ...existing.data, ...updates, updatedAt: new Date().toISOString() };
            const validMerchant = MerchantSchema.parse(updatedMerchant);

            const stmt = this.db.prepare(`
                UPDATE merchants
                SET name = ?, type = ?, disposition = ?, inventory = ?, location = ?,
                    last_restock = ?, updated_at = ?
                WHERE id = ?
            `);

            stmt.run(
                validMerchant.name,
                validMerchant.type,
                validMerchant.disposition,
                JSON.stringify(validMerchant.inventory),
                validMerchant.location || null,
                validMerchant.lastRestock || null,
                validMerchant.updatedAt,
                id
            );

            return { success: true, data: validMerchant };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }

    delete(id: string): { success: boolean; error?: string } {
        try {
            const stmt = this.db.prepare('DELETE FROM merchants WHERE id = ?');
            const result = stmt.run(id);

            if (result.changes === 0) {
                return { success: false, error: 'Merchant not found' };
            }

            return { success: true };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }

    findByLocation(location: string): { success: boolean; data?: Merchant[]; error?: string } {
        try {
            const stmt = this.db.prepare('SELECT * FROM merchants WHERE location = ?');
            const rows = stmt.all(location) as any[];

            const merchants: Merchant[] = rows.map(row => ({
                id: row.id,
                name: row.name,
                type: row.type,
                disposition: row.disposition,
                inventory: JSON.parse(row.inventory),
                location: row.location,
                lastRestock: row.last_restock,
                createdAt: row.created_at,
                updatedAt: row.updated_at
            }));

            return { success: true, data: merchants.map(m => MerchantSchema.parse(m)) };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }
}