/**
 * ReplayEngine - Event sourcing replay system for deterministic state reconstruction.
 *
 * The ReplayEngine provides the ability to reconstruct game state by replaying
 * events from a snapshot. This is critical for:
 * - State recovery after crashes
 * - Time-travel debugging
 * - Reproducibility verification
 * - Audit and validation
 *
 * @module engine/replay-engine
 */

import Database from 'better-sqlite3';
import { EventLogRepository, EventLogEntry } from '../storage/event-log.repo.js';
import { SnapshotRepository, Snapshot } from '../storage/snapshot.repo.js';
import { RNGStateRepository, RNGState } from '../storage/rng-state.repo.js';
import { computeEventHash, GENESIS_HASH, EventHashInput } from '../storage/utils/hash.js';
import { getDb } from '../storage/index.js';

// Re-export types from storage layer
export { Snapshot } from '../storage/snapshot.repo.js';
export { RNGState } from '../storage/rng-state.repo.js';

// ============================================================
// Types
// ============================================================

/**
 * Result of a replay operation.
 */
export interface ReplayResult {
    /** Whether the replay succeeded */
    success: boolean;
    /** Number of events replayed */
    events_replayed: number;
    /** ID of the last event in the replay */
    final_event_id: number;
    /** Final reconstructed state */
    final_state: object;
    /** RNG states restored during replay */
    rng_states: RNGState[];
    /** Duration of the replay in milliseconds */
    duration_ms: number;
    /** Error message if replay failed */
    error?: string;
}

/**
 * Options for controlling replay behavior.
 */
export interface ReplayOptions {
    /** Start replay from a specific snapshot ID */
    from_snapshot_id?: string;
    /** Start replay from a specific event ID */
    from_event_id?: number;
    /** Stop replay at a specific event ID (inclusive) */
    to_event_id?: number;
    /** Verify hash chain integrity during replay */
    verify_hashes?: boolean;
    /** Don't apply changes, just validate */
    dry_run?: boolean;
}

/**
 * Result of state verification.
 */
export interface VerifyReplayResult {
    /** Whether the replayed state matches expected state */
    matches: boolean;
    /** List of differences if state doesn't match */
    differences?: string[];
}

/**
 * Handler function type for applying events to state.
 */
export type EventHandler = (state: object, event: EventLogEntry) => object;

/**
 * Registry of event handlers by event type.
 */
export interface EventHandlerRegistry {
    [key: string]: EventHandler;
}

// ============================================================
// Default Event Handlers
// ============================================================

/**
 * Default event handlers for each event type.
 * These handle the basic state mutations for each event category.
 */
