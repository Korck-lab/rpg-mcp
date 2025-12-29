import { Database } from 'better-sqlite3';
import { BaseRepository, RepositoryErrorCode, RepositoryError } from '../base.repo.js';
import { Quest, QuestSchema } from '../../schema/quest.js';

// Extended types for full quest log
export interface QuestWithStatus extends Quest {
    logStatus: 'active' | 'completed' | 'failed';
}

export interface FullQuestLog {
    characterId: string;
    quests: QuestWithStatus[];
    summary: {
        active: number;
        completed: number;
        failed: number;
    };
}

interface QuestRow {
    id: string;
    world_id: string;
    name: string;
    description: string;
    status: string;
    objectives: string;
    rewards: string;
    prerequisites: string;
    giver: string | null;
    created_at: string;
    updated_at: string;
    time_limit?: number;
    type?: string;
    accepted_at?: string;
    completed_at?: string;
    giver_id?: string;
}

export class QuestRepository extends BaseRepository<Quest> {
    constructor(db: Database) {
        super(db, 'quests');
    }

    protected toEntity(row: unknown): Quest {
        const r = row as QuestRow;
        try {
            return QuestSchema.parse({
                id: r.id,
                worldId: r.world_id,
                name: r.name,
                description: r.description,
                status: r.status,
                objectives: JSON.parse(r.objectives),
                rewards: JSON.parse(r.rewards),
                prerequisites: JSON.parse(r.prerequisites),
                giver: r.giver_id || r.giver || undefined,
                createdAt: r.created_at,
                updatedAt: r.updated_at
            });
        } catch (error) {
            throw new RepositoryError(
                `Failed to parse quest ${r.id}: ${(error as Error).message}`,
                RepositoryErrorCode.VALIDATION_ERROR,
                { originalError: error }
            );
        }
    }

    protected toRow(entity: Partial<Quest>): Record<string, unknown> {
        const row: Record<string, unknown> = {};
        if (entity.id !== undefined) row.id = entity.id;
        if (entity.worldId !== undefined) row.world_id = entity.worldId;
        if (entity.name !== undefined) row.name = entity.name;
        if (entity.description !== undefined) row.description = entity.description;
        if (entity.status !== undefined) row.status = entity.status;
        if (entity.objectives !== undefined) row.objectives = JSON.stringify(entity.objectives);
        if (entity.rewards !== undefined) row.rewards = JSON.stringify(entity.rewards);
        if (entity.prerequisites !== undefined) row.prerequisites = JSON.stringify(entity.prerequisites);
        if (entity.giver !== undefined) {
            row.giver = entity.giver;
            row.giver_id = entity.giver;
        }
        if (entity.createdAt !== undefined) row.created_at = entity.createdAt;
        if (entity.updatedAt !== undefined) row.updated_at = entity.updatedAt;
        
        return row;
    }

    /**
     * Override insert to handle transaction for quest_objectives if needed
     * For now, we rely on the JSON column as the source of truth, 
     * but we should sync the quest_objectives table for queryability.
     */
    insert(quest: Quest): { success: boolean; data?: Quest; error?: string } {
        return this.transaction(() => {
            const result = super.insert(quest);
            if (!result.success) return result;

            // Sync objectives to normalized table
            this.syncObjectives(quest);

            return result;
        });
    }

    /**
     * Override update to sync objectives
     */
    update(id: string, updates: Partial<Quest>): { success: boolean; data?: Quest; error?: string } {
        return this.transaction(() => {
            const result = super.update(id, updates);
            if (!result.success || !result.data) return result;

            if (updates.objectives) {
                this.syncObjectives(result.data);
            }

            return result;
        });
    }

    private syncObjectives(quest: Quest): void {
        // Clear existing objectives for this quest
        this.execute('DELETE FROM quest_objectives WHERE quest_id = ?', [quest.id]);

        // Insert current objectives
        const stmt = this.db.prepare(`
            INSERT INTO quest_objectives (
                id, quest_id, description, type, target, required, current, completed
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const obj of quest.objectives) {
            stmt.run(
                obj.id,
                quest.id,
                obj.description,
                obj.type,
                obj.target,
                obj.required,
                obj.current,
                obj.completed ? 1 : 0
            );
        }
    }

    /**
     * Find all quests, optionally filtered by world
     */
    findAllByWorld(worldId: string): Quest[] {
        return this.query<QuestRow>(
            'SELECT * FROM quests WHERE world_id = ?',
            [worldId]
        ).map(row => this.toEntity(row));
    }

    /**
     * Update a specific objective's progress
     */
    updateObjectiveProgress(questId: string, objectiveId: string, progress: number): Quest | null {
        const result = this.findById(questId);
        if (!result.success || !result.data) return null;
        
        const quest = result.data;
        const objectiveIndex = quest.objectives.findIndex(o => o.id === objectiveId);
        if (objectiveIndex === -1) return null;

        const objective = quest.objectives[objectiveIndex];
        objective.current = Math.min(objective.required, objective.current + progress);
        if (objective.current >= objective.required) {
            objective.completed = true;
        }

        quest.objectives[objectiveIndex] = objective;
        quest.updatedAt = new Date().toISOString();
        
        const updateResult = this.update(quest.id, { 
            objectives: quest.objectives,
            updatedAt: quest.updatedAt
        });
        
        return updateResult.data || null;
    }

    /**
     * Check if all objectives for a quest are completed
     */
    areAllObjectivesComplete(questId: string): boolean {
        const result = this.findById(questId);
        if (!result.success || !result.data) return false;
        return result.data.objectives.every(o => o.completed);
    }

    /**
     * Complete a specific objective (set current = required)
     */
    completeObjective(questId: string, objectiveId: string): Quest | null {
        const result = this.findById(questId);
        if (!result.success || !result.data) return null;

        const quest = result.data;
        const objectiveIndex = quest.objectives.findIndex(o => o.id === objectiveId);
        if (objectiveIndex === -1) return null;

        const objective = quest.objectives[objectiveIndex];
        objective.current = objective.required;
        objective.completed = true;

        quest.objectives[objectiveIndex] = objective;
        quest.updatedAt = new Date().toISOString();

        const updateResult = this.update(quest.id, { 
            objectives: quest.objectives,
            updatedAt: quest.updatedAt
        });
        
        return updateResult.data || null;
    }
}
