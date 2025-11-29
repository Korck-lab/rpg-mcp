import Database from 'better-sqlite3';
import { Quest, QuestSchema, QuestLog, QuestLogSchema } from '../../schema/quest.js';

export class QuestRepository {
    constructor(private db: Database.Database) { }

    create(quest: Quest): void {
        const validQuest = QuestSchema.parse(quest);

        const stmt = this.db.prepare(`
            INSERT INTO quests (id, world_id, name, description, status, objectives, rewards, prerequisites, giver, created_at, updated_at)
            VALUES (@id, @worldId, @name, @description, @status, @objectives, @rewards, @prerequisites, @giver, @createdAt, @updatedAt)
        `);

        stmt.run({
            id: validQuest.id,
            worldId: validQuest.worldId,
            name: validQuest.name,
            description: validQuest.description,
            status: validQuest.status,
            objectives: JSON.stringify(validQuest.objectives),
            rewards: JSON.stringify(validQuest.rewards),
            prerequisites: JSON.stringify(validQuest.prerequisites),
            giver: validQuest.giver || null,
            createdAt: validQuest.createdAt,
            updatedAt: validQuest.updatedAt
        });
    }

    findById(id: string): Quest | null {
        const stmt = this.db.prepare('SELECT * FROM quests WHERE id = ?');
        const row = stmt.get(id) as QuestRow | undefined;

        if (!row) return null;
        return this.rowToQuest(row);
    }

    update(id: string, updates: Partial<Quest>): Quest | null {
        const existing = this.findById(id);
        if (!existing) return null;

        const updated = {
            ...existing,
            ...updates,
            updatedAt: new Date().toISOString()
        };

        const validQuest = QuestSchema.parse(updated);

        const stmt = this.db.prepare(`
            UPDATE quests
            SET name = ?, description = ?, status = ?, objectives = ?, rewards = ?, prerequisites = ?, giver = ?, updated_at = ?
            WHERE id = ?
        `);

        stmt.run(
            validQuest.name,
            validQuest.description,
            validQuest.status,
            JSON.stringify(validQuest.objectives),
            JSON.stringify(validQuest.rewards),
            JSON.stringify(validQuest.prerequisites),
            validQuest.giver || null,
            validQuest.updatedAt,
            id
        );

        return validQuest;
    }

    getLog(characterId: string): QuestLog | null {
        const stmt = this.db.prepare('SELECT * FROM quest_logs WHERE character_id = ?');
        const row = stmt.get(characterId) as QuestLogRow | undefined;

        if (!row) return null;
        return this.rowToQuestLog(row);
    }

    updateLog(log: QuestLog): void {
        const validLog = QuestLogSchema.parse(log);

        const stmt = this.db.prepare(`
            INSERT INTO quest_logs (character_id, active_quests, completed_quests, failed_quests)
            VALUES (@characterId, @activeQuests, @completedQuests, @failedQuests)
            ON CONFLICT(character_id) DO UPDATE SET
                active_quests = excluded.active_quests,
                completed_quests = excluded.completed_quests,
                failed_quests = excluded.failed_quests
        `);

        stmt.run({
            characterId: validLog.characterId,
            activeQuests: JSON.stringify(validLog.activeQuests),
            completedQuests: JSON.stringify(validLog.completedQuests),
            failedQuests: JSON.stringify(validLog.failedQuests)
        });
    }

    private rowToQuest(row: QuestRow): Quest {
        return QuestSchema.parse({
            id: row.id,
            worldId: row.world_id,
            name: row.name,
            description: row.description,
            status: row.status,
            objectives: JSON.parse(row.objectives),
            rewards: JSON.parse(row.rewards),
            prerequisites: JSON.parse(row.prerequisites),
            giver: row.giver || undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        });
    }

    private rowToQuestLog(row: QuestLogRow): QuestLog {
        return QuestLogSchema.parse({
            characterId: row.character_id,
            activeQuests: JSON.parse(row.active_quests),
            completedQuests: JSON.parse(row.completed_quests),
            failedQuests: JSON.parse(row.failed_quests)
        });
    }
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
}

interface QuestLogRow {
    character_id: string;
    active_quests: string;
    completed_quests: string;
    failed_quests: string;
}