const DEFAULT_HANDLERS: EventHandlerRegistry = {
    combat: (state: object, event: EventLogEntry): object => {
        const payload = JSON.parse(event.payload);
        return {
            ...state,
            lastCombatEvent: {
                type: payload.action || 'unknown',
                actor: event.actor_id,
                target: event.target_id,
                timestamp: event.timestamp,
                data: payload,
            },
        };
    },

    movement: (state: object, event: EventLogEntry): object => {
        const payload = JSON.parse(event.payload);
        const s = state as Record<string, unknown>;
        const positions = (s.positions || {}) as Record<string, unknown>;
        
        if (event.actor_id) {
            positions[event.actor_id] = {
                x: payload.to_x ?? payload.x,
                y: payload.to_y ?? payload.y,
                z: payload.to_z ?? payload.z ?? 0,
            };
        }
        
        return {
            ...state,
            positions,
        };
    },

    spell: (state: object, event: EventLogEntry): object => {
        const payload = JSON.parse(event.payload);
        return {
            ...state,
            lastSpellEvent: {
                spell: payload.spell_name || payload.spell,
                caster: event.actor_id,
                targets: event.target_id ? [event.target_id] : payload.targets || [],
                timestamp: event.timestamp,
                data: payload,
            },
        };
    },

    item: (state: object, event: EventLogEntry): object => {
        const payload = JSON.parse(event.payload);
        return {
            ...state,
            lastItemEvent: {
                action: payload.action || 'unknown',
                actor: event.actor_id,
                item: payload.item_id || payload.item,
                timestamp: event.timestamp,
                data: payload,
            },
        };
    },

    quest: (state: object, event: EventLogEntry): object => {
        const payload = JSON.parse(event.payload);
        const s = state as Record<string, unknown>;
        const quests = (s.quests || {}) as Record<string, unknown>;
        
        if (payload.quest_id) {
            quests[payload.quest_id] = {
                status: payload.status || 'active',
                progress: payload.progress,
                updatedAt: event.timestamp,
            };
        }
        
        return {
            ...state,
            quests,
        };
    },

    social: (state: object, event: EventLogEntry): object => {
        const payload = JSON.parse(event.payload);
        return {
            ...state,
            lastSocialEvent: {
                type: payload.type || 'interaction',
                actor: event.actor_id,
                target: event.target_id,
                timestamp: event.timestamp,
                data: payload,
            },
        };
    },

    system: (state: object, event: EventLogEntry): object => {
        const payload = JSON.parse(event.payload);
        
        // System events can contain RNG state updates
        if (payload.rng_state) {
            const s = state as Record<string, unknown>;
            const rngStates = (s.rngStates || {}) as Record<string, unknown>;
            rngStates[payload.rng_state.context] = payload.rng_state;
            return {
                ...state,
                rngStates,
            };
        }
        
        return {
            ...state,
            lastSystemEvent: {
                type: payload.type || 'unknown',
                timestamp: event.timestamp,
                data: payload,
            },
        };
    },
};

// ============================================================
// ReplayEngine implementation
// ============================================================

/**
 * ReplayEngine for reconstructing game state from event logs.
 *
 * The engine supports:
 * - Replay from a specific snapshot
 * - Replay from genesis (no snapshot)
 * - Replay to a specific event
 * - Hash chain verification during replay
 * - Dry run mode for validation without state mutation
 *
 * @example
 * ```typescript
 * const engine = new ReplayEngine(db);
 *
 * // Replay from the latest snapshot to current state
 * const result = await engine.replayFromSnapshot('world_001', 'snapshot_001');
 *
 * // Replay with hash verification
 * const result = await engine.replayToEvent('world_001', 500, {
 *   verify_hashes: true
 * });
 *
 * // Verify replay produces expected state
 * const verification = await engine.verifyReplay('world_001', expectedState);
 * ```
 */
export class ReplayEngine {
    private eventRepo: EventLogRepository;
    private snapshotRepo: SnapshotRepository;
    private rngRepo: RNGStateRepository;
    private handlers: EventHandlerRegistry;

    constructor(db?: Database.Database, handlers?: EventHandlerRegistry) {
        const database = db ?? getDb();
        this.eventRepo = new EventLogRepository(database);
        this.snapshotRepo = new SnapshotRepository(database);
        this.rngRepo = new RNGStateRepository(database);
        this.handlers = { ...DEFAULT_HANDLERS, ...handlers };
    }

