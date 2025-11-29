import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Tools, handleGenerateWorld, handleGetWorldState, handleApplyMapPatch, handleGetWorldMapOverview, handleGetRegionMap, handlePreviewMapPatch, setWorldPubSub } from './tools';
import { CombatTools, handleCreateEncounter, handleGetEncounterState, handleExecuteCombatAction, handleAdvanceTurn, handleEndEncounter, handleLoadEncounter, setCombatPubSub } from './combat-tools';
import { CRUDTools, handleCreateWorld, handleGetWorld, handleListWorlds, handleDeleteWorld, handleCreateCharacter, handleGetCharacter, handleUpdateCharacter, handleListCharacters, handleDeleteCharacter } from './crud-tools';
import { InventoryTools, handleCreateItemTemplate, handleGiveItem, handleRemoveItem, handleEquipItem, handleUnequipItem, handleGetInventory } from './inventory-tools';
import { QuestTools, handleCreateQuest, handleAssignQuest, handleUpdateObjective, handleCompleteQuest, handleGetQuestLog } from './quest-tools';
import { MathTools, handleDiceRoll, handleProbabilityCalculate, handleAlgebraSolve, handleAlgebraSimplify, handlePhysicsProjectile } from './math-tools';
import { PubSub } from '../engine/pubsub';
import { registerEventTools } from './events';
import { AuditLogger } from './audit';
import { withSession } from './types';

