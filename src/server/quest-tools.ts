import { z } from 'zod';
import { randomUUID } from 'crypto';
import { QuestRepository } from '../storage/repos/quest.repo.js';
import { QuestLogRepository } from '../storage/repos/quest-log.repo.js';
import { CharacterRepository } from '../storage/repos/character.repo.js';
import { InventoryRepository } from '../storage/repos/inventory.repo.js';
import { ItemRepository } from '../storage/repos/item.repo.js';
import { getDb } from '../storage/index.js';
import { SessionContext } from './types.js';
import { RichFormatter } from './utils/formatter.js';

function ensureDb() {
    const dbPath = process.env.NODE_ENV === 'test'
        ? ':memory:'
        : process.env.RPG_DATA_DIR
            ? `${process.env.RPG_DATA_DIR}/rpg.db`
            : 'rpg.db';
    const db = getDb(dbPath);
    const questRepo = new QuestRepository(db);
    const questLogRepo = new QuestLogRepository(db, questRepo);
    const characterRepo = new CharacterRepository(db);
    const inventoryRepo = new InventoryRepository(db);
    const itemRepo = new ItemRepository(db);
    return { questRepo, questLogRepo, characterRepo, inventoryRepo, itemRepo };
}

export const QuestTools = {
    CREATE_QUEST: {
        name: 'create_quest',
        description: 'Define a new quest in the world.',
        inputSchema: z.object({
            worldId: z.string(),
            name: z.string(),
            description: z.string(),
            status: z.enum(['available', 'active', 'completed', 'failed']),
            objectives: z.array(z.object({
                id: z.string().optional(),
                description: z.string(),
                type: z.enum(['kill', 'collect', 'deliver', 'explore', 'interact', 'custom']),
                target: z.string(),
                required: z.number().int().min(1),
                current: z.number().int().min(0).default(0),
                completed: z.boolean().default(false)
            })),
            rewards: z.object({
                experience: z.number().int().min(0).default(0),
                gold: z.number().int().min(0).default(0),
                items: z.array(z.string()).default([])
            }),
            prerequisites: z.array(z.string()).default([]),
            giver: z.string().optional()
        })
    },
    GET_QUEST: {
        name: 'get_quest',
        description: 'Get a single quest by ID with full details.',
        inputSchema: z.object({
            questId: z.string()
        })
    },
    LIST_QUESTS: {
        name: 'list_quests',
        description: 'List all quests, optionally filtered by world.',
        inputSchema: z.object({
            worldId: z.string().optional()
        })
    },
    ASSIGN_QUEST: {
        name: 'assign_quest',
        description: 'Assign a quest to a character.',
        inputSchema: z.object({
            characterId: z.string(),
            questId: z.string()
        })
    },
    UPDATE_OBJECTIVE: {
        name: 'update_objective',
        description: 'Update progress on a quest objective.',
        inputSchema: z.object({
            characterId: z.string(),
            questId: z.string(),
            objectiveId: z.string(),
            progress: z.number().int().min(1).default(1)
        })
    },
    COMPLETE_OBJECTIVE: {
        name: 'complete_objective',
        description: 'Mark an objective as fully completed.',
        inputSchema: z.object({
            questId: z.string(),
            objectiveId: z.string()
        })
    },
    COMPLETE_QUEST: {
        name: 'complete_quest',
        description: 'Mark a quest as completed and grant rewards.',
        inputSchema: z.object({
            characterId: z.string(),
            questId: z.string()
        })
    },
    GET_QUEST_LOG: {
        name: 'get_quest_log',
        description: 'Get the quest log for a character.',
        inputSchema: z.object({
            characterId: z.string()
        })
    }
} as const;

