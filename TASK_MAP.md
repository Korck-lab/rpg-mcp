# RPG-MCP Task Map for Quest Keeper Integration

> **Purpose**: Guide for coding agents to systematically improve rpg-mcp for Quest Keeper AI replacement.
> **Generated**: 2025-11-26
> **Based on**: Comprehensive code review

---

## Task Priority Legend

| Priority | Meaning | Timeframe |
|----------|---------|-----------|
| 🔴 P0 | Critical blocker | Do first |
| 🟠 P1 | High impact | This sprint |
| 🟡 P2 | Important | Next sprint |
| 🟢 P3 | Nice to have | Backlog |

---

## Phase 1: Critical Fixes (P0)

### Task 1.1: Fix Global State Anti-Pattern

**File**: `src/server/tools.ts`, `src/server/combat-tools.ts`

**Problem**: Single global `currentWorld` and `currentEncounter` prevent multi-session support.

**Implementation Hints**:
```typescript
// Create new file: src/server/state/world-manager.ts

import { GeneratedWorld } from '../engine/worldgen/index';

export class WorldManager {
    private worlds: Map<string, GeneratedWorld> = new Map();
    
    create(id: string, world: GeneratedWorld): void {
        if (this.worlds.has(id)) {
            throw new Error(`World ${id} already exists`);
        }
        this.worlds.set(id, world);
    }
    
    get(id: string): GeneratedWorld | null {
        return this.worlds.get(id) || null;
    }
    
    delete(id: string): boolean {
        return this.worlds.delete(id);
    }
    
    list(): string[] {
        return Array.from(this.worlds.keys());
    }
}

// Singleton for server lifetime
let instance: WorldManager | null = null;
export function getWorldManager(): WorldManager {
    if (!instance) instance = new WorldManager();
    return instance;
}
```

**Changes needed**:
1. Create `src/server/state/world-manager.ts` (as above)
2. Create `src/server/state/combat-manager.ts` (similar pattern)
3. Update `tools.ts`:
   - Add `worldId` parameter to all tool schemas
   - Replace `currentWorld` access with `getWorldManager().get(worldId)`
4. Update `combat-tools.ts`:
   - Add `encounterId` parameter to combat tool schemas
   - Replace `currentEncounter` with manager lookup
5. Update `src/server/index.ts` to instantiate managers

**Acceptance Criteria**:
- [x] Can create multiple worlds simultaneously
- [x] Can run multiple encounters simultaneously
- [x] Each tool call specifies which world/encounter to operate on
- [x] All existing tests pass (update test fixtures)

---

### Task 1.2: Persist Combat State to Database

**Files**: `src/server/combat-tools.ts`, `src/storage/repos/encounter.repo.ts`

**Problem**: Combat state lost on server restart.

**Implementation Hints**:
```typescript
// src/storage/repos/encounter.repo.ts - ADD serialization methods

import { CombatState } from '../../engine/combat/engine';

export class EncounterRepository {
    // ... existing code ...
    
    saveState(encounterId: string, state: CombatState): void {
        const stmt = this.db.prepare(`
            UPDATE encounters 
            SET tokens = ?, round = ?, active_token_id = ?, status = ?, updated_at = ?
            WHERE id = ?
        `);
        stmt.run(
            JSON.stringify(state.participants),
            state.round,
            state.turnOrder[state.currentTurnIndex],
            'active',
            new Date().toISOString(),
            encounterId
        );
    }
    
    loadState(encounterId: string): CombatState | null {
        const row = this.findById(encounterId);
        if (!row) return null;
        
        return {
            participants: JSON.parse(row.tokens),
            turnOrder: JSON.parse(row.tokens).map((p: any) => p.id),
            currentTurnIndex: /* find index of active_token_id */,
            round: row.round
        };
    }
}
```

**Changes needed**:
1. Add `saveState()` and `loadState()` to `EncounterRepository`
2. In `combat-tools.ts`:
   - After each state-changing operation, call `repo.saveState()`
   - In `handleCreateEncounter`, also persist to DB
   - Add `handleLoadEncounter` tool to resume from DB
3. Update `CombatEngine` to accept initial state in constructor

