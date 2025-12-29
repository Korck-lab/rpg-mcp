/**
 * ROOM REPOSITORY
 *
 * Manages room nodes within structures - individual spaces that players
 * can explore, containing NPCs, items, and environmental features.
 *
 * Key features:
 * - T050: Create room nodes with descriptions and lighting
 * - Query rooms by structure
 * - Update room contents and state
 *
 * @see specs/001-database-architecture/data-model.md
 * @module storage/room.repo
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { BaseRepository, RepositoryResult } from './base.repo.js';
import { canonicalStringify } from './utils/canonical-json.js';

/**
 * Valid biome contexts for rooms.
 */
export type BiomeContext = 'forest' | 'mountain' | 'urban' | 'dungeon' | 'coastal' | 'cavern' | 'divine' | 'arcane';

/**
 * Valid lighting levels for rooms.
 */
export type LightingLevel = 'bright' | 'dim' | 'dark' | 'magical';

/**
 * Represents a room node - an explorable space within a structure.
 */
export interface RoomNode {
    /** Unique room identifier (UUID) */
    id: string;
    /** Parent structure ID */
    structure_id: string;
    /** Human-readable room name */
    name: string;
    /** Room description (optional) */
    description: string | null;
    /** Biome context affecting room atmosphere */
    biome_context: string | null;
    /** Lighting level in the room */
    lighting: string;
    /** Room type classification (optional) */
    room_type: string | null;
    /** JSON-encoded array of room contents (items, NPCs, etc.) */
    contents_json: string;
    /** JSON-encoded room state (doors open/closed, traps triggered, etc.) */
    state_json: string;
    /** ISO 8601 timestamp of room creation */
    created_at: string;
}

/**
 * Database row type for room_nodes table.
 */
interface RoomNodeRow {
    id: string;
    name: string;
    base_description: string;
    biome_context: string;
    atmospherics: string;
    exits: string;
    entity_ids: string;
    created_at: string;
    updated_at: string;
    visited_count: number;
    last_visited_at: string | null;
    network_id: string | null;
    local_x: number | null;
    local_y: number | null;
}

/**
 * Repository for room node management operations.
 *
 * Room nodes represent explorable spaces within structures. They contain
 * NPCs, items, and environmental features that players interact with.
 *
 * @example
 * ```typescript
 * const repo = new RoomRepository(db);
 *
 * // Create a tavern common room
 * const result = repo.create('structure_001', {
 *   name: 'Common Room',
 *   description: 'A bustling tavern filled with patrons',
 *   biome_context: 'urban',
 *   lighting: 'dim',
 *   room_type: 'tavern',
 * });
 *
 * // Get all rooms in a structure
 * const rooms = repo.getByStructure('structure_001');
 *
 * // Update room contents
 * repo.updateContents(room.id, { npcs: ['bartender_001'], items: ['ale_keg'] });
 * ```
 */
export class RoomRepository extends BaseRepository<RoomNode> {
    constructor(db: Database.Database) {
        super(db, 'room_nodes');
    }

