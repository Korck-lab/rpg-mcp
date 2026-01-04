import { z } from 'zod';
import { randomUUID } from 'crypto';
import { CombatEngine, CombatState, CombatActionResult } from '../engine/combat/engine.js';
import { SpatialEngine } from '../engine/spatial/engine.js';
import { CombatRNG } from '../engine/combat/rng.js';

import { PubSub } from '../engine/pubsub.js';

import { getCombatManager } from './state/combat-manager.js';
import { getDb } from '../storage/index.js';
import { EncounterRepository } from '../storage/repos/encounter.repo.js';
import { SessionContext } from './types.js';

// CRIT-006: Import spellcasting validation and resolution
import { validateSpellCast, consumeSpellSlot } from '../engine/magic/spell-validator.js';
import { resolveSpell } from '../engine/magic/spell-resolver.js';
import { CharacterRepository } from '../storage/repos/character.repo.js';
import { ConcentrationRepository } from '../storage/repos/concentration.repo.js';
import { startConcentration, checkConcentration, breakConcentration } from '../engine/magic/concentration.js';
import type { Character } from '../schema/character.js';
import { getPatternGenerator, PATTERN_DESCRIPTIONS } from './terrain-patterns.js';
import { generateDeterministicEncounterId } from '../utils/deterministic-id.js';

// Global combat state (in-memory for MVP)
let pubsub: PubSub | null = null;

export function setCombatPubSub(instance: PubSub) {
    pubsub = instance;
}

// ============================================================
// FORMATTING - Both human-readable AND machine-readable
// ============================================================

/**
 * Build a machine-readable state object for frontend sync
 */
function buildStateJson(state: CombatState, encounterId: string) {
    const currentParticipant = state.participants.find(
        (p) => p.id === state.turnOrder[state.currentTurnIndex]
    );

    return {
        encounterId,
        round: state.round,
        currentTurnIndex: state.currentTurnIndex,
        currentTurn: currentParticipant ? {
            id: currentParticipant.id,
            name: currentParticipant.name,
            isEnemy: currentParticipant.isEnemy
        } : null,
        turnOrder: state.turnOrder.map(id => {
            const p = state.participants.find(part => part.id === id);
            return p?.name || id;
        }),
        participants: state.participants.map(p => ({
            id: p.id,
            name: p.name,
            hp: p.hp,
            maxHp: p.maxHp,
            initiative: p.initiative,
            isEnemy: p.isEnemy,
            conditions: p.conditions.map(c => c.type),
            isDefeated: p.hp <= 0,
            isCurrentTurn: p.id === currentParticipant?.id,
            // Spatial visualization data
            position: p.position ?? null,
            size: p.size ?? 'medium',
            movementSpeed: p.movementSpeed ?? 30,
            movementRemaining: p.movementRemaining ?? (p.movementSpeed ?? 30)
        })),
        // HIGH-006: Lair action status
        isLairActionPending: state.turnOrder[state.currentTurnIndex] === 'LAIR',
        hasLairActions: state.hasLairActions ?? false,
        lairOwnerId: state.lairOwnerId,
        // Spatial visualization data
        terrain: state.terrain ?? { obstacles: [], difficultTerrain: [], water: [] },
        props: state.props ?? [],
        gridBounds: state.gridBounds ?? null
    };
}

/**
 * Format combat state for human reading in chat
 */
function formatCombatStateText(state: CombatState): string {
    const currentParticipant = state.participants.find(
        (p) => p.id === state.turnOrder[state.currentTurnIndex]
    );

    const isEnemy = currentParticipant?.isEnemy ?? false;

    // Header with round info
    const turnIcon = isEnemy ? '👹' : '⚔️';
    let output = `\n┌─────────────────────────────────────────┐\n`;
    output += `│ ${turnIcon} ROUND ${state.round} — ${currentParticipant?.name}'s Turn\n`;
    output += `└─────────────────────────────────────────┘\n\n`;

    // Initiative order with clear formatting
    output += `📋 INITIATIVE ORDER\n`;
    output += `───────────────────────────────────────────\n`;
    
    state.turnOrder.forEach((id: string, index: number) => {
        const p = state.participants.find((part) => part.id === id);
        if (!p) return;

        const isCurrent = index === state.currentTurnIndex;
        const icon = p.isEnemy ? '👹' : '🧙';
        const hpPct = p.maxHp > 0 ? (p.hp / p.maxHp) * 100 : 0;
        const hpBar = createHpBar(hpPct);
        const marker = isCurrent ? '▶' : ' ';
        const status = p.hp <= 0 ? '💀 DEFEATED' : '';
        
        output += `${marker} ${icon} ${p.name.padEnd(18)} ${hpBar} ${p.hp}/${p.maxHp} HP  [Init: ${p.initiative}] ${status}\n`;
    });
    
    output += `\n`;

    // Find valid targets for guidance
    const validPlayerTargets = state.participants
        .filter(p => !p.isEnemy && p.hp > 0)
        .map(p => `${p.name} (${p.id})`);
    
    const validEnemyTargets = state.participants
        .filter(p => p.isEnemy && p.hp > 0)
        .map(p => `${p.name} (${p.id})`);

    // Action guidance
    if (isEnemy && currentParticipant && currentParticipant.hp > 0) {
        output += `⚡ ENEMY TURN\n`;
        output += `   Available targets: ${validPlayerTargets.join(', ') || 'None'}\n`;
        output += `   → Execute attack, then call advance_turn\n`;
    } else if (currentParticipant && currentParticipant.hp > 0) {
        output += `🎮 PLAYER TURN\n`;
        output += `   Available targets: ${validEnemyTargets.join(', ') || 'None'}\n`;
        output += `   → Awaiting player action\n`;
    } else {
        output += `⏭️ Current combatant is defeated — call advance_turn\n`;
    }

    return output;
}

/**
 * Create a visual HP bar
 */
function createHpBar(percentage: number): string {
    const filled = Math.max(0, Math.min(10, Math.round(percentage / 10)));
    const empty = 10 - filled;
    
    // Simple ASCII bar for cleaner output
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    return `[${bar}]`;
}

/**
 * Format an attack result for display
 */
function formatAttackResult(result: CombatActionResult): string {
    let output = `\n┌─────────────────────────────────────────┐\n`;
    output += `│ ⚔️  ATTACK ACTION\n`;
    output += `└─────────────────────────────────────────┘\n\n`;
    
    output += `${result.actor.name} attacks ${result.target.name}!\n\n`;
    output += result.detailedBreakdown;
    
    if (result.defeated) {
        output += `\n\n💀 ${result.target.name} has been defeated!`;
    }
    
    output += `\n\n→ Call advance_turn to proceed`;
    
    return output;
}

/**
 * Format a heal result for display
 */
function formatHealResult(result: CombatActionResult): string {
    let output = `\n┌─────────────────────────────────────────┐\n`;
    output += `│ 💚 HEAL ACTION\n`;
    output += `└─────────────────────────────────────────┘\n\n`;

    output += `${result.actor.name} heals ${result.target.name}!\n\n`;
    output += result.detailedBreakdown;
    output += `\n\n→ Call advance_turn to proceed`;

    return output;
}

/**
 * CRIT-006: Format spell cast result for display
 */
function formatSpellCastResult(
    casterName: string,
    resolution: { 
        spellName: string; 
        damage?: number; 
        damageType?: string; 
        healing?: number; 
        diceRolled: string; 
        saveResult?: string; 
        saveDC?: number; 
        autoHit?: boolean; 
        dartCount?: number; 
        concentration?: boolean;
        attackRoll?: number;
        attackTotal?: number;
        hit?: boolean;
    },
    target: { name: string; hp: number; maxHp: number } | undefined,
    targetHpBefore: number
): string {
    let output = `\n┌─────────────────────────────────────────┐\n`;
    output += `│ ✨ SPELL CAST\n`;
    output += `└─────────────────────────────────────────┘\n\n`;
    output += `${casterName} casts ${resolution.spellName}!\n\n`;

    // Attack Roll details
    if (resolution.attackRoll !== undefined) {
        const hitStr = resolution.hit ? 'HIT' : 'MISS';
        const bonus = (resolution.attackTotal || 0) - resolution.attackRoll;
        const sign = bonus >= 0 ? '+' : '';
        output += `⚔️ Attack Roll: ${resolution.attackRoll} (d20) ${sign}${bonus} = ${resolution.attackTotal} → ${hitStr}\n`;
    }

    // Dice & Damage
    if (resolution.diceRolled) {
        output += `🎲 Rolled: ${resolution.diceRolled}\n`;
    }

    // Special: Magic Missile darts
    if (resolution.dartCount) {
        output += `✨ Darts: ${resolution.dartCount}\n`;
    }

    // Save info (moved into damage block if applicable, or standalone if no damage)
    if (resolution.saveResult && resolution.saveDC && (!resolution.damage || resolution.damage <= 0)) {
        const saveIcon = resolution.saveResult === 'passed' ? '✓' : '✗';
        output += `🛡️ Save DC ${resolution.saveDC}: ${saveIcon} ${resolution.saveResult}\n`;
    }

    // Auto-hit
    if (resolution.autoHit) {
        output += `🎯 Auto-hit!\n`;
    }

    // Damage
    if (resolution.damage !== undefined && resolution.damage > 0) {
        const damageType = resolution.damageType || 'magical';
        output += `💥 Damage: ${resolution.damage} ${damageType}\n`;
        
        // Save details (if damage was dealt and there was a save)
        if (resolution.saveResult) {
            const saveEmoji = resolution.saveResult === 'passed' ? '✓' : '✗';
            output += `   (Save DC ${resolution.saveDC}: ${saveEmoji} ${resolution.saveResult.toUpperCase()})\n`;
        }

        if (target) {
            output += `\n${target.name}: ${targetHpBefore} → ${target.hp} HP`;
            if (target.hp <= 0) {
                output += ` 💀 DEFEATED!`;
            }
        }
    } else if (resolution.hit === false) {
        output += `💨 The spell missed!\n`;
    }

    // Healing
    if (resolution.healing && resolution.healing > 0) {
        output += `💚 Healing: ${resolution.healing}\n`;

        if (target) {
            output += `\n${target.name}: ${targetHpBefore} → ${target.hp} HP`;
        }
    }

    // Concentration
    if (resolution.concentration) {
        output += `\n⚡ Concentration required`;
    }

    output += `\n\n→ Call advance_turn to proceed`;

    return output;
}

/**
 * HIGH-003: Format disengage result for display
 */
function formatDisengageResult(actorName: string): string {
    let output = `\n┌─────────────────────────────────────────┐\n`;
    output += `│ 🏃 DISENGAGE ACTION\n`;
    output += `└─────────────────────────────────────────┘\n\n`;
    output += `${actorName} takes the Disengage action.\n`;
    output += `Movement this turn will not provoke opportunity attacks.\n`;
    output += `\n→ Call advance_turn to proceed (or move first)`;
    return output;
}

/**
 * HIGH-003: Format opportunity attack result for display
 */
function formatOpportunityAttackResult(result: CombatActionResult): string {
    let output = `\n┌─────────────────────────────────────────┐\n`;
    output += `│ ⚡ OPPORTUNITY ATTACK\n`;
    output += `└─────────────────────────────────────────┘\n\n`;
    output += result.detailedBreakdown;
    return output;
}

/**
 * CRIT-003: Format a move result for display
 */
function formatMoveResult(
    actorName: string,
    fromPos: { x: number; y: number } | undefined,
    toPos: { x: number; y: number },
    success: boolean,
    failReason: string | null,
    distance?: number
): string {
    let output = `\n┌─────────────────────────────────────────┐\n`;
    output += `│ 🚶 MOVE ACTION\n`;
    output += `└─────────────────────────────────────────┘\n\n`;

    if (success) {
        if (fromPos) {
            output += `${actorName} moved from (${fromPos.x}, ${fromPos.y}) to (${toPos.x}, ${toPos.y})`;
            if (distance !== undefined) {
                output += ` [${distance} tiles]`;
            }
            output += `\n`;
        } else {
            output += `${actorName} placed at (${toPos.x}, ${toPos.y})\n`;
        }
    } else {
        output += `${actorName} cannot move to (${toPos.x}, ${toPos.y})\n`;
        output += `Reason: ${failReason}\n`;
    }

    output += `\n→ Call advance_turn to proceed`;
    return output;
}

// ============================================================
// GRID VISUALIZATION - ASCII rendering for spatial combat
// ============================================================

/**
 * Render an ASCII grid map of the combat state
 * Shows participant positions, terrain, and coordinate labels
 */
function renderGrid(state: CombatState, options?: { width?: number; height?: number; showLegend?: boolean }): string {
    const width = options?.width ?? 20;
    const height = options?.height ?? 20;
    const showLegend = options?.showLegend ?? true;

    // Build grid with empty cells
    const grid: string[][] = [];
    for (let y = 0; y < height; y++) {
        grid[y] = [];
        for (let x = 0; x < width; x++) {
            grid[y][x] = '·';  // Empty tile
        }
    }

    // Place terrain obstacles
    const terrain = state.terrain ?? { obstacles: [] };
    for (const obs of terrain.obstacles) {
        const [x, y] = obs.split(',').map(Number);
        if (x >= 0 && x < width && y >= 0 && y < height) {
            grid[y][x] = '█';  // Solid obstacle
        }
    }

    // Place difficult terrain
    if (terrain.difficultTerrain) {
        for (const dt of terrain.difficultTerrain) {
            const [x, y] = dt.split(',').map(Number);
            if (x >= 0 && x < width && y >= 0 && y < height && grid[y][x] === '·') {
                grid[y][x] = '░';  // Difficult terrain
            }
        }
    }

    // Place participants
    const legend: string[] = [];
    let friendlyIndex = 1;
    let enemyIndex = 1;

    for (const p of state.participants) {
        if (!p.position) continue;
        const { x, y } = p.position;
        if (x >= 0 && x < width && y >= 0 && y < height) {
            let symbol: string;
            if (p.hp <= 0) {
                symbol = '☠';  // Defeated
            } else if (p.isEnemy) {
                symbol = String(enemyIndex);
                legend.push(`  ${symbol} = ${p.name} (Enemy, HP: ${p.hp}/${p.maxHp})`);
                enemyIndex = (enemyIndex % 9) + 1;
            } else {
                symbol = String.fromCharCode(64 + friendlyIndex);  // A, B, C...
                legend.push(`  ${symbol} = ${p.name} (HP: ${p.hp}/${p.maxHp})`);
                friendlyIndex++;
            }
            grid[y][x] = symbol;
        }
    }

    // Build output string
    let output = '\n┌─ COMBAT MAP ─────────────────────────────┐\n';

    // Column headers (x-axis)
    output += '    ';
    for (let x = 0; x < width; x++) {
        output += (x % 5 === 0) ? String(x).padStart(2, ' ').slice(-1) : ' ';
    }
    output += '\n';

    // Grid rows (with y-axis labels)
    for (let y = 0; y < height; y++) {
        const yLabel = (y % 5 === 0) ? String(y).padStart(2, ' ') : '  ';
        output += `${yLabel} │`;
        for (let x = 0; x < width; x++) {
            output += grid[y][x];
        }
        output += '│\n';
    }

    output += '└───────────────────────────────────────────┘\n';

    // Legend
    if (showLegend && legend.length > 0) {
        output += '\n📍 LEGEND:\n';
        output += legend.join('\n') + '\n';
        output += '\n  · = Empty   █ = Obstacle   ░ = Difficult Terrain   ☠ = Defeated\n';
    }

    return output;
}

/**
 * Calculate which tiles and participants are affected by an Area of Effect
 */
function calculateAoE(
    state: CombatState,
    shape: 'circle' | 'cone' | 'line',
    origin: { x: number; y: number },
    params: { radius?: number; direction?: { x: number; y: number }; length?: number; angle?: number; width?: number }
): { tiles: { x: number; y: number }[]; affectedParticipants: { id: string; name: string; position: { x: number; y: number } }[] } {
    const spatial = new SpatialEngine();
    let tiles: { x: number; y: number }[] = [];

    if (shape === 'circle' && params.radius !== undefined) {
        tiles = spatial.getCircleTiles(origin, params.radius);
    } else if (shape === 'cone' && params.direction && params.length !== undefined && params.angle !== undefined) {
        tiles = spatial.getConeTiles(origin, params.direction, params.length, params.angle);
    } else if (shape === 'line' && params.direction && params.length !== undefined) {
        // Line is a cone with 0 angle, or we use getLineTiles
        const endX = origin.x + params.direction.x * params.length;
        const endY = origin.y + params.direction.y * params.length;
        tiles = spatial.getLineTiles(origin, { x: endX, y: endY });
    }

    // Find participants in affected tiles
    const tileSet = new Set(tiles.map(t => `${t.x},${t.y}`));
    const affectedParticipants = state.participants
        .filter(p => p.position && tileSet.has(`${p.position.x},${p.position.y}`) && p.hp > 0)
        .map(p => ({ id: p.id, name: p.name, position: p.position! }));

    return { tiles, affectedParticipants };
}