**Acceptance Criteria**:
- [x] Encounter survives server restart
- [x] Can list and resume previous encounters
- [x] Round and turn position preserved correctly

---

### Task 1.3: Fix Repository Bypass in CRUD Tools

**File**: `src/server/crud-tools.ts`, `src/storage/repos/character.repo.ts`

**Problem**: `handleUpdateCharacter` and `handleListCharacters` bypass repository pattern.

**Implementation Hints**:
```typescript
// src/storage/repos/character.repo.ts - ADD these methods

update(id: string, updates: Partial<Character>): Character | null {
    const existing = this.findById(id);
    if (!existing) return null;
    
    const updated = {
        ...existing,
        ...updates,
        updatedAt: new Date().toISOString()
    };
    
    const stmt = this.db.prepare(`
        UPDATE characters
        SET name = ?, stats = ?, hp = ?, max_hp = ?, ac = ?, level = ?,
            faction_id = ?, behavior = ?, updated_at = ?
        WHERE id = ?
    `);
    stmt.run(
        updated.name,
        JSON.stringify(updated.stats),
        updated.hp,
        updated.maxHp,
        updated.ac,
        updated.level,
        (updated as NPC).factionId || null,
        (updated as NPC).behavior || null,
        updated.updatedAt,
        id
    );
    
    return updated;
}

findAll(): (Character | NPC)[] {
    const stmt = this.db.prepare('SELECT * FROM characters');
    const rows = stmt.all() as CharacterRow[];
    return rows.map(row => this.rowToCharacter(row));
}

private rowToCharacter(row: CharacterRow): Character | NPC {
    // Extract the common mapping logic from findById
}
```

**Changes needed**:
1. Add `update()` method to `CharacterRepository`
2. Add `findAll()` method to `CharacterRepository`
3. Refactor `findById` to use shared `rowToCharacter` helper
4. Update `handleUpdateCharacter` to use `charRepo.update()`
5. Update `handleListCharacters` to use `charRepo.findAll()`

**Acceptance Criteria**:
- [x] No direct SQL in crud-tools.ts
- [x] All data access goes through repositories
- [x] Zod validation on all paths

---

### Task 1.4: Fix Memory Leak in Event Subscriptions

**File**: `src/server/events.ts`

**Problem**: Subscriptions accumulate without cleanup.

**Implementation Hints**:
```typescript
// Track subscriptions per connection
const activeSubscriptions: Map<string, Array<() => void>> = new Map();

export function registerEventTools(server: McpServer, pubsub: PubSub) {
    // Generate connection ID (in real impl, get from transport)
    let connectionId = `conn-${Date.now()}`;
    
    server.tool(
        EventTools.SUBSCRIBE.name,
        EventTools.SUBSCRIBE.description,
        EventTools.SUBSCRIBE.inputSchema.shape,
        async (args: any) => {
            const parsed = EventTools.SUBSCRIBE.inputSchema.parse(args);
            
            // Clean up previous subscriptions for this connection
            const existing = activeSubscriptions.get(connectionId) || [];
            existing.forEach(unsub => unsub());
            
            const newSubs: Array<() => void> = [];
            
            for (const topic of parsed.topics) {
                const unsub = pubsub.subscribe(topic, (payload) => {
                    server.server.notification({
                        method: 'notifications/rpg/event',
                        params: { topic, payload }
                    });
                });
                newSubs.push(unsub);
            }
            
            activeSubscriptions.set(connectionId, newSubs);
            
            return {
                content: [{
                    type: 'text',
                    text: `Subscribed to topics: ${parsed.topics.join(', ')}`
                }]
            };
        }
    );
    
    // Add unsubscribe tool
    server.tool(
        'unsubscribe_from_events',
        'Unsubscribe from all event topics',
        {},
        async () => {
            const subs = activeSubscriptions.get(connectionId) || [];
            subs.forEach(unsub => unsub());
            activeSubscriptions.delete(connectionId);
            return { content: [{ type: 'text', text: 'Unsubscribed from all topics' }] };
        }
    );
}
```

**Acceptance Criteria**:
- [x] Calling subscribe twice replaces previous subscriptions
- [x] Unsubscribe tool exists and works
- [x] No memory growth on repeated subscribe calls

---

