import Database from 'better-sqlite3';

/**
 * Standard result type for repository operations.
 * All repository methods return this structure for consistent error handling.
 */
export interface RepositoryResult<T> {
    success: boolean;
    data?: T;
    error?: string;
}

/**
 * Error codes for repository operations.
 * Used by RepositoryError for categorizing failures.
 */
export enum RepositoryErrorCode {
    /** Entity with the specified ID was not found */
    NOT_FOUND = 'NOT_FOUND',
    /** Entity already exists (duplicate key violation) */
    ALREADY_EXISTS = 'ALREADY_EXISTS',
    /** Data validation failed */
    VALIDATION_ERROR = 'VALIDATION_ERROR',
    /** Foreign key constraint violation */
    CONSTRAINT_VIOLATION = 'CONSTRAINT_VIOLATION',
    /** Database connection or query error */
    DATABASE_ERROR = 'DATABASE_ERROR',
    /** Transaction failed */
    TRANSACTION_ERROR = 'TRANSACTION_ERROR',
    /** Generic unknown error */
    UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Custom error class for repository operations.
 * Provides structured error information including error codes and optional details.
 */
export class RepositoryError extends Error {
    public readonly code: RepositoryErrorCode;
    public readonly details?: Record<string, unknown>;

    constructor(
        message: string,
        code: RepositoryErrorCode,
        details?: Record<string, unknown>
    ) {
        super(message);
        this.name = 'RepositoryError';
        this.code = code;
        this.details = details;

        // Maintain proper stack trace in V8 environments
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, RepositoryError);
        }
    }

    /**
     * Create a standardized error for entity not found scenarios.
     */
    static notFound(entityType: string, id: string): RepositoryError {
        return new RepositoryError(
            `${entityType} with id '${id}' not found`,
            RepositoryErrorCode.NOT_FOUND,
            { entityType, id }
        );
    }

    /**
     * Create a standardized error for duplicate entity scenarios.
     */
    static alreadyExists(entityType: string, id: string): RepositoryError {
        return new RepositoryError(
            `${entityType} with id '${id}' already exists`,
            RepositoryErrorCode.ALREADY_EXISTS,
            { entityType, id }
        );
    }

    /**
     * Create a standardized error for validation failures.
     */
    static validationError(message: string, details?: Record<string, unknown>): RepositoryError {
        return new RepositoryError(
            message,
            RepositoryErrorCode.VALIDATION_ERROR,
            details
        );
    }

    /**
     * Create a standardized error from a database error.
     */
    static fromDatabaseError(error: Error, operation: string): RepositoryError {
        const message = error.message || 'Unknown database error';

        // Detect constraint violations
        if (message.includes('UNIQUE constraint failed') || message.includes('SQLITE_CONSTRAINT_UNIQUE')) {
            return new RepositoryError(
                `Duplicate entry: ${message}`,
                RepositoryErrorCode.ALREADY_EXISTS,
                { operation, originalMessage: message }
            );
        }

        if (message.includes('FOREIGN KEY constraint failed') || message.includes('SQLITE_CONSTRAINT_FOREIGNKEY')) {
            return new RepositoryError(
                `Foreign key constraint violation: ${message}`,
                RepositoryErrorCode.CONSTRAINT_VIOLATION,
                { operation, originalMessage: message }
            );
        }

        return new RepositoryError(
            `Database error during ${operation}: ${message}`,
            RepositoryErrorCode.DATABASE_ERROR,
            { operation, originalMessage: message }
        );
    }
}

/**
 * Options for query logging.
 */
export interface QueryLogOptions {
    /** Enable query logging (default: false in production, true in development) */
    enabled?: boolean;
    /** Custom logger function (defaults to console.error for stderr) */
    logger?: (message: string) => void;
    /** Include query parameters in logs (may contain sensitive data) */
    includeParams?: boolean;
    /** Include query timing information */
    includeTiming?: boolean;
}

/**
 * Configuration options for BaseRepository.
 */
export interface BaseRepositoryOptions {
    /** Query logging configuration */
    queryLogging?: QueryLogOptions;
}

