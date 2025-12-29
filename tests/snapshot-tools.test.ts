/**
 * Tests for Snapshot Tools (T037)
 *
 * Tests snapshot creation, listing, rollback, and RNG state management.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { setDb, closeDb } from '../src/storage/index.js';
import { migrate } from '../src/storage/migrations.js';
import {
  SnapshotTools,
  handleSnapshotCreate,
  handleSnapshotList,
  handleSnapshotGet,
  handleSnapshotDelete,
  handleRollbackToSnapshot,
  handleRollbackToEvent,
  handleReplayEvents,
  handleRngStateGet,
  handleRngStateReset
} from '../src/server/snapshot-tools.js';
import { SessionContext } from '../src/server/types.js';

const mockContext: SessionContext = {
  sessionId: 'test-session',
  timestamp: Date.now()
};

describe('Snapshot Tools', () => {
  let db: Database.Database;

  beforeEach(() => {
    // Create in-memory database
    db = new Database(':memory:');
    setDb(db);
    // Run base migrations (includes snapshots, rng_state tables)
    migrate(db);

    // Create a test world
    db.prepare(`
      INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('test-world', 'Test World', 'test-seed', 100, 100, new Date().toISOString(), new Date().toISOString());

    // Create a test event for snapshot reference
    db.prepare(`
      INSERT INTO event_logs (world_id, timestamp, event_type, type, actor_id, target_id, payload, prev_hash, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('test-world', new Date().toISOString(), 'system', 'system', 'system', null, '{}', 'genesis', 'test-hash-1');
  });

  afterEach(() => {
    closeDb();
  });

  describe('snapshot_create', () => {
    it('should create a snapshot for a world', async () => {
      const result = await handleSnapshotCreate({
        world_id: 'test-world',
        description: 'Test snapshot'
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.snapshot).toBeDefined();
      expect(response.snapshot.world_id).toBe('test-world');
      expect(response.snapshot.description).toBe('Test snapshot');
      expect(response.snapshot.checksum).toBeDefined();
      expect(response.snapshot.size_bytes).toBeGreaterThan(0);
    });

    it('should create auto-snapshots', async () => {
      const result = await handleSnapshotCreate({
        world_id: 'test-world',
        is_auto: true
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.snapshot.is_auto).toBe(true);
    });
  });

  describe('snapshot_list', () => {
    beforeEach(async () => {
      // Create some snapshots with events between them
      // (snapshots have UNIQUE(world_id, event_id) constraint, so we need distinct event_ids)
      await handleSnapshotCreate({ world_id: 'test-world', description: 'Snapshot 1' }, mockContext);
      
      // Add event to advance event_id
      db.prepare(`
        INSERT INTO event_logs (world_id, timestamp, event_type, type, actor_id, target_id, payload, prev_hash, hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('test-world', new Date().toISOString(), 'system', 'system', 'system', null, '{}', 'test-hash-1', 'test-hash-2');
      
      await handleSnapshotCreate({ world_id: 'test-world', description: 'Snapshot 2', is_auto: true }, mockContext);
      
      // Add another event
      db.prepare(`
        INSERT INTO event_logs (world_id, timestamp, event_type, type, actor_id, target_id, payload, prev_hash, hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('test-world', new Date().toISOString(), 'system', 'system', 'system', null, '{}', 'test-hash-2', 'test-hash-3');
      
      await handleSnapshotCreate({ world_id: 'test-world', description: 'Snapshot 3' }, mockContext);
    });

    it('should list all snapshots', async () => {
      const result = await handleSnapshotList({
        world_id: 'test-world',
        limit: 10,
        include_auto: true
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.count).toBe(3);
    });

    it('should exclude auto-snapshots when requested', async () => {
      const result = await handleSnapshotList({
        world_id: 'test-world',
        limit: 10,
        include_auto: false
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.count).toBe(2);
    });

    it('should respect limit', async () => {
      const result = await handleSnapshotList({
        world_id: 'test-world',
        limit: 2,
        include_auto: true
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.count).toBe(2);
    });
  });

  describe('snapshot_get', () => {
    it('should get snapshot details', async () => {
      const createResult = await handleSnapshotCreate({
        world_id: 'test-world',
        description: 'Test get'
      }, mockContext);
      const created = JSON.parse(createResult.content[0].text);

      const result = await handleSnapshotGet({
        snapshot_id: created.snapshot.id
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.snapshot.id).toBe(created.snapshot.id);
      expect(response.snapshot.description).toBe('Test get');
    });

    it('should return error for non-existent snapshot', async () => {
      const result = await handleSnapshotGet({
        snapshot_id: 'non-existent'
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(false);
      expect(response.error).toContain('not found');
    });
  });

  describe('snapshot_delete', () => {
    it('should delete a snapshot', async () => {
      const createResult = await handleSnapshotCreate({
        world_id: 'test-world',
        description: 'To delete'
      }, mockContext);
      const created = JSON.parse(createResult.content[0].text);

      const result = await handleSnapshotDelete({
        snapshot_id: created.snapshot.id
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);

      // Verify it's gone
      const getResult = await handleSnapshotGet({
        snapshot_id: created.snapshot.id
      }, mockContext);
      const getResponse = JSON.parse(getResult.content[0].text);
      expect(getResponse.success).toBe(false);
    });

    it('should return error for non-existent snapshot', async () => {
      const result = await handleSnapshotDelete({
        snapshot_id: 'non-existent'
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(false);
    });
  });

  describe('rollback_to_snapshot', () => {
    it('should rollback to a snapshot', async () => {
      const createResult = await handleSnapshotCreate({
        world_id: 'test-world',
        description: 'Rollback target'
      }, mockContext);
      const created = JSON.parse(createResult.content[0].text);

      const result = await handleRollbackToSnapshot({
        world_id: 'test-world',
        snapshot_id: created.snapshot.id
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.snapshot_id).toBe(created.snapshot.id);
    });

    it('should verify checksum during rollback', async () => {
      const createResult = await handleSnapshotCreate({
        world_id: 'test-world',
        description: 'Checksum test'
      }, mockContext);
      const created = JSON.parse(createResult.content[0].text);

      // Corrupt the checksum
      db.prepare('UPDATE snapshots SET checksum = ? WHERE id = ?')
        .run('corrupted', created.snapshot.id);

      const result = await handleRollbackToSnapshot({
        world_id: 'test-world',
        snapshot_id: created.snapshot.id
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(false);
      expect(response.error).toContain('checksum');
    });

    it('should fail for wrong world', async () => {
      // Create another world
      db.prepare(`
        INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('other-world', 'Other World', 'other-seed', 100, 100, new Date().toISOString(), new Date().toISOString());

      const createResult = await handleSnapshotCreate({
        world_id: 'other-world',
        description: 'Other world snapshot'
      }, mockContext);
      const created = JSON.parse(createResult.content[0].text);

      const result = await handleRollbackToSnapshot({
        world_id: 'test-world',
        snapshot_id: created.snapshot.id
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(false);
      expect(response.error).toContain('different world');
    });
  });

  describe('rollback_to_event', () => {
    it('should fail when no snapshot exists before event', async () => {
      const result = await handleRollbackToEvent({
        world_id: 'test-world',
        event_id: 1
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(false);
      expect(response.hint).toContain('replay_events');
    });

    it('should find nearest snapshot and rollback', async () => {
      // Create a snapshot
      await handleSnapshotCreate({
        world_id: 'test-world',
        description: 'Before event 10'
      }, mockContext);

      // Add more events
      for (let i = 2; i <= 5; i++) {
        db.prepare(`
          INSERT INTO event_logs (world_id, timestamp, event_type, type, actor_id, target_id, payload, prev_hash, hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run('test-world', new Date().toISOString(), 'system', 'system', 'system', null, '{}', `hash-${i - 1}`, `test-hash-${i}`);
      }

      const result = await handleRollbackToEvent({
        world_id: 'test-world',
        event_id: 3
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
    });
  });

  describe('replay_events', () => {
    beforeEach(() => {
      // Add more events
      for (let i = 2; i <= 10; i++) {
        db.prepare(`
          INSERT INTO event_logs (world_id, timestamp, event_type, type, actor_id, target_id, payload, prev_hash, hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run('test-world', new Date().toISOString(), i % 2 === 0 ? 'combat' : 'movement', i % 2 === 0 ? 'combat' : 'movement', 'system', null, '{}', `hash-${i - 1}`, `test-hash-${i}`);
      }
    });

    it('should query events for replay', async () => {
      const result = await handleReplayEvents({
        world_id: 'test-world',
        from_event_id: 1,
        to_event_id: 5
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.event_count).toBe(5);
      expect(response.event_type_breakdown).toBeDefined();
    });

    it('should provide event type breakdown', async () => {
      const result = await handleReplayEvents({
        world_id: 'test-world',
        from_event_id: 1,
        to_event_id: 10
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.event_type_breakdown.combat).toBeGreaterThan(0);
      expect(response.event_type_breakdown.movement).toBeGreaterThan(0);
    });
  });

  describe('rng_state_get', () => {
    it('should return null for non-existent state', async () => {
      const result = await handleRngStateGet({
        world_id: 'test-world',
        context: 'combat'
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.rng_state).toBe(null);
    });

    it('should return existing RNG state', async () => {
      // Create RNG state
      db.prepare(`
        INSERT INTO rng_state (id, world_id, context, seed, call_index, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('rng-1', 'test-world', 'combat', 'test-seed', 42, new Date().toISOString());

      const result = await handleRngStateGet({
        world_id: 'test-world',
        context: 'combat'
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.rng_state.seed).toBe('test-seed');
      expect(response.rng_state.call_index).toBe(42);
    });
  });

  describe('rng_state_reset', () => {
    it('should create new RNG state with seed', async () => {
      const result = await handleRngStateReset({
        world_id: 'test-world',
        context: 'loot',
        seed: 'new-seed',
        call_index: 0
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.seed).toBe('new-seed');

      // Verify it exists
      const getResult = await handleRngStateGet({
        world_id: 'test-world',
        context: 'loot'
      }, mockContext);
      const getResponse = JSON.parse(getResult.content[0].text);
      expect(getResponse.rng_state.seed).toBe('new-seed');
    });

    it('should require seed for new state', async () => {
      const result = await handleRngStateReset({
        world_id: 'test-world',
        context: 'loot',
        call_index: 0
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(false);
      expect(response.error).toContain('seed');
    });

    it('should reset existing RNG state', async () => {
      // Create RNG state
      db.prepare(`
        INSERT INTO rng_state (id, world_id, context, seed, call_index, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('rng-1', 'test-world', 'combat', 'original-seed', 100, new Date().toISOString());

      const result = await handleRngStateReset({
        world_id: 'test-world',
        context: 'combat',
        call_index: 0
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.seed_changed).toBe(false);

      // Verify reset
      const getResult = await handleRngStateGet({
        world_id: 'test-world',
        context: 'combat'
      }, mockContext);
      const getResponse = JSON.parse(getResult.content[0].text);
      expect(getResponse.rng_state.call_index).toBe(0);
      expect(getResponse.rng_state.seed).toBe('original-seed');
    });

    it('should update seed when provided', async () => {
      // Create RNG state
      db.prepare(`
        INSERT INTO rng_state (id, world_id, context, seed, call_index, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('rng-1', 'test-world', 'combat', 'original-seed', 100, new Date().toISOString());

      const result = await handleRngStateReset({
        world_id: 'test-world',
        context: 'combat',
        seed: 'new-seed',
        call_index: 5
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.seed_changed).toBe(true);

      // Verify changes
      const getResult = await handleRngStateGet({
        world_id: 'test-world',
        context: 'combat'
      }, mockContext);
      const getResponse = JSON.parse(getResult.content[0].text);
      expect(getResponse.rng_state.call_index).toBe(5);
      expect(getResponse.rng_state.seed).toBe('new-seed');
    });
  });
});

describe('Snapshot Tool Schemas', () => {
  it('should validate snapshot_create schema', () => {
    const valid = SnapshotTools.SNAPSHOT_CREATE.inputSchema.safeParse({
      world_id: 'test-world',
      description: 'Test'
    });
    expect(valid.success).toBe(true);

    const invalid = SnapshotTools.SNAPSHOT_CREATE.inputSchema.safeParse({
      world_id: '', // empty string
    });
    expect(invalid.success).toBe(false);
  });

  it('should validate replay_events schema', () => {
    const valid = SnapshotTools.REPLAY_EVENTS.inputSchema.safeParse({
      world_id: 'test-world',
      from_event_id: 1,
      to_event_id: 10
    });
    expect(valid.success).toBe(true);

    const invalid = SnapshotTools.REPLAY_EVENTS.inputSchema.safeParse({
      world_id: 'test-world',
      from_event_id: 0, // must be >= 1
      to_event_id: 10
    });
    expect(invalid.success).toBe(false);
  });
});