## Phase 2: High Impact Improvements (P1)

### Task 2.1: Fix DSL Parser/Documentation Mismatch

**Files**: `src/server/tools.ts`, `src/engine/dsl/parser.ts`

**Problem**: Tool description says `ADD_STRUCTURE town 12 15` but parser expects `ADD_STRUCTURE type=town x=12 y=15`.

**Option A - Fix Documentation** (Easier):
```typescript
// src/server/tools.ts - Update description
description: `Applies a DSL patch script to the current world.

Syntax: COMMAND key=value key2="string value"

Supported Commands:
- ADD_STRUCTURE type=<type> x=<num> y=<num> name="<name>"
- SET_BIOME type=<biome> x=<num> y=<num>
- EDIT_TILE x=<num> y=<num> elevation=<num>

Example Script:
ADD_STRUCTURE type=city x=25 y=25 name="Riverdale"
SET_BIOME type=mountain x=26 y=25`
```

**Option B - Support Positional Args** (Better UX):
```typescript
// src/engine/dsl/parser.ts - Add positional parsing

function parseLine(line: string): PatchCommand {
    const tokens = tokenize(line);
    const commandName = tokens[0];
    
    // Try positional parsing for known commands
    if (commandName === 'ADD_STRUCTURE' && tokens.length >= 4 && !tokens[1].includes('=')) {
        return {
            command: CommandType.ADD_STRUCTURE,
            args: {
                type: tokens[1],
                x: parseInt(tokens[2]),
                y: parseInt(tokens[3]),
                name: tokens[4] || tokens[1] // default name to type
            }
        };
    }
    
    // Fall back to key=value parsing
    // ... existing code ...
}
```

**Acceptance Criteria**:
- [x] Example in tool description actually works
- [x] Tests cover both syntaxes (if Option B)

---

### Task 2.2: Simplify Test Configuration

**File**: `package.json`, `vitest.config.ts`

**Problem**: Massive test script, sequential execution, hard to maintain.

**Implementation**:
```typescript
// vitest.config.ts - Replace entire file
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        exclude: ['node_modules', 'dist'],
        pool: 'forks',
        poolOptions: {
            forks: {
                singleFork: false,
                isolate: true,
            }
        },
        testTimeout: 30000,
        hookTimeout: 30000,
        // Memory management
        maxConcurrency: 4,
        fileParallelism: true,
        // Coverage
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            include: ['src/**/*.ts'],
            exclude: ['src/api/**'] // Excluded from build anyway
        }
    }
});
```

```json
// package.json - Simplify scripts
{
    "scripts": {
        "test": "vitest run",
        "test:watch": "vitest",
        "test:coverage": "vitest run --coverage",
        "test:ui": "vitest --ui"
    }
}
```

**Also fix**: `tests/storage/character.repo.test.ts` line 40 - missing `FIXED_TIMESTAMP` constant.

**Acceptance Criteria**:
- [x] `npm test` runs all tests
- [x] Tests run in parallel where possible
- [x] No more `FIXED_TIMESTAMP` error

---

### Task 2.3: Add Session Context to All Tools

**Files**: All files in `src/server/`

**Problem**: Need session isolation for multi-user support.

**Implementation Hints**:
```typescript
// src/server/types.ts - New file
export interface SessionContext {
    sessionId: string;
    userId?: string;
    worldId?: string;
}

// Create wrapper for tool handlers
export function withSession<T extends z.ZodObject<any>>(
    schema: T,
    handler: (args: z.infer<T>, ctx: SessionContext) => Promise<any>
) {
    const sessionSchema = schema.extend({
        sessionId: z.string().optional().default('default')
    });
    
    return async (args: unknown) => {
        const parsed = sessionSchema.parse(args);
        const { sessionId, ...rest } = parsed;
        const ctx: SessionContext = { sessionId };
        return handler(rest as z.infer<T>, ctx);
    };
}
```

**Apply to each tool**:
```typescript
// Example in tools.ts
server.tool(
    Tools.GENERATE_WORLD.name,
    Tools.GENERATE_WORLD.description,
    Tools.GENERATE_WORLD.inputSchema.extend({ sessionId: z.string().optional() }).shape,
    withSession(Tools.GENERATE_WORLD.inputSchema, async (args, ctx) => {
        const world = generateWorld(args);
        getWorldManager().create(`${ctx.sessionId}:${args.seed}`, world);
        // ...
    })
);
```