export async function handleCreateQuest(args: unknown, _ctx: SessionContext) {
    const { questRepo } = ensureDb();
    const parsed = QuestTools.CREATE_QUEST.inputSchema.parse(args);

    const now = new Date().toISOString();

    // Ensure all objectives have IDs
    const objectives = parsed.objectives.map(obj => ({
        ...obj,
        id: obj.id || randomUUID(),
        current: obj.current ?? 0,
        completed: obj.completed ?? false
    }));

    const quest = {
        ...parsed,
        objectives,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now
    };

    const result = questRepo.insert(quest);
    if (!result.success) {
        throw new Error(`Failed to create quest: ${result.error}`);
    }

    let output = RichFormatter.quest(quest as any);
    output += RichFormatter.success('Quest created!');
    output += RichFormatter.embedJson(quest, 'QUEST');

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

export async function handleGetQuest(args: unknown, _ctx: SessionContext) {
    const { questRepo } = ensureDb();
    const parsed = QuestTools.GET_QUEST.inputSchema.parse(args);

    const result = questRepo.findById(parsed.questId);
    if (!result.success || !result.data) {
        throw new Error(`Quest ${parsed.questId} not found`);
    }
    const quest = result.data;

    let output = RichFormatter.quest(quest as any);
    output += RichFormatter.embedJson(quest, 'QUEST');

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

export async function handleListQuests(args: unknown, _ctx: SessionContext) {
    const { questRepo } = ensureDb();
    const parsed = QuestTools.LIST_QUESTS.inputSchema.parse(args);

    const quests = parsed.worldId ? questRepo.findAllByWorld(parsed.worldId) : []; 
    
    let questList = quests;
    if (!parsed.worldId) {
        const result = questRepo.findAll();
        if (result.success && result.data) {
            questList = result.data;
        }
    }

    let output = RichFormatter.header('Quests', '📜');
    if (questList.length === 0) {
        output += RichFormatter.alert('No quests found.', 'info');
    } else {
        const rows = questList.map((q: any) => [q.name, q.status || 'active', String(q.objectives?.length || 0)]);
        output += RichFormatter.table(['Name', 'Status', 'Objectives'], rows);
        output += `\n*${questList.length} quest(s) total*\n`;
    }
    output += RichFormatter.embedJson({ quests: questList, count: questList.length }, 'QUESTS');

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

export async function handleAssignQuest(args: unknown, _ctx: SessionContext) {
    const { questRepo, questLogRepo, characterRepo } = ensureDb();
    const parsed = QuestTools.ASSIGN_QUEST.inputSchema.parse(args);

    const character = characterRepo.findById(parsed.characterId);
    if (!character) throw new Error(`Character ${parsed.characterId} not found`);

    const questResult = questRepo.findById(parsed.questId);
    if (!questResult.success || !questResult.data) throw new Error(`Quest ${parsed.questId} not found`);
    const quest = questResult.data;

    // Check prerequisites using quest log
    const logResult = questLogRepo.getOrCreate(parsed.characterId);
    if (!logResult.success || !logResult.data) throw new Error(`Failed to access quest log: ${logResult.error}`);
    const log = logResult.data;

    if (log.activeQuests.includes(parsed.questId)) {
        throw new Error(`Quest ${parsed.questId} is already active for character ${parsed.characterId}`);
    }
    if (log.completedQuests.includes(parsed.questId)) {
        throw new Error(`Quest ${parsed.questId} is already completed by character ${parsed.characterId}`);
    }

    for (const prereqId of quest.prerequisites) {
        if (!log.completedQuests.includes(prereqId)) {
            const prereqResult = questRepo.findById(prereqId);
            const prereqName = (prereqResult.success && prereqResult.data) ? prereqResult.data.name : prereqId;
            throw new Error(`Prerequisite quest "${prereqName}" not completed`);
        }
    }

    const acceptResult = questLogRepo.acceptQuest(parsed.characterId, parsed.questId);
    if (!acceptResult.success) {
        throw new Error(acceptResult.error || 'Failed to assign quest');
    }

    let output = RichFormatter.header('Quest Assigned', '📜');
    output += RichFormatter.keyValue({
        'Quest': quest.name,
        'Character': character.name,
    });
    output += RichFormatter.success(`${character.name} has accepted the quest!`);
    output += RichFormatter.embedJson({ quest }, 'QUEST');

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

export async function handleUpdateObjective(args: unknown, _ctx: SessionContext) {
    const { questRepo, questLogRepo, characterRepo } = ensureDb();
    const parsed = QuestTools.UPDATE_OBJECTIVE.inputSchema.parse(args);

    // Verify character exists
    const character = characterRepo.findById(parsed.characterId);
    if (!character) {
        throw new Error(`Character ${parsed.characterId} not found`);
    }

    const questResult = questRepo.findById(parsed.questId);
    if (!questResult.success || !questResult.data) throw new Error(`Quest ${parsed.questId} not found`);
    const quest = questResult.data;

    // Verify quest is active
    const logResult = questLogRepo.findById(parsed.characterId);
    if (!logResult.success || !logResult.data || !logResult.data.activeQuests.includes(parsed.questId)) {
        throw new Error(`Quest "${quest.name}" is not active for character ${character.name}`);
    }

    const updatedQuest = questRepo.updateObjectiveProgress(parsed.questId, parsed.objectiveId, parsed.progress);
    if (!updatedQuest) throw new Error('Failed to update objective');

    let output = RichFormatter.header('Objective Updated', '📝');
    output += RichFormatter.keyValue({
        'Quest': updatedQuest.name,
        'Progress': `+${parsed.progress}`
    });

    // Find updated objective
    const obj = updatedQuest.objectives.find(o => o.id === parsed.objectiveId);
    if (obj) {
        output += RichFormatter.keyValue({
            'Objective': obj.description,
            'Status': `${obj.current}/${obj.required} ${obj.completed ? '(COMPLETED)' : ''}`
        });
    }

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

export async function handleGetQuestLog(args: unknown, _ctx: SessionContext) {
    const { questLogRepo, characterRepo } = ensureDb();
    const parsed = QuestTools.GET_QUEST_LOG.inputSchema.parse(args);

    // Verify character exists
    const character = characterRepo.findById(parsed.characterId);
    if (!character) {
        throw new Error(`Character ${parsed.characterId} not found`);
    }

    // Get full quest log with complete quest data
    const fullLogResult = questLogRepo.getFullQuestLog(parsed.characterId);
    if (!fullLogResult.success || !fullLogResult.data) {
        throw new Error(`Failed to retrieve quest log: ${fullLogResult.error}`);
    }
    const fullLog = fullLogResult.data;

    // Transform to frontend-friendly format
    const quests = fullLog.quests.map(quest => ({
        id: quest.id,
        title: quest.name,
        name: quest.name,
        description: quest.description,
        status: quest.logStatus,
        questGiver: quest.giver,
        objectives: quest.objectives.map(obj => ({
            id: obj.id,
            description: obj.description,
            type: obj.type,
            target: obj.target,
            current: obj.current,
            required: obj.required,
            completed: obj.completed,
            progress: `${obj.current}/${obj.required}`
        })),
        rewards: {
            experience: quest.rewards.experience,
            gold: quest.rewards.gold,
            items: quest.rewards.items
        },
        prerequisites: quest.prerequisites
    }));

    let output = RichFormatter.header(`${character.name}'s Quest Log`, '📖');
    output += RichFormatter.keyValue({ 'Summary': `${fullLog.summary.active} active, ${fullLog.summary.completed} completed, ${fullLog.summary.failed} failed` });

    if (quests.length === 0) {
        output += RichFormatter.alert('No quests in log.', 'info');
    } else {
        for (const quest of quests) {
            const statusIcon = quest.status === 'completed' ? '✅' : quest.status === 'failed' ? '❌' : '📜';
            output += `\n${statusIcon} **${quest.name}** (${quest.status})\n`;
            if (quest.objectives && quest.objectives.length > 0) {
                for (const obj of quest.objectives) {
                    const check = obj.completed ? '☑️' : '☐';
                    output += `  ${check} ${obj.description} (${obj.current}/${obj.required})\n`;
                }
            }
        }
    }
    output += RichFormatter.embedJson({ characterId: parsed.characterId, characterName: character.name, quests, summary: fullLog.summary }, 'QUESTLOG');

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

export async function handleCompleteObjective(args: unknown, _ctx: SessionContext) {
    const { questRepo } = ensureDb();
    const parsed = QuestTools.COMPLETE_OBJECTIVE.inputSchema.parse(args);

    const questResult = questRepo.findById(parsed.questId);
    if (!questResult.success || !questResult.data) {
        throw new Error(`Quest ${parsed.questId} not found (Error: ${questResult.error})`);
    }
    
    // Check if objective exists
    const quest = questResult.data;
    const objective = quest.objectives.find(o => o.id === parsed.objectiveId);
    if (!objective) throw new Error(`Objective ${parsed.objectiveId} not found in quest ${parsed.questId}`);

    const updatedQuest = questRepo.completeObjective(parsed.questId, parsed.objectiveId);
    if (!updatedQuest) {
        throw new Error('Failed to complete objective');
    }

    let output = RichFormatter.header('Objective Completed', '✅');
    output += RichFormatter.keyValue({
        'Quest': updatedQuest.name,
        'Objective': objective.description
    });
    
    // Check if full quest is complete
    const allComplete = updatedQuest.objectives.every(o => o.completed);
    if (allComplete) {
        output += RichFormatter.alert('All objectives complete! Quest is ready to turn in.', 'success');
    }

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

export async function handleCompleteQuest(args: unknown, _ctx: SessionContext) {
    const { questRepo, questLogRepo, characterRepo, inventoryRepo, itemRepo } = ensureDb();
    const parsed = QuestTools.COMPLETE_QUEST.inputSchema.parse(args);

    // Verify character exists
    const character = characterRepo.findById(parsed.characterId);
    if (!character) {
        throw new Error(`Character ${parsed.characterId} not found`);
    }

    const questResult = questRepo.findById(parsed.questId);
    if (!questResult.success || !questResult.data) throw new Error(`Quest ${parsed.questId} not found`);
    const quest = questResult.data;

    // Verify quest is active
    const logResult = questLogRepo.findById(parsed.characterId);
    if (!logResult.success || !logResult.data || !logResult.data.activeQuests.includes(parsed.questId)) {
        throw new Error(`Quest "${quest.name}" is not active for character ${character.name}`);
    }

    // Verify all objectives are completed
    const allCompleted = quest.objectives.every(o => o.completed);
    if (!allCompleted) {
        const incomplete = quest.objectives.filter(o => !o.completed);
        throw new Error(`Not all objectives completed. Remaining: ${incomplete.map(o => o.description).join(', ')}`);
    }

    // Grant rewards
    const rewardsGranted: { xp?: number; gold?: number; items: string[] } = {
        items: []
    };

    // Grant XP (update character - need to check if character schema supports xp)
    if (quest.rewards.experience > 0) {
        rewardsGranted.xp = quest.rewards.experience;
        // Logic to add XP to character would go here if progression repo was available/linked
        // For now we just log it
    }

    // Grant gold
    if (quest.rewards.gold > 0) {
        rewardsGranted.gold = quest.rewards.gold;
        inventoryRepo.addCurrency(parsed.characterId, { gold: quest.rewards.gold });
    }

    // Grant items
    for (const itemId of quest.rewards.items) {
        try {
            inventoryRepo.addItem(parsed.characterId, itemId, 1);
            const itemResult = itemRepo.findById(itemId);
            const itemName = itemResult.success && itemResult.data ? itemResult.data.name : itemId;
            rewardsGranted.items.push(itemName);
        } catch (err) {
            // Item may not exist, still complete the quest
            rewardsGranted.items.push(`${itemId} (item not found)`);
        }
    }

    // Update quest log
    const completeResult = questLogRepo.completeQuest(parsed.characterId, parsed.questId);
    if (!completeResult.success) {
        throw new Error(`Failed to complete quest in log: ${completeResult.error}`);
    }

    // Update quest status (optional - usually quests remain 'active' in world but 'completed' in log, 
    // unless it's a unique world quest)
    // questRepo.update(parsed.questId, { status: 'completed' });

    let output = RichFormatter.header('Quest Completed!', '🎉');
    output += RichFormatter.keyValue({
        'Quest': quest.name,
        'Character': character.name,
    });
    output += RichFormatter.section('Rewards');
    output += RichFormatter.keyValue({
        'XP': rewardsGranted.xp || 0,
        'Gold': rewardsGranted.gold || 0,
    });
    if (rewardsGranted.items.length > 0) {
        output += RichFormatter.subSection('Items');
        output += RichFormatter.list(rewardsGranted.items);
    }
    output += RichFormatter.success('Congratulations!');
    output += RichFormatter.embedJson({ quest, rewards: rewardsGranted }, 'COMPLETE');

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}