    /**
     * Replay events from a specific snapshot to reconstruct state.
     *
     * @param world_id - The world to replay
     * @param snapshot_id - The snapshot to start from
     * @param options - Replay options
     * @returns Result containing the reconstructed state
     */
    async replayFromSnapshot(
        world_id: string,
        snapshot_id: string,
        options: ReplayOptions = {}
    ): Promise<ReplayResult> {
        const startTime = performance.now();

        try {
            // Get the snapshot
            const snapshotResult = this.snapshotRepo.getById(snapshot_id);
            if (!snapshotResult.success || !snapshotResult.data) {
                return this.errorResult(`Snapshot '${snapshot_id}' not found`, startTime);
            }

            const snapshot = snapshotResult.data;
            
            // Verify snapshot belongs to the correct world
            if (snapshot.world_id !== world_id) {
                return this.errorResult(
                    `Snapshot '${snapshot_id}' belongs to world '${snapshot.world_id}', not '${world_id}'`,
                    startTime
                );
            }

            // Parse initial state from snapshot
            let state: object;
            try {
                state = JSON.parse(snapshot.state_json);
            } catch (e) {
                return this.errorResult(`Failed to parse snapshot state: ${(e as Error).message}`, startTime);
            }

            // Restore RNG states from snapshot
            const rngStates = this.restoreRNGStates(world_id, snapshot);

            // Get events to replay (after snapshot, up to to_event_id)
            const fromEventId = snapshot.event_id + 1;
            const toEventId = options.to_event_id;

            return this.replayEvents(
                world_id,
                state,
                rngStates,
                fromEventId,
                toEventId,
                options,
                startTime
            );
        } catch (error) {
            return this.errorResult(`Replay failed: ${(error as Error).message}`, startTime);
        }
    }

    /**
     * Replay all events from genesis (no snapshot) to reconstruct state.
     *
     * @param world_id - The world to replay
     * @param options - Replay options
     * @returns Result containing the reconstructed state
     */
    async replayFromGenesis(
        world_id: string,
        options: ReplayOptions = {}
    ): Promise<ReplayResult> {
        const startTime = performance.now();

        try {
            // Start with empty state
            const state: object = {
                world_id,
                createdAt: new Date().toISOString(),
                positions: {},
                quests: {},
                rngStates: {},
            };

            // No RNG states to restore from genesis
            const rngStates: RNGState[] = [];

            return this.replayEvents(
                world_id,
                state,
                rngStates,
                options.from_event_id ?? 1,
                options.to_event_id,
                options,
                startTime
            );
        } catch (error) {
            return this.errorResult(`Replay failed: ${(error as Error).message}`, startTime);
        }
    }

    /**
     * Replay to a specific event, finding the nearest snapshot first.
     *
     * @param world_id - The world to replay
     * @param event_id - The event ID to replay to (inclusive)
     * @param options - Replay options
     * @returns Result containing the reconstructed state
     */
    async replayToEvent(
        world_id: string,
        event_id: number,
        options: ReplayOptions = {}
    ): Promise<ReplayResult> {
        const startTime = performance.now();

        try {
            // Find the nearest snapshot before this event
            const snapshotResult = this.snapshotRepo.getNearest(world_id, event_id);
            if (!snapshotResult.success) {
                return this.errorResult(`Failed to find snapshot: ${snapshotResult.error}`, startTime);
            }

            const snapshot = snapshotResult.data;

            if (snapshot) {
                // Replay from snapshot
                return this.replayFromSnapshot(world_id, snapshot.id, {
                    ...options,
                    to_event_id: event_id,
                });
            } else {
                // No snapshot found, replay from genesis
                return this.replayFromGenesis(world_id, {
                    ...options,
                    to_event_id: event_id,
                });
            }
        } catch (error) {
            return this.errorResult(`Replay failed: ${(error as Error).message}`, startTime);
        }
    }

    /**
     * Verify that replaying events produces the expected state.
     *
     * @param world_id - The world to verify
     * @param expected_state - The expected final state
     * @returns Verification result with match status and differences
     */
    async verifyReplay(
        world_id: string,
        expected_state: object
    ): Promise<VerifyReplayResult> {
        // Replay all events
        const replayResult = await this.replayFromGenesis(world_id, { verify_hashes: true });

        if (!replayResult.success) {
            return {
                matches: false,
                differences: [`Replay failed: ${replayResult.error}`],
            };
        }

        // Compare states
        const differences = this.compareStates(replayResult.final_state, expected_state);

        return {
            matches: differences.length === 0,
            differences: differences.length > 0 ? differences : undefined,
        };
    }

    /**
     * Register a custom event handler for a specific event type.
     */
    registerHandler(eventType: string, handler: EventHandler): void {
        this.handlers[eventType] = handler;
    }