**Acceptance Criteria**:
- [x] All tools accept optional `sessionId`
- [x] Worlds/encounters namespaced by session
- [x] Default session works for backward compatibility
- [ ] Default session works for backward compatibility

---

### Task 2.4: Add World Repository Integration to Generate World

**Files**: `src/server/tools.ts`, `src/storage/repos/world.repo.ts`

**Problem**: `generate_world` creates in-memory world but doesn't persist metadata to DB.

**Implementation Hints**:
```typescript
// In handleGenerateWorld
export async function handleGenerateWorld(args: unknown) {
    const parsed = Tools.GENERATE_WORLD.inputSchema.parse(args);
    const world = generateWorld({
        seed: parsed.seed,
        width: parsed.width,
        height: parsed.height
    });
    
    // Persist to both manager (runtime) and DB (metadata)
    const worldId = randomUUID();
    getWorldManager().create(worldId, world);
    
    const { worldRepo } = ensureDb();
    worldRepo.create({
        id: worldId,
        name: `World-${parsed.seed}`,
        seed: parsed.seed,
        width: parsed.width,
        height: parsed.height,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });
    
    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                worldId, // Return this so client can reference it
                message: 'World generated successfully',
                stats: { /* ... */ }
            }, null, 2)
        }]
    };
}
```

**Acceptance Criteria**:
- [x] Generated world appears in `list_worlds`
- [x] `worldId` returned for subsequent operations
- [x] Can delete generated worlds

---

## Phase 3: Feature Development (P2)

### Task 3.1: Add WebSocket Transport

**Files**: New `src/server/transport/websocket.ts`

**Why**: Real-time events for combat turns, world updates.

**Implementation Hints**:
```typescript
import { WebSocketServer, WebSocket } from 'ws';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

export class WebSocketServerTransport implements Transport {
    private wss: WebSocketServer;
    private clients: Set<WebSocket> = new Set();
    private messageHandlers: Map<WebSocket, (msg: JSONRPCMessage) => void> = new Map();
    
    constructor(private port: number = 3001) {
        this.wss = new WebSocketServer({ port });
        
        this.wss.on('connection', (ws) => {
            this.clients.add(ws);
            
            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this._onmessage?.(message);
                } catch (e) {
                    this._onerror?.(e as Error);
                }
            });
            
            ws.on('close', () => {
                this.clients.delete(ws);
            });
        });
    }
    
    async send(message: JSONRPCMessage): Promise<void> {
        const data = JSON.stringify(message);
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(data);
            }
        }
    }
    
    // Broadcast to all clients (for notifications)
    broadcast(message: JSONRPCMessage): void {
        this.send(message);
    }
    
    // ... implement remaining Transport interface
}
```

**Add to package.json**:
```json
"dependencies": {
    "ws": "^8.16.0"
},
"devDependencies": {
    "@types/ws": "^8.5.10"
}
```

**Acceptance Criteria**:
- [ ] Server accepts WebSocket connections
- [ ] Tool calls work over WebSocket
- [ ] Event notifications pushed to clients

---

### Task 3.2: Add Inventory System

**Files**: New schema, repo, and tools

**Schema** (`src/schema/inventory.ts`):
```typescript
import { z } from 'zod';

export const ItemSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    type: z.enum(['weapon', 'armor', 'consumable', 'quest', 'misc']),
    weight: z.number().min(0).default(0),
    value: z.number().min(0).default(0),
    properties: z.record(z.any()).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
});

export const InventorySchema = z.object({
    characterId: z.string(),
    items: z.array(z.object({
        itemId: z.string(),
        quantity: z.number().int().min(1),
        equipped: z.boolean().default(false),
        slot: z.string().optional() // 'mainhand', 'offhand', 'armor', etc.
    })),
    capacity: z.number().default(100), // Weight limit
    currency: z.object({
        gold: z.number().int().min(0).default(0),
        silver: z.number().int().min(0).default(0),
        copper: z.number().int().min(0).default(0)
    }).default({})
});

export type Item = z.infer<typeof ItemSchema>;
export type Inventory = z.infer<typeof InventorySchema>;
```