async function main() {
    // Create server instance
    const server = new McpServer({
        name: 'rpg-mcp',
        version: '1.0.0'
    });

    // Initialize PubSub
    const pubsub = new PubSub();
    setCombatPubSub(pubsub);
    setWorldPubSub(pubsub);

    // Register Event Tools
    registerEventTools(server, pubsub);

    // Initialize AuditLogger
    const auditLogger = new AuditLogger();

    // Register Core Tools
    server.tool(
        Tools.GENERATE_WORLD.name,
        Tools.GENERATE_WORLD.description,
        Tools.GENERATE_WORLD.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(Tools.GENERATE_WORLD.name, withSession(Tools.GENERATE_WORLD.inputSchema, handleGenerateWorld))
    );

    server.tool(
        Tools.GET_WORLD_STATE.name,
        Tools.GET_WORLD_STATE.description,
        Tools.GET_WORLD_STATE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(Tools.GET_WORLD_STATE.name, withSession(Tools.GET_WORLD_STATE.inputSchema, handleGetWorldState))
    );

    server.tool(
        Tools.APPLY_MAP_PATCH.name,
        Tools.APPLY_MAP_PATCH.description,
        Tools.APPLY_MAP_PATCH.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(Tools.APPLY_MAP_PATCH.name, withSession(Tools.APPLY_MAP_PATCH.inputSchema, handleApplyMapPatch))
    );

    server.tool(
        Tools.GET_WORLD_MAP_OVERVIEW.name,
        Tools.GET_WORLD_MAP_OVERVIEW.description,
        Tools.GET_WORLD_MAP_OVERVIEW.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(Tools.GET_WORLD_MAP_OVERVIEW.name, withSession(Tools.GET_WORLD_MAP_OVERVIEW.inputSchema, handleGetWorldMapOverview))
    );

    server.tool(
        Tools.GET_REGION_MAP.name,
        Tools.GET_REGION_MAP.description,
        Tools.GET_REGION_MAP.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(Tools.GET_REGION_MAP.name, withSession(Tools.GET_REGION_MAP.inputSchema, handleGetRegionMap))
    );

    server.tool(
        Tools.PREVIEW_MAP_PATCH.name,
        Tools.PREVIEW_MAP_PATCH.description,
        Tools.PREVIEW_MAP_PATCH.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(Tools.PREVIEW_MAP_PATCH.name, withSession(Tools.PREVIEW_MAP_PATCH.inputSchema, handlePreviewMapPatch))
    );

    // Register Combat Tools
    server.tool(
        CombatTools.CREATE_ENCOUNTER.name,
        CombatTools.CREATE_ENCOUNTER.description,
        CombatTools.CREATE_ENCOUNTER.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CombatTools.CREATE_ENCOUNTER.name, withSession(CombatTools.CREATE_ENCOUNTER.inputSchema, handleCreateEncounter))
    );

    server.tool(
        CombatTools.GET_ENCOUNTER_STATE.name,
        CombatTools.GET_ENCOUNTER_STATE.description,
        CombatTools.GET_ENCOUNTER_STATE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CombatTools.GET_ENCOUNTER_STATE.name, withSession(CombatTools.GET_ENCOUNTER_STATE.inputSchema, handleGetEncounterState))
    );

    server.tool(
        CombatTools.EXECUTE_COMBAT_ACTION.name,
        CombatTools.EXECUTE_COMBAT_ACTION.description,
        CombatTools.EXECUTE_COMBAT_ACTION.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CombatTools.EXECUTE_COMBAT_ACTION.name, withSession(CombatTools.EXECUTE_COMBAT_ACTION.inputSchema, handleExecuteCombatAction))
    );

    server.tool(
        CombatTools.ADVANCE_TURN.name,
        CombatTools.ADVANCE_TURN.description,
        CombatTools.ADVANCE_TURN.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CombatTools.ADVANCE_TURN.name, withSession(CombatTools.ADVANCE_TURN.inputSchema, handleAdvanceTurn))
    );

    server.tool(
        CombatTools.END_ENCOUNTER.name,
        CombatTools.END_ENCOUNTER.description,
        CombatTools.END_ENCOUNTER.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CombatTools.END_ENCOUNTER.name, withSession(CombatTools.END_ENCOUNTER.inputSchema, handleEndEncounter))
    );

    server.tool(
        CombatTools.LOAD_ENCOUNTER.name,
        CombatTools.LOAD_ENCOUNTER.description,
        CombatTools.LOAD_ENCOUNTER.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CombatTools.LOAD_ENCOUNTER.name, withSession(CombatTools.LOAD_ENCOUNTER.inputSchema, handleLoadEncounter))
    );

    // Register CRUD Tools
    server.tool(
        CRUDTools.CREATE_WORLD.name,
        CRUDTools.CREATE_WORLD.description,
        CRUDTools.CREATE_WORLD.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CRUDTools.CREATE_WORLD.name, withSession(CRUDTools.CREATE_WORLD.inputSchema, handleCreateWorld))
    );

    server.tool(
        CRUDTools.GET_WORLD.name,
        CRUDTools.GET_WORLD.description,
        CRUDTools.GET_WORLD.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CRUDTools.GET_WORLD.name, withSession(CRUDTools.GET_WORLD.inputSchema, handleGetWorld))
    );

    server.tool(
        CRUDTools.LIST_WORLDS.name,
        CRUDTools.LIST_WORLDS.description,
        CRUDTools.LIST_WORLDS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CRUDTools.LIST_WORLDS.name, withSession(CRUDTools.LIST_WORLDS.inputSchema, handleListWorlds))
    );

    server.tool(
        CRUDTools.DELETE_WORLD.name,
        CRUDTools.DELETE_WORLD.description,
        CRUDTools.DELETE_WORLD.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CRUDTools.DELETE_WORLD.name, withSession(CRUDTools.DELETE_WORLD.inputSchema, handleDeleteWorld))
    );

    server.tool(
        CRUDTools.CREATE_CHARACTER.name,
        CRUDTools.CREATE_CHARACTER.description,
        // For union types, we can't easily extend. We'll cast to any for schema registration.
        // withSession will handle the intersection internally.
        (z.intersection(CRUDTools.CREATE_CHARACTER.inputSchema, z.object({ sessionId: z.string().optional() })) as any),
        auditLogger.wrapHandler(CRUDTools.CREATE_CHARACTER.name, withSession(CRUDTools.CREATE_CHARACTER.inputSchema, handleCreateCharacter))
    );

    server.tool(
        CRUDTools.GET_CHARACTER.name,
        CRUDTools.GET_CHARACTER.description,
        CRUDTools.GET_CHARACTER.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CRUDTools.GET_CHARACTER.name, withSession(CRUDTools.GET_CHARACTER.inputSchema, handleGetCharacter))
    );

    server.tool(
        CRUDTools.UPDATE_CHARACTER.name,
        CRUDTools.UPDATE_CHARACTER.description,
        CRUDTools.UPDATE_CHARACTER.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CRUDTools.UPDATE_CHARACTER.name, withSession(CRUDTools.UPDATE_CHARACTER.inputSchema, handleUpdateCharacter))
    );

    server.tool(
        CRUDTools.LIST_CHARACTERS.name,
        CRUDTools.LIST_CHARACTERS.description,
        CRUDTools.LIST_CHARACTERS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CRUDTools.LIST_CHARACTERS.name, withSession(CRUDTools.LIST_CHARACTERS.inputSchema, handleListCharacters))
    );

    server.tool(
        CRUDTools.DELETE_CHARACTER.name,
        CRUDTools.DELETE_CHARACTER.description,
        CRUDTools.DELETE_CHARACTER.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CRUDTools.DELETE_CHARACTER.name, withSession(CRUDTools.DELETE_CHARACTER.inputSchema, handleDeleteCharacter))
    );

    // Register Inventory Tools
    server.tool(
        InventoryTools.CREATE_ITEM_TEMPLATE.name,
        InventoryTools.CREATE_ITEM_TEMPLATE.description,
        InventoryTools.CREATE_ITEM_TEMPLATE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(InventoryTools.CREATE_ITEM_TEMPLATE.name, withSession(InventoryTools.CREATE_ITEM_TEMPLATE.inputSchema, handleCreateItemTemplate))
    );

    server.tool(
        InventoryTools.GIVE_ITEM.name,
        InventoryTools.GIVE_ITEM.description,
        InventoryTools.GIVE_ITEM.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(InventoryTools.GIVE_ITEM.name, withSession(InventoryTools.GIVE_ITEM.inputSchema, handleGiveItem))
    );

    server.tool(
        InventoryTools.REMOVE_ITEM.name,
        InventoryTools.REMOVE_ITEM.description,
        InventoryTools.REMOVE_ITEM.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(InventoryTools.REMOVE_ITEM.name, withSession(InventoryTools.REMOVE_ITEM.inputSchema, handleRemoveItem))
    );

    server.tool(
        InventoryTools.EQUIP_ITEM.name,
        InventoryTools.EQUIP_ITEM.description,
        InventoryTools.EQUIP_ITEM.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(InventoryTools.EQUIP_ITEM.name, withSession(InventoryTools.EQUIP_ITEM.inputSchema, handleEquipItem))
    );

    server.tool(
        InventoryTools.UNEQUIP_ITEM.name,
        InventoryTools.UNEQUIP_ITEM.description,
        InventoryTools.UNEQUIP_ITEM.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(InventoryTools.UNEQUIP_ITEM.name, withSession(InventoryTools.UNEQUIP_ITEM.inputSchema, handleUnequipItem))
    );

    server.tool(
        InventoryTools.GET_INVENTORY.name,
        InventoryTools.GET_INVENTORY.description,
        InventoryTools.GET_INVENTORY.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(InventoryTools.GET_INVENTORY.name, withSession(InventoryTools.GET_INVENTORY.inputSchema, handleGetInventory))
    );

    // Register Quest Tools
    server.tool(
        QuestTools.CREATE_QUEST.name,
        QuestTools.CREATE_QUEST.description,
        QuestTools.CREATE_QUEST.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(QuestTools.CREATE_QUEST.name, withSession(QuestTools.CREATE_QUEST.inputSchema, handleCreateQuest))
    );

    server.tool(
        QuestTools.ASSIGN_QUEST.name,
        QuestTools.ASSIGN_QUEST.description,
        QuestTools.ASSIGN_QUEST.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(QuestTools.ASSIGN_QUEST.name, withSession(QuestTools.ASSIGN_QUEST.inputSchema, handleAssignQuest))
    );

    server.tool(
        QuestTools.UPDATE_OBJECTIVE.name,
        QuestTools.UPDATE_OBJECTIVE.description,
        QuestTools.UPDATE_OBJECTIVE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(QuestTools.UPDATE_OBJECTIVE.name, withSession(QuestTools.UPDATE_OBJECTIVE.inputSchema, handleUpdateObjective))
    );

    server.tool(
        QuestTools.COMPLETE_QUEST.name,
        QuestTools.COMPLETE_QUEST.description,
        QuestTools.COMPLETE_QUEST.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(QuestTools.COMPLETE_QUEST.name, withSession(QuestTools.COMPLETE_QUEST.inputSchema, handleCompleteQuest))
    );

    server.tool(
        QuestTools.GET_QUEST_LOG.name,
        QuestTools.GET_QUEST_LOG.description,
        QuestTools.GET_QUEST_LOG.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(QuestTools.GET_QUEST_LOG.name, withSession(QuestTools.GET_QUEST_LOG.inputSchema, handleGetQuestLog))
    );

    // Register Math Tools
    server.tool(
        MathTools.DICE_ROLL.name,
        MathTools.DICE_ROLL.description,
        MathTools.DICE_ROLL.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(MathTools.DICE_ROLL.name, withSession(MathTools.DICE_ROLL.inputSchema, handleDiceRoll))
    );

    server.tool(
        MathTools.PROBABILITY_CALCULATE.name,
        MathTools.PROBABILITY_CALCULATE.description,
        MathTools.PROBABILITY_CALCULATE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(MathTools.PROBABILITY_CALCULATE.name, withSession(MathTools.PROBABILITY_CALCULATE.inputSchema, handleProbabilityCalculate))
    );

    server.tool(
        MathTools.ALGEBRA_SOLVE.name,
        MathTools.ALGEBRA_SOLVE.description,
        MathTools.ALGEBRA_SOLVE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(MathTools.ALGEBRA_SOLVE.name, withSession(MathTools.ALGEBRA_SOLVE.inputSchema, handleAlgebraSolve))
    );

    server.tool(
        MathTools.ALGEBRA_SIMPLIFY.name,
        MathTools.ALGEBRA_SIMPLIFY.description,
        MathTools.ALGEBRA_SIMPLIFY.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(MathTools.ALGEBRA_SIMPLIFY.name, withSession(MathTools.ALGEBRA_SIMPLIFY.inputSchema, handleAlgebraSimplify))
    );

    server.tool(
        MathTools.PHYSICS_PROJECTILE.name,
        MathTools.PHYSICS_PROJECTILE.description,
        MathTools.PHYSICS_PROJECTILE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(MathTools.PHYSICS_PROJECTILE.name, withSession(MathTools.PHYSICS_PROJECTILE.inputSchema, handlePhysicsProjectile))
    );

    // Connect transport
    const args = process.argv.slice(2);
    const transportType = args.includes('--tcp') ? 'tcp'
        : (args.includes('--unix') || args.includes('--socket')) ? 'unix'
            : (args.includes('--ws') || args.includes('--websocket')) ? 'websocket'
                : 'stdio';

    if (transportType === 'tcp') {
        const { TCPServerTransport } = await import('./transport/tcp.js');
        const portIndex = args.indexOf('--port');
        const port = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : 3000;

        const transport = new TCPServerTransport(port);
        await server.connect(transport);
        console.error(`RPG MCP Server running on TCP port ${port}`);
    } else if (transportType === 'unix') {
        const { UnixServerTransport } = await import('./transport/unix.js');
        let socketPath = '';
        const unixIndex = args.indexOf('--unix');
        const socketIndex = args.indexOf('--socket');

        if (unixIndex !== -1 && args[unixIndex + 1]) {
            socketPath = args[unixIndex + 1];
        } else if (socketIndex !== -1 && args[socketIndex + 1]) {
            socketPath = args[socketIndex + 1];
        }

        if (!socketPath) {
            // Default path based on OS
            socketPath = process.platform === 'win32' ? '\\\\.\\pipe\\rpg-mcp' : '/tmp/rpg-mcp.sock';
        }

        const transport = new UnixServerTransport(socketPath);
        await server.connect(transport);
        console.error(`RPG MCP Server running on Unix socket ${socketPath}`);
    } else if (transportType === 'websocket') {
        const { WebSocketServerTransport } = await import('./transport/websocket.js');
        const portIndex = args.indexOf('--port');
        const port = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : 3001;

        const transport = new WebSocketServerTransport(port);
        await server.connect(transport);
        console.error(`RPG MCP Server running on WebSocket port ${port}`);
    } else {
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error('RPG MCP Server running on stdio');
    }
}

main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
});
