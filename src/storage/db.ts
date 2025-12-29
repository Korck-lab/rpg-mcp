import Database from 'better-sqlite3';
import { existsSync, unlinkSync } from 'fs';
import * as migrations from './migrations.js';
import {
    migrate001DatabaseArchitecture,
    rollback001DatabaseArchitecture,
} from './migrations/001-database-architecture.js';

/**
 * Migration definition interface.
 * Each migration exports { name, up, down }.
 */
interface Migration {
    name: string;
    up: (db: Database.Database) => void;
    down: (db: Database.Database) => void;
}

/**
 * Registry of all migrations in order.
 * Add new migrations to this array as they are created.
 */
const MIGRATIONS: Migration[] = [
    {
        name: '001-database-architecture',
        up: migrate001DatabaseArchitecture,
        down: rollback001DatabaseArchitecture,
    },
];

export interface DatabaseIntegrityResult {
    ok: boolean;
    errors: string[];
}

/**
 * Check database integrity using SQLite's integrity_check pragma.
 */
export function checkDatabaseIntegrity(db: Database.Database): DatabaseIntegrityResult {
    try {
        const result = db.pragma('integrity_check') as { integrity_check: string }[];
        const errors = result
            .map(row => row.integrity_check)
            .filter(msg => msg !== 'ok');

        return {
            ok: errors.length === 0,
            errors
        };
    } catch (e) {
        return {
            ok: false,
            errors: [(e as Error).message]
        };
    }
}

/**
 * Attempt to recover a corrupted database by creating a fresh one.
 * Returns true if recovery was needed and performed.
 */
function handleCorruptedDatabase(path: string, error: Error): void {
    console.error(`[Database] CRITICAL: Database corruption detected at ${path}`);
    console.error(`[Database] Error: ${error.message}`);

    // Check for WAL files
    const walPath = `${path}-wal`;
    const shmPath = `${path}-shm`;

    console.error('[Database] Attempting recovery by removing corrupted files...');

    try {
        if (existsSync(path)) {
            unlinkSync(path);
            console.error(`[Database] Removed corrupted database: ${path}`);
        }
        if (existsSync(walPath)) {
            unlinkSync(walPath);
            console.error(`[Database] Removed WAL file: ${walPath}`);
        }
        if (existsSync(shmPath)) {
            unlinkSync(shmPath);
            console.error(`[Database] Removed SHM file: ${shmPath}`);
        }
        console.error('[Database] Recovery complete. A fresh database will be created.');
    } catch (cleanupError) {
        console.error(`[Database] Failed to clean up corrupted files: ${(cleanupError as Error).message}`);
        throw new Error(`Database is corrupted and cleanup failed. Please manually delete: ${path}, ${walPath}, ${shmPath}`);
    }
}

export function initDB(path: string): Database.Database {
    console.error(`[Database] Opening database: ${path}`);

    let db: Database.Database;

    try {
        db = new Database(path);
    } catch (e) {
        const error = e as Error;
        // If we can't even open the database, it's likely corrupted
        if (error.message.includes('SQLITE_CORRUPT') || error.message.includes('malformed')) {
            handleCorruptedDatabase(path, error);
            // Try again with fresh database
            db = new Database(path);
        } else {
            throw e;
        }
    }

    // Set pragmas for performance and integrity
    // WAL mode for concurrent reads during writes (required for game state)
    db.pragma('journal_mode = WAL');
    // Foreign key enforcement for referential integrity
    db.pragma('foreign_keys = ON');
    // NORMAL synchronous: Balance between safety and performance
    // FULL would be safer but 10x slower; OFF risks corruption
    // NORMAL syncs at critical moments, safe for single-user game
    db.pragma('synchronous = NORMAL');
    // 64MB cache for improved read performance (negative = KB)
    // Default is ~2MB; 64MB handles large world/entity queries
    db.pragma('cache_size = -65536');
    // 256MB memory-mapped I/O for faster reads
    // Enables OS to handle caching, reduces syscalls
    db.pragma('mmap_size = 268435456');

    // Run integrity check on existing databases
    const integrity = checkDatabaseIntegrity(db);
    if (!integrity.ok) {
        console.error('[Database] Integrity check failed:');
        integrity.errors.forEach(err => console.error(`  - ${err}`));

        // Close the corrupted database
        db.close();

        // Handle the corruption
        handleCorruptedDatabase(path, new Error(integrity.errors.join(', ')));

        // Create fresh database with same optimizations
        db = new Database(path);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        db.pragma('synchronous = NORMAL');
        db.pragma('cache_size = -65536');
        db.pragma('mmap_size = 268435456');

        console.error('[Database] Fresh database created after corruption recovery');
    } else {
        console.error('[Database] Integrity check passed');
    }

    // Run base migration to create tables first
    migrations.migrate(db);

    // Then run versioned migrations
    runMigrations(db);

    return db;
}

/**
 * Create the _migrations table to track applied migrations.
 */
function ensureMigrationsTable(db: Database.Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    `);
}

/**
 * Check if a migration has been applied.
 */
function isMigrationApplied(db: Database.Database, name: string): boolean {
    const result = db.prepare('SELECT 1 FROM _migrations WHERE name = ?').get(name);
    return result !== undefined;
}

/**
 * Record a migration as applied.
 */
function recordMigration(db: Database.Database, name: string): void {
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(name);
}

/**
 * Run all pending migrations in order.
 * Migrations are tracked in the _migrations table.
 */
export function runMigrations(db: Database.Database): void {
    console.error('[Database] Checking for pending migrations...');

    // Ensure the migrations tracking table exists
    ensureMigrationsTable(db);

    let appliedCount = 0;

    for (const migration of MIGRATIONS) {
        if (isMigrationApplied(db, migration.name)) {
            console.error(`[Database] Migration already applied: ${migration.name}`);
            continue;
        }

        console.error(`[Database] Applying migration: ${migration.name}`);
        try {
            // Run the migration in a transaction for atomicity
            db.transaction(() => {
                migration.up(db);
                recordMigration(db, migration.name);
            })();
            console.error(`[Database] Migration applied successfully: ${migration.name}`);
            appliedCount++;
        } catch (e) {
            const error = e as Error;
            console.error(`[Database] Migration failed: ${migration.name}`);
            console.error(`[Database] Error: ${error.message}`);
            throw new Error(`Migration ${migration.name} failed: ${error.message}`);
        }
    }

    if (appliedCount === 0) {
        console.error('[Database] All migrations are up to date');
    } else {
        console.error(`[Database] Applied ${appliedCount} migration(s)`);
    }
}
