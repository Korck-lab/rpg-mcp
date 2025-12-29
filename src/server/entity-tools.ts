import { z } from 'zod';
import { getDb } from '../storage/index.js';
import { CharacterRepository } from '../storage/repos/character.repo.js';
import { MonsterRepository, MonsterCreateInput } from '../storage/repos/monster.repo.js';
import { CorpseRepository } from '../storage/repos/corpse.repo.js';
import { SessionContext } from './types.js';
import { RichFormatter } from './utils/formatter.js';
import { SpellSlotsSchema, PactMagicSlotsSchema } from '../schema/spell.js';

/**
 * T065-T066: Entity Management Tools
 * 
 * Provides MCP tools for:
 * - Character CRUD operations (extended from crud-tools)
 * - Monster spawn/damage/kill
 * - Corpse creation and management
 */

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function ensureDb() {
    const dbPath = process.env.NODE_ENV === 'test'
        ? ':memory:'
        : process.env.RPG_DATA_DIR
            ? `${process.env.RPG_DATA_DIR}/rpg.db`
            : 'rpg.db';
    const db = getDb(dbPath);
    const charRepo = new CharacterRepository(db);
    const monsterRepo = new MonsterRepository(db);
    const corpseRepo = new CorpseRepository(db);
    return { db, charRepo, monsterRepo, corpseRepo };
}

// ============================================================
// TOOL DEFINITIONS
// ============================================================