    /**
     * T050: Create a room node within a structure.
     *
     * Creates a room entry with:
     * - Unique UUID identifier
     * - Current timestamp
     * - Description and atmospheric data
     * - Initial empty contents and state
     *
     * @param structure_id - Parent structure ID (stored in network_id for now)
     * @param data - Room data (name, description, biome_context, lighting, etc.)
     * @returns Repository result with the created room
     */
    create(structure_id: string, data: Partial<RoomNode>): RepositoryResult<RoomNode> {
        try {
            if (!structure_id) {
                return this.failure('Structure ID is required');
            }
            if (!data.name || data.name.trim().length === 0) {
                return this.failure('Room name is required');
            }

            const id = randomUUID();
            const now = new Date().toISOString();
            const name = data.name.trim();
            const description = data.description ?? 'A nondescript room.';
            const biomeContext = data.biome_context ?? 'dungeon';
            const lighting = data.lighting ?? 'dim';

            // Validate biome_context
            const validBiomes = ['forest', 'mountain', 'urban', 'dungeon', 'coastal', 'cavern', 'divine', 'arcane'];
            if (!validBiomes.includes(biomeContext)) {
                return this.failure(`Invalid biome_context: ${biomeContext}. Must be one of: ${validBiomes.join(', ')}`);
            }

            // Build atmospherics from lighting and room_type
            const atmospherics: string[] = [];
            if (lighting === 'dark') {
                atmospherics.push('darkness');
            } else if (lighting === 'dim') {
                atmospherics.push('shadows');
            } else if (lighting === 'magical') {
                atmospherics.push('ethereal glow');
            }
            if (data.room_type) {
                atmospherics.push(data.room_type);
            }

            const sql = `
                INSERT INTO room_nodes (
                    id, name, base_description, biome_context, atmospherics,
                    exits, entity_ids, created_at, updated_at, network_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            this.execute(sql, [
                id,
                name,
                description.length >= 10 ? description : description.padEnd(10, '.'), // Min 10 chars
                biomeContext,
                canonicalStringify(atmospherics),
                '[]', // Empty exits
                '[]', // Empty entity_ids
                now,
                now,
                structure_id, // Store structure_id in network_id
            ]);

            const room: RoomNode = {
                id,
                structure_id,
                name,
                description,
                biome_context: biomeContext,
                lighting,
                room_type: data.room_type ?? null,
                contents_json: data.contents_json ?? '{}',
                state_json: data.state_json ?? '{}',
                created_at: now,
            };

            return this.success(room);
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Get all rooms in a structure.
     *
     * @param structure_id - Parent structure ID
     * @returns Repository result with array of rooms
     */
    getByStructure(structure_id: string): RepositoryResult<RoomNode[]> {
        try {
            const sql = `
                SELECT id, name, base_description, biome_context, atmospherics,
                       exits, entity_ids, created_at, updated_at, network_id,
                       local_x, local_y, visited_count, last_visited_at
                FROM room_nodes
                WHERE network_id = ?
                ORDER BY name ASC
            `;

            const rows = this.query<RoomNodeRow>(sql, [structure_id]);
            const rooms = rows.map((row) => this.toEntityWithStructure(row, structure_id));

            return this.success(rooms);
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Update room contents (NPCs, items, etc.).
     *
     * @param id - Room ID to update
     * @param contents - New contents object
     * @returns Repository result with the updated room
     */
    updateContents(id: string, contents: object): RepositoryResult<RoomNode> {
        try {
            // Get existing room
            const existingResult = this.findById(id);
            if (!existingResult.success || !existingResult.data) {
                return this.failure(`Room with id '${id}' not found`);
            }

            const now = new Date().toISOString();
            const contentsJson = canonicalStringify(contents);

            // Extract entity_ids from contents for storage
            const entityIds: string[] = [];
            if (typeof contents === 'object' && contents !== null) {
                const c = contents as Record<string, unknown>;
                if (Array.isArray(c.npcs)) {
                    entityIds.push(...c.npcs);
                }
                if (Array.isArray(c.items)) {
                    entityIds.push(...c.items);
                }
                if (Array.isArray(c.entities)) {
                    entityIds.push(...c.entities);
                }
            }

            const sql = `
                UPDATE room_nodes
                SET entity_ids = ?, updated_at = ?
                WHERE id = ?
            `;

            this.execute(sql, [canonicalStringify(entityIds), now, id]);

            return this.success({
                ...existingResult.data,
                contents_json: contentsJson,
            });
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Update room state (doors, traps, environmental conditions).
     *
     * @param id - Room ID to update
     * @param state - New state object
     * @returns Repository result with the updated room
     */
    updateState(id: string, state: object): RepositoryResult<RoomNode> {
        try {
            // Get existing room
            const existingResult = this.findById(id);
            if (!existingResult.success || !existingResult.data) {
                return this.failure(`Room with id '${id}' not found`);
            }

            const now = new Date().toISOString();
            const stateJson = canonicalStringify(state);

            // Extract atmospherics from state for storage
            const atmospherics: string[] = [];
            if (typeof state === 'object' && state !== null) {
                const s = state as Record<string, unknown>;
                if (Array.isArray(s.atmospherics)) {
                    atmospherics.push(...s.atmospherics);
                }
                if (s.lighting === 'dark') {
                    atmospherics.push('darkness');
                }
                if (s.hazard) {
                    atmospherics.push(String(s.hazard));
                }
            }

            const sql = `
                UPDATE room_nodes
                SET atmospherics = ?, updated_at = ?
                WHERE id = ?
            `;

            this.execute(sql, [canonicalStringify(atmospherics), now, id]);

            return this.success({
                ...existingResult.data,
                state_json: stateJson,
            });
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Record a visit to a room (increments visit count).
     *
     * @param id - Room ID
     * @returns Repository result indicating success
     */
    recordVisit(id: string): RepositoryResult<void> {
        try {
            const now = new Date().toISOString();

            const sql = `
                UPDATE room_nodes
                SET visited_count = visited_count + 1, last_visited_at = ?, updated_at = ?
                WHERE id = ?
            `;

            const result = this.execute(sql, [now, now, id]);

            if (result.changes === 0) {
                return this.failure(`Room with id '${id}' not found`);
            }

            return this.success(undefined);
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Convert a database row to a RoomNode entity.
     */
    protected toEntity(row: unknown): RoomNode {
        const r = row as RoomNodeRow;
        return this.toEntityWithStructure(r, r.network_id ?? '');
    }

    /**
     * Convert a database row to a RoomNode entity with explicit structure_id.
     */
    private toEntityWithStructure(row: RoomNodeRow, structure_id: string): RoomNode {
        // Parse atmospherics to determine lighting
        let atmospherics: string[] = [];
        try {
            atmospherics = JSON.parse(row.atmospherics || '[]');
        } catch {
            // Keep empty array
        }

        // Determine lighting from atmospherics
        let lighting = 'bright';
        if (atmospherics.includes('darkness')) {
            lighting = 'dark';
        } else if (atmospherics.includes('shadows')) {
            lighting = 'dim';
        } else if (atmospherics.includes('ethereal glow')) {
            lighting = 'magical';
        }

        // Parse entity_ids for contents
        let entityIds: string[] = [];
        try {
            entityIds = JSON.parse(row.entity_ids || '[]');
        } catch {
            // Keep empty array
        }

        return {
            id: row.id,
            structure_id,
            name: row.name,
            description: row.base_description,
            biome_context: row.biome_context,
            lighting,
            room_type: atmospherics.find(a => !['darkness', 'shadows', 'ethereal glow'].includes(a)) ?? null,
            contents_json: canonicalStringify({ entities: entityIds }),
            state_json: canonicalStringify({ atmospherics }),
            created_at: row.created_at,
        };
    }

    /**
     * Convert a RoomNode to a database row format.
     */
    protected toRow(entity: Partial<RoomNode>): Record<string, unknown> {
        const row: Record<string, unknown> = {};

        if (entity.id !== undefined) {
            row.id = entity.id;
        }
        if (entity.name !== undefined) {
            row.name = entity.name;
        }
        if (entity.description !== undefined) {
            row.base_description = entity.description;
        }
        if (entity.biome_context !== undefined) {
            row.biome_context = entity.biome_context;
        }
        if (entity.structure_id !== undefined) {
            row.network_id = entity.structure_id;
        }
        if (entity.created_at !== undefined) {
            row.created_at = entity.created_at;
        }

        return row;
    }
}
