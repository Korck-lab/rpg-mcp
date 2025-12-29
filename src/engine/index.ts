export * as combat from './combat/index.js';
export * as spatial from './spatial/index.js';
export * as dsl from './dsl/index.js';
export * as worldgen from './worldgen/index.js';

// Replay engine for event sourcing
export {
    ReplayEngine,
    type Snapshot,
    type RNGState,
    type ReplayResult,
    type ReplayOptions,
    type VerifyReplayResult,
    type EventHandler,
    type EventHandlerRegistry,
} from './replay-engine.js';

// Re-export repositories from storage layer for convenience
export { SnapshotRepository } from '../storage/snapshot.repo.js';
export { RNGStateRepository } from '../storage/rng-state.repo.js';