export const EntityTools = {
    // --------------------------------------------------------
    // CHARACTER TOOLS (extended operations)
    // --------------------------------------------------------
    
    CHARACTER_MOVE: {
        name: 'character_move',
        description: 'Move a character to a new room.',
        inputSchema: z.object({
            characterId: z.string().describe('Character ID'),
            roomId: z.string().describe('Target room ID'),
        }),
    },

    CHARACTER_ADD_CONDITION: {
        name: 'character_add_condition',
        description: 'Add a condition to a character (e.g., Poisoned, Frightened).',
        inputSchema: z.object({
            characterId: z.string(),
            condition: z.string().describe('Condition name'),
            duration: z.number().int().optional().describe('Duration in rounds'),
            source: z.string().optional().describe('Source of the condition'),
        }),
    },

    CHARACTER_REMOVE_CONDITION: {
        name: 'character_remove_condition',
        description: 'Remove a condition from a character.',
        inputSchema: z.object({
            characterId: z.string(),
            condition: z.string().describe('Condition name to remove'),
        }),
    },

    CHARACTER_UPDATE_SPELL_SLOTS: {
        name: 'character_update_spell_slots',
        description: 'Update spell slot usage for a character.',
        inputSchema: z.object({
            characterId: z.string(),
            spellSlots: SpellSlotsSchema.optional(),
            pactMagicSlots: PactMagicSlotsSchema.optional(),
        }),
    },

    // --------------------------------------------------------
    // MONSTER TOOLS
    // --------------------------------------------------------

    MONSTER_SPAWN: {
        name: 'monster_spawn',
        description: `Spawn a monster from a template into a room.

Example:
{
  "worldId": "world-123",
  "templateId": "goblin",
  "roomId": "room-456",
  "name": "Goblin Warrior",
  "hp": 7,
  "maxHp": 7,
  "ac": 15,
  "cr": 0.25,
  "xp": 50,
  "stats": { "str": 8, "dex": 14, "con": 10, "int": 10, "wis": 8, "cha": 8 },
  "creatureType": "humanoid"
}`,
        inputSchema: z.object({
            worldId: z.string(),
            templateId: z.string().describe('Monster template identifier'),
            roomId: z.string().describe('Room to spawn monster in'),
            name: z.string(),
            hp: z.number().int().min(1),
            maxHp: z.number().int().min(1),
            ac: z.number().int().min(0),
            cr: z.number().min(0),
            xp: z.number().int().min(0),
            stats: z.object({
                str: z.number().int().min(0),
                dex: z.number().int().min(0),
                con: z.number().int().min(0),
                int: z.number().int().min(0),
                wis: z.number().int().min(0),
                cha: z.number().int().min(0),
            }),
            size: z.enum(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']).optional(),
            creatureType: z.string(),
            alignment: z.string().optional(),
            speed: z.number().int().min(0).optional(),
            positionX: z.number().int().optional(),
            positionY: z.number().int().optional(),
            positionZ: z.number().int().optional(),
            encounterId: z.string().optional(),
            conditions: z.array(z.string()).optional(),
            resistances: z.array(z.string()).optional(),
            vulnerabilities: z.array(z.string()).optional(),
            immunities: z.array(z.string()).optional(),
        }),
    },

    MONSTER_GET: {
        name: 'monster_get',
        description: 'Get a monster by ID.',
        inputSchema: z.object({
            monsterId: z.string(),
        }),
    },

    MONSTER_DAMAGE: {
        name: 'monster_damage',
        description: 'Apply damage to a monster. Returns updated monster state.',
        inputSchema: z.object({
            monsterId: z.string(),
            damage: z.number().int().min(0).describe('Amount of damage to apply'),
        }),
    },

    MONSTER_KILL: {
        name: 'monster_kill',
        description: 'Kill a monster and optionally create a corpse for looting.',
        inputSchema: z.object({
            monsterId: z.string(),
            createCorpse: z.boolean().optional().default(true).describe('Whether to create a lootable corpse'),
        }),
    },

    MONSTER_LIST_IN_ROOM: {
        name: 'monster_list_in_room',
        description: 'List all monsters in a room.',
        inputSchema: z.object({
            roomId: z.string(),
        }),
    },

    MONSTER_LIST_ALIVE: {
        name: 'monster_list_alive',
        description: 'List all living monsters in a world.',
        inputSchema: z.object({
            worldId: z.string(),
        }),
    },

    // --------------------------------------------------------
    // CORPSE TOOLS
    // --------------------------------------------------------

    CORPSE_CREATE: {
        name: 'corpse_create_from_monster',
        description: 'Create a corpse from a dead monster for looting.',
        inputSchema: z.object({
            monsterId: z.string(),
            worldId: z.string().optional(),
            regionId: z.string().optional(),
            encounterId: z.string().optional(),
        }),
    },

    CORPSE_LOOT: {
        name: 'corpse_loot',
        description: 'Loot items from a corpse.',
        inputSchema: z.object({
            corpseId: z.string(),
            characterId: z.string().describe('Character doing the looting'),
            itemId: z.string().optional().describe('Specific item to loot'),
            lootAll: z.boolean().optional().describe('Loot everything'),
        }),
    },

    CORPSE_DECAY: {
        name: 'corpse_advance_decay',
        description: 'Advance corpse decay when game time passes.',
        inputSchema: z.object({
            hoursAdvanced: z.number().int().min(1),
        }),
    },
} as const;

// ============================================================
// HANDLER IMPLEMENTATIONS
// ============================================================

// Character Handlers

export async function handleCharacterMove(args: unknown, _ctx: SessionContext) {
    const { charRepo } = ensureDb();
    const parsed = EntityTools.CHARACTER_MOVE.inputSchema.parse(args);

    const existing = charRepo.findById(parsed.characterId);
    if (!existing) {
        throw new Error(`Character not found: ${parsed.characterId}`);
    }

    const updated = charRepo.update(parsed.characterId, {
        currentRoomId: parsed.roomId,
    });

    if (!updated) {
        throw new Error(`Failed to update character: ${parsed.characterId}`);
    }

    let output = RichFormatter.header('Character Moved', '🚶');
    output += RichFormatter.keyValue({
        'Character': updated.name,
        'ID': `\`${updated.id}\``,
        'New Room': `\`${parsed.roomId}\``,
    });
    output += RichFormatter.embedJson({ character: updated }, 'CHARACTER');

    return {
        content: [{
            type: 'text' as const,
            text: output,
        }],
    };
}

export async function handleCharacterAddCondition(args: unknown, _ctx: SessionContext) {
    const { charRepo } = ensureDb();
    const parsed = EntityTools.CHARACTER_ADD_CONDITION.inputSchema.parse(args);

    const existing = charRepo.findById(parsed.characterId);
    if (!existing) {
        throw new Error(`Character not found: ${parsed.characterId}`);
    }

    const currentConditions: Array<{ name: string; duration?: number; source?: string }> =
        (existing as any).conditions || [];

    // Check if condition already exists
    const existingIdx = currentConditions.findIndex(
        c => c.name.toLowerCase() === parsed.condition.toLowerCase()
    );

    const newCondition = {
        name: parsed.condition,
        duration: parsed.duration,
        source: parsed.source,
    };

    if (existingIdx >= 0) {
        // Update existing condition
        currentConditions[existingIdx] = newCondition;
    } else {
        // Add new condition
        currentConditions.push(newCondition);
    }

    const updated = charRepo.update(parsed.characterId, {
        conditions: currentConditions,
    } as any);

    if (!updated) {
        throw new Error(`Failed to update character: ${parsed.characterId}`);
    }

    let output = RichFormatter.header('Condition Added', '⚡');
    output += RichFormatter.keyValue({
        'Character': updated.name,
        'Condition': parsed.condition,
        'Duration': parsed.duration ? `${parsed.duration} rounds` : 'Until removed',
        'Source': parsed.source || 'Unknown',
    });
    output += RichFormatter.embedJson({
        character: updated,
        conditionAdded: newCondition,
    }, 'CHARACTER');

    return {
        content: [{
            type: 'text' as const,
            text: output,
        }],
    };
}

export async function handleCharacterRemoveCondition(args: unknown, _ctx: SessionContext) {
    const { charRepo } = ensureDb();
    const parsed = EntityTools.CHARACTER_REMOVE_CONDITION.inputSchema.parse(args);

    const existing = charRepo.findById(parsed.characterId);
    if (!existing) {
        throw new Error(`Character not found: ${parsed.characterId}`);
    }

    const currentConditions: Array<{ name: string; duration?: number; source?: string }> =
        (existing as any).conditions || [];

    const filteredConditions = currentConditions.filter(
        c => c.name.toLowerCase() !== parsed.condition.toLowerCase()
    );

    const removed = currentConditions.length !== filteredConditions.length;

    const updated = charRepo.update(parsed.characterId, {
        conditions: filteredConditions,
    } as any);

    if (!updated) {
        throw new Error(`Failed to update character: ${parsed.characterId}`);
    }

    let output = RichFormatter.header('Condition Removed', '✨');
    output += RichFormatter.keyValue({
        'Character': updated.name,
        'Condition': parsed.condition,
        'Was Present': removed ? 'Yes' : 'No',
    });
    output += RichFormatter.embedJson({
        character: updated,
        conditionRemoved: parsed.condition,
        wasPresent: removed,
    }, 'CHARACTER');

    return {
        content: [{
            type: 'text' as const,
            text: output,
        }],
    };
}

export async function handleCharacterUpdateSpellSlots(args: unknown, _ctx: SessionContext) {
    const { charRepo } = ensureDb();
    const parsed = EntityTools.CHARACTER_UPDATE_SPELL_SLOTS.inputSchema.parse(args);

    const existing = charRepo.findById(parsed.characterId);
    if (!existing) {
        throw new Error(`Character not found: ${parsed.characterId}`);
    }

    const updates: Record<string, unknown> = {};
    if (parsed.spellSlots) updates.spellSlots = parsed.spellSlots;
    if (parsed.pactMagicSlots) updates.pactMagicSlots = parsed.pactMagicSlots;

    const updated = charRepo.update(parsed.characterId, updates);

    if (!updated) {
        throw new Error(`Failed to update character: ${parsed.characterId}`);
    }

    let output = RichFormatter.header('Spell Slots Updated', '📖');
    output += RichFormatter.keyValue({
        'Character': updated.name,
    });
    output += RichFormatter.embedJson({ character: updated }, 'CHARACTER');

    return {
        content: [{
            type: 'text' as const,
            text: output,
        }],
    };
}

// Monster Handlers

export async function handleMonsterSpawn(args: unknown, _ctx: SessionContext) {
    const { monsterRepo } = ensureDb();
    const parsed = EntityTools.MONSTER_SPAWN.inputSchema.parse(args);

    const createInput: MonsterCreateInput = {
        name: parsed.name,
        hp: parsed.hp,
        maxHp: parsed.maxHp,
        ac: parsed.ac,
        cr: parsed.cr,
        xp: parsed.xp,
        stats: parsed.stats,
        size: parsed.size,
        creatureType: parsed.creatureType,
        alignment: parsed.alignment,
        speed: parsed.speed,
        roomId: parsed.roomId,
        positionX: parsed.positionX,
        positionY: parsed.positionY,
        positionZ: parsed.positionZ,
        encounterId: parsed.encounterId,
        conditions: parsed.conditions,
        resistances: parsed.resistances,
        vulnerabilities: parsed.vulnerabilities,
        immunities: parsed.immunities,
    };

    const result = monsterRepo.create(
        parsed.worldId,
        parsed.templateId,
        parsed.roomId,
        createInput
    );

    if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to spawn monster');
    }

    const monster = result.data;

    let output = RichFormatter.header('Monster Spawned', '👹');
    output += RichFormatter.keyValue({
        'Name': monster.name,
        'ID': `\`${monster.id}\``,
        'Template': monster.templateId,
        'HP': `${monster.hp}/${monster.maxHp}`,
        'AC': `${monster.ac}`,
        'CR': `${monster.cr}`,
        'Room': `\`${monster.roomId}\``,
    });
    output += RichFormatter.embedJson({ monster }, 'MONSTER');

    return {
        content: [{
            type: 'text' as const,
            text: output,
        }],
    };
}