/**
 * Abstract base repository class providing common CRUD operations
 * and database interaction patterns.
 * 
 * All domain repositories should extend this class to ensure
 * consistent error handling, transaction support, and logging.
 * 
 * @template T - The entity type this repository manages
 * @template TRow - The database row type (internal use)
 * 
 * @example
 * ```typescript
 * class ItemRepository extends BaseRepository<Item> {
 *   constructor(db: Database.Database) {
 *     super(db, 'items');
 *   }
 * 
 *   protected toEntity(row: unknown): Item {
 *     const r = row as ItemRow;
 *     return ItemSchema.parse({
 *       id: r.id,
 *       name: r.name,
 *       // ... map other fields
 *     });
 *   }
 * 
 *   protected toRow(entity: Partial<Item>): Record<string, unknown> {
 *     return {
 *       id: entity.id,
 *       name: entity.name,
 *       // ... map other fields
 *     };
 *   }
 * }
 * ```
 */
export abstract class BaseRepository<T extends { id: string }> {
    protected readonly db: Database.Database;
    protected readonly tableName: string;
    protected readonly entityName: string;
    private readonly queryLogging: Required<QueryLogOptions>;

    constructor(
        db: Database.Database,
        tableName: string,
        options?: BaseRepositoryOptions
    ) {
        this.db = db;
        this.tableName = tableName;
        // Derive entity name from table name (e.g., 'characters' -> 'Character')
        this.entityName = tableName.charAt(0).toUpperCase() +
            tableName.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase()).replace(/s$/, '');