**Migration** (add to `migrations.ts`):
```sql
CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 0,
    value INTEGER NOT NULL DEFAULT 0,
    properties TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_items (
    character_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    equipped INTEGER NOT NULL DEFAULT 0,
    slot TEXT,
    PRIMARY KEY (character_id, item_id),
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);
```

**Tools to add**:
- `create_item` - Define new item template
- `add_to_inventory` - Give item to character
- `remove_from_inventory` - Take item from character
- `equip_item` / `unequip_item`
- `get_inventory` - List character's items
- `transfer_item` - Move between characters

**Acceptance Criteria**:
- [ ] Characters can hold items
- [ ] Weight/capacity limits enforced
- [ ] Equipment slots work

---

### Task 3.3: Add Quest System

**Schema** (`src/schema/quest.ts`):
```typescript
export const QuestSchema = z.object({
    id: z.string(),
    worldId: z.string(),
    name: z.string(),
    description: z.string(),
    status: z.enum(['available', 'active', 'completed', 'failed']),
    objectives: z.array(z.object({
        id: z.string(),
        description: z.string(),
        type: z.enum(['kill', 'collect', 'deliver', 'explore', 'interact', 'custom']),
        target: z.string(), // Entity ID, item ID, location, etc.
        required: z.number().int().min(1),
        current: z.number().int().min(0).default(0),
        completed: z.boolean().default(false)
    })),
    rewards: z.object({
        experience: z.number().int().min(0).default(0),
        gold: z.number().int().min(0).default(0),
        items: z.array(z.string()).default([]) // Item IDs
    }),
    prerequisites: z.array(z.string()).default([]), // Quest IDs that must be completed first
    giver: z.string().optional(), // NPC ID
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
});

export const QuestLogSchema = z.object({
    characterId: z.string(),
    activeQuests: z.array(z.string()), // Quest IDs
    completedQuests: z.array(z.string()),
    failedQuests: z.array(z.string())
});
```

**Tools to add**:
- `create_quest` - Define quest in world
- `assign_quest` - Give quest to character
- `update_objective` - Progress on objective
- `complete_quest` - Mark quest done, grant rewards
- `get_quest_log` - Character's quest status

**Acceptance Criteria**:
- [x] Quests can be created and assigned
- [x] Objective progress tracked
- [x] Prerequisites enforced
- [x] Rewards granted on completion

---

### Task 3.4: Add Map Rendering Tool

**File**: New `src/server/map-tools.ts`

**Purpose**: Generate ASCII or structured map output for LLM context.

```typescript
export const MapTools = {
    RENDER_ASCII_MAP: {
        name: 'render_ascii_map',
        description: 'Render a region of the world as ASCII art for visualization',
        inputSchema: z.object({
            worldId: z.string(),
            centerX: z.number().int(),
            centerY: z.number().int(),
            radius: z.number().int().min(1).max(25).default(10),
            showStructures: z.boolean().default(true),
            showRivers: z.boolean().default(true)
        })
    }
};

const BIOME_CHARS: Record<string, string> = {
    ocean: '~',
    desert: '.',
    grassland: '"',
    forest: '♣',
    mountain: '^',
    snow: '*',
    swamp: '%',
    // ...
};

const STRUCTURE_CHARS: Record<string, string> = {
    city: '▣',
    town: '□',
    village: '○',
    dungeon: '◆',
    // ...
};

export async function handleRenderAsciiMap(args: unknown) {
    const parsed = MapTools.RENDER_ASCII_MAP.inputSchema.parse(args);
    const world = getWorldManager().get(parsed.worldId);
    if (!world) throw new Error('World not found');
    
    const lines: string[] = [];
    
    for (let y = parsed.centerY - parsed.radius; y <= parsed.centerY + parsed.radius; y++) {
        let line = '';
        for (let x = parsed.centerX - parsed.radius; x <= parsed.centerX + parsed.radius; x++) {
            if (x < 0 || y < 0 || x >= world.width || y >= world.height) {
                line += ' ';
                continue;
            }
            
            // Check for structure first
            const structure = world.structures.find(s => s.location.x === x && s.location.y === y);
            if (structure && parsed.showStructures) {
                line += STRUCTURE_CHARS[structure.type] || '?';
                continue;
            }
            
            // Check for river
            const idx = y * world.width + x;
            if (world.rivers[idx] > 0 && parsed.showRivers) {
                line += '≈';
                continue;
            }
            
            // Default to biome
            const biome = world.biomes[y][x];
            line += BIOME_CHARS[biome] || '?';
        }
        lines.push(line);
    }
    
    return {
        content: [{
            type: 'text',
            text: lines.join('\n')
        }]
    };
}
```