export async function handleMonsterGet(args: unknown, _ctx: SessionContext) {
    const { monsterRepo } = ensureDb();
    const parsed = EntityTools.MONSTER_GET.inputSchema.parse(args);

    const result = monsterRepo.findById(parsed.monsterId);

    if (!result.success || !result.data) {
        throw new Error(result.error || `Monster not found: ${parsed.monsterId}`);
    }

    const monster = result.data;

    let output = RichFormatter.header(`Monster: ${monster.name}`, '👹');
    output += RichFormatter.keyValue({
        'ID': `\`${monster.id}\``,
        'Template': monster.templateId,
        'HP': `${monster.hp}/${monster.maxHp}`,
        'AC': `${monster.ac}`,
        'CR': `${monster.cr}`,
        'XP': `${monster.xp}`,
        'Alive': monster.isAlive ? 'Yes' : 'No',
        'Room': monster.roomId ? `\`${monster.roomId}\`` : 'None',
    });
    output += RichFormatter.embedJson({ monster }, 'MONSTER');

    return {
        content: [{
            type: 'text' as const,
            text: output,
        }],
    };
}

export async function handleMonsterDamage(args: unknown, _ctx: SessionContext) {
    const { monsterRepo } = ensureDb();
    const parsed = EntityTools.MONSTER_DAMAGE.inputSchema.parse(args);

    // Get current monster
    const current = monsterRepo.findById(parsed.monsterId);
    if (!current.success || !current.data) {
        throw new Error(current.error || `Monster not found: ${parsed.monsterId}`);
    }

    const oldHp = current.data.hp;
    const newHp = Math.max(0, oldHp - parsed.damage);

    const result = monsterRepo.updateHP(parsed.monsterId, newHp);

    if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to update monster HP');
    }

    const monster = result.data;
    const isDead = monster.hp <= 0;

    let output = RichFormatter.header('Monster Damaged', '💥');
    output += RichFormatter.keyValue({
        'Monster': monster.name,
        'Damage': `${parsed.damage}`,
        'HP': `${oldHp} → ${monster.hp}/${monster.maxHp}`,
        'Status': isDead ? '💀 DEAD' : '✅ Alive',
    });
    output += RichFormatter.embedJson({
        monster,
        damage: parsed.damage,
        previousHp: oldHp,
        isDead,
    }, 'MONSTER');

    return {
        content: [{
            type: 'text' as const,
            text: output,
        }],
    };
}