// Tool definitions
export const CombatTools = {
    // Encounter management
    LIST_ENCOUNTERS: {
        name: 'listEncounters',
        description: 'List all encounters for a world.',
        inputSchema: z.object({
            worldId: z.string().describe('World ID to list encounters for'),
            status: z.enum(['active', 'completed', 'paused']).optional().describe('Filter by status'),
            activeOnly: z.boolean().default(false).describe('Only show active encounters')
        })
    },
    UPDATE_ENCOUNTER: {
        name: 'updateEncounter',
        description: 'Update encounter state.',
        inputSchema: z.object({
            encounterId: z.string().describe('Encounter ID'),
            round: z.number().int().optional(),
            activeTokenId: z.string().optional(),
            status: z.enum(['active', 'completed', 'paused']).optional(),
            terrain: z.any().optional(),
            props: z.array(z.any()).optional()
        })
    },
    DELETE_ENCOUNTER: {
        name: 'deleteEncounter',
        description: 'Delete an encounter.',
        inputSchema: z.object({
            encounterId: z.string().describe('Encounter ID to delete')
        })
    },
    // Token management
    ADD_TOKEN: {
        name: 'addToken',
        description: 'Add a token to an encounter.',
        inputSchema: z.object({
            encounterId: z.string().describe('Encounter ID'),
            characterId: z.string().describe('Character ID'),
            name: z.string().describe('Token name'),
            initiativeBonus: z.number().int().describe('Initiative bonus'),
            isEnemy: z.boolean().describe('Whether this is an enemy'),
            hp: z.number().int().describe('Current HP'),
            maxHp: z.number().int().describe('Maximum HP'),
            positionX: z.number().int().describe('X position'),
            positionY: z.number().int().describe('Y position'),
            movementSpeed: z.number().int().default(30).describe('Movement speed'),
            size: z.enum(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']).default('medium').describe('Size category')
        })
    },
    UPDATE_TOKEN: {
        name: 'updateToken',
        description: 'Update token state.',
        inputSchema: z.object({
            encounterId: z.string().describe('Encounter ID'),
            tokenId: z.string().describe('Token ID'),
            initiative: z.number().int().optional(),
            hp: z.number().int().optional(),
            positionX: z.number().int().optional(),
            positionY: z.number().int().optional(),
            positionZ: z.number().int().optional(),
            movementRemaining: z.number().int().optional(),
            hasReaction: z.boolean().optional(),
            hasAction: z.boolean().optional(),
            hasBonusAction: z.boolean().optional(),
            conditions: z.array(z.string()).optional()
        })
    },
    REMOVE_TOKEN: {
        name: 'removeToken',
        description: 'Remove a token from an encounter.',
        inputSchema: z.object({
            encounterId: z.string().describe('Encounter ID'),
            tokenId: z.string().describe('Token ID to remove')
        })
    },
    LIST_TOKENS: {
        name: 'listTokens',
        description: 'List tokens in an encounter.',
        inputSchema: z.object({
            encounterId: z.string().describe('Encounter ID'),
            isEnemy: z.boolean().optional().describe('Filter by enemy status')
        })
    },
    GET_TOKEN: {
        name: 'getToken',
        description: 'Get a single token by ID.',
        inputSchema: z.object({
            encounterId: z.string().describe('Encounter ID'),
            tokenId: z.string().describe('Token ID')
        })
    },
    // Initiative
    ROLL_INITIATIVE: {
        name: 'rollInitiative',
        description: 'Roll initiative for all tokens in an encounter.',
        inputSchema: z.object({
            encounterId: z.string().describe('Encounter ID')
        })
    },
    CREATE_ENCOUNTER: {
        name: 'createEncounter',
        description: `Create a new combat encounter.

Example:
{
  "worldId": "world-123",
  "regionId": "region-1",
  "seed": "battle-001",
  "participants": [
    {
      "id": "hero-1",
      "name": "Hero",
      "initiativeBonus": 2,
      "hp": 30,
      "maxHp": 30,
      "position": { "x": 0, "y": 0 }
    }
  ]
}`,
        inputSchema: z.object({
            worldId: z.string().describe('World ID where the encounter takes place'),
            regionId: z.string().optional().describe('Region ID (optional)'),
            roomId: z.string().optional().describe('Room ID (optional)'),
            terrain: z.any().optional().describe('Terrain configuration'),
            gridBounds: z.any().optional().describe('Grid boundaries'),
            seed: z.string().optional().describe('Seed for deterministic combat resolution'),
            participants: z.array(z.object({
                id: z.string().describe('Participant ID'),
                name: z.string().describe('Participant name'),
                initiativeBonus: z.number().int().default(0).describe('Initiative bonus'),
                hp: z.number().int().describe('Current HP'),
                maxHp: z.number().int().describe('Maximum HP'),
                position: z.object({ x: z.number().int(), y: z.number().int() }).optional().describe('Starting position'),
                isEnemy: z.boolean().default(false).describe('Whether this is an enemy'),
                movementSpeed: z.number().int().default(30).describe('Movement speed in feet'),
                size: z.enum(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']).default('medium').describe('Size category')
            })).optional().describe('Initial participants to add to the encounter')
        })
    },
    GET_ENCOUNTER_STATE: {
        name: 'getEncounter',
        description: 'Get the current state of the active combat encounter.',
        inputSchema: z.object({
            encounterId: z.string().describe('The ID of the encounter')
        })
    },
    EXECUTE_COMBAT_ACTION: {
        name: 'execute_combat_action',
        description: `Execute a combat action (attack, heal, move, cast_spell, etc.).

Examples:
{
  "action": "attack",
  "actorId": "hero-1",
  "targetId": "goblin-1",
  "attackBonus": 5,
  "dc": 12,
  "damage": 6
}

{
  "action": "heal",
  "actorId": "cleric-1",
  "targetId": "hero-1",
  "amount": 8
}

{
  "action": "move",
  "actorId": "hero-1",
  "targetPosition": { "x": 5, "y": 3 }
}

{
  "action": "disengage",
  "actorId": "hero-1"
}

{
  "action": "cast_spell",
  "actorId": "wizard-1",
  "spellName": "Fireball",
  "targetId": "goblin-1",
  "slotLevel": 3
}`,
        inputSchema: z.object({
            encounterId: z.string().describe('The ID of the encounter'),
            action: z.enum(['attack', 'heal', 'move', 'disengage', 'cast_spell']),
            actorId: z.string(),
            targetId: z.string().optional().describe('Target ID for attack/heal/cast_spell actions'),
            attackBonus: z.number().int().optional(),
            dc: z.number().int().optional(),
            damage: z.number().int().optional(),
            damageType: z.string().optional()
                .describe('HIGH-002: Damage type (e.g., "fire", "cold", "slashing") for resistance calculation'),
            amount: z.number().int().optional(),
            targetPosition: z.object({ x: z.number(), y: z.number() }).optional()
                .describe('CRIT-003: Target position for move action'),
            // CRIT-006: Spell casting fields
            spellName: z.string().optional()
                .describe('CRIT-006: Name of the spell to cast (must exist in spell database)'),
            slotLevel: z.number().int().min(1).max(9).optional()
                .describe('CRIT-006: Spell slot level to use (for upcasting)')
        })
    },
    ADVANCE_TURN: {
        name: 'advanceTurn',
        description: 'Advance to the next combatant\'s turn.',
        inputSchema: z.object({
            encounterId: z.string().describe('The ID of the encounter')
        })
    },
    END_ENCOUNTER: {
        name: 'end_encounter',
        description: 'End the current combat encounter.',
        inputSchema: z.object({
            encounterId: z.string().describe('The ID of the encounter')
        })
    },
    LOAD_ENCOUNTER: {
        name: 'load_encounter',
        description: 'Load a combat encounter from the database.',
        inputSchema: z.object({
            encounterId: z.string().describe('The ID of the encounter to load')
        })
    },
    ROLL_DEATH_SAVE: {
        name: 'roll_death_save',
        description: 'Roll a d20 death saving throw for a character at 0 HP. 10+ success, nat 20 regains 1 HP, nat 1 counts as 2 failures.',
        inputSchema: z.object({
            encounterId: z.string().describe('The ID of the encounter'),
            characterId: z.string().describe('The ID of the character at 0 HP')
        })
    },
    EXECUTE_LAIR_ACTION: {
        name: 'execute_lair_action',
        description: 'Execute a lair action at initiative 20 when isLairActionPending is true. Apply environmental effects to targets.',
        inputSchema: z.object({
            encounterId: z.string().describe('The ID of the encounter'),
            actionDescription: z.string().describe('Description of the lair action'),
            targetIds: z.array(z.string()).optional().describe('IDs of affected participants (optional)'),
            damage: z.number().int().min(0).optional().describe('Damage dealt by the lair action'),
            damageType: z.string().optional().describe('Type of damage (fire, cold, etc.)'),
            savingThrow: z.object({
                ability: z.enum(['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']),
                dc: z.number().int().min(1).max(30)
            }).optional().describe('Saving throw required to avoid/reduce effect'),
            halfDamageOnSave: z.boolean().default(true).describe('Whether successful save halves damage')
        })
    },
    // Concentration management
    SET_CONCENTRATION: {
        name: 'setConcentration',
        description: 'Set concentration on a spell.',
        inputSchema: z.object({
            character_id: z.string().describe('Character ID'),
            spell_name: z.string().describe('Spell name'),
            spell_level: z.number().int().describe('Spell level'),
            target_ids: z.array(z.string()).describe('Target IDs'),
            started_at: z.number().int().describe('Round when concentration started'),
            max_duration: z.number().int().optional().describe('Maximum duration in rounds'),
            save_dc_base: z.number().int().default(10).describe('Base save DC')
        })
    },
    BREAK_CONCENTRATION: {
        name: 'breakConcentration',
        description: 'Break concentration.',
        inputSchema: z.object({
            character_id: z.string().describe('Character ID')
        })
    },
    GET_CONCENTRATION: {
        name: 'getConcentration',
        description: 'Get concentration state for a character.',
        inputSchema: z.object({
            character_id: z.string().describe('Character ID')
        })
    },
    // ============================================================
    // VISUALIZATION TOOLS
    // ============================================================
    RENDER_MAP: {
        name: 'render_map',
        description: `Render an ASCII map of the current combat state showing participant positions, obstacles, and terrain.
Returns a text-based grid visualization with:
- A-Z for friendly participants
- 1-9 for enemies
- █ for obstacles
- ░ for difficult terrain
- ☠ for defeated combatants

Example:
{
  "encounterId": "encounter-battle-1-123456",
  "width": 15,
  "height": 15
}`,
        inputSchema: z.object({
            encounterId: z.string().describe('The ID of the encounter'),
            width: z.number().int().min(5).max(50).default(20).describe('Grid width (default: 20)'),
            height: z.number().int().min(5).max(50).default(20).describe('Grid height (default: 20)'),
            showLegend: z.boolean().default(true).describe('Include legend explaining symbols')
        })
    },
    CALCULATE_AOE: {
        name: 'calculate_aoe',
        description: `Calculate which tiles and participants are affected by an Area of Effect spell or ability.
Supports circle (Fireball), cone (Burning Hands), and line (Lightning Bolt) shapes.

Example - Fireball (20ft radius circle):
{
  "encounterId": "encounter-1",
  "shape": "circle",
  "origin": { "x": 10, "y": 10 },
  "radius": 4
}

Example - Burning Hands (15ft cone):
{
  "encounterId": "encounter-1",
  "shape": "cone",
  "origin": { "x": 5, "y": 5 },
  "direction": { "x": 1, "y": 0 },
  "length": 3,
  "angle": 90
}

Example - Lightning Bolt (100ft line):
{
  "encounterId": "encounter-1",
  "shape": "line",
  "origin": { "x": 0, "y": 5 },
  "direction": { "x": 1, "y": 0 },
  "length": 20
}`,
        inputSchema: z.object({
            encounterId: z.string().describe('The ID of the encounter'),
            shape: z.enum(['circle', 'cone', 'line']).describe('Shape of the AoE'),
            origin: z.object({
                x: z.number(),
                y: z.number()
            }).describe('Origin point of the AoE'),
            radius: z.number().optional().describe('Radius for circle shape (in tiles)'),
            direction: z.object({
                x: z.number(),
                y: z.number()
            }).optional().describe('Direction vector for cone/line (e.g., {x:1,y:0} = East)'),
            length: z.number().optional().describe('Length for cone/line shapes (in tiles)'),
            angle: z.number().optional().describe('Angle for cone shape (in degrees, e.g., 90 for quarter circle)')
        })
    },
    UPDATE_TERRAIN: {
        name: 'update_terrain',
        description: `Add, remove, or modify terrain in an active encounter. ALWAYS prefer ranges over tiles arrays for efficiency.

TERRAIN TYPES:
- obstacles: Blocking terrain (walls, rocks, fallen trees)
- difficultTerrain: Half-speed terrain (mud, rubble, underbrush)
- water: Watery terrain (streams, rivers, pools)

INPUT OPTIONS (use ranges for efficiency):
1. ranges: Array of range shortcuts (PREFERRED - saves tokens)
2. tiles: Array of "x,y" strings (only for specific scattered tiles)

RANGE SHORTCUTS (use these!):

LINES:
- "x=N" - vertical line at x=N (full height)
- "x=N:y1:y2" - vertical line segment
- "y=N" - horizontal line at y=N (full width)
- "y=N:x1:x2" - horizontal line segment
- "line:x1,y1,x2,y2" - diagonal/any line from point to point (Bresenham)
- "hline:y:x1:x2" - horizontal line
- "vline:x:y1:y2" - vertical line
- "row:N" / "col:N" - aliases for y=N / x=N

SHAPES:
- "rect:x,y,w,h" - filled rectangle
- "box:x,y,w,h" - hollow rectangle (border only)
- "border:margin" - outer border of grid (margin=0 for edge)
- "fill:x1,y1,x2,y2" - fill between two corners
- "circle:cx,cy,r" - filled circle
- "ring:cx,cy,r" - hollow circle

ALGEBRA (for curves, diagonals):
- "y=x:0:99" - diagonal line (y equals x)
- "y=2*x+5:0:50" - any linear equation
- "y=x/2:0:99" - half-speed diagonal
- "expr:EQUATION:xMin:xMax" - explicit expression format

EXAMPLES:

Maze outer walls (1 call vs 4):
{ "ranges": ["border:0"], "gridWidth": 100, "gridHeight": 100 }

Complex maze section:
{ "ranges": ["y=10:0:50", "x=25:10:40", "line:50,50,75,25", "box:60,60,15,15"] }

Diagonal river:
{ "terrainType": "water", "ranges": ["y=x:0:99"] }

Circular arena:
{ "ranges": ["ring:50,50,40", "border:0"] }`,
        inputSchema: z.object({
            encounterId: z.string().describe('The ID of the encounter'),
            operation: z.enum(['add', 'remove']).describe('Add or remove terrain'),
            terrainType: z.enum(['obstacles', 'difficultTerrain', 'water']).describe('Type of terrain to modify'),
            tiles: z.array(z.string()).optional().describe('Array of "x,y" coordinate strings (use this OR ranges)'),
            ranges: z.array(z.string()).optional().describe('Array of range shortcuts like "row:5", "col:10", "rect:0,0,10,10", "border:0"'),
            gridWidth: z.number().int().min(1).max(500).default(100).describe('Grid width for range calculations'),
            gridHeight: z.number().int().min(1).max(500).default(100).describe('Grid height for range calculations')
        }).refine(data => data.tiles || data.ranges, {
            message: 'Either tiles or ranges must be provided'
        })
    },
    PLACE_PROP: {
        name: 'place_prop',
        description: `Place an improvised prop/object on the battlefield during combat.

Props are free-form terrain features with rich description that can be interacted with.
Think: ladders, wagons, trees, buildings, towers, cliffs, chandeliers, etc.

⚠️ HEIGHT SEMANTICS (CRITICAL):
- heightFeet describes the PROP'S visual/physical height, NOT entity position
- A 30ft cliff at (5,5) is visually tall 
- Entities standing ON such a prop use position (5,5, z=0), NOT z=30!
- The terrain height is implicit in the visualization

🏗️ PROP TYPES:
- cliff: Stacked rocky terrain with slopes
- wall: Stone/brick barriers  
- bridge: Spanning structures over gaps
- tree: Vegetation cover
- stairs: Stepped access to elevation
- pit: Below-ground areas (negative Y)

Cover Types (D&D 5e):
- half: +2 AC (waist-high wall, thick furniture)
- three_quarter: +5 AC (arrow slit, portcullis)
- full: Total cover (complete obstruction)

Example - Climbable cliff with slopes adjacent:
{
  "encounterId": "encounter-1",
  "position": "15,20",
  "label": "Rocky Cliff",
  "propType": "structure",
  "heightFeet": 25,
  "cover": "half",
  "climbable": true,
  "climbDC": 12,
  "description": "A 25ft rocky outcrop. Adjacent tiles (14,20), (16,20) slope down."
}`,
        inputSchema: z.object({
            encounterId: z.string().describe('The ID of the encounter'),
            position: z.string().describe('Position as "x,y" coordinate string'),
            label: z.string().describe('Free-text label (e.g., "Burning Cart", "Watch Tower", "Rope Bridge")'),
            propType: z.enum(['structure', 'cover', 'climbable', 'hazard', 'interactive', 'decoration'])
                .describe('General category of prop'),
            heightFeet: z.number().int().min(0).optional().describe('Height in feet for elevated props'),
            cover: z.enum(['none', 'half', 'three_quarter', 'full']).optional().default('none')
                .describe('Cover provided by this prop'),
            climbable: z.boolean().optional().default(false).describe('Can this be climbed?'),
            climbDC: z.number().int().min(0).max(30).optional().describe('Athletics DC to climb (if climbable)'),
            breakable: z.boolean().optional().default(false).describe('Can this be destroyed?'),
            hp: z.number().int().min(1).optional().describe('Hit points (if breakable)'),
            description: z.string().optional().describe('Rich narrative description of the prop')
        })
    },
    MEASURE_DISTANCE: {
        name: 'measure_distance',
        description: `Calculate the distance between two points or entities on the battlefield.
Returns distance in feet (5ft per square, diagonal = 5ft using D&D simplified rules).

Example - Between two coordinates:
{
  "encounterId": "encounter-1",
  "from": { "type": "position", "value": "10,10" },
  "to": { "type": "position", "value": "15,18" }
}

Example - Between two entities:
{
  "encounterId": "encounter-1",
  "from": { "type": "entity", "value": "hero-1" },
  "to": { "type": "entity", "value": "goblin-3" }
}

Example - From entity to position:
{
  "encounterId": "encounter-1",
  "from": { "type": "entity", "value": "wizard-1" },
  "to": { "type": "position", "value": "25,30" }
}`,
        inputSchema: z.object({
            encounterId: z.string().describe('The ID of the encounter'),
            from: z.object({
                type: z.enum(['position', 'entity']),
                value: z.string().describe('Either "x,y" coordinate or entity ID')
            }),
            to: z.object({
                type: z.enum(['position', 'entity']),
                value: z.string().describe('Either "x,y" coordinate or entity ID')
            })
        })
    },
    GENERATE_TERRAIN_PATCH: {
        name: 'generate_terrain_patch',
        description: `Generate a terrain patch using procedural noise or preset patterns.
Much easier than placing individual tiles - LLM describes the area and this tool generates it.

Biome Presets:
- forest: Trees (climbable props), undergrowth (difficult terrain), paths
- cave: Rocky walls (obstacles), stalactites (props), pools (water)  
- village: Buildings (obstacle clusters), roads (clear), market stalls (props)
- dungeon: Walls (obstacles), rubble (difficult), traps (hazards)
- swamp: Water, lily pads (props), dead trees, difficult terrain
- battlefield: Barricades, craters (difficult), debris (props)

Density: 0.1 (sparse) to 1.0 (dense)

Example - Generate a forest clearing:
{
  "encounterId": "encounter-1",
  "biome": "forest",
  "origin": { "x": 10, "y": 10 },
  "width": 20,
  "height": 20,
  "density": 0.4,
  "seed": "goblin-ambush",
  "clearCenter": true
}

Example - Dungeon room:
{
  "encounterId": "encounter-1",
  "biome": "dungeon",
  "origin": { "x": 0, "y": 0 },
  "width": 15,
  "height": 12,
  "density": 0.6,
  "seed": "throne-room"
}`,
        inputSchema: z.object({
            encounterId: z.string().describe('The ID of the encounter'),
            biome: z.enum(['forest', 'cave', 'village', 'dungeon', 'swamp', 'battlefield'])
                .describe('Biome preset to use'),
            origin: z.object({
                x: z.number().int(),
                y: z.number().int()
            }).describe('Top-left corner of the patch'),
            width: z.number().int().min(5).max(100).describe('Width of the patch in tiles'),
            height: z.number().int().min(5).max(100).describe('Height of the patch in tiles'),
            density: z.number().min(0.1).max(1.0).default(0.5)
                .describe('How densely packed (0.1=sparse, 1.0=very dense)'),
            seed: z.string().optional().describe('Seed for reproducible generation'),
            clearCenter: z.boolean().optional().default(false)
                .describe('Keep the center area clear (for player spawn)'),
            pattern: z.enum(['river_valley', 'canyon', 'arena', 'mountain_pass']).optional()
                .describe('Use a terrain pattern template instead of biome generation')
        })
    },
    
    /**
     * Generate terrain with a specific geometric pattern
     */
    GENERATE_TERRAIN_PATTERN: {
        name: 'generate_terrain_pattern',
        description: `Generate terrain using a pattern template. ONE CALL generates entire layout.

PATTERNS:
- maze: Full procedural maze (corridors & walls) - USE THIS FOR MAZES
- maze_rooms: Maze with open chambers/rooms connected by corridors
- river_valley: Cliff walls on east/west with river in center
- canyon: Parallel walls east-west with pass between
- arena: Circular wall enclosing fighting area
- mountain_pass: Narrowing corridor toward center

MAZE EXAMPLE (100x100 in ONE call):
{
  "encounterId": "enc-1",
  "pattern": "maze",
  "origin": { "x": 0, "y": 0 },
  "width": 100,
  "height": 100,
  "seed": "maze-runner-001"
}

MAZE WITH ROOMS:
{
  "pattern": "maze_rooms",
  "width": 100,
  "height": 100,
  "roomCount": 8
}`,
        inputSchema: z.object({
            encounterId: z.string().describe('The ID of the encounter'),
            pattern: z.enum(['river_valley', 'canyon', 'arena', 'mountain_pass', 'maze', 'maze_rooms'])
                .describe('Terrain pattern to generate'),
            origin: z.object({
                x: z.number().int(),
                y: z.number().int()
            }).default({ x: 0, y: 0 }).describe('Top-left corner of the pattern'),
            width: z.number().int().min(10).max(500).default(100).describe('Width of the pattern area'),
            height: z.number().int().min(10).max(500).default(100).describe('Height of the pattern area'),
            seed: z.string().optional().describe('Seed for reproducible generation'),
            corridorWidth: z.number().int().min(1).max(5).default(1).describe('Width of corridors (maze patterns only)'),
            roomCount: z.number().int().min(0).max(20).default(5).describe('Number of rooms (maze_rooms pattern only)')
        })
    }
} as const;

// Tool handlers
export async function handleCreateEncounter(args: unknown, _ctx: SessionContext) {
    const parsed = CombatTools.CREATE_ENCOUNTER.inputSchema.parse(args);

    // Generate encounter ID
    const encounterId = await generateDeterministicEncounterId(parsed.seed || randomUUID(), 'combat-encounter');

    // Persist initial state
    const db = getDb();
    const repo = new EncounterRepository(db);

    // Transform participants into token objects if provided
    // Use camelCase to match CombatTokenSchema
    const tokens = parsed.participants ? parsed.participants.map(p => ({
        id: p.id,
        encounterId: encounterId,
        characterId: p.id, // Use participant ID as character ID for now
        name: p.name,
        initiativeBonus: p.initiativeBonus,
        initiative: 0, // Will be rolled later
        isEnemy: p.isEnemy ?? false,
        hp: p.hp,
        maxHp: p.maxHp,
        positionX: p.position?.x ?? 0,
        positionY: p.position?.y ?? 0,
        positionZ: 0,
        movementSpeed: p.movementSpeed ?? 30,
        movementRemaining: p.movementSpeed ?? 30,
        size: p.size ?? 'medium',
        hasReaction: true,
        hasAction: true,
        hasBonusAction: true,
        conditions: [],
        metadata: {}
    })) : [];

    // Create the encounter record
    repo.create({
        id: encounterId,
        worldId: parsed.worldId,
        regionId: parsed.regionId,
        roomId: parsed.roomId,
        tokens: tokens,
        round: 1,
        activeTokenId: undefined,
        status: 'active',
        terrain: parsed.terrain,
        props: [],
        gridMinX: parsed.gridBounds?.minX ?? 0,
        gridMaxX: parsed.gridBounds?.maxX ?? 20,
        gridMinY: parsed.gridBounds?.minY ?? 0,
        gridMaxY: parsed.gridBounds?.maxY ?? 20,
        seed: parsed.seed,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });

    // Initialize combat engine with participants if provided
    let engine: CombatEngine | undefined;
    if (parsed.participants && parsed.participants.length > 0) {
        engine = new CombatEngine(encounterId, pubsub || undefined);

        // Build participants array for startEncounter
        const combatParticipants = parsed.participants.map(participant => ({
            id: participant.id,
            name: participant.name,
            hp: participant.hp,
            maxHp: participant.maxHp,
            initiativeBonus: participant.initiativeBonus,
            isEnemy: participant.isEnemy,
            position: participant.position,
            movementSpeed: participant.movementSpeed,
            size: participant.size,
            conditions: [] as Array<{ name: string; duration?: number; source?: string }>,
            metadata: {} as Record<string, unknown>
        }));

        // Start encounter with all participants (rolls initiative automatically)
        engine.startEncounter(combatParticipants as any);

        // Save the initial state
        const state = engine.getState();
        if (state) {
            repo.saveState(encounterId, state);
        }
    }

    const encounterData = {
        id: encounterId,
        world_id: parsed.worldId,
        region_id: parsed.regionId,
        room_id: parsed.roomId,
        round: 1,
        status: 'active',
        terrain: parsed.terrain,
        grid_min_x: parsed.gridBounds?.minX ?? 0,
        grid_max_x: parsed.gridBounds?.maxX ?? 20,
        grid_min_y: parsed.gridBounds?.minY ?? 0,
        grid_max_y: parsed.gridBounds?.maxY ?? 20,
        seed: parsed.seed,
        created_at: new Date().toISOString()
    };

    // Build response data including tokens
    const responseData: {
        encounter: typeof encounterData;
        tokens: typeof tokens;
        visualState?: ReturnType<typeof buildStateJson>;
    } = {
        encounter: encounterData,
        tokens: tokens
    };

    // Include visual state if engine was initialized
    if (engine) {
        const state = engine.getState();
        if (state) {
            // Include terrain from input since engine doesn't store it
            const stateWithTerrain = {
                ...state,
                terrain: parsed.terrain ?? { obstacles: [], difficultTerrain: [], water: [] }
            };
            responseData.visualState = buildStateJson(stateWithTerrain, encounterId);
        }
    }

    let output = 'Encounter created successfully!\n';
    output += `ID: ${encounterId}\n`;
    output += `World: ${parsed.worldId}\n`;
    output += `Status: active\n`;

    if (parsed.participants && parsed.participants.length > 0) {
        output += `Participants: ${parsed.participants.map(p => p.name).join(', ')}\n`;
    }

    output += '\n<!-- STATE_JSON\n';
    output += JSON.stringify(responseData, null, 2);
    output += '\nSTATE_JSON -->';

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

export async function handleGetEncounterState(args: unknown, ctx: SessionContext) {
    const parsed = CombatTools.GET_ENCOUNTER_STATE.inputSchema.parse(args);
    let engine = getCombatManager().get(`${ctx.sessionId}:${parsed.encounterId}`);

    const db = getDb();
    const repo = new EncounterRepository(db);

    // Auto-load from database if not in memory
    if (!engine) {
        const state = repo.loadState(parsed.encounterId);

        if (!state) {
            throw new Error(`Encounter ${parsed.encounterId} not found.`);
        }

        // Create engine and load state
        engine = new CombatEngine(parsed.encounterId, pubsub || undefined);
        engine.loadState(state);
        getCombatManager().create(`${ctx.sessionId}:${parsed.encounterId}`, engine);
    }

    const state = engine.getState();
    if (!state) {
        throw new Error('No active encounter');
    }

    // Fetch static metadata for the encounter (world_id, etc.)
    const encounterRow = repo.findById(parsed.encounterId);
    if (!encounterRow) {
        throw new Error(`Encounter ${parsed.encounterId} not found in database.`);
    }

    // Get terrain from database since engine doesn't store it
    const dbTerrain = encounterRow.terrain ? JSON.parse(encounterRow.terrain) : { obstacles: [], difficultTerrain: [], water: [] };
    const dbProps = encounterRow.props ? JSON.parse(encounterRow.props) : [];

    // Build the full encounter object matching the Python client's expectation
    const encounterData = {
        id: encounterRow.id,
        world_id: encounterRow.world_id,
        region_id: encounterRow.region_id,
        room_id: encounterRow.room_id,
        round: state.round,
        current_turn_index: state.currentTurnIndex,
        status: encounterRow.status,
        terrain: dbTerrain,
        props: dbProps,
        grid_min_x: encounterRow.grid_min_x,
        grid_max_x: encounterRow.grid_max_x,
        grid_min_y: encounterRow.grid_min_y,
        grid_max_y: encounterRow.grid_max_y,
        seed: encounterRow.seed,
        created_at: encounterRow.created_at,
        updated_at: encounterRow.updated_at
    };

    // Build tokens list
    const tokens = state.participants.map(p => ({
        id: p.id,
        encounter_id: parsed.encounterId,
        character_id: p.characterId || p.id,
        name: p.name,
        initiative_bonus: p.initiativeBonus || 0,
        initiative: p.initiative,
        is_enemy: p.isEnemy,
        hp: p.hp,
        max_hp: p.maxHp,
        position_x: p.position?.x ?? 0,
        position_y: p.position?.y ?? 0,
        position_z: p.position?.z ?? 0,
        movement_speed: p.movementSpeed ?? 30,
        movement_remaining: p.movementRemaining ?? 30,
        size: p.size || 'medium',
        has_reaction: true, // Defaulting as these might not be in CombatState explicitly unless tracked
        has_action: true,
        has_bonus_action: true,
        conditions: p.conditions.map(c => c.type),
        metadata: p.metadata || {}
    }));

    // Include terrain in state for buildStateJson since engine doesn't store it
    const stateWithTerrain = {
        ...state,
        terrain: dbTerrain,
        props: dbProps
    };

    const responseData = {
        encounter: encounterData,
        tokens: tokens,
        // Include visual state for frontend if needed, but the Python client mainly needs the above
        visualState: buildStateJson(stateWithTerrain, parsed.encounterId) 
    };
    
    let output = `Encounter state retrieved.\n`;
    output += `\n<!-- STATE_JSON\n`;
    output += JSON.stringify(responseData, null, 2);
    output += '\nSTATE_JSON -->';

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

export async function handleExecuteCombatAction(args: unknown, ctx: SessionContext) {
    const parsed = CombatTools.EXECUTE_COMBAT_ACTION.inputSchema.parse(args);
    const rng = new CombatRNG(randomUUID());
    let engine = getCombatManager().get(`${ctx.sessionId}:${parsed.encounterId}`);

    // Auto-load from database if not in memory
    if (!engine) {
        const db = getDb();
        const repo = new EncounterRepository(db);
        const state = repo.loadState(parsed.encounterId);

        if (!state) {
            throw new Error(`Encounter ${parsed.encounterId} not found.`);
        }

        engine = new CombatEngine(parsed.encounterId, pubsub || undefined);
        engine.loadState(state);
        getCombatManager().create(`${ctx.sessionId}:${parsed.encounterId}`, engine);
    }

    let result: CombatActionResult | undefined;
    let output = '';

    // Helper to determine action type from casting time
    const parseCastingTime = (castingTime: string): 'action' | 'bonus' | 'reaction' => {
        const lower = castingTime.toLowerCase();
        if (lower.includes('bonus')) return 'bonus';
        if (lower.includes('reaction')) return 'reaction';
        return 'action';
    };

    if (parsed.action === 'attack') {
        if (parsed.attackBonus === undefined || parsed.dc === undefined || parsed.damage === undefined) {
            throw new Error('Attack action requires attackBonus, dc, and damage');
        }
        if (!parsed.targetId) {
            throw new Error('Attack action requires targetId');
        }

        // Validate Action Economy
        const validation = engine.validateActionEconomy(parsed.actorId, 'action');
        if (!validation.valid) {
            throw new Error(validation.error);
        }

        // Use the new detailed attack method with optional damageType for HIGH-002
        result = engine.executeAttack(
            parsed.actorId,
            parsed.targetId,
            parsed.attackBonus,
            parsed.dc,
            parsed.damage,
            parsed.damageType  // HIGH-002: Pass damage type for resistance calculation
        );

        // Check concentration if target took damage and is concentrating
        if (result.success && result.damage && result.damage > 0) {
            const db = getDb();
            const concentrationRepo = new ConcentrationRepository(db);
            const charRepo = new CharacterRepository(db);
            
            // Resolve character ID from target token
            const state = engine.getState();
            const targetParticipant = state?.participants.find(p => p.id === parsed.targetId);
            const targetCharacterId = targetParticipant?.characterId || parsed.targetId!;

            const targetChar = charRepo.findById(targetCharacterId);

            if (targetChar && concentrationRepo.isConcentrating(targetCharacterId)) {
                const concentrationCheck = checkConcentration(targetChar, result.damage, concentrationRepo, rng);
                if (concentrationCheck.broken) {
                    // Break concentration
                    breakConcentration(
                        { characterId: targetCharacterId, reason: 'damage', damageAmount: result.damage },
                        concentrationRepo,
                        charRepo
                    );
                }
            }

            // D&D 5e Rule: Dropping to 0 HP automatically breaks concentration
            if (result.defeated && targetCharacterId) {
                if (concentrationRepo.isConcentrating(targetCharacterId)) {
                    // Force break if defeated, even if they passed the save above (unlikely if defeated)
                    breakConcentration(
                        { characterId: targetCharacterId, reason: 'death' },
                        concentrationRepo,
                        charRepo
                    );
                }
            }
        }

        output = formatAttackResult(result);
        
        // Commit Action Economy
        engine.commitAction(parsed.actorId, 'action');

    } else if (parsed.action === 'heal') {
        if (parsed.amount === undefined) {
            throw new Error('Heal action requires amount');
        }
        if (!parsed.targetId) {
            throw new Error('Heal action requires targetId');
        }

        // Validate Action Economy
        const validation = engine.validateActionEconomy(parsed.actorId, 'action');
        if (!validation.valid) {
            throw new Error(validation.error);
        }

        result = engine.executeHeal(parsed.actorId, parsed.targetId, parsed.amount);
        output = formatHealResult(result);
        
        // Commit Action Economy
        engine.commitAction(parsed.actorId, 'action');

    } else if (parsed.action === 'disengage') {
        // HIGH-003: Disengage action - prevents opportunity attacks
        const currentState = engine.getState();
        if (!currentState) {
            throw new Error('No combat state');
        }

        const actor = currentState.participants.find(p => p.id === parsed.actorId);
        if (!actor) {
            throw new Error(`Actor ${parsed.actorId} not found`);
        }

        // Validate Action Economy
        const validation = engine.validateActionEconomy(parsed.actorId, 'action');
        if (!validation.valid) {
            throw new Error(validation.error);
        }

        // Mark as disengaged using engine method
        engine.disengage(parsed.actorId);
        
        // Commit Action Economy
        engine.commitAction(parsed.actorId, 'action');

        output = formatDisengageResult(actor.name);

        // Create result for consistency
        result = {
            type: 'attack', // Placeholder type
            success: true,
            actor: { id: actor.id, name: actor.name },
            target: { id: actor.id, name: actor.name, hpBefore: actor.hp, hpAfter: actor.hp, maxHp: actor.maxHp },
            defeated: false,
            message: `${actor.name} disengages`,
            detailedBreakdown: output
        };
    } else if (parsed.action === 'move') {
        // CRIT-003: Spatial movement with collision checking
        if (!parsed.targetPosition) {
            throw new Error('Move action requires targetPosition');
        }

        const currentState = engine.getState();
        if (!currentState) {
            throw new Error('No combat state');
        }

        const actor = currentState.participants.find(p => p.id === parsed.actorId);
        if (!actor) {
            throw new Error(`Actor ${parsed.actorId} not found`);
        }

        // Get actor's current position
        const actorPos = (actor as any).position;
        if (!actorPos) {
            // No position set - just set the target position directly
            (actor as any).position = parsed.targetPosition;
            output = formatMoveResult(actor.name, undefined, parsed.targetPosition, true, null);
        } else {
            // HIGH-003: Check for opportunity attacks BEFORE moving
            const opportunityAttackers = engine.getOpportunityAttackers(
                parsed.actorId,
                actorPos,
                parsed.targetPosition
            );

            // Execute any triggered opportunity attacks
            let opportunityAttackOutput = '';
            for (const attacker of opportunityAttackers) {
                const oaResult = engine.executeOpportunityAttack(attacker.id, parsed.actorId);
                opportunityAttackOutput += formatOpportunityAttackResult(oaResult) + '\n';

                // If the mover is defeated by an opportunity attack, they can't complete the move
                if (oaResult.defeated) {
                    output = opportunityAttackOutput;
                    output += `\n${actor.name} was defeated while attempting to move and cannot complete the movement!`;
                    result = {
                        type: 'attack',
                        success: false,
                        actor: { id: actor.id, name: actor.name },
                        target: { id: actor.id, name: actor.name, hpBefore: oaResult.target.hpBefore, hpAfter: oaResult.target.hpAfter, maxHp: actor.maxHp },
                        defeated: true,
                        message: `${actor.name} defeated by opportunity attack`,
                        detailedBreakdown: output
                    };
                    // Skip to saving state
                    break;
                }
            }

            // Only continue with move if not defeated
            const updatedActor = currentState.participants.find(p => p.id === parsed.actorId);
            if (updatedActor && updatedActor.hp > 0) {
                // Build obstacle set from other participants and terrain
                const obstacles = new Set<string>();

                // Add other participant positions as obstacles
                for (const p of currentState.participants) {
                    if (p.id !== parsed.actorId && (p as any).position) {
                        const pos = (p as any).position;
                        obstacles.add(`${pos.x},${pos.y}`);
                    }
                }

                // Add terrain obstacles from database (engine doesn't store terrain)
                const db = getDb();
                const encounterRepo = new EncounterRepository(db);
                const encounterRow = encounterRepo.findById(parsed.encounterId);
                const terrain = encounterRow?.terrain ? JSON.parse(encounterRow.terrain) : null;
                if (terrain?.obstacles) {
                    for (const obs of terrain.obstacles) {
                        obstacles.add(obs);
                    }
                }

                // Check if destination is blocked
                const destKey = `${parsed.targetPosition.x},${parsed.targetPosition.y}`;
                if (obstacles.has(destKey)) {
                    output = opportunityAttackOutput + formatMoveResult(actor.name, actorPos, parsed.targetPosition, false, 'Destination is blocked');
                } else {
                    // Use spatial engine to find path
                    const spatial = new SpatialEngine();
                    const path = spatial.findPath(
                        { x: actorPos.x, y: actorPos.y },
                        { x: parsed.targetPosition.x, y: parsed.targetPosition.y },
                        obstacles
                    );

                    if (path === null) {
                        // No valid path
                        output = opportunityAttackOutput + formatMoveResult(actor.name, actorPos, parsed.targetPosition, false, 'No valid path - blocked by obstacles');
                    } else {
                        // Calculate movement cost (5ft per step)
                        // path includes start node, so steps = length - 1
                        const moveCost = (path.length - 1) * 5;
                        const currentMovement = (actor as any).movementRemaining ?? 30; // Default 30 if undefined

                        if (currentMovement < moveCost) {
                            output = opportunityAttackOutput + formatMoveResult(actor.name, actorPos, parsed.targetPosition, false, `Insufficient movement (Cost: ${moveCost}ft, Remaining: ${currentMovement}ft)`);
                        } else {
                            // Move successful - update position and remaining movement
                            (updatedActor as any).position = parsed.targetPosition;
                            (updatedActor as any).movementRemaining = currentMovement - moveCost;
                            
                            output = opportunityAttackOutput + formatMoveResult(actor.name, actorPos, parsed.targetPosition, true, null, path.length - 1);
                        }
                    }
                }

                // Create result for consistency
                result = {
                    type: 'attack',
                    success: output.includes('moved'),
                    actor: { id: actor.id, name: actor.name },
                    target: { id: actor.id, name: actor.name, hpBefore: actor.hp, hpAfter: updatedActor.hp, maxHp: actor.maxHp },
                    defeated: updatedActor.hp <= 0,
                    message: output.includes('moved') ? `${actor.name} moved` : `${actor.name} could not move`,
                    detailedBreakdown: output
                };
            }
        }

        // Create dummy result if not set (for the case where no position was set initially)
        if (!result) {
            result = {
                type: 'attack',
                success: output.includes('moved') || output.includes('placed'),
                actor: { id: actor.id, name: actor.name },
                target: { id: actor.id, name: actor.name, hpBefore: actor.hp, hpAfter: actor.hp, maxHp: actor.maxHp },
                defeated: false,
                message: `${actor.name} moved`,
                detailedBreakdown: output
            };
        }
    } else if (parsed.action === 'cast_spell') {
        // CRIT-006: Validated spell casting - prevents LLM hallucination
        if (!parsed.spellName) {
            throw new Error('cast_spell action requires spellName');
        }

        // CRIT-006: Block raw damage parameter for spell casting
        if (parsed.damage !== undefined) {
            throw new Error('damage parameter not allowed for cast_spell - damage is calculated from spell');
        }

        const currentState = engine.getState();
        if (!currentState) {
            throw new Error('No combat state');
        }

        const actor = currentState.participants.find(p => p.id === parsed.actorId);
        if (!actor) {
            throw new Error(`Actor ${parsed.actorId} not found`);
        }

        // Load character data for spellcasting validation
        const db = getDb();
        const charRepo = new CharacterRepository(db);
        let casterChar: Character | null = null;

        try {
            // Use characterId from the actor token if available, otherwise fall back to actorId (token ID)
            // This handles cases where tokens are persistent (have characterId) vs ad-hoc
            const characterId = (actor as any).characterId || parsed.actorId;
            casterChar = charRepo.findById(characterId);
        } catch {
            // Character might not exist in DB (e.g., test setup)
            // Create minimal character for validation
        }

        // If no character record, create minimal one from participant data
        if (!casterChar) {
            // This is a fallback - ideally all casters are in the character table
            const characterId = (actor as any).characterId || parsed.actorId;
            throw new Error(`Character ${characterId} not found in database. Spellcasting requires a character record with class and spell slots.`);
        }

        // If no character record, create minimal one from participant data
        if (!casterChar) {
            // This is a fallback - ideally all casters are in the character table
            const characterId = (actor as any).characterId || parsed.actorId;
            throw new Error(`Character ${characterId} not found in database. Spellcasting requires a character record with class and spell slots.`);
        }

        // If no character record, create minimal one from participant data
        if (!casterChar) {
            // This is a fallback - ideally all casters are in the character table
            const characterId = (actor as any).characterId || parsed.actorId;
            throw new Error(`Character ${characterId} not found in database. Spellcasting requires a character record with class and spell slots.`);
        }

        // Get target (needed for validation of range)
        // Re-use logic: defined outside or define here once?
        // Note: variable 'target' is defined later in the file.
        // We will define it here as 'validationTarget' to avoid conflict, or check if we can hoist.
        const validationTarget = currentState.participants.find(p => p.id === parsed.targetId);

        // Validate spell cast (CRIT-006 core validation)
        const validation = validateSpellCast(casterChar, parsed.spellName, parsed.slotLevel, {
            casterPosition: actor.position || undefined,
            targetPosition: validationTarget ? (validationTarget.position || undefined) : (parsed.targetPosition || undefined),
            targetId: parsed.targetId
        });

        if (!validation.valid) {
            throw new Error(validation.error?.message || 'Invalid spell cast');
        }

        // Spell is valid - resolve effects
        const spell = validation.spell!;
        const effectiveSlotLevel = validation.effectiveSlotLevel || spell.level;

        // ACTION ECONOMY VALIDATION
        const actionType = parseCastingTime(spell.castingTime);
        // Is it a leveled spell? (Cantrips are level 0)
        // Bonus Action Rule applies to "casting a spell" (BA) and "casting a spell" (Action).
        // My engine logic handles the specific combinations (BA spell -> Action Cantrip Only).
        // I need to pass the spell level (effective slot level? No, base level usually? Rules say "Cantrip", which is level 0. Casting at higher level doesn't make it a leveled spell? Yes it does. "Level 1 or higher". )
        // "You can't cast another spell during the same turn, except for a cantrip with a casting time of 1 action."
        // So effectiveSlotLevel is what matters for consumption, but base level matters for "Cantrip"? A Level 1 spell cast with Level 2 slot is Level 2. A Cantrip cast with... cantrips don't use slots.
        // So I'll use `effectiveSlotLevel` (which is 0 for cantrips).
        
        const economyValidation = engine.validateActionEconomy(parsed.actorId, actionType, effectiveSlotLevel);
        if (!economyValidation.valid) {
            throw new Error(economyValidation.error);
        }
        
        // Commit Action Economy (do this BEFORE resolving just in case resolution fails? No, if resolution fails we shouldn't burn action? 
        // But throwing errors inside resolution is bad. 
        // However, I'll commit at end to be safe, or start? 
        // If I commit at end, and resolution crashes, action is saved? 
        // If logic throws, we don't save state. 
        // So better to commit at end of block).

        // Get target for damage/effects
        let target = currentState.participants.find(p => p.id === parsed.targetId);
        const targetHpBefore = target?.hp || 0;

        // Resolve spell effects
        const resolution = resolveSpell(spell, casterChar, effectiveSlotLevel, {
            targetAC: target ? (target as any).ac || 10 : 10,
            rng: engine.rng
        });

        // Apply damage/healing to target
        if (resolution.damage && resolution.damage > 0 && target) {
            const damageType = resolution.damageType || 'force';

            // Use engine to apply damage (handles resistances/immunities)
            engine.executeAttack(
                parsed.actorId,
                parsed.targetId!,
                100, // Auto-hit for spell damage
                0,   // DC doesn't matter
                resolution.damage,
                damageType
            );

            target = currentState.participants.find(p => p.id === parsed.targetId);

            // Check concentration if target is concentrating
            if (target) {
                const db = getDb();
                const concentrationRepo = new ConcentrationRepository(db);
                // Use characterId from the target token if available
                const targetCharId = (target as any).characterId || parsed.targetId!;
                const targetChar = charRepo.findById(targetCharId);

                if (targetChar && concentrationRepo.isConcentrating(targetCharId)) {
                    const concentrationCheck = checkConcentration(targetChar, resolution.damage, concentrationRepo, rng);
                    if (concentrationCheck.broken) {
                        // Break concentration
                        breakConcentration(
                            { characterId: targetCharId, reason: 'damage', damageAmount: resolution.damage },
                            concentrationRepo,
                            charRepo
                        );
                    }
                }

                // D&D 5e Rule: Dropping to 0 HP automatically breaks concentration
                if (target.hp <= 0 && concentrationRepo.isConcentrating(targetCharId)) {
                    breakConcentration(
                        { characterId: targetCharId, reason: 'death' },
                        concentrationRepo,
                        charRepo
                    );
                }
            }
        }

        if (resolution.healing && resolution.healing > 0 && target) {
            engine.executeHeal(parsed.actorId, parsed.targetId!, resolution.healing);
            target = currentState.participants.find(p => p.id === parsed.targetId);
        }

        // Consume spell slot (if not cantrip)
        if (effectiveSlotLevel > 0) {
            const updatedChar = consumeSpellSlot(casterChar, effectiveSlotLevel);
            charRepo.update(casterChar.id, updatedChar);
        }

        // Handle concentration
        if (spell.concentration) {
            const db = getDb();
            const concentrationRepo = new ConcentrationRepository(db);
            const currentState = engine.getState();

            // Parse duration from spell (e.g., "Concentration, up to 1 minute")
            let maxDuration: number | undefined;
            const durationMatch = spell.duration.match(/(\d+)\s+(minute|hour)/i);
            if (durationMatch) {
                const value = parseInt(durationMatch[1]);
                const unit = durationMatch[2].toLowerCase();
                // Convert to rounds (1 round = 6 seconds)
                if (unit === 'minute') {
                    maxDuration = value * 10; // 1 minute = 10 rounds
                } else if (unit === 'hour') {
                    maxDuration = value * 600; // 1 hour = 600 rounds
                }
            }

            // Start concentration
            startConcentration(
                casterChar.id,
                spell.name,
                effectiveSlotLevel,
                currentState?.round || 1,
                maxDuration,
                parsed.targetId ? [parsed.targetId] : undefined,
                concentrationRepo,
                charRepo
            );
        }

        // Format output with SPELL tag for test parsing
        output = formatSpellCastResult(actor.name, resolution, target, targetHpBefore);
        output += `\n[SPELL: ${spell.name}, SLOT: ${effectiveSlotLevel > 0 ? effectiveSlotLevel : 'cantrip'}, DMG: ${resolution.damage || 0}, HEAL: ${resolution.healing || 0}]`;

        // Commit Action Economy
        engine.commitAction(parsed.actorId, actionType, effectiveSlotLevel);

        // Create result
        result = {
            type: 'attack',
            success: resolution.success,
            actor: { id: actor.id, name: actor.name },
            target: target ? {
                id: target.id,
                name: target.name,
                hpBefore: targetHpBefore,
                hpAfter: target.hp,
                maxHp: target.maxHp
            } : { id: 'none', name: 'none', hpBefore: 0, hpAfter: 0, maxHp: 0 },
            defeated: target ? target.hp <= 0 : false,
            message: `${actor.name} cast ${spell.name}`,
            // CRIT-006: Include spell damage/healing in result for testing and frontend
            damage: resolution.damage,
            healAmount: resolution.healing,
            detailedBreakdown: output
        };
    } else {
        throw new Error(`Unknown action: ${parsed.action}`);
    }

    // Save state
    const state = engine.getState();
    if (state) {
        const db = getDb();
        const repo = new EncounterRepository(db);
        repo.saveState(parsed.encounterId, state);
        
        // Get terrain from database for response
        const encounterRow = repo.findById(parsed.encounterId);
        const dbTerrain = encounterRow?.terrain ? JSON.parse(encounterRow.terrain) : null;
        const stateWithTerrain = dbTerrain ? { ...state, terrain: dbTerrain } : state;
        
        // Append current state JSON for frontend
        const stateJson = buildStateJson(stateWithTerrain, parsed.encounterId);
        output += `\n\n<!-- STATE_JSON\n${JSON.stringify(stateJson)}\nSTATE_JSON -->`;
    }

    return {
        content: [
            {
                type: 'text' as const,
                text: output
            }
        ]
    };
}

export async function handleAdvanceTurn(args: unknown, ctx: SessionContext) {
    const parsed = CombatTools.ADVANCE_TURN.inputSchema.parse(args);
    let engine = getCombatManager().get(`${ctx.sessionId}:${parsed.encounterId}`);

    // Auto-load from database if not in memory
    if (!engine) {
        const db = getDb();
        const repo = new EncounterRepository(db);
        const state = repo.loadState(parsed.encounterId);

        if (!state) {
            throw new Error(`Encounter ${parsed.encounterId} not found.`);
        }

        engine = new CombatEngine(parsed.encounterId, pubsub || undefined);
        engine.loadState(state);
        getCombatManager().create(`${ctx.sessionId}:${parsed.encounterId}`, engine);
    }

    const previousParticipant = engine.getCurrentParticipant();
    
    engine.nextTurnWithConditions();
    
    const state = engine.getState();

    // Save state
    if (state) {
        const db = getDb();
        const repo = new EncounterRepository(db);
        repo.saveState(parsed.encounterId, state);
    }

    let output = `\n⏭️ TURN ENDED: ${previousParticipant?.name}\n`;
    output += state ? formatCombatStateText(state) : 'No combat state';
    
    // Append JSON for frontend
    if (state) {
        const stateJson = buildStateJson(state, parsed.encounterId);
        output += `\n\n<!-- STATE_JSON\n${JSON.stringify(stateJson)}\nSTATE_JSON -->`;
    }

    return {
        content: [
            {
                type: 'text' as const,
                text: output
            }
        ]
    };
}

export async function handleEndEncounter(args: unknown, ctx: SessionContext) {
    const parsed = CombatTools.END_ENCOUNTER.inputSchema.parse(args);
    const namespacedId = `${ctx.sessionId}:${parsed.encounterId}`;

    // Get the engine BEFORE deleting to access final state
    let engine = getCombatManager().get(namespacedId);

    // Auto-load from database if not in memory
    if (!engine) {
        const db = getDb();
        const repo = new EncounterRepository(db);
        const state = repo.loadState(parsed.encounterId);

        if (!state) {
            throw new Error(`Encounter ${parsed.encounterId} not found.`);
        }

        engine = new CombatEngine(parsed.encounterId, pubsub || undefined);
        engine.loadState(state);
        getCombatManager().create(namespacedId, engine);
    }

    const finalState = engine.getState();

    // CRIT-001 FIX: Sync HP changes back to character records
    const syncResults: { id: string; name: string; hp: number; synced: boolean }[] = [];

    const db = getDb();
    const repo = new EncounterRepository(db);

    if (finalState) {
        const { CharacterRepository } = await import('../storage/repos/character.repo.js');
        const charRepo = new CharacterRepository(db);

        for (const participant of finalState.participants) {
            // Try to find this participant in the character database
            // Use characterId (link to persistent record), not id (token UUID)
            const charId = participant.characterId || participant.id;
            const character = charRepo.findById(charId);

            if (character) {
                // Sync HP back to character record
                charRepo.update(charId, { hp: participant.hp });
                syncResults.push({
                    id: participant.id,
                    name: participant.name,
                    hp: participant.hp,
                    synced: true
                });
            } else {
                // Ad-hoc participant (not in DB) - skip silently
                syncResults.push({
                    id: participant.id,
                    name: participant.name,
                    hp: participant.hp,
                    synced: false
                });
            }
        }
    }

    // Update encounter status to completed
    repo.update(parsed.encounterId, { status: 'completed', endedAt: new Date().toISOString() });

    // Now delete the encounter from memory
    getCombatManager().delete(namespacedId);

    // Build response with sync information
    let output = `\n🏁 COMBAT ENDED\nEncounter ID: ${parsed.encounterId}\n\n`;

    const syncedChars = syncResults.filter(r => r.synced);
    if (syncedChars.length > 0) {
        output += `📊 Character HP Synced:\n`;
        for (const char of syncedChars) {
            output += `   • ${char.name}: ${char.hp} HP\n`;
        }
    }

    output += `\nAll combatants have been removed from the battlefield.`;

    return {
        content: [
            {
                type: 'text' as const,
                text: output
            }
        ]
    };
}

export async function handleLoadEncounter(args: unknown, ctx: SessionContext) {
    const parsed = CombatTools.LOAD_ENCOUNTER.inputSchema.parse(args);
    const db = getDb();
    const repo = new EncounterRepository(db);

    const state = repo.loadState(parsed.encounterId);
    if (!state) {
        throw new Error(`Encounter ${parsed.encounterId} not found in database.`);
    }

    // Create engine and load state
    const engine = new CombatEngine(parsed.encounterId, pubsub || undefined);
    engine.loadState(state);

    getCombatManager().create(`${ctx.sessionId}:${parsed.encounterId}`, engine);

    const stateJson = buildStateJson(state, parsed.encounterId);
    let output = `📥 ENCOUNTER LOADED\nEncounter ID: ${parsed.encounterId}\n`;
    output += formatCombatStateText(state);
    output += `\n\n<!-- STATE_JSON\n${JSON.stringify(stateJson)}\nSTATE_JSON -->`;

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

/**
 * MED-003: Roll a death saving throw for a character at 0 HP
 */
export async function handleRollDeathSave(args: unknown, ctx: SessionContext) {
    const parsed = CombatTools.ROLL_DEATH_SAVE.inputSchema.parse(args);
    const engine = getCombatManager().get(`${ctx.sessionId}:${parsed.encounterId}`);

    if (!engine) {
        throw new Error(`No active encounter with ID ${parsed.encounterId}`);
    }

    const state = engine.getState();
    if (!state) {
        throw new Error('Encounter has no active state');
    }

    const participant = state.participants.find(p => p.id === parsed.characterId);
    if (!participant) {
        throw new Error(`Participant ${parsed.characterId} not found in encounter`);
    }

    // Validate state
    if (participant.hp > 0) {
        throw new Error(`${participant.name} is not at 0 HP and cannot make death saving throws`);
    }

    if (participant.isDead) {
        throw new Error(`${participant.name} is already dead`);
    }

    if (participant.isStabilized) {
        return {
            content: [{
                type: 'text' as const,
                text: `${participant.name} is already stabilized and does not need to make death saving throws.`
            }]
        };
    }

    // Roll the death save
    const result = engine.rollDeathSave(parsed.characterId);

    if (!result) {
        throw new Error('Failed to roll death save');
    }

    // Build output
    let output = `\n┌─────────────────────────────────────────┐\n`;
    output += `│ 💀 DEATH SAVING THROW\n`;
    output += `└─────────────────────────────────────────┘\n\n`;
    output += `${participant.name} makes a death saving throw...\n\n`;

    output += `🎲 Roll: d20 = ${result.roll}`;

    if (result.isNat20) {
        output += ` ⭐ NATURAL 20!\n\n`;
        output += `✨ ${participant.name} regains 1 HP and is conscious again!\n`;
    } else if (result.isNat1) {
        output += ` 💥 NATURAL 1! (Counts as 2 failures)\n\n`;
    } else if (result.success) {
        output += ` ✓ SUCCESS (10+)\n\n`;
    } else {
        output += ` ✗ FAILURE (9 or less)\n\n`;
    }

    // Status summary
    const successMarkers = '●'.repeat(result.successes) + '○'.repeat(3 - result.successes);
    const failureMarkers = '●'.repeat(result.failures) + '○'.repeat(3 - result.failures);

    output += `Successes: [${successMarkers}] ${result.successes}/3\n`;
    output += `Failures:  [${failureMarkers}] ${result.failures}/3\n\n`;

    if (result.isStabilized) {
        output += `🛡️ ${participant.name} is STABILIZED! (Unconscious but no longer dying)\n`;
    } else if (result.isDead) {
        output += `☠️ ${participant.name} has DIED!\n`;
    }

    // Save state
    const db = getDb();
    const repo = new EncounterRepository(db);
    repo.saveState(parsed.encounterId, engine.getState()!);

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

/**
 * HIGH-006: Execute a lair action on initiative 20
 */
// Encounter management handlers
export async function handleListEncounters(args: unknown, _ctx: SessionContext) {
    const parsed = CombatTools.LIST_ENCOUNTERS.inputSchema.parse(args);
    const db = getDb();
    const repo = new EncounterRepository(db);

    const encounters = repo.listByWorld(parsed.worldId, parsed.status, parsed.activeOnly);

    // Convert to snake_case format for Python client
    const encountersData = encounters.map(encounter => ({
        id: encounter.id,
        world_id: encounter.worldId,
        region_id: encounter.regionId,
        room_id: encounter.roomId,
        round: encounter.round,
        active_token_id: encounter.activeTokenId,
        status: encounter.status,
        terrain: encounter.terrain,
        props: encounter.props,
        grid_min_x: encounter.gridMinX,
        grid_max_x: encounter.gridMaxX,
        grid_min_y: encounter.gridMinY,
        grid_max_y: encounter.gridMaxY,
        seed: encounter.seed,
        created_at: encounter.createdAt,
        ended_at: encounter.endedAt
    }));

    let output = `Found ${encounters.length} encounters\n`;
    output += '\n<!-- STATE_JSON\n';
    output += JSON.stringify({ encounters: encountersData }, null, 2);
    output += '\nSTATE_JSON -->';

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

export async function handleUpdateEncounter(args: unknown, _ctx: SessionContext) {
    const parsed = CombatTools.UPDATE_ENCOUNTER.inputSchema.parse(args);
    const db = getDb();
    const repo = new EncounterRepository(db);

    const updated = repo.update(parsed.encounterId, {
        round: parsed.round,
        activeTokenId: parsed.activeTokenId,
        status: parsed.status,
        terrain: parsed.terrain,
        props: parsed.props
    });

    return {
        content: [{
            type: 'text' as const,
            text: updated ? 'Encounter updated' : 'Encounter not found'
        }]
    };
}

export async function handleDeleteEncounter(args: unknown, _ctx: SessionContext) {
    const parsed = CombatTools.DELETE_ENCOUNTER.inputSchema.parse(args);
    const db = getDb();
    const repo = new EncounterRepository(db);

    const deleted = repo.delete(parsed.encounterId);
    return {
        content: [{
            type: 'text' as const,
            text: deleted ? 'Encounter deleted' : 'Encounter not found'
        }]
    };
}

// Token management handlers
export async function handleAddToken(args: unknown, _ctx: SessionContext) {
    const parsed = CombatTools.ADD_TOKEN.inputSchema.parse(args);
    const db = getDb();
    const repo = new EncounterRepository(db);

    const newToken = {
        id: randomUUID(),
        encounterId: parsed.encounterId,
        characterId: parsed.characterId,
        name: parsed.name,
        initiativeBonus: parsed.initiativeBonus,
        initiative: null,
        isEnemy: parsed.isEnemy,
        hp: parsed.hp,
        maxHp: parsed.maxHp,
        positionX: parsed.positionX,
        positionY: parsed.positionY,
        positionZ: 0,
        movementSpeed: parsed.movementSpeed,
        movementRemaining: parsed.movementSpeed,
        size: parsed.size,
        hasReaction: true,
        hasAction: true,
        hasBonusAction: true,
        conditions: [],
        metadata: {}
    };

    repo.addToken(parsed.encounterId, newToken);

    const snakeToken = {
        id: newToken.id,
        encounter_id: newToken.encounterId,
        character_id: newToken.characterId,
        name: newToken.name,
        initiative_bonus: newToken.initiativeBonus,
        initiative: newToken.initiative,
        is_enemy: newToken.isEnemy,
        hp: newToken.hp,
        max_hp: newToken.maxHp,
        position_x: newToken.positionX,
        position_y: newToken.positionY,
        position_z: newToken.positionZ,
        movement_speed: newToken.movementSpeed,
        movement_remaining: newToken.movementRemaining,
        size: newToken.size,
        has_reaction: newToken.hasReaction,
        has_action: newToken.hasAction,
        has_bonus_action: newToken.hasBonusAction,
        conditions: newToken.conditions,
        metadata: newToken.metadata
    };

    let output = JSON.stringify(snakeToken, null, 2);
    output += '\n<!-- STATE_JSON\n';
    output += JSON.stringify({ token: snakeToken }, null, 2);
    output += '\nSTATE_JSON -->';

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

export async function handleUpdateToken(args: unknown, _ctx: SessionContext) {
    const parsed = CombatTools.UPDATE_TOKEN.inputSchema.parse(args);
    const db = getDb();
    const repo = new EncounterRepository(db);

    const updated = repo.updateToken(parsed.encounterId, parsed.tokenId, {
        initiative: parsed.initiative,
        hp: parsed.hp,
        positionX: parsed.positionX,
        positionY: parsed.positionY,
        positionZ: parsed.positionZ,
        movementRemaining: parsed.movementRemaining,
        hasReaction: parsed.hasReaction,
        hasAction: parsed.hasAction,
        hasBonusAction: parsed.hasBonusAction,
        conditions: parsed.conditions
    });

    return {
        content: [{
            type: 'text' as const,
            text: updated ? 'Token updated' : 'Token not found'
        }]
    };
}

export async function handleRemoveToken(args: unknown, _ctx: SessionContext) {
    const parsed = CombatTools.REMOVE_TOKEN.inputSchema.parse(args);
    const db = getDb();
    const repo = new EncounterRepository(db);

    const removed = repo.removeToken(parsed.encounterId, parsed.tokenId);
    return {
        content: [{
            type: 'text' as const,
            text: removed ? 'Token removed' : 'Token not found'
        }]
    };
}

export async function handleRollInitiative(args: unknown, _ctx: SessionContext) {
    const parsed = CombatTools.ROLL_INITIATIVE.inputSchema.parse(args);
    let engine = getCombatManager().get(`${_ctx.sessionId}:${parsed.encounterId}`);

    if (!engine) {
        const db = getDb();
        const repo = new EncounterRepository(db);
        const state = repo.loadState(parsed.encounterId);

        if (!state) {
            throw new Error(`Encounter ${parsed.encounterId} not found.`);
        }

        engine = new CombatEngine(parsed.encounterId, pubsub || undefined);
        engine.loadState(state);
        getCombatManager().create(`${_ctx.sessionId}:${parsed.encounterId}`, engine);
    }

    const results = engine.rollInitiativeForAll();

    // Save state
    const state = engine.getState();
    if (state) {
        const db = getDb();
        const repo = new EncounterRepository(db);
        repo.saveState(parsed.encounterId, state);
    }

    let output = JSON.stringify(results, null, 2);
    output += '\n<!-- STATE_JSON\n';
    output += JSON.stringify({ initiativeOrder: results }, null, 2);
    output += '\nSTATE_JSON -->';

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

export async function handleListTokens(args: unknown, _ctx: SessionContext) {
    const parsed = CombatTools.LIST_TOKENS.inputSchema.parse(args);
    const db = getDb();
    const repo = new EncounterRepository(db);

    const encounter = repo.findById(parsed.encounterId);
    if (!encounter) {
        throw new Error(`Encounter ${parsed.encounterId} not found`);
    }

    // EncounterRow.tokens is a string in the DB row, but we need to parse it or load from combat_tokens table
    // The repository's findById returns EncounterRow, not the Encounter object with parsed tokens
    // We should use loadState to get the full state including tokens from the combat_tokens table
    
    // Actually repo.loadState returns the State object for the engine.
    // Let's use a new method on repo or just query directly? 
    // The repo has `loadState` which loads tokens.
    
    const state = repo.loadState(parsed.encounterId);
    if (!state) {
        throw new Error(`Encounter ${parsed.encounterId} not found`);
    }

    // Filter tokens if requested
    let tokens = state.participants;
    if (parsed.isEnemy !== undefined) {
        tokens = tokens.filter((t: any) => t.isEnemy === parsed.isEnemy);
    }

    // Format for response - match Python CombatToken model
    const formattedTokens = tokens.map((t: any) => ({
        id: t.id,
        encounter_id: parsed.encounterId,
        character_id: t.characterId || t.id,
        name: t.name,
        initiative_bonus: t.initiativeBonus || 0,
        initiative: t.initiative,
        is_enemy: t.isEnemy,
        hp: t.hp,
        max_hp: t.maxHp,
        position_x: t.position?.x ?? 0,
        position_y: t.position?.y ?? 0,
        position_z: t.position?.z ?? 0,
        movement_speed: t.movementSpeed ?? 30,
        movement_remaining: t.movementRemaining ?? 30,
        size: t.size || 'medium',
        has_reaction: t.hasReaction ?? true,
        has_action: t.hasAction ?? true,
        has_bonus_action: t.hasBonusAction ?? true,
        conditions: Array.isArray(t.conditions) ? t.conditions.map((c: any) => typeof c === 'string' ? c : c.type) : [],
        metadata: t.metadata || {}
    }));

    let output = `Found ${formattedTokens.length} tokens\n`;
    output += '\n<!-- STATE_JSON\n';
    output += JSON.stringify({ tokens: formattedTokens }, null, 2);
    output += '\nSTATE_JSON -->';

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

export async function handleGetToken(args: unknown, _ctx: SessionContext) {
    const parsed = CombatTools.GET_TOKEN.inputSchema.parse(args);
    const db = getDb();
    const repo = new EncounterRepository(db);

    const state = repo.loadState(parsed.encounterId);
    if (!state) {
        throw new Error(`Encounter ${parsed.encounterId} not found`);
    }

    const token = state.participants.find((p: any) => p.id === parsed.tokenId);
    if (!token) {
        throw new Error(`Token ${parsed.tokenId} not found in encounter`);
    }

    const formattedToken = {
        id: token.id,
        encounter_id: parsed.encounterId,
        character_id: token.characterId || token.id,
        name: token.name,
        initiative_bonus: token.initiativeBonus || 0,
        initiative: token.initiative,
        is_enemy: token.isEnemy,
        hp: token.hp,
        max_hp: token.maxHp,
        position_x: token.position?.x ?? 0,
        position_y: token.position?.y ?? 0,
        position_z: token.position?.z ?? 0,
        movement_speed: token.movementSpeed ?? 30,
        movement_remaining: token.movementRemaining ?? 30,
        size: token.size || 'medium',
        has_reaction: token.hasReaction ?? true,
        has_action: token.hasAction ?? true,
        has_bonus_action: token.hasBonusAction ?? true,
        conditions: Array.isArray(token.conditions) ? token.conditions.map((c: any) => typeof c === 'string' ? c : c.type) : [],
        metadata: token.metadata || {}
    };

    let output = `Token retrieved: ${token.name}\n`;
    output += '\n<!-- STATE_JSON\n';
    output += JSON.stringify({ token: formattedToken }, null, 2);
    output += '\nSTATE_JSON -->';

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

// Concentration handlers
export async function handleSetConcentration(args: unknown, _ctx: SessionContext) {
    const parsed = CombatTools.SET_CONCENTRATION.inputSchema.parse(args);
    const db = getDb();
    const concentrationRepo = new ConcentrationRepository(db);
    const charRepo = new CharacterRepository(db);

    startConcentration(
        parsed.character_id,
        parsed.spell_name,
        parsed.spell_level,
        parsed.started_at,
        parsed.max_duration,
        parsed.target_ids,
        concentrationRepo,
        charRepo
    );

    return {
        content: [{
            type: 'text' as const,
            text: 'Concentration set'
        }]
    };
}

export async function handleBreakConcentration(args: unknown, _ctx: SessionContext) {
    const parsed = CombatTools.BREAK_CONCENTRATION.inputSchema.parse(args);
    const db = getDb();
    const concentrationRepo = new ConcentrationRepository(db);
    const charRepo = new CharacterRepository(db);

    breakConcentration(
        { characterId: parsed.character_id, reason: 'voluntary' },
        concentrationRepo,
        charRepo
    );

    return {
        content: [{
            type: 'text' as const,
            text: 'Concentration broken'
        }]
    };
}

export async function handleGetConcentration(args: unknown, _ctx: SessionContext) {
    const parsed = CombatTools.GET_CONCENTRATION.inputSchema.parse(args);
    const db = getDb();
    const concentrationRepo = new ConcentrationRepository(db);

    const concentration = concentrationRepo.findByCharacterId(parsed.character_id);
    
    let output = concentration 
        ? `Concentrating on ${concentration.activeSpell} (Level ${concentration.spellLevel})`
        : 'Not concentrating';
        
    output += '\n\n<!-- STATE_JSON\n';
    output += JSON.stringify({ concentration }, null, 2);
    output += '\nSTATE_JSON -->';
    
    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}



export async function handleExecuteLairAction(args: unknown, ctx: SessionContext) {
    const parsed = CombatTools.EXECUTE_LAIR_ACTION.inputSchema.parse(args);
    const engine = getCombatManager().get(`${ctx.sessionId}:${parsed.encounterId}`);

    if (!engine) {
        throw new Error(`No active encounter with ID ${parsed.encounterId}`);
    }

    const state = engine.getState();
    if (!state) {
        throw new Error('Encounter has no active state');
    }

    // Validate it's the lair's turn
    if (!engine.isLairActionPending()) {
        throw new Error('Cannot execute lair action: it is not the lair\'s turn (initiative 20)');
    }

    let output = `\n┌─────────────────────────────────────────┐\n`;
    output += `│ 🏰 LAIR ACTION (Initiative 20)\n`;
    output += `└─────────────────────────────────────────┘\n\n`;
    output += `${parsed.actionDescription}\n\n`;

    const results: Array<{
        targetId: string;
        targetName: string;
        saveRoll?: number;
        saveTotal?: number;
        saved: boolean;
        damageTaken: number;
    }> = [];

    // Apply damage to targets if specified
    if (parsed.targetIds && parsed.targetIds.length > 0 && parsed.damage) {
        for (const targetId of parsed.targetIds) {
            const target = state.participants.find(p => p.id === targetId);
            if (!target) {
                output += `⚠️ Target ${targetId} not found in encounter\n`;
                continue;
            }

            let damageTaken = parsed.damage;
            let saved = false;
            let saveRoll: number | undefined;
            let saveTotal: number | undefined;

            // Handle saving throw if specified
            if (parsed.savingThrow) {
                // Roll saving throw
                saveRoll = engine.rng.d20();
                const abilityScore = target.abilityScores?.[parsed.savingThrow.ability] ?? 10;
                const modifier = Math.floor((abilityScore - 10) / 2);
                saveTotal = saveRoll + modifier;
                saved = saveTotal >= parsed.savingThrow.dc;

                if (saved && parsed.halfDamageOnSave) {
                    damageTaken = Math.floor(parsed.damage / 2);
                } else if (saved) {
                    damageTaken = 0;
                }
            }

            // Apply damage (considering resistances/immunities/vulnerabilities)
            const damageType = parsed.damageType?.toLowerCase() || 'untyped';
            if (target.immunities?.includes(damageType)) {
                damageTaken = 0;
            } else if (target.resistances?.includes(damageType)) {
                damageTaken = Math.floor(damageTaken / 2);
            } else if (target.vulnerabilities?.includes(damageType)) {
                damageTaken = damageTaken * 2;
            }

            // Deal damage via engine
            if (damageTaken > 0) {
                engine.applyDamage(targetId, damageTaken);
            }

            results.push({
                targetId,
                targetName: target.name,
                saveRoll,
                saveTotal,
                saved,
                damageTaken
            });

            // Format result
            output += `🎯 ${target.name}`;
            if (parsed.savingThrow) {
                const saveAbility = parsed.savingThrow.ability.charAt(0).toUpperCase() + parsed.savingThrow.ability.slice(1);
                output += ` - ${saveAbility} Save: ${saveRoll} + ${Math.floor(((target.abilityScores?.[parsed.savingThrow.ability] ?? 10) - 10) / 2)} = ${saveTotal} vs DC ${parsed.savingThrow.dc}`;
                output += saved ? ' ✓ SAVED' : ' ✗ FAILED';
            }
            output += `\n`;
            output += `   Damage: ${damageTaken}${parsed.damageType ? ` ${parsed.damageType}` : ''}\n`;

            const updatedTarget = engine.getState()!.participants.find(p => p.id === targetId);
            if (updatedTarget) {
                output += `   HP: ${updatedTarget.hp}/${updatedTarget.maxHp}`;
                if (updatedTarget.hp <= 0) {
                    output += ' 💀 DEFEATED';
                }
                output += '\n';
            }
        }
    } else {
        output += `(No mechanical effect - narrative only)\n`;
    }

    output += `\n→ Call advance_turn to proceed to the next combatant`;

    // Save state
    const db = getDb();
    const repo = new EncounterRepository(db);
    repo.saveState(parsed.encounterId, engine.getState()!);

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

// Helper for tests
export function clearCombatState() {
    const manager = getCombatManager();
    const ids = manager.list();
    for (const id of ids) {
        manager.delete(id);
    }
}

// ============================================================
// VISUALIZATION TOOL HANDLERS
// ============================================================

export async function handleRenderMap(args: unknown, ctx: SessionContext) {
    const parsed = CombatTools.RENDER_MAP.inputSchema.parse(args);
    let engine = getCombatManager().get(`${ctx.sessionId}:${parsed.encounterId}`);

    // Auto-load from database if not in memory
    if (!engine) {
        const db = getDb();
        const repo = new EncounterRepository(db);
        const state = repo.loadState(parsed.encounterId);

        if (!state) {
            throw new Error(`Encounter ${parsed.encounterId} not found.`);
        }

        engine = new CombatEngine(parsed.encounterId, pubsub || undefined);
        engine.loadState(state);
        getCombatManager().create(`${ctx.sessionId}:${parsed.encounterId}`, engine);
    }

    const state = engine.getState();
    if (!state) {
        throw new Error('No active encounter');
    }

    const map = renderGrid(state, {
        width: parsed.width,
        height: parsed.height,
        showLegend: parsed.showLegend
    });

    return {
        content: [{
            type: 'text' as const,
            text: map
        }]
    };
}

export async function handleCalculateAoe(args: unknown, ctx: SessionContext) {
    const parsed = CombatTools.CALCULATE_AOE.inputSchema.parse(args);
    let engine = getCombatManager().get(`${ctx.sessionId}:${parsed.encounterId}`);

    // Auto-load from database if not in memory
    if (!engine) {
        const db = getDb();
        const repo = new EncounterRepository(db);
        const state = repo.loadState(parsed.encounterId);

        if (!state) {
            throw new Error(`Encounter ${parsed.encounterId} not found.`);
        }

        engine = new CombatEngine(parsed.encounterId, pubsub || undefined);
        engine.loadState(state);
        getCombatManager().create(`${ctx.sessionId}:${parsed.encounterId}`, engine);
    }

    const state = engine.getState();
    if (!state) {
        throw new Error('No active encounter');
    }

    const result = calculateAoE(state, parsed.shape, parsed.origin, {
        radius: parsed.radius,
        direction: parsed.direction,
        length: parsed.length,
        angle: parsed.angle
    });

    // Format output
    let output = `\n┌─ AREA OF EFFECT ────────────────────────┐\n`;
    output += `│ Shape: ${parsed.shape.toUpperCase()}\n`;
    output += `│ Origin: (${parsed.origin.x}, ${parsed.origin.y})\n`;
    if (parsed.radius) output += `│ Radius: ${parsed.radius} tiles\n`;
    if (parsed.length) output += `│ Length: ${parsed.length} tiles\n`;
    if (parsed.angle) output += `│ Angle: ${parsed.angle}°\n`;
    output += `└─────────────────────────────────────────┘\n\n`;

    output += `📍 Affected Tiles: ${result.tiles.length}\n`;

    if (result.affectedParticipants.length > 0) {
        output += `\n⚠️ AFFECTED CREATURES:\n`;
        for (const p of result.affectedParticipants) {
            output += `  • ${p.name} at (${p.position.x}, ${p.position.y})\n`;
        }
    } else {
        output += `\n✓ No creatures in area of effect\n`;
    }

    // Also return JSON for programmatic use
    output += `\n<!-- AOE_JSON\n${JSON.stringify(result)}\nAOE_JSON -->`;

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

/**
 * Bresenham's line algorithm - draws a line from (x1,y1) to (x2,y2)
 */
function bresenhamLine(x1: number, y1: number, x2: number, y2: number): string[] {
    const tiles: string[] = [];
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1;
    const sy = y1 < y2 ? 1 : -1;
    let err = dx - dy;

    let x = x1;
    let y = y1;

    while (true) {
        tiles.push(`${x},${y}`);
        if (x === x2 && y === y2) break;
        const e2 = 2 * err;
        if (e2 > -dy) {
            err -= dy;
            x += sx;
        }
        if (e2 < dx) {
            err += dx;
            y += sy;
        }
    }
    return tiles;
}

/**
 * Evaluate a simple algebraic expression for y given x
 * Supports: constants, x, +, -, *, /, parentheses
 * Examples: "2*x+3", "x/2", "10", "x", "(x+5)/2"
 */
function evaluateExpression(expr: string, x: number): number {
    // Replace 'x' with the actual value
    const substituted = expr.replace(/x/gi, `(${x})`);
    // Safely evaluate basic math (no eval for security)
    // Parse simple expressions: numbers, +, -, *, /, parentheses
    try {
        // Use Function constructor for safe math evaluation (no access to scope)
        const result = new Function(`return ${substituted}`)();
        return Math.round(result);
    } catch {
        throw new Error(`Invalid expression: ${expr}`);
    }
}

/**
 * Parse range shortcut into array of "x,y" coordinate strings
 *
 * FORMATS:
 * - row:N or row:N:x1:x2 - horizontal line at y=N
 * - col:N or col:N:y1:y2 - vertical line at x=N
 * - hline:y:x1:x2 - horizontal line
 * - vline:x:y1:y2 - vertical line
 * - line:x1,y1,x2,y2 - point-to-point line (Bresenham)
 * - rect:x,y,w,h - filled rectangle
 * - border:margin - outer border
 * - fill:x1,y1,x2,y2 - fill rectangle by corners
 * - expr:EQUATION:xMin:xMax - algebraic expression (e.g., "expr:2*x+5:0:50")
 * - x=N or x=N:y1:y2 - vertical line shorthand
 * - y=N or y=N:x1:x2 - horizontal line shorthand
 * - y=EXPR:xMin:xMax - algebraic y as function of x (e.g., "y=2*x+3:0:20")
 */
function parseRangeShortcut(range: string, gridWidth: number, gridHeight: number): string[] {
    const tiles: string[] = [];

    // Check for algebraic shorthand first: x=N, y=N, y=expr
    if (range.startsWith('x=')) {
        // x=N or x=N:y1:y2 - vertical line
        const afterEquals = range.substring(2);
        const colonParts = afterEquals.split(':');
        const x = parseInt(colonParts[0], 10);
        const y1 = colonParts[1] ? parseInt(colonParts[1], 10) : 0;
        const y2 = colonParts[2] ? parseInt(colonParts[2], 10) : gridHeight - 1;
        for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
            tiles.push(`${x},${y}`);
        }
        return tiles;
    }

    if (range.startsWith('y=')) {
        // y=N or y=N:x1:x2 - horizontal line OR y=expr:x1:x2 - algebraic
        const afterEquals = range.substring(2);
        const colonParts = afterEquals.split(':');
        const firstPart = colonParts[0];

        // Check if it's a simple number or an expression
        const isSimpleNumber = /^-?\d+$/.test(firstPart);

        if (isSimpleNumber) {
            // y=N:x1:x2 - simple horizontal line
            const y = parseInt(firstPart, 10);
            const x1 = colonParts[1] ? parseInt(colonParts[1], 10) : 0;
            const x2 = colonParts[2] ? parseInt(colonParts[2], 10) : gridWidth - 1;
            for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
                tiles.push(`${x},${y}`);
            }
        } else {
            // y=expr:x1:x2 - algebraic expression
            const expr = firstPart;
            const xMin = colonParts[1] ? parseInt(colonParts[1], 10) : 0;
            const xMax = colonParts[2] ? parseInt(colonParts[2], 10) : gridWidth - 1;
            for (let x = xMin; x <= xMax; x++) {
                const y = evaluateExpression(expr, x);
                if (y >= 0 && y < gridHeight) {
                    tiles.push(`${x},${y}`);
                }
            }
        }
        return tiles;
    }

    const parts = range.split(':');
    const command = parts[0].toLowerCase();

    switch (command) {
        case 'row': {
            // row:N or row:N:x1:x2
            const y = parseInt(parts[1], 10);
            const x1 = parts[2] ? parseInt(parts[2], 10) : 0;
            const x2 = parts[3] ? parseInt(parts[3], 10) : gridWidth - 1;
            for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
                tiles.push(`${x},${y}`);
            }
            break;
        }
        case 'col': {
            // col:N or col:N:y1:y2
            const x = parseInt(parts[1], 10);
            const y1 = parts[2] ? parseInt(parts[2], 10) : 0;
            const y2 = parts[3] ? parseInt(parts[3], 10) : gridHeight - 1;
            for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
                tiles.push(`${x},${y}`);
            }
            break;
        }
        case 'hline': {
            // hline:y:x1:x2 - horizontal line
            const y = parseInt(parts[1], 10);
            const x1 = parseInt(parts[2], 10);
            const x2 = parseInt(parts[3], 10);
            for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
                tiles.push(`${x},${y}`);
            }
            break;
        }
        case 'vline': {
            // vline:x:y1:y2 - vertical line
            const x = parseInt(parts[1], 10);
            const y1 = parseInt(parts[2], 10);
            const y2 = parseInt(parts[3], 10);
            for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
                tiles.push(`${x},${y}`);
            }
            break;
        }
        case 'line': {
            // line:x1,y1,x2,y2 - point-to-point line using Bresenham
            const lineParts = parts[1].split(',');
            const x1 = parseInt(lineParts[0], 10);
            const y1 = parseInt(lineParts[1], 10);
            const x2 = parseInt(lineParts[2], 10);
            const y2 = parseInt(lineParts[3], 10);
            tiles.push(...bresenhamLine(x1, y1, x2, y2));
            break;
        }
        case 'rect': {
            // rect:x,y,w,h - filled rectangle
            const rectParts = parts[1].split(',');
            const rx = parseInt(rectParts[0], 10);
            const ry = parseInt(rectParts[1], 10);
            const rw = parseInt(rectParts[2], 10);
            const rh = parseInt(rectParts[3], 10);
            for (let y = ry; y < ry + rh; y++) {
                for (let x = rx; x < rx + rw; x++) {
                    tiles.push(`${x},${y}`);
                }
            }
            break;
        }
        case 'box': {
            // box:x,y,w,h - hollow rectangle (just the border)
            const boxParts = parts[1].split(',');
            const bx = parseInt(boxParts[0], 10);
            const by = parseInt(boxParts[1], 10);
            const bw = parseInt(boxParts[2], 10);
            const bh = parseInt(boxParts[3], 10);
            // Top and bottom edges
            for (let x = bx; x < bx + bw; x++) {
                tiles.push(`${x},${by}`);
                tiles.push(`${x},${by + bh - 1}`);
            }
            // Left and right edges (excluding corners)
            for (let y = by + 1; y < by + bh - 1; y++) {
                tiles.push(`${bx},${y}`);
                tiles.push(`${bx + bw - 1},${y}`);
            }
            break;
        }
        case 'border': {
            // border:margin - outer border with margin inward
            const margin = parseInt(parts[1], 10);
            // Top edge
            for (let x = margin; x < gridWidth - margin; x++) {
                tiles.push(`${x},${margin}`);
            }
            // Bottom edge
            for (let x = margin; x < gridWidth - margin; x++) {
                tiles.push(`${x},${gridHeight - 1 - margin}`);
            }
            // Left edge (excluding corners already added)
            for (let y = margin + 1; y < gridHeight - margin - 1; y++) {
                tiles.push(`${margin},${y}`);
            }
            // Right edge (excluding corners already added)
            for (let y = margin + 1; y < gridHeight - margin - 1; y++) {
                tiles.push(`${gridWidth - 1 - margin},${y}`);
            }
            break;
        }
        case 'fill': {
            // fill:x1,y1,x2,y2 - fill from corner to corner
            const fillParts = parts[1].split(',');
            const fx1 = parseInt(fillParts[0], 10);
            const fy1 = parseInt(fillParts[1], 10);
            const fx2 = parseInt(fillParts[2], 10);
            const fy2 = parseInt(fillParts[3], 10);
            for (let y = Math.min(fy1, fy2); y <= Math.max(fy1, fy2); y++) {
                for (let x = Math.min(fx1, fx2); x <= Math.max(fx1, fx2); x++) {
                    tiles.push(`${x},${y}`);
                }
            }
            break;
        }
        case 'circle': {
            // circle:cx,cy,r - filled circle at center (cx,cy) with radius r
            const circleParts = parts[1].split(',');
            const cx = parseInt(circleParts[0], 10);
            const cy = parseInt(circleParts[1], 10);
            const r = parseInt(circleParts[2], 10);
            for (let y = cy - r; y <= cy + r; y++) {
                for (let x = cx - r; x <= cx + r; x++) {
                    if ((x - cx) ** 2 + (y - cy) ** 2 <= r ** 2) {
                        if (x >= 0 && x < gridWidth && y >= 0 && y < gridHeight) {
                            tiles.push(`${x},${y}`);
                        }
                    }
                }
            }
            break;
        }
        case 'ring': {
            // ring:cx,cy,r - hollow circle (just the perimeter)
            const ringParts = parts[1].split(',');
            const rcx = parseInt(ringParts[0], 10);
            const rcy = parseInt(ringParts[1], 10);
            const rr = parseInt(ringParts[2], 10);
            // Use parametric circle
            for (let angle = 0; angle < 360; angle += 1) {
                const rad = (angle * Math.PI) / 180;
                const x = Math.round(rcx + rr * Math.cos(rad));
                const y = Math.round(rcy + rr * Math.sin(rad));
                const key = `${x},${y}`;
                if (x >= 0 && x < gridWidth && y >= 0 && y < gridHeight && !tiles.includes(key)) {
                    tiles.push(key);
                }
            }
            break;
        }
        case 'expr': {
            // expr:EQUATION:xMin:xMax - explicit algebraic expression
            const expr = parts[1];
            const xMin = parts[2] ? parseInt(parts[2], 10) : 0;
            const xMax = parts[3] ? parseInt(parts[3], 10) : gridWidth - 1;
            for (let x = xMin; x <= xMax; x++) {
                const y = evaluateExpression(expr, x);
                if (y >= 0 && y < gridHeight) {
                    tiles.push(`${x},${y}`);
                }
            }
            break;
        }
        default:
            throw new Error(`Unknown range command: ${command}. Valid: row, col, hline, vline, line, rect, box, border, fill, circle, ring, expr, x=, y=`);
    }

    return tiles;
}

/**
 * Handle updating terrain during an active encounter
 */
export async function handleUpdateTerrain(args: unknown, ctx: SessionContext) {
    const parsed = CombatTools.UPDATE_TERRAIN.inputSchema.parse(args);
    let engine = getCombatManager().get(`${ctx.sessionId}:${parsed.encounterId}`);

    // Auto-load from database if not in memory
    if (!engine) {
        const db = getDb();
        const repo = new EncounterRepository(db);
        const state = repo.loadState(parsed.encounterId);

        if (!state) {
            throw new Error(`Encounter ${parsed.encounterId} not found.`);
        }

        engine = new CombatEngine(parsed.encounterId, pubsub || undefined);
        engine.loadState(state);
        getCombatManager().create(`${ctx.sessionId}:${parsed.encounterId}`, engine);
    }

    const state = engine.getState();
    if (!state) {
        throw new Error('No active encounter');
    }

    // Initialize terrain if it doesn't exist
    if (!state.terrain) {
        state.terrain = { obstacles: [], difficultTerrain: [], water: [] };
    }

    // Get or create the appropriate terrain array
    const terrainKey = parsed.terrainType as 'obstacles' | 'difficultTerrain' | 'water';
    if (!state.terrain[terrainKey]) {
        state.terrain[terrainKey] = [];
    }

    const terrainArray = state.terrain[terrainKey] as string[];
    let modified = 0;

    // Expand ranges into tiles if provided
    const gridWidth = parsed.gridWidth ?? 100;
    const gridHeight = parsed.gridHeight ?? 100;
    let allTiles: string[] = parsed.tiles ? [...parsed.tiles] : [];

    if (parsed.ranges) {
        for (const range of parsed.ranges) {
            const expanded = parseRangeShortcut(range, gridWidth, gridHeight);
            allTiles.push(...expanded);
        }
    }

    if (parsed.operation === 'add') {
        // Add tiles that don't already exist (use Set for efficiency with large arrays)
        const existingSet = new Set(terrainArray);
        for (const tile of allTiles) {
            if (!existingSet.has(tile)) {
                terrainArray.push(tile);
                existingSet.add(tile);
                modified++;
            }
        }
    } else {
        // Remove tiles
        const tileSet = new Set(allTiles);
        const originalLength = terrainArray.length;
        state.terrain[terrainKey] = terrainArray.filter(t => !tileSet.has(t));
        modified = originalLength - (state.terrain[terrainKey] as string[]).length;
    }

    // Save updated state to database
    const db = getDb();
    const repo = new EncounterRepository(db);
    repo.saveState(parsed.encounterId, state);

    // Build response
    const stateJson = buildStateJson(state, parsed.encounterId);
    let output = `\n⛏️ TERRAIN UPDATED\n`;
    output += `├─ Operation: ${parsed.operation.toUpperCase()}\n`;
    output += `├─ Type: ${parsed.terrainType}\n`;
    output += `├─ Tiles modified: ${modified}\n`;
    output += `└─ Total ${parsed.terrainType}: ${(state.terrain[terrainKey] as string[]).length}\n`;

    // Append JSON for frontend parsing
    output += `\n\n<!-- STATE_JSON\n${JSON.stringify(stateJson)}\nSTATE_JSON -->`;

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

/**
 * Handle placing an improvised prop on the battlefield
 */
export async function handlePlaceProp(args: unknown, ctx: SessionContext) {
    const parsed = CombatTools.PLACE_PROP.inputSchema.parse(args);
    let engine = getCombatManager().get(`${ctx.sessionId}:${parsed.encounterId}`);

    // Auto-load from database if not in memory
    if (!engine) {
        const db = getDb();
        const repo = new EncounterRepository(db);
        const state = repo.loadState(parsed.encounterId);

        if (!state) {
            throw new Error(`Encounter ${parsed.encounterId} not found.`);
        }

        engine = new CombatEngine(parsed.encounterId, pubsub || undefined);
        engine.loadState(state);
        getCombatManager().create(`${ctx.sessionId}:${parsed.encounterId}`, engine);
    }

    const state = engine.getState();
    if (!state) {
        throw new Error('No active encounter');
    }

    // Initialize props array if it doesn't exist
    if (!state.props) {
        state.props = [];
    }

    // Generate a unique ID for the prop
    const propId = `prop-${parsed.label.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;

    // Create the prop object
    const prop = {
        id: propId,
        position: parsed.position,
        label: parsed.label,
        propType: parsed.propType,
        heightFeet: parsed.heightFeet,
        cover: parsed.cover || 'none',
        climbable: parsed.climbable || false,
        climbDC: parsed.climbDC,
        breakable: parsed.breakable || false,
        hp: parsed.hp,
        currentHp: parsed.hp,
        description: parsed.description
    };

    state.props.push(prop);

    // Save updated state to database
    const db = getDb();
    const repo = new EncounterRepository(db);
    repo.saveState(parsed.encounterId, state);

    // Build response
    const stateJson = buildStateJson(state, parsed.encounterId);
    
    const coverIcon = {
        'none': '○',
        'half': '◐',
        'three_quarter': '◕',
        'full': '●'
    }[prop.cover || 'none'];

    let output = `\\n🏗️ PROP PLACED\\n`;
    output += `┌─────────────────────────────────────────┐\\n`;
    output += `│ ${parsed.label}\\n`;
    output += `└─────────────────────────────────────────┘\\n\\n`;
    output += `📍 Position: (${parsed.position})\\n`;
    output += `📦 Type: ${parsed.propType}\\n`;
    if (parsed.heightFeet) output += `📏 Height: ${parsed.heightFeet} ft\\n`;
    output += `🛡️ Cover: ${coverIcon} ${parsed.cover || 'none'}\\n`;
    if (parsed.climbable) output += `🧗 Climbable: DC ${parsed.climbDC || 10}\\n`;
    if (parsed.breakable && parsed.hp) output += `💔 Breakable: ${parsed.hp} HP\\n`;
    if (parsed.description) output += `\\n📜 ${parsed.description}\\n`;

    // Append JSON for frontend parsing
    output += `\\n\\n<!-- STATE_JSON\\n${JSON.stringify(stateJson)}\\nSTATE_JSON -->`;

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

/**
 * Handle measuring distance between two points or entities
 */
export async function handleMeasureDistance(args: unknown, ctx: SessionContext) {
    const parsed = CombatTools.MEASURE_DISTANCE.inputSchema.parse(args);
    let engine = getCombatManager().get(`${ctx.sessionId}:${parsed.encounterId}`);

    // Auto-load from database if not in memory
    if (!engine) {
        const db = getDb();
        const repo = new EncounterRepository(db);
        const state = repo.loadState(parsed.encounterId);

        if (!state) {
            throw new Error(`Encounter ${parsed.encounterId} not found.`);
        }

        engine = new CombatEngine(parsed.encounterId, pubsub || undefined);
        engine.loadState(state);
        getCombatManager().create(`${ctx.sessionId}:${parsed.encounterId}`, engine);
    }

    const state = engine.getState();
    if (!state) {
        throw new Error('No active encounter');
    }

    // Helper to parse position or get entity position
    const getPosition = (ref: { type: 'position' | 'entity'; value: string }): { x: number; y: number; name: string } => {
        if (ref.type === 'position') {
            const [x, y] = ref.value.split(',').map(Number);
            return { x, y, name: `(${ref.value})` };
        } else {
            // Look up by token id OR characterId (for compatibility)
            const participant = state.participants.find(p => p.id === ref.value || p.characterId === ref.value);
            if (!participant) {
                throw new Error(`Entity ${ref.value} not found in encounter`);
            }
            const pos = participant.position || { x: 0, y: 0 };
            return { x: pos.x, y: pos.y, name: participant.name };
        }
    };

    const fromPos = getPosition(parsed.from);
    const toPos = getPosition(parsed.to);

    // Calculate distance using D&D Chebyshev distance (diagonal = 5ft)
    const dx = Math.abs(toPos.x - fromPos.x);
    const dy = Math.abs(toPos.y - fromPos.y);
    const distanceSquares = Math.max(dx, dy);
    const distanceFeet = distanceSquares * 5;

    // Also calculate Euclidean for reference
    const euclideanSquares = Math.sqrt(dx * dx + dy * dy);
    const euclideanFeet = Math.round(euclideanSquares * 5);

    let output = `\\n📏 DISTANCE MEASURED\\n`;
    output += `┌─────────────────────────────────────────┐\\n`;
    output += `│ ${fromPos.name} → ${toPos.name}\\n`;
    output += `└─────────────────────────────────────────┘\\n\\n`;
    output += `🎯 Distance: ${distanceFeet} ft (${distanceSquares} squares)\\n`;
    output += `   (Using D&D 5e diagonal = 5ft rule)\\n\\n`;
    output += `📐 Euclidean: ~${euclideanFeet} ft\\n`;
    output += `   (Δx: ${dx} squares, Δy: ${dy} squares)\\n`;

    // Add range category for quick reference
    let rangeCategory = '';
    if (distanceFeet <= 5) rangeCategory = '⚔️ Melee range';
    else if (distanceFeet <= 30) rangeCategory = '🏃 Normal movement';
    else if (distanceFeet <= 60) rangeCategory = '🏹 Short bow range';
    else if (distanceFeet <= 120) rangeCategory = '🎯 Longbow short range';
    else if (distanceFeet <= 150) rangeCategory = '🔮 Most spell range';
    else rangeCategory = '🌍 Long range';

    output += `\\n${rangeCategory}\\n`;

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

/**
 * Handle generating a terrain patch with procedural noise
 */
export async function handleGenerateTerrainPatch(args: unknown, ctx: SessionContext) {
    const parsed = CombatTools.GENERATE_TERRAIN_PATCH.inputSchema.parse(args);
    let engine = getCombatManager().get(`${ctx.sessionId}:${parsed.encounterId}`);

    // Auto-load from database if not in memory
    if (!engine) {
        const db = getDb();
        const repo = new EncounterRepository(db);
        const state = repo.loadState(parsed.encounterId);

        if (!state) {
            throw new Error(`Encounter ${parsed.encounterId} not found.`);
        }

        engine = new CombatEngine(parsed.encounterId, pubsub || undefined);
        engine.loadState(state);
        getCombatManager().create(`${ctx.sessionId}:${parsed.encounterId}`, engine);
    }

    const state = engine.getState();
    if (!state) {
        throw new Error('No active encounter');
    }

    // Initialize terrain and props if needed
    if (!state.terrain) {
        state.terrain = { obstacles: [], difficultTerrain: [], water: [] };
    }
    if (!state.props) {
        state.props = [];
    }

    // If pattern is specified, use pattern generator instead of biome
    if (parsed.pattern) {
        const patternGen = getPatternGenerator(parsed.pattern);
        const result = patternGen(parsed.origin.x, parsed.origin.y, parsed.width, parsed.height);
        
        // Add generated terrain to state
        state.terrain!.obstacles.push(...result.obstacles);
        if (!state.terrain!.water) state.terrain!.water = [];
        state.terrain!.water.push(...result.water);
        state.terrain!.difficultTerrain!.push(...result.difficultTerrain);
        
        // Add props
        for (const prop of result.props) {
            const randomId = engine.rng.rollDie(36).toString(36) + engine.rng.rollDie(36).toString(36);
            state.props!.push({
                id: `prop-${Date.now()}-${randomId}`,
                label: prop.label,
                position: prop.position,
                heightFeet: prop.heightFeet,
                propType: prop.propType as any,
                cover: prop.cover as any,
                description: PATTERN_DESCRIPTIONS[parsed.pattern]
            });
        }
        
        // Persist state
        const db = getDb();
        const repo = new EncounterRepository(db);
        repo.saveState(parsed.encounterId, state);
        
        const stateJson = buildStateJson(state, parsed.encounterId);
        const output = `🏔️ TERRAIN PATTERN GENERATED: ${parsed.pattern.toUpperCase()}\n` +
            `📐 Area: (${parsed.origin.x},${parsed.origin.y}) to (${parsed.origin.x + parsed.width},${parsed.origin.y + parsed.height})\n` +
            `🧱 Obstacles: ${result.obstacles.length}\n` +
            `💧 Water: ${result.water.length}\n` +
            `🌿 Difficult terrain: ${result.difficultTerrain.length}\n` +
            `🏗️ Props: ${result.props.length}\n\n` +
            `<!-- STATE_JSON\n${JSON.stringify(stateJson)}\nSTATE_JSON -->`;
        
        return {
            content: [{ type: 'text' as const, text: output }]
        };
    }

    // Simple noise function (seeded)
    const seedStr = parsed.seed || `${parsed.biome}-${Date.now()}`;
    let seedNum = 0;
    for (let i = 0; i < seedStr.length; i++) {
        seedNum = ((seedNum << 5) - seedNum) + seedStr.charCodeAt(i);
        seedNum = seedNum & seedNum;
    }
    const random = () => {
        seedNum = (seedNum * 1103515245 + 12345) & 0x7fffffff;
        return seedNum / 0x7fffffff;
    };

    // Calculate center for optional clearing
    const centerX = parsed.origin.x + Math.floor(parsed.width / 2);
    const centerY = parsed.origin.y + Math.floor(parsed.height / 2);
    const clearRadius = Math.min(parsed.width, parsed.height) / 4;

    const isClear = (x: number, y: number) => {
        if (!parsed.clearCenter) return false;
        const dx = x - centerX;
        const dy = y - centerY;
        return Math.sqrt(dx * dx + dy * dy) < clearRadius;
    };

    // Biome generation configurations
    const biomeConfigs: Record<string, {
        obstacles: { chance: number; pattern: 'scatter' | 'cluster' | 'edge' };
        difficult: { chance: number; pattern: 'scatter' | 'cluster' };
        water: { chance: number; pattern: 'pools' | 'river' | 'none' };
        props: Array<{ label: string; propType: string; chance: number; heightFeet?: number; cover?: string; climbable?: boolean }>;
    }> = {
        forest: {
            obstacles: { chance: 0.05, pattern: 'scatter' },
            difficult: { chance: 0.2, pattern: 'scatter' },
            water: { chance: 0.02, pattern: 'pools' },
            props: [
                { label: 'Oak Tree', propType: 'climbable', chance: 0.15, heightFeet: 25, cover: 'half', climbable: true },
                { label: 'Pine Tree', propType: 'climbable', chance: 0.1, heightFeet: 30, cover: 'half', climbable: true },
                { label: 'Fallen Log', propType: 'cover', chance: 0.03, heightFeet: 3, cover: 'half' },
                { label: 'Boulder', propType: 'cover', chance: 0.02, heightFeet: 5, cover: 'three_quarter' }
            ]
        },
        cave: {
            obstacles: { chance: 0.2, pattern: 'edge' },
            difficult: { chance: 0.15, pattern: 'scatter' },
            water: { chance: 0.1, pattern: 'pools' },
            props: [
                { label: 'Stalactite', propType: 'hazard', chance: 0.05, heightFeet: 15 },
                { label: 'Rock Pillar', propType: 'structure', chance: 0.04, heightFeet: 20, cover: 'full' },
                { label: 'Glowing Mushroom', propType: 'decoration', chance: 0.08, heightFeet: 2 }
            ]
        },
        village: {
            obstacles: { chance: 0.25, pattern: 'cluster' },
            difficult: { chance: 0.05, pattern: 'scatter' },
            water: { chance: 0.01, pattern: 'pools' },
            props: [
                { label: 'Market Stall', propType: 'cover', chance: 0.04, heightFeet: 8, cover: 'half' },
                { label: 'Wagon', propType: 'cover', chance: 0.02, heightFeet: 6, cover: 'three_quarter' },
                { label: 'Barrel', propType: 'cover', chance: 0.06, heightFeet: 4, cover: 'half' },
                { label: 'Well', propType: 'structure', chance: 0.01, heightFeet: 4, cover: 'half' }
            ]
        },
        dungeon: {
            obstacles: { chance: 0.15, pattern: 'edge' },
            difficult: { chance: 0.1, pattern: 'scatter' },
            water: { chance: 0.02, pattern: 'pools' },
            props: [
                { label: 'Stone Pillar', propType: 'structure', chance: 0.03, heightFeet: 15, cover: 'half' },
                { label: 'Rubble Pile', propType: 'cover', chance: 0.05, heightFeet: 3, cover: 'half' },
                { label: 'Brazier', propType: 'interactive', chance: 0.02, heightFeet: 5 },
                { label: 'Spike Trap', propType: 'hazard', chance: 0.02, heightFeet: 0 }
            ]
        },
        swamp: {
            obstacles: { chance: 0.1, pattern: 'scatter' },
            difficult: { chance: 0.4, pattern: 'cluster' },
            water: { chance: 0.35, pattern: 'pools' },
            props: [
                { label: 'Dead Tree', propType: 'structure', chance: 0.08, heightFeet: 15, cover: 'half' },
                { label: 'Lily Pad', propType: 'decoration', chance: 0.1, heightFeet: 0 },
                { label: 'Hollow Log', propType: 'cover', chance: 0.02, heightFeet: 4, cover: 'three_quarter' }
            ]
        },
        battlefield: {
            obstacles: { chance: 0.1, pattern: 'scatter' },
            difficult: { chance: 0.25, pattern: 'scatter' },
            water: { chance: 0.0, pattern: 'none' },
            props: [
                { label: 'Barricade', propType: 'cover', chance: 0.08, heightFeet: 4, cover: 'three_quarter' },
                { label: 'Overturned Cart', propType: 'cover', chance: 0.03, heightFeet: 5, cover: 'three_quarter' },
                { label: 'Broken Siege Engine', propType: 'cover', chance: 0.01, heightFeet: 10, cover: 'full' },
                { label: 'Debris Pile', propType: 'cover', chance: 0.05, heightFeet: 3, cover: 'half' }
            ]
        }
    };

    const config = biomeConfigs[parsed.biome];
    let obstaclesAdded = 0;
    let difficultAdded = 0;
    let waterAdded = 0;
    let propsAdded = 0;

    // Generate terrain
    for (let y = parsed.origin.y; y < parsed.origin.y + parsed.height; y++) {
        for (let x = parsed.origin.x; x < parsed.origin.x + parsed.width; x++) {
            if (isClear(x, y)) continue;

            const adjustedDensity = parsed.density || 0.5;
            const tileKey = `${x},${y}`;

            // Edge pattern modifier
            const edgeDist = Math.min(
                x - parsed.origin.x,
                parsed.origin.x + parsed.width - 1 - x,
                y - parsed.origin.y,
                parsed.origin.y + parsed.height - 1 - y
            );
            const isEdge = edgeDist < 2;

            // Obstacles
            let obstacleChance = config.obstacles.chance * adjustedDensity;
            if (config.obstacles.pattern === 'edge' && isEdge) obstacleChance *= 3;
            if (random() < obstacleChance) {
                state.terrain.obstacles.push(tileKey);
                obstaclesAdded++;
                continue; // Don't place other things on obstacles
            }

            // Water
            if (config.water.pattern !== 'none' && random() < config.water.chance * adjustedDensity) {
                if (!state.terrain.water) state.terrain.water = [];
                state.terrain.water.push(tileKey);
                waterAdded++;
                continue;
            }

            // Difficult terrain
            if (random() < config.difficult.chance * adjustedDensity) {
                if (!state.terrain.difficultTerrain) state.terrain.difficultTerrain = [];
                state.terrain.difficultTerrain.push(tileKey);
                difficultAdded++;
            }

            // Props
            for (const propDef of config.props) {
                if (random() < propDef.chance * adjustedDensity) {
                    const propId = `prop-${parsed.biome}-${propsAdded}-${Date.now()}`;
                    state.props.push({
                        id: propId,
                        position: tileKey,
                        label: propDef.label,
                        propType: propDef.propType as any,
                        heightFeet: propDef.heightFeet,
                        cover: (propDef.cover || 'none') as any,
                        climbable: propDef.climbable,
                        climbDC: propDef.climbable ? 10 : undefined
                    });
                    propsAdded++;
                    break; // Only one prop per tile
                }
            }
        }
    }

    // Save updated state
    const db = getDb();
    const repo = new EncounterRepository(db);
    repo.saveState(parsed.encounterId, state);

    // Build response
    const stateJson = buildStateJson(state, parsed.encounterId);
    
    let output = `\\n🌍 TERRAIN PATCH GENERATED\\n`;
    output += `┌─────────────────────────────────────────┐\\n`;
    output += `│ Biome: ${parsed.biome.toUpperCase()}\\n`;
    output += `│ Area: ${parsed.width}×${parsed.height} (${parsed.origin.x},${parsed.origin.y})\\n`;
    output += `│ Density: ${(parsed.density || 0.5) * 100}%\\n`;
    output += `└─────────────────────────────────────────┘\\n\\n`;
    output += `📊 Generated:\\n`;
    output += `   🧱 Obstacles: ${obstaclesAdded}\\n`;
    output += `   🌿 Difficult terrain: ${difficultAdded}\\n`;
    output += `   💧 Water: ${waterAdded}\\n`;
    output += `   🏗️ Props: ${propsAdded}\\n`;
    
    if (parsed.clearCenter) {
        output += `\\n✨ Center area kept clear for party placement\\n`;
    }

    // Append JSON for frontend
    output += `\\n\\n<!-- STATE_JSON\\n${JSON.stringify(stateJson)}\\nSTATE_JSON -->`;

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

/**
 * Handle generating terrain with a specific pattern template
 */
export async function handleGenerateTerrainPattern(args: unknown, ctx: SessionContext) {
    const parsed = CombatTools.GENERATE_TERRAIN_PATTERN.inputSchema.parse(args);
    let engine = getCombatManager().get(`${ctx.sessionId}:${parsed.encounterId}`);

    // Auto-load from database if not in memory
    if (!engine) {
        const db = getDb();
        const repo = new EncounterRepository(db);
        const state = repo.loadState(parsed.encounterId);

        if (!state) {
            throw new Error(`Encounter ${parsed.encounterId} not found.`);
        }

        engine = new CombatEngine(parsed.encounterId, pubsub || undefined);
        engine.loadState(state);
        getCombatManager().create(`${ctx.sessionId}:${parsed.encounterId}`, engine);
    }

    const state = engine.getState();
    if (!state) {
        throw new Error('No active encounter');
    }

    // Initialize terrain and props if needed
    if (!state.terrain) {
        state.terrain = { obstacles: [], difficultTerrain: [], water: [] };
    }
    if (!state.props) {
        state.props = [];
    }

    // Generate pattern - handle maze-specific options
    type PatternResult = { obstacles: string[]; water: string[]; difficultTerrain: string[]; props: Array<{position: string; label: string; heightFeet: number; propType: string; cover: string}> };
    let result: PatternResult;
    if (parsed.pattern === 'maze') {
        // Import maze generator with corridor width support
        const { generateMaze } = await import('./terrain-patterns.js');
        result = generateMaze(
            parsed.origin.x,
            parsed.origin.y,
            parsed.width,
            parsed.height,
            parsed.seed,
            parsed.corridorWidth ?? 1
        );
    } else if (parsed.pattern === 'maze_rooms') {
        const { generateMazeWithRooms } = await import('./terrain-patterns.js');
        result = generateMazeWithRooms(
            parsed.origin.x,
            parsed.origin.y,
            parsed.width,
            parsed.height,
            parsed.seed,
            parsed.roomCount ?? 5
        );
    } else {
        const patternGen = getPatternGenerator(parsed.pattern as any);
        result = patternGen(parsed.origin.x, parsed.origin.y, parsed.width, parsed.height, parsed.seed);
    }
    
    // Add generated terrain to state
    state.terrain.obstacles.push(...result.obstacles);
    if (!state.terrain.water) state.terrain.water = [];
    state.terrain.water.push(...result.water);
    if (!state.terrain.difficultTerrain) state.terrain.difficultTerrain = [];
    state.terrain.difficultTerrain.push(...result.difficultTerrain);
    
    // Add props
    for (const prop of result.props) {
        const randomId = engine.rng.rollDie(36).toString(36) + engine.rng.rollDie(36).toString(36);
        state.props.push({
            id: `prop-${Date.now()}-${randomId}`,
            label: prop.label,
            position: prop.position,
            heightFeet: prop.heightFeet,
            propType: prop.propType as any,
            cover: prop.cover as any,
            description: PATTERN_DESCRIPTIONS[parsed.pattern]
        });
    }
    
    // Persist state
    const db = getDb();
    const repo = new EncounterRepository(db);
    repo.saveState(parsed.encounterId, state);
    
    const stateJson = buildStateJson(state, parsed.encounterId);
    const output = `🏔️ TERRAIN PATTERN GENERATED: ${parsed.pattern.toUpperCase()}\n` +
        `📐 Area: (${parsed.origin.x},${parsed.origin.y}) to (${parsed.origin.x + parsed.width},${parsed.origin.y + parsed.height})\n` +
        `🧱 Obstacles: ${result.obstacles.length}\n` +
        `💧 Water: ${result.water.length}\n` +
        `🌿 Difficult terrain: ${result.difficultTerrain.length}\n` +
        `🏗️ Props: ${result.props.length}\n\n` +
        PATTERN_DESCRIPTIONS[parsed.pattern] + `\n\n` +
        `<!-- STATE_JSON\n${JSON.stringify(stateJson)}\nSTATE_JSON -->`;
    
    return {
        content: [{ type: 'text' as const, text: output }]
    };
}


