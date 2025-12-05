import { z } from 'zod';
import { getDb } from '../storage/index.js';
import { NpcMemoryRepository, Familiarity, Disposition, Importance } from '../storage/repos/npc-memory.repo.js';
import { SessionContext } from './types.js';

/**
 * HIGH-004: NPC Memory Tools
 * Tools for tracking NPC relationships and conversation memories
 */

// ============================================================
// TOOL DEFINITIONS
// ============================================================

export const NpcMemoryTools = {
    GET_NPC_RELATIONSHIP: {
        name: 'get_npc_relationship',
        description: `Get the relationship status between a PC and NPC.
Returns familiarity level, disposition, notes, and interaction history.
If no relationship exists, returns default "stranger/neutral" status.`,
        inputSchema: z.object({
            characterId: z.string().describe('ID of the player character'),
            npcId: z.string().describe('ID of the NPC')
        })
    },

    UPDATE_NPC_RELATIONSHIP: {
        name: 'update_npc_relationship',
        description: `Update or create a relationship between PC and NPC.

Familiarity levels (in order):
- stranger: Never met before
- acquaintance: Met briefly, know name
- friend: Multiple positive interactions
- close_friend: Deep trust and history
- rival: Competitive relationship
- enemy: Hostile relationship

Disposition levels:
- hostile: Actively antagonistic
- unfriendly: Cold, dismissive
- neutral: Indifferent
- friendly: Warm, helpful
- helpful: Goes out of their way to assist`,
        inputSchema: z.object({
            characterId: z.string().describe('ID of the player character'),
            npcId: z.string().describe('ID of the NPC'),
            familiarity: z.enum(['stranger', 'acquaintance', 'friend', 'close_friend', 'rival', 'enemy'])
                .describe('Level of familiarity'),
            disposition: z.enum(['hostile', 'unfriendly', 'neutral', 'friendly', 'helpful'])
                .describe('NPC\'s attitude toward the character'),
            notes: z.string().optional().describe('Additional notes about the relationship')
        })
    },

    RECORD_CONVERSATION_MEMORY: {
        name: 'record_conversation_memory',
        description: `Record a significant conversation or interaction with an NPC.
Use this to remember important plot points, promises, secrets shared, etc.

Importance levels:
- low: Casual conversation, small talk
- medium: Useful information, minor agreements
- high: Important plot points, significant promises
- critical: Life-changing revelations, major story beats`,
        inputSchema: z.object({
            characterId: z.string().describe('ID of the player character'),
            npcId: z.string().describe('ID of the NPC'),
            summary: z.string().describe('Summary of the conversation/interaction'),
            importance: z.enum(['low', 'medium', 'high', 'critical']).default('medium')
                .describe('How important this memory is'),
            topics: z.array(z.string()).default([])
                .describe('Keywords/topics for searching (e.g., ["quest", "dragon", "treasure"])')
        })
    },

    GET_CONVERSATION_HISTORY: {
        name: 'get_conversation_history',
        description: `Get conversation history between PC and specific NPC.
Can filter by importance level to only get significant memories.`,
        inputSchema: z.object({
            characterId: z.string().describe('ID of the player character'),
            npcId: z.string().describe('ID of the NPC'),
            minImportance: z.enum(['low', 'medium', 'high', 'critical']).optional()
                .describe('Minimum importance to include'),
            limit: z.number().int().positive().optional()
                .describe('Maximum number of memories to return')
        })
    },

    GET_RECENT_INTERACTIONS: {
        name: 'get_recent_interactions',
        description: `Get recent conversation memories across all NPCs.
Useful for building context about what the character has been doing.`,
        inputSchema: z.object({
            characterId: z.string().describe('ID of the player character'),
            limit: z.number().int().positive().default(10)
                .describe('Maximum number of memories to return')
        })
    },

    GET_NPC_CONTEXT: {
        name: 'get_npc_context',
        description: `Get full context for an NPC interaction.
Returns both relationship data AND relevant conversation history.
Use this to inject context into LLM prompts for NPC dialogue.`,
        inputSchema: z.object({
            characterId: z.string().describe('ID of the player character'),
            npcId: z.string().describe('ID of the NPC'),
            memoryLimit: z.number().int().positive().default(5)
                .describe('Maximum number of memories to include')
        })
    }
} as const;

// ============================================================
// TOOL HANDLERS
// ============================================================

function getRepo(): NpcMemoryRepository {
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
    return new NpcMemoryRepository(db);
}

