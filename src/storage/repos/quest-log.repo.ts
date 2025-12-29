import { Database } from 'better-sqlite3';
import { BaseRepository, RepositoryErrorCode, RepositoryError } from '../base.repo.js';
import { QuestLog, QuestLogSchema } from '../../schema/quest.js';
import { QuestRepository, QuestWithStatus, FullQuestLog } from './quest.repo.js';

interface QuestLogRow {
    character_id: string;
    active_quests_json: string;
    completed_quests_json: string;
    failed_quests_json: string;
}

export class QuestLogRepository extends BaseRepository<QuestLog> {
    constructor(db: Database, private questRepo: QuestRepository) {
        super(db, 'quest_logs');
    }

    /**
     * Override findById to use character_id (the actual PK) instead of id
     */
    findById(characterId: string): { success: boolean; data?: QuestLog; error?: string } {
        try {
            const row = this.queryOne(
                `SELECT * FROM ${this.tableName} WHERE character_id = ?`,
                [characterId]
            );

            if (!row) {
                return {
                    success: false,
                    error: `QuestLog for character '${characterId}' not found`,
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
     * Override update to use character_id (the actual PK) instead of id
     */
    update(characterId: string, updates: Partial<QuestLog>): { success: boolean; data?: QuestLog; error?: string } {
        try {
            const row = this.toRow(updates);
            const columns = Object.keys(row).filter(k => k !== 'character_id');

            if (columns.length === 0) {
                return this.findById(characterId);
            }

            const setClause = columns.map(col => `${col} = ?`).join(', ');
            const values = columns.map(col => row[col]);
            values.push(characterId);

            const sql = `UPDATE ${this.tableName} SET ${setClause} WHERE character_id = ?`;
            this.execute(sql, values);

            return this.findById(characterId);
        } catch (error) {
            return this.handleError(error);
        }
    }

    protected toEntity(row: unknown): QuestLog {
        const r = row as QuestLogRow;
        try {
            return QuestLogSchema.parse({
                id: r.character_id,
                characterId: r.character_id,
                activeQuests: JSON.parse(r.active_quests_json),
                completedQuests: JSON.parse(r.completed_quests_json),
                failedQuests: JSON.parse(r.failed_quests_json)
            });
        } catch (error) {
            throw new RepositoryError(
                `Failed to parse quest log for character ${r.character_id}: ${(error as Error).message}`,
                RepositoryErrorCode.VALIDATION_ERROR,
                { originalError: error }
            );
        }
    }

    protected toRow(entity: Partial<QuestLog>): Record<string, unknown> {
        const row: Record<string, unknown> = {};
        if (entity.characterId !== undefined) row.character_id = entity.characterId;
        if (entity.activeQuests !== undefined) row.active_quests_json = JSON.stringify(entity.activeQuests);
        if (entity.completedQuests !== undefined) row.completed_quests_json = JSON.stringify(entity.completedQuests);
        if (entity.failedQuests !== undefined) row.failed_quests_json = JSON.stringify(entity.failedQuests);
        
        return row;
    }

    /**
     * Get or create a quest log for a character
     */
    getOrCreate(characterId: string): { success: boolean; data?: QuestLog; error?: string } {
        const existing = this.findById(characterId);
        if (existing.success && existing.data) {
            return existing;
        }

        // Create new log
        const newLog: QuestLog = {
            id: characterId,
            characterId,
            activeQuests: [],
            completedQuests: [],
            failedQuests: []
        };

        return this.insert(newLog);
    }

    /**
     * Accept a quest (move to active)
     */
    acceptQuest(characterId: string, questId: string): { success: boolean; data?: QuestLog; error?: string } {
        const logResult = this.getOrCreate(characterId);
        if (!logResult.success || !logResult.data) return logResult;
        
        const log = logResult.data;
        
        // Check if already active or completed
        if (log.activeQuests.includes(questId)) {
            return { success: false, error: 'Quest already active' };
        }
        if (log.completedQuests.includes(questId)) {
            return { success: false, error: 'Quest already completed' };
        }

        log.activeQuests.push(questId);
        
        return this.update(characterId, { activeQuests: log.activeQuests });
    }

    /**
     * Complete a quest (move from active to completed)
     */
    completeQuest(characterId: string, questId: string): { success: boolean; data?: QuestLog; error?: string } {
        const logResult = this.getOrCreate(characterId);
        if (!logResult.success || !logResult.data) return logResult;
        
        const log = logResult.data;
        
        if (!log.activeQuests.includes(questId)) {
            return { success: false, error: 'Quest not active' };
        }

        log.activeQuests = log.activeQuests.filter(id => id !== questId);
        log.completedQuests.push(questId);
        
        return this.update(characterId, { 
            activeQuests: log.activeQuests,
            completedQuests: log.completedQuests 
        });
    }

    /**
     * Fail a quest (move from active to failed)
     */
    failQuest(characterId: string, questId: string): { success: boolean; data?: QuestLog; error?: string } {
        const logResult = this.getOrCreate(characterId);
        if (!logResult.success || !logResult.data) return logResult;
        
        const log = logResult.data;
        
        if (!log.activeQuests.includes(questId)) {
            return { success: false, error: 'Quest not active' };
        }

        log.activeQuests = log.activeQuests.filter(id => id !== questId);
        log.failedQuests.push(questId);
        
        return this.update(characterId, { 
            activeQuests: log.activeQuests,
            failedQuests: log.failedQuests 
        });
    }

    /**
     * Get full quest log with complete quest objects
     */
    getFullQuestLog(characterId: string): { success: boolean; data?: FullQuestLog; error?: string } {
        const logResult = this.findById(characterId);
        if (!logResult.success) {
             // Return empty log structure if not found (or error if db error)
             // If strictly not found, return empty log
             if (logResult.error?.includes('not found')) {
                 return {
                     success: true,
                     data: {
                         characterId,
                         quests: [],
                         summary: { active: 0, completed: 0, failed: 0 }
                     }
                 };
             }
             return { success: false, error: logResult.error };
        }

        const log = logResult.data!;
        const quests: QuestWithStatus[] = [];

        // Helper to fetch and push
        const fetchAndPush = (ids: string[], status: 'active' | 'completed' | 'failed') => {
            for (const id of ids) {
                const qResult = this.questRepo.findById(id);
                if (qResult.success && qResult.data) {
                    quests.push({
                        ...qResult.data,
                        logStatus: status
                    });
                }
            }
        };

        fetchAndPush(log.activeQuests, 'active');
        fetchAndPush(log.completedQuests, 'completed');
        fetchAndPush(log.failedQuests, 'failed');

        return {
            success: true,
            data: {
                characterId,
                quests,
                summary: {
                    active: log.activeQuests.length,
                    completed: log.completedQuests.length,
                    failed: log.failedQuests.length
                }
            }
        };
    }
}