export async function handleMonsterKill(args: unknown, _ctx: SessionContext) {
    const { monsterRepo, corpseRepo } = ensureDb();
    const parsed = EntityTools.MONSTER_KILL.inputSchema.parse(args);

    // Get monster first
    const current = monsterRepo.findById(parsed.monsterId);
    if (!current.success || !current.data) {
        throw new Error(current.error || `Monster not found: ${parsed.monsterId}`);
    }

    const monster = current.data;

    // Kill the monster
    const result = monsterRepo.kill(parsed.monsterId);
    if (!result.success) {
        throw new Error(result.error || 'Failed to kill monster');
    }

    let corpse = null;

    // Create corpse if requested
    if (parsed.createCorpse !== false) {
        corpse = corpseRepo.createFromDeath(
            monster.id,
            monster.name,
            'enemy',
            {
                creatureType: monster.creatureType,
                cr: monster.cr,
                worldId: monster.worldId,
                encounterId: monster.encounterId || undefined,
                position: monster.positionX !== null && monster.positionY !== null
                    ? { x: monster.positionX, y: monster.positionY }
                    : undefined,
            }
        );
    }

    let output = RichFormatter.header('Monster Killed', '💀');
    output += RichFormatter.keyValue({
        'Monster': monster.name,
        'XP Reward': `${monster.xp}`,
        'Corpse Created': corpse ? 'Yes' : 'No',
    });
    if (corpse) {
        output += RichFormatter.subSection('Corpse');
        output += RichFormatter.keyValue({
            'Corpse ID': `\`${corpse.id}\``,
            'State': corpse.state,
        });
    }
    output += RichFormatter.embedJson({
        monster: result.data,
        corpse,
        xpReward: monster.xp,
    }, 'MONSTER_KILLED');

    return {
        content: [{
            type: 'text' as const,
            text: output,
        }],
    };
}