export async function handleGetNpcRelationship(args: unknown, _ctx: SessionContext) {
    const parsed = NpcMemoryTools.GET_NPC_RELATIONSHIP.inputSchema.parse(args);
    const repo = getRepo();

    const relationship = repo.getRelationship(parsed.characterId, parsed.npcId);

    if (!relationship) {
        // Default stranger status
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    characterId: parsed.characterId,
                    npcId: parsed.npcId,
                    familiarity: 'stranger',
                    disposition: 'neutral',
                    notes: null,
                    firstMetAt: null,
                    lastInteractionAt: null,
                    interactionCount: 0,
                    isNew: true
                }, null, 2)
            }]
        };
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                ...relationship,
                isNew: false
            }, null, 2)
        }]
    };
}

export async function handleUpdateNpcRelationship(args: unknown, _ctx: SessionContext) {
    const parsed = NpcMemoryTools.UPDATE_NPC_RELATIONSHIP.inputSchema.parse(args);
    const repo = getRepo();

    const relationship = repo.upsertRelationship({
        characterId: parsed.characterId,
        npcId: parsed.npcId,
        familiarity: parsed.familiarity as Familiarity,
        disposition: parsed.disposition as Disposition,
        notes: parsed.notes ?? null
    });

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                success: true,
                relationship
            }, null, 2)
        }]
    };
}

export async function handleRecordConversationMemory(args: unknown, _ctx: SessionContext) {
    const parsed = NpcMemoryTools.RECORD_CONVERSATION_MEMORY.inputSchema.parse(args);
    const repo = getRepo();

    const memory = repo.recordMemory({
        characterId: parsed.characterId,
        npcId: parsed.npcId,
        summary: parsed.summary,
        importance: parsed.importance as Importance,
        topics: parsed.topics
    });

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                success: true,
                memory
            }, null, 2)
        }]
    };
}

export async function handleGetConversationHistory(args: unknown, _ctx: SessionContext) {
    const parsed = NpcMemoryTools.GET_CONVERSATION_HISTORY.inputSchema.parse(args);
    const repo = getRepo();

    const memories = repo.getConversationHistory(
        parsed.characterId,
        parsed.npcId,
        {
            minImportance: parsed.minImportance as Importance | undefined,
            limit: parsed.limit
        }
    );

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                characterId: parsed.characterId,
                npcId: parsed.npcId,
                count: memories.length,
                memories
            }, null, 2)
        }]
    };
}

export async function handleGetRecentInteractions(args: unknown, _ctx: SessionContext) {
    const parsed = NpcMemoryTools.GET_RECENT_INTERACTIONS.inputSchema.parse(args);
    const repo = getRepo();

    const memories = repo.getRecentInteractions(parsed.characterId, parsed.limit);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                characterId: parsed.characterId,
                count: memories.length,
                memories
            }, null, 2)
        }]
    };
}

export async function handleGetNpcContext(args: unknown, _ctx: SessionContext) {
    const parsed = NpcMemoryTools.GET_NPC_CONTEXT.inputSchema.parse(args);
    const repo = getRepo();

    // Get relationship
    const relationship = repo.getRelationship(parsed.characterId, parsed.npcId);

    // Get conversation history
    const memories = repo.getConversationHistory(
        parsed.characterId,
        parsed.npcId,
        { limit: parsed.memoryLimit }
    );

    // Build context for LLM injection
    const context = {
        relationship: relationship ?? {
            characterId: parsed.characterId,
            npcId: parsed.npcId,
            familiarity: 'stranger',
            disposition: 'neutral',
            notes: null,
            firstMetAt: null,
            lastInteractionAt: null,
            interactionCount: 0
        },
        recentMemories: memories,
        // Generate LLM-ready summary
        contextSummary: buildContextSummary(relationship, memories)
    };

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify(context, null, 2)
        }]
    };
}

/**
 * Build a human-readable context summary for LLM injection
 */
function buildContextSummary(
    relationship: { familiarity: string; disposition: string; notes: string | null; interactionCount: number } | null,
    memories: Array<{ summary: string; importance: string; topics: string[] }>
): string {
    const lines: string[] = [];

    if (relationship) {
        lines.push(`RELATIONSHIP: ${relationship.familiarity} (${relationship.disposition})`);
        lines.push(`Previous interactions: ${relationship.interactionCount}`);
        if (relationship.notes) {
            lines.push(`Notes: ${relationship.notes}`);
        }
    } else {
        lines.push(`RELATIONSHIP: First meeting (stranger, neutral)`);
    }

    if (memories.length > 0) {
        lines.push('');
        lines.push('PREVIOUS CONVERSATIONS:');
        for (const memory of memories) {
            const importance = memory.importance === 'critical' ? '!!!' :
                memory.importance === 'high' ? '!!' :
                    memory.importance === 'medium' ? '!' : '';
            lines.push(`${importance} ${memory.summary}`);
            if (memory.topics.length > 0) {
                lines.push(`  Topics: ${memory.topics.join(', ')}`);
            }
        }
    }

    return lines.join('\n');
}
