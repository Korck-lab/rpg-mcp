import { Database } from 'better-sqlite3';
import { z } from 'zod';
import { BaseRepository, RepositoryErrorCode, RepositoryError } from '../base.repo.js';

// Schema for Narrative Notes
export const NarrativeNoteSchema = z.object({
    id: z.string(),
    worldId: z.string(),
    type: z.enum(['plot_thread', 'canonical_moment', 'npc_voice', 'foreshadowing', 'session_log']),
    content: z.string(),
    metadata: z.record(z.any()).default({}),
    visibility: z.enum(['dm_only', 'player_visible']).default('dm_only'),
    tags: z.array(z.string()).default([]),
    entityId: z.string().optional(),
    entityType: z.string().optional(),
    status: z.enum(['active', 'resolved', 'dormant', 'archived']).default('active'),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
});

export type NarrativeNote = z.infer<typeof NarrativeNoteSchema>;

interface NarrativeNoteRow {
    id: string;
    world_id: string;
    type: string;
    content: string;
    metadata_json: string;
    visibility: string;
    tags_json: string;
    entity_id: string | null;
    entity_type: string | null;
    status: string;
    created_at: string;
    updated_at: string;
}

export class NarrativeNotesRepository extends BaseRepository<NarrativeNote> {
    constructor(db: Database) {
        super(db, 'narrative_notes');
    }

    protected toEntity(row: unknown): NarrativeNote {
        const r = row as NarrativeNoteRow;
        try {
            return NarrativeNoteSchema.parse({
                id: r.id,
                worldId: r.world_id,
                type: r.type,
                content: r.content,
                metadata: JSON.parse(r.metadata_json),
                visibility: r.visibility,
                tags: JSON.parse(r.tags_json),
                entityId: r.entity_id || undefined,
                entityType: r.entity_type || undefined,
                status: r.status,
                createdAt: r.created_at,
                updatedAt: r.updated_at
            });
        } catch (error) {
            throw new RepositoryError(
                `Failed to parse narrative note ${r.id}: ${(error as Error).message}`,
                RepositoryErrorCode.VALIDATION_ERROR,
                { originalError: error }
            );
        }
    }

    protected toRow(entity: Partial<NarrativeNote>): Record<string, unknown> {
        const row: Record<string, unknown> = {};
        if (entity.id !== undefined) row.id = entity.id;
        if (entity.worldId !== undefined) row.world_id = entity.worldId;
        if (entity.type !== undefined) row.type = entity.type;
        if (entity.content !== undefined) row.content = entity.content;
        if (entity.metadata !== undefined) row.metadata_json = JSON.stringify(entity.metadata);
        if (entity.visibility !== undefined) row.visibility = entity.visibility;
        if (entity.tags !== undefined) row.tags_json = JSON.stringify(entity.tags);
        if (entity.entityId !== undefined) row.entity_id = entity.entityId;
        if (entity.entityType !== undefined) row.entity_type = entity.entityType;
        if (entity.status !== undefined) row.status = entity.status;
        if (entity.createdAt !== undefined) row.created_at = entity.createdAt;
        if (entity.updatedAt !== undefined) row.updated_at = entity.updatedAt;
        
        return row;
    }

    /**
     * Find notes by world and type
     */
    findByWorld(worldId: string, type?: string): NarrativeNote[] {
        let sql = 'SELECT * FROM narrative_notes WHERE world_id = ?';
        const params: unknown[] = [worldId];

        if (type) {
            sql += ' AND type = ?';
            params.push(type);
        }

        sql += ' ORDER BY created_at DESC';

        return this.query<NarrativeNoteRow>(sql, params).map(row => this.toEntity(row));
    }

    /**
     * Find notes associated with a specific entity (NPC, location, etc)
     */
    findByEntity(entityId: string, entityType?: string): NarrativeNote[] {
        let sql = 'SELECT * FROM narrative_notes WHERE entity_id = ?';
        const params: unknown[] = [entityId];

        if (entityType) {
            sql += ' AND entity_type = ?';
            params.push(entityType);
        }

        sql += ' ORDER BY created_at DESC';

        return this.query<NarrativeNoteRow>(sql, params).map(row => this.toEntity(row));
    }

    /**
     * Search notes by tag
     */
    findByTag(worldId: string, tag: string): NarrativeNote[] {
        // SQLite doesn't have great JSON array search without extensions, 
        // using LIKE for basic tag search given the default '["tag1","tag2"]' format
        const sql = `
            SELECT * FROM narrative_notes 
            WHERE world_id = ? 
            AND tags_json LIKE ?
            ORDER BY created_at DESC
        `;
        return this.query<NarrativeNoteRow>(sql, [worldId, `%"${tag}"%`]).map(row => this.toEntity(row));
    }
}