export async function handleMonsterListInRoom(args: unknown, _ctx: SessionContext) {
    const { monsterRepo } = ensureDb();
    const parsed = EntityTools.MONSTER_LIST_IN_ROOM.inputSchema.parse(args);

    const result = monsterRepo.getByLocation(parsed.roomId);

    if (!result.success) {
        throw new Error(result.error || 'Failed to list monsters');
    }

    const monsters = result.data || [];

    let output = RichFormatter.header('Monsters in Room', '👹');
    output += RichFormatter.keyValue({ 'Room': `\`${parsed.roomId}\`` });

    if (monsters.length === 0) {
        output += RichFormatter.alert('No monsters in this room.', 'info');
    } else {
        const rows = monsters.map(m => [
            m.name,
            `\`${m.id.slice(0, 8)}...\``,
            `${m.hp}/${m.maxHp}`,
            m.isAlive ? '✅' : '💀',
        ]);
        output += RichFormatter.table(['Name', 'ID', 'HP', 'Status'], rows);
    }
    output += RichFormatter.embedJson({ roomId: parsed.roomId, monsters, count: monsters.length }, 'MONSTERS');

    return {
        content: [{
            type: 'text' as const,
            text: output,
        }],
    };
}

export async function handleMonsterListAlive(args: unknown, _ctx: SessionContext) {
    const { monsterRepo } = ensureDb();
    const parsed = EntityTools.MONSTER_LIST_ALIVE.inputSchema.parse(args);

    const result = monsterRepo.getAlive(parsed.worldId);

    if (!result.success) {
        throw new Error(result.error || 'Failed to list monsters');
    }

    const monsters = result.data || [];

    let output = RichFormatter.header('Living Monsters', '👹');
    output += RichFormatter.keyValue({ 'World': `\`${parsed.worldId}\`` });

    if (monsters.length === 0) {
        output += RichFormatter.alert('No living monsters in this world.', 'info');
    } else {
        const rows = monsters.map(m => [
            m.name,
            `\`${m.id.slice(0, 8)}...\``,
            `${m.hp}/${m.maxHp}`,
            `CR ${m.cr}`,
            m.roomId ? `\`${m.roomId.slice(0, 8)}...\`` : '-',
        ]);
        output += RichFormatter.table(['Name', 'ID', 'HP', 'CR', 'Room'], rows);
    }
    output += RichFormatter.embedJson({ worldId: parsed.worldId, monsters, count: monsters.length }, 'MONSTERS');

    return {
        content: [{
            type: 'text' as const,
            text: output,
        }],
    };
}

// Corpse Handlers