**Acceptance Criteria**:
- [ ] ASCII map renders correctly
- [ ] Structures visible
- [ ] Rivers visible
- [ ] Bounded to world edges

---

## Phase 4: Polish & Production (P3)

### Task 4.1: Add Input Sanitization

**All tool handlers need validation beyond Zod**:
- String length limits
- Path traversal prevention (if file ops added)
- Rate limiting hooks

### Task 4.2: Add Health Check Endpoint

```typescript
server.tool('health_check', 'Server health status', {}, async () => ({
    content: [{
        type: 'text',
        text: JSON.stringify({
            status: 'healthy',
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            worlds: getWorldManager().list().length,
            encounters: getCombatManager().list().length
        })
    }]
}));
```

### Task 4.3: Add Metrics/Telemetry

- Tool call counts
- Latency percentiles
- Error rates
- Memory usage over time

### Task 4.4: Docker Deployment

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 3000 3001
CMD ["node", "dist/server/index.js", "--tcp", "--port", "3000"]
```

### Task 4.5: Documentation

- [ ] API reference for all tools
- [ ] Architecture diagram
- [ ] Deployment guide
- [ ] Contributing guide updates

---

## Dependency Graph

```
Phase 1 (Critical)
├── 1.1 Fix Global State ─────────┐
├── 1.2 Persist Combat ───────────┼── Required for Phase 2+
├── 1.3 Fix Repo Bypass           │
└── 1.4 Fix Event Leak            │
                                  │
Phase 2 (High Impact)             │
├── 2.1 Fix DSL Docs              │
├── 2.2 Simplify Tests            │
├── 2.3 Add Session Context ◄─────┘
└── 2.4 World Repo Integration
                                  
Phase 3 (Features)
├── 3.1 WebSocket Transport ◄── Enables real-time Quest Keeper
├── 3.2 Inventory System
├── 3.3 Quest System
└── 3.4 Map Rendering

Phase 4 (Polish)
├── 4.1 Input Sanitization
├── 4.2 Health Check
├── 4.3 Metrics
├── 4.4 Docker
└── 4.5 Documentation
```

---

## Quick Reference: File Locations

| Component | Primary File | Related Files |
|-----------|--------------|---------------|
| World Generation | `src/engine/worldgen/index.ts` | `heightmap.ts`, `biome.ts`, `river.ts` |
| Combat | `src/engine/combat/engine.ts` | `rng.ts`, `conditions.ts` |
| Spatial | `src/engine/spatial/engine.ts` | `heap.ts` |
| DSL | `src/engine/dsl/parser.ts` | `engine.ts`, `schema.ts` |
| MCP Server | `src/server/index.ts` | `tools.ts`, `combat-tools.ts`, `crud-tools.ts` |
| Storage | `src/storage/index.ts` | `migrations.ts`, `repos/*.ts` |
| Schemas | `src/schema/index.ts` | `character.ts`, `world.ts`, etc. |

---

## Testing Commands

```bash
# Run all tests
npm test

# Run specific test file
npx vitest run tests/combat/engine.test.ts

# Run tests matching pattern
npx vitest run -t "should apply damage"

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

---

## Notes for Coding Agents

1. **Always run tests after changes**: `npm test`
2. **TypeScript strict mode is ON**: Fix all type errors
3. **Zod schemas are source of truth**: Update schema first, then implementation
4. **Audit logging is automatic**: Don't disable it
5. **PubSub is available**: Use it for cross-cutting events
6. **Determinism matters**: Use seeded RNG, not `Math.random()`

---

*Last updated: 2025-11-26*
*Review source: Comprehensive code review by Claude*