        // Configure query logging
        const isDev = process.env.NODE_ENV !== 'production';
        this.queryLogging = {
            enabled: options?.queryLogging?.enabled ?? isDev,
            logger: options?.queryLogging?.logger ?? ((msg: string) => console.error(msg)),
            includeParams: options?.queryLogging?.includeParams ?? false,
            includeTiming: options?.queryLogging?.includeTiming ?? true,
        };
    }

    // ============================================================
    // ABSTRACT METHODS - Must be implemented by subclasses
    // ============================================================

    /**
     * Convert a database row to an entity object.
     * Subclasses must implement this to handle their specific schema mapping.
     * 
     * @param row - The raw database row
     * @returns The typed entity object
     */
    protected abstract toEntity(row: unknown): T;

    /**
     * Convert an entity object to a database row format.
     * Subclasses must implement this to handle their specific schema mapping.
     * 
     * @param entity - The entity to convert (may be partial for updates)
     * @returns Object with column names as keys and values for the database
     */
    protected abstract toRow(entity: Partial<T>): Record<string, unknown>;

    // ============================================================
    // PROTECTED QUERY METHODS - For subclass use
    // ============================================================

    /**
     * Execute a SELECT query returning multiple rows.
     * 
     * @param sql - The SQL query string
     * @param params - Optional query parameters
     * @returns Array of typed results
     */
    protected query<R = T>(sql: string, params?: unknown[]): R[] {
        const startTime = this.queryLogging.includeTiming ? performance.now() : 0;

        try {
            this.logQuery(sql, params);
            const stmt = this.db.prepare(sql);
            const rows = params ? stmt.all(...params) : stmt.all();
            this.logQueryComplete(startTime, rows.length);
            return rows as R[];
        } catch (error) {
            this.logQueryError(sql, error as Error);
            throw RepositoryError.fromDatabaseError(error as Error, 'query');
        }
    }

    /**
     * Execute a SELECT query returning a single row or null.
     * 
     * @param sql - The SQL query string
     * @param params - Optional query parameters
     * @returns The typed result or null if not found
     */
    protected queryOne<R = T>(sql: string, params?: unknown[]): R | null {
        const startTime = this.queryLogging.includeTiming ? performance.now() : 0;

        try {
            this.logQuery(sql, params);
            const stmt = this.db.prepare(sql);
            const row = params ? stmt.get(...params) : stmt.get();
            this.logQueryComplete(startTime, row ? 1 : 0);
            return (row as R) ?? null;
        } catch (error) {
            this.logQueryError(sql, error as Error);
            throw RepositoryError.fromDatabaseError(error as Error, 'queryOne');
        }
    }

    /**
     * Execute an INSERT, UPDATE, or DELETE statement.
     * 
     * @param sql - The SQL statement
     * @param params - Optional statement parameters
     * @returns The result containing changes count and last insert ID
     */
    protected execute(sql: string, params?: unknown[]): Database.RunResult {
        const startTime = this.queryLogging.includeTiming ? performance.now() : 0;

        try {
            this.logQuery(sql, params);
            const stmt = this.db.prepare(sql);
            const result = params ? stmt.run(...params) : stmt.run();
            this.logQueryComplete(startTime, result.changes);
            return result;
        } catch (error) {
            this.logQueryError(sql, error as Error);
            throw RepositoryError.fromDatabaseError(error as Error, 'execute');
        }
    }

    /**
     * Execute multiple statements within a transaction.
     * If any statement fails, all changes are rolled back.
     * 
     * @param fn - Function containing the transactional operations
     * @returns The result of the transaction function
     * 
     * @example
     * ```typescript
     * const result = this.transaction(() => {
     *   this.execute('INSERT INTO items ...');
     *   this.execute('UPDATE inventory ...');
     *   return { success: true };
     * });
     * ```
     */
    protected transaction<R>(fn: () => R): R {
        const startTime = this.queryLogging.includeTiming ? performance.now() : 0;
        this.logTransaction('BEGIN');

        try {
            const txn = this.db.transaction(fn);
            const result = txn();
            this.logTransaction('COMMIT', startTime);
            return result;
        } catch (error) {
            this.logTransaction('ROLLBACK', startTime);
            if (error instanceof RepositoryError) {
                throw error;
            }
            throw new RepositoryError(
                `Transaction failed: ${(error as Error).message}`,
                RepositoryErrorCode.TRANSACTION_ERROR,
                { originalMessage: (error as Error).message }
            );
        }
    }

    // ============================================================
    // PUBLIC CRUD OPERATIONS
    // ============================================================

    /**
     * Find an entity by its ID.
     * 
     * @param id - The entity ID
     * @returns Repository result with the entity or error
     */
    findById(id: string): RepositoryResult<T> {
        try {
            const row = this.queryOne(`SELECT * FROM ${this.tableName} WHERE id = ?`, [id]);

            if (!row) {
                return {
                    success: false,
                    error: `${this.entityName} with id '${id}' not found`,
                };
            }

            return {
                success: true,
                data: this.toEntity(row),
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Find all entities with optional pagination.
     * 
     * @param limit - Maximum number of results (default: 100)
     * @param offset - Number of results to skip (default: 0)
     * @returns Repository result with array of entities
     */
    findAll(limit: number = 100, offset: number = 0): RepositoryResult<T[]> {
        try {
            const rows = this.query(
                `SELECT * FROM ${this.tableName} LIMIT ? OFFSET ?`,
                [limit, offset]
            );

            return {
                success: true,
                data: rows.map(row => this.toEntity(row)),
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Count total entities in the table.
     * 
     * @returns Repository result with count
     */
    count(): RepositoryResult<number> {
        try {
            const result = this.queryOne<{ count: number }>(
                `SELECT COUNT(*) as count FROM ${this.tableName}`
            );

            return {
                success: true,
                data: result?.count ?? 0,
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Insert a new entity.
     * Subclasses may override this for custom insert logic.
     * 
     * @param entity - The entity to insert
     * @returns Repository result with the inserted entity
     */
    insert(entity: T): RepositoryResult<T> {
        try {
            const row = this.toRow(entity);
            const columns = Object.keys(row);
            const placeholders = columns.map(() => '?').join(', ');
            const values = Object.values(row);

            const sql = `INSERT INTO ${this.tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
            this.execute(sql, values);

            return {
                success: true,
                data: entity,
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Update an existing entity.
     * Only updates fields present in the updates object.
     * 
     * @param id - The entity ID
     * @param updates - Partial entity with fields to update
     * @returns Repository result with the updated entity
     */
    update(id: string, updates: Partial<T>): RepositoryResult<T> {
        try {
            // First, verify the entity exists
            const existingResult = this.findById(id);
            if (!existingResult.success || !existingResult.data) {
                return {
                    success: false,
                    error: `${this.entityName} with id '${id}' not found`,
                };
            }

            const row = this.toRow(updates);
            const columns = Object.keys(row).filter(k => k !== 'id');

            if (columns.length === 0) {
                // No fields to update
                return existingResult;
            }

            const setClause = columns.map(col => `${col} = ?`).join(', ');
            const values = columns.map(col => row[col]);
            values.push(id);

            const sql = `UPDATE ${this.tableName} SET ${setClause} WHERE id = ?`;
            this.execute(sql, values);

            // Return the updated entity
            return this.findById(id);
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Delete an entity by ID.
     * 
     * @param id - The entity ID
     * @returns Repository result indicating success/failure
     */
    delete(id: string): RepositoryResult<void> {
        try {
            const result = this.execute(
                `DELETE FROM ${this.tableName} WHERE id = ?`,
                [id]
            );

            if (result.changes === 0) {
                return {
                    success: false,
                    error: `${this.entityName} with id '${id}' not found`,
                };
            }

            return {
                success: true,
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Check if an entity exists by ID.
     * 
     * @param id - The entity ID
     * @returns Repository result with boolean indicating existence
     */
    exists(id: string): RepositoryResult<boolean> {
        try {
            const result = this.queryOne<{ count: number }>(
                `SELECT COUNT(*) as count FROM ${this.tableName} WHERE id = ?`,
                [id]
            );

            return {
                success: true,
                data: (result?.count ?? 0) > 0,
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    // ============================================================
    // PROTECTED HELPER METHODS
    // ============================================================

    /**
     * Convert any error to a RepositoryResult with error message.
     */
    protected handleError<R>(error: unknown): RepositoryResult<R> {
        if (error instanceof RepositoryError) {
            return {
                success: false,
                error: error.message,
            };
        }

        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
            success: false,
            error: message,
        };
    }

    /**
     * Wrap a value in a successful RepositoryResult.
     */
    protected success<R>(data: R): RepositoryResult<R> {
        return {
            success: true,
            data,
        };
    }

    /**
     * Create a failed RepositoryResult with error message.
     */
    protected failure<R>(error: string): RepositoryResult<R> {
        return {
            success: false,
            error,
        };
    }

    // ============================================================
    // PRIVATE LOGGING METHODS
    // ============================================================

    private logQuery(sql: string, params?: unknown[]): void {
        if (!this.queryLogging.enabled) return;

        let message = `[${this.tableName}] Query: ${sql.trim().replace(/\s+/g, ' ')}`;
        if (this.queryLogging.includeParams && params?.length) {
            message += ` | Params: ${JSON.stringify(params)}`;
        }
        this.queryLogging.logger(message);
    }

    private logQueryComplete(startTime: number, rowCount: number): void {
        if (!this.queryLogging.enabled || !this.queryLogging.includeTiming) return;

        const duration = (performance.now() - startTime).toFixed(2);
        this.queryLogging.logger(`[${this.tableName}] Query complete: ${rowCount} rows in ${duration}ms`);
    }

    private logQueryError(sql: string, error: Error): void {
        if (!this.queryLogging.enabled) return;

        this.queryLogging.logger(`[${this.tableName}] Query error: ${error.message} | SQL: ${sql.trim().replace(/\s+/g, ' ')}`);
    }

    private logTransaction(phase: 'BEGIN' | 'COMMIT' | 'ROLLBACK', startTime?: number): void {
        if (!this.queryLogging.enabled) return;

        let message = `[${this.tableName}] Transaction ${phase}`;
        if (startTime && this.queryLogging.includeTiming && phase !== 'BEGIN') {
            const duration = (performance.now() - startTime).toFixed(2);
            message += ` (${duration}ms)`;
        }
        this.queryLogging.logger(message);
    }
}