export async function handleCorpseCreateFromMonster(args: unknown, _ctx: SessionContext) {
    const { monsterRepo, corpseRepo } = ensureDb();
    const parsed = EntityTools.CORPSE_CREATE.inputSchema.parse(args);

    // Get monster
    const monsterResult = monsterRepo.findById(parsed.monsterId);
    if (!monsterResult.success || !monsterResult.data) {
        throw new Error(monsterResult.error || `Monster not found: ${parsed.monsterId}`);
    }

    const monster = monsterResult.data;

    const corpse = corpseRepo.createFromDeath(
        monster.id,
        monster.name,
        'enemy',
        {
            creatureType: monster.creatureType,
            cr: monster.cr,
            worldId: parsed.worldId || monster.worldId,
            regionId: parsed.regionId,
            encounterId: parsed.encounterId || monster.encounterId || undefined,
            position: monster.positionX !== null && monster.positionY !== null
                ? { x: monster.positionX, y: monster.positionY }
                : undefined,
        }
    );

    let output = RichFormatter.header('Corpse Created', '💀');
    output += RichFormatter.keyValue({
        'Monster': monster.name,
        'Corpse ID': `\`${corpse.id}\``,
        'State': corpse.state,
        'CR': `${monster.cr}`,
    });
    output += RichFormatter.embedJson({ corpse }, 'CORPSE');

    return {
        content: [{
            type: 'text' as const,
            text: output,
        }],
    };
}

export async function handleCorpseLoot(args: unknown, _ctx: SessionContext) {
    const { corpseRepo } = ensureDb();
    const parsed = EntityTools.CORPSE_LOOT.inputSchema.parse(args);

    if (parsed.lootAll) {
        const looted = corpseRepo.lootAll(parsed.corpseId, parsed.characterId);
        
        let output = RichFormatter.header('Corpse Looted', '💰');
        output += RichFormatter.keyValue({
            'Corpse': `\`${parsed.corpseId}\``,
            'Looter': `\`${parsed.characterId}\``,
            'Items Looted': `${looted.length}`,
        });
        if (looted.length > 0) {
            output += RichFormatter.list(looted.map(i => `${i.itemId} x${i.quantity}`));
        }
        output += RichFormatter.embedJson({
            corpseId: parsed.corpseId,
            lootedBy: parsed.characterId,
            itemsLooted: looted,
        }, 'LOOT');

        return {
            content: [{
                type: 'text' as const,
                text: output,
            }],
        };
    }

    if (!parsed.itemId) {
        throw new Error('Must specify itemId or set lootAll: true');
    }

    const result = corpseRepo.lootItem(parsed.corpseId, parsed.itemId, parsed.characterId);

    let output = RichFormatter.header('Item Looted', '💰');
    output += RichFormatter.keyValue({
        'Success': result.success ? 'Yes' : 'No',
        'Item': result.itemId || 'N/A',
        'Quantity': `${result.quantity || 0}`,
        'Reason': result.reason || 'OK',
    });
    output += RichFormatter.embedJson(result, 'LOOT');

    return {
        content: [{
            type: 'text' as const,
            text: output,
        }],
    };
}

export async function handleCorpseAdvanceDecay(args: unknown, _ctx: SessionContext) {
    const { corpseRepo } = ensureDb();
    const parsed = EntityTools.CORPSE_DECAY.inputSchema.parse(args);

    const changes = corpseRepo.processDecay(parsed.hoursAdvanced);

    let output = RichFormatter.header('Corpse Decay Processed', '⏳');
    output += RichFormatter.keyValue({
        'Hours Advanced': `${parsed.hoursAdvanced}`,
        'Corpses Affected': `${changes.length}`,
    });

    if (changes.length > 0) {
        const rows = changes.map(c => [c.corpseId.slice(0, 8) + '...', c.oldState, '→', c.newState]);
        output += RichFormatter.table(['Corpse', 'From', '', 'To'], rows);
    }

    output += RichFormatter.embedJson({
        hoursAdvanced: parsed.hoursAdvanced,
        changes,
    }, 'DECAY');

    return {
        content: [{
            type: 'text' as const,
            text: output,
        }],
    };
}