    /**
     * Persist RNG states to the database after replay.
     * This synchronizes the in-memory RNG states with persistent storage.
     *
     * @param world_id - The world to persist RNG states for
     * @param rngStates - The RNG states to persist
     * @returns Number of states persisted
     */
    persistRNGStates(world_id: string, rngStates: RNGState[]): number {
        const result = this.rngRepo.restoreFromSnapshot(world_id, rngStates);
        return result.success ? rngStates.length : 0;
    }

    /**
     * Load RNG states from the database for a world.
     *
     * @param world_id - The world to load RNG states for
     * @returns Array of RNG states
     */
    loadRNGStates(world_id: string): RNGState[] {
        const result = this.rngRepo.getAllForWorld(world_id);
        return result.success && result.data ? result.data : [];
    }

    /**
     * Get access to the snapshot repository for external snapshot management.
     */
    getSnapshotRepository(): SnapshotRepository {
        return this.snapshotRepo;
    }

    /**
     * Get access to the RNG state repository for external RNG management.
     */
    getRNGStateRepository(): RNGStateRepository {
        return this.rngRepo;
    }

    // ============================================================
    // Private methods
    // ============================================================

    /**
     * Core replay logic - applies events to state.
     */
    private async replayEvents(
        world_id: string,
        initialState: object,
        initialRngStates: RNGState[],
        fromEventId: number,
        toEventId: number | undefined,
        options: ReplayOptions,
        startTime: number
    ): Promise<ReplayResult> {
        let state = { ...initialState };
        const rngStates = [...initialRngStates];
        let eventsReplayed = 0;
        let lastEventId = fromEventId - 1;
        let expectedPrevHash = GENESIS_HASH;

        // If starting from a specific event, get its prev_hash
        if (fromEventId > 1) {
            const prevEventResult = this.eventRepo.getById(fromEventId - 1);
            if (prevEventResult.success && prevEventResult.data) {
                expectedPrevHash = prevEventResult.data.hash;
            }
        }

        // Query events to replay
        const eventsResult = this.eventRepo.queryByFilters({
            world_id,
            from_event_id: fromEventId,
            to_event_id: toEventId,
            limit: 10000, // Max events per replay batch
        });

        if (!eventsResult.success || !eventsResult.data) {
            return this.errorResult(`Failed to query events: ${eventsResult.error}`, startTime);
        }

        const events = eventsResult.data.events;

        // Apply each event
        for (const event of events) {
            // Verify hash chain if requested
            if (options.verify_hashes) {
                // Verify prev_hash matches expected
                if (event.prev_hash !== expectedPrevHash) {
                    return this.errorResult(
                        `Hash chain broken at event ${event.id}: expected prev_hash '${expectedPrevHash}', got '${event.prev_hash}'`,
                        startTime,
                        eventsReplayed,
                        lastEventId,
                        state,
                        rngStates
                    );
                }

                // Verify event hash
                const hashInput: EventHashInput = {
                    id: event.id,
                    timestamp: event.timestamp,
                    event_type: event.event_type,
                    actor_id: event.actor_id,
                    target_id: event.target_id,
                    payload: event.payload,
                    prev_hash: event.prev_hash,
                };
                const computedHash = computeEventHash(hashInput);

                if (event.hash !== computedHash) {
                    return this.errorResult(
                        `Hash mismatch at event ${event.id}: expected '${computedHash}', got '${event.hash}'`,
                        startTime,
                        eventsReplayed,
                        lastEventId,
                        state,
                        rngStates
                    );
                }

                expectedPrevHash = event.hash;
            }

            // Apply the event (unless dry run)
            if (!options.dry_run) {
                state = this.applyEvent(state, event);

                // Extract RNG state updates if present
                try {
                    const payload = JSON.parse(event.payload);
                    if (payload.rng_state) {
                        const existingIndex = rngStates.findIndex(
                            r => r.context === payload.rng_state.context
                        );
                        if (existingIndex >= 0) {
                            rngStates[existingIndex] = payload.rng_state;
                        } else {
                            rngStates.push(payload.rng_state);
                        }
                    }
                } catch {
                    // Ignore JSON parse errors for RNG extraction
                }
            }

            eventsReplayed++;
            lastEventId = event.id;
        }

        const duration_ms = performance.now() - startTime;

        return {
            success: true,
            events_replayed: eventsReplayed,
            final_event_id: lastEventId,
            final_state: state,
            rng_states: rngStates,
            duration_ms,
        };
    }

    /**
     * Apply a single event to the current state.
     */
    private applyEvent(state: object, event: EventLogEntry): object {
        const handler = this.handlers[event.event_type];
        
        if (handler) {
            try {
                return handler(state, event);
            } catch (error) {
                console.error(`Error applying event ${event.id} (${event.event_type}):`, error);
                // Return state unchanged on handler error
                return state;
            }
        }

        // No handler found - log and return state unchanged
        console.warn(`No handler for event type '${event.event_type}'`);
        return state;
    }

    /**
     * Restore RNG states from a snapshot.
     */
    private restoreRNGStates(world_id: string, snapshot: Snapshot): RNGState[] {
        try {
            const state = JSON.parse(snapshot.state_json);
            
            if (state.rngStates && typeof state.rngStates === 'object') {
                const rngStates: RNGState[] = [];
                for (const context of Object.keys(state.rngStates)) {
                    const rng = state.rngStates[context];
                    if (rng && rng.seed) {
                        rngStates.push({
                            id: rng.id || `${world_id}_${context}`,
                            world_id,
                            context,
                            seed: rng.seed,
                            call_index: rng.call_index || 0,
                            last_value: rng.last_value || null,
                            updated_at: rng.updated_at || new Date().toISOString(),
                        });
                    }
                }
                return rngStates;
            }
        } catch (error) {
            console.error('Failed to restore RNG states from snapshot:', error);
        }
        
        return [];
    }

    /**
     * Compare two states and return differences.
     */
    private compareStates(actual: object, expected: object, path: string = ''): string[] {
        const differences: string[] = [];
        const actualObj = actual as Record<string, unknown>;
        const expectedObj = expected as Record<string, unknown>;

        // Check for missing or different keys in actual
        for (const key of Object.keys(expectedObj)) {
            const fullPath = path ? `${path}.${key}` : key;
            
            if (!(key in actualObj)) {
                differences.push(`Missing key: ${fullPath}`);
            } else if (typeof expectedObj[key] !== typeof actualObj[key]) {
                differences.push(
                    `Type mismatch at ${fullPath}: expected ${typeof expectedObj[key]}, got ${typeof actualObj[key]}`
                );
            } else if (typeof expectedObj[key] === 'object' && expectedObj[key] !== null) {
                differences.push(
                    ...this.compareStates(
                        actualObj[key] as object,
                        expectedObj[key] as object,
                        fullPath
                    )
                );
            } else if (actualObj[key] !== expectedObj[key]) {
                differences.push(
                    `Value mismatch at ${fullPath}: expected ${JSON.stringify(expectedObj[key])}, got ${JSON.stringify(actualObj[key])}`
                );
            }
        }

        // Check for extra keys in actual
        for (const key of Object.keys(actualObj)) {
            const fullPath = path ? `${path}.${key}` : key;
            if (!(key in expectedObj)) {
                differences.push(`Extra key: ${fullPath}`);
            }
        }

        return differences;
    }

    /**
     * Create an error result.
     */
    private errorResult(
        error: string,
        startTime: number,
        eventsReplayed: number = 0,
        lastEventId: number = 0,
        state: object = {},
        rngStates: RNGState[] = []
    ): ReplayResult {
        return {
            success: false,
            events_replayed: eventsReplayed,
            final_event_id: lastEventId,
            final_state: state,
            rng_states: rngStates,
            duration_ms: performance.now() - startTime,
            error,
        };
    }
}
