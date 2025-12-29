import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { EventLogRepository, EventType, EventFilter, SNAPSHOT_INTERVAL } from '../src/storage/event-log.repo.js';
import { GENESIS_HASH } from '../src/storage/utils/hash.js';
import { SnapshotRepository } from '../src/storage/snapshot.repo.js';
import { migrate } from '../src/storage/migrations.js';

describe('EventLogRepository', () => {
  let db: Database.Database;
  let repo: EventLogRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    repo = new EventLogRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('T019: append', () => {
    it('should append an event with GENESIS_HASH as first prev_hash', () => {
      const result = repo.append('world_001', 'combat', 'char_001', 'goblin_001', { action: 'attack', damage: 8 });
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.world_id).toBe('world_001');
      expect(result.data!.event_type).toBe('combat');
      expect(result.data!.actor_id).toBe('char_001');
      expect(result.data!.target_id).toBe('goblin_001');
      expect(result.data!.prev_hash).toBe(GENESIS_HASH);
      expect(result.data!.hash).toBeDefined();
      expect(result.data!.hash).not.toBe('pending');
    });

    it('should chain events correctly with prev_hash', () => {
      const first = repo.append('world_001', 'combat', 'char_001', null, { action: 'init' });
      const second = repo.append('world_001', 'movement', 'char_001', null, { x: 5, y: 10 });
      
      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      expect(second.data!.prev_hash).toBe(first.data!.hash);
    });

    it('should maintain separate chains per world', () => {
      const world1Event = repo.append('world_001', 'combat', null, null, {});
      const world2Event = repo.append('world_002', 'combat', null, null, {});
      
      expect(world1Event.data!.prev_hash).toBe(GENESIS_HASH);
      expect(world2Event.data!.prev_hash).toBe(GENESIS_HASH);
    });
  });

  describe('T020: verifyChain', () => {
    it('should verify an empty chain as valid', () => {
      const result = repo.verifyChain('world_001');
      
      expect(result.success).toBe(true);
      expect(result.data!.valid).toBe(true);
      expect(result.data!.verified_count).toBe(0);
    });

    it('should verify a valid chain', () => {
      repo.append('world_001', 'combat', 'char_001', null, { round: 1 });
      repo.append('world_001', 'combat', 'char_001', null, { round: 2 });
      repo.append('world_001', 'combat', 'char_001', null, { round: 3 });
      
      const result = repo.verifyChain('world_001');
      
      expect(result.success).toBe(true);
      expect(result.data!.valid).toBe(true);
      expect(result.data!.verified_count).toBe(3);
    });

    it('should detect tampered hash', () => {
      repo.append('world_001', 'combat', null, null, { test: true });
      
      // Tamper with the hash directly
      db.prepare('UPDATE event_logs SET hash = ? WHERE id = 1').run('tampered_hash');
      
      const result = repo.verifyChain('world_001');
      
      expect(result.success).toBe(true);
      expect(result.data!.valid).toBe(false);
      expect(result.data!.error).toBeDefined();
      expect(result.data!.error!.event_id).toBe(1);
      expect(result.data!.error!.message).toContain('Hash mismatch');
    });

    it('should detect broken chain', () => {
      repo.append('world_001', 'combat', null, null, { a: 1 });
      repo.append('world_001', 'combat', null, null, { b: 2 });
      
      // Break the chain by modifying prev_hash
      db.prepare('UPDATE event_logs SET prev_hash = ? WHERE id = 2').run('wrong_prev_hash');
      
      const result = repo.verifyChain('world_001');
      
      expect(result.success).toBe(true);
      expect(result.data!.valid).toBe(false);
      expect(result.data!.error!.event_id).toBe(2);
      expect(result.data!.error!.message).toContain('Chain broken');
    });

    it('should verify a range of events', () => {
      for (let i = 0; i < 5; i++) {
        repo.append('world_001', 'system', null, null, { index: i });
      }
      
      const result = repo.verifyChain('world_001', 2, 4);
      
      expect(result.success).toBe(true);
      expect(result.data!.valid).toBe(true);
      expect(result.data!.verified_count).toBe(3);
    });
  });

  describe('T021: queryByFilters', () => {
    beforeEach(() => {
      // Set up test data
      repo.append('world_001', 'combat', 'char_001', 'goblin_001', { damage: 10 });
      repo.append('world_001', 'movement', 'char_001', null, { x: 5 });
      repo.append('world_001', 'combat', 'char_002', 'goblin_001', { damage: 15 });
      repo.append('world_002', 'quest', 'char_001', null, { quest_id: 'q1' });
    });

    it('should filter by world_id', () => {
      const result = repo.queryByFilters({ world_id: 'world_001' });
      
      expect(result.success).toBe(true);
      expect(result.data!.events.length).toBe(3);
      expect(result.data!.total_count).toBe(3);
    });

    it('should filter by event_type', () => {
      const result = repo.queryByFilters({ world_id: 'world_001', event_type: 'combat' });
      
      expect(result.success).toBe(true);
      expect(result.data!.events.length).toBe(2);
      expect(result.data!.events.every(e => e.event_type === 'combat')).toBe(true);
    });

    it('should filter by actor_id', () => {
      const result = repo.queryByFilters({ world_id: 'world_001', actor_id: 'char_001' });
      
      expect(result.success).toBe(true);
      expect(result.data!.events.length).toBe(2);
    });

    it('should respect limit', () => {
      const result = repo.queryByFilters({ world_id: 'world_001', limit: 2 });
      
      expect(result.success).toBe(true);
      expect(result.data!.events.length).toBe(2);
      expect(result.data!.total_count).toBe(3);
      expect(result.data!.has_more).toBe(true);
    });

    it('should clamp limit to max 1000', () => {
      const result = repo.queryByFilters({ world_id: 'world_001', limit: 5000 });
      
      expect(result.success).toBe(true);
      // Should work but clamp to 1000 internally
    });

    it('should filter by event_id range', () => {
      const result = repo.queryByFilters({ 
        world_id: 'world_001', 
        from_event_id: 2, 
        to_event_id: 3 
      });
      
      expect(result.success).toBe(true);
      expect(result.data!.events.length).toBe(2);
    });
  });

  describe('helper methods', () => {
    it('getLastEvent should return null for empty world', () => {
      const result = repo.getLastEvent('world_001');
      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });

    it('getLastEvent should return the most recent event', () => {
      repo.append('world_001', 'combat', null, null, { a: 1 });
      repo.append('world_001', 'movement', null, null, { b: 2 });
      
      const result = repo.getLastEvent('world_001');
      expect(result.success).toBe(true);
      expect(result.data!.event_type).toBe('movement');
    });

    it('getById should return specific event', () => {
      const appended = repo.append('world_001', 'combat', null, null, {});
      
      const result = repo.getById(appended.data!.id);
      expect(result.success).toBe(true);
      expect(result.data!.id).toBe(appended.data!.id);
    });

    it('countByWorld should return correct count', () => {
      repo.append('world_001', 'combat', null, null, {});
      repo.append('world_001', 'combat', null, null, {});
      repo.append('world_002', 'combat', null, null, {});
      
      const result = repo.countByWorld('world_001');
      expect(result.success).toBe(true);
      expect(result.data).toBe(2);
    });
  });

  describe('T039: auto-snapshot integration', () => {
    it('should export SNAPSHOT_INTERVAL constant', () => {
      expect(SNAPSHOT_INTERVAL).toBe(1000);
    });

    it('should create snapshot on event 1000', () => {
      const snapshotRepo = new SnapshotRepository(db);
      const worldId = 'world_auto_snapshot';

      // Append events up to 999 (no snapshot yet)
      for (let i = 1; i < 1000; i++) {
        repo.append(worldId, 'system', null, null, { index: i });
      }

      // Verify no snapshot created yet
      let snapshots = snapshotRepo.list(worldId);
      expect(snapshots.data!.length).toBe(0);

      // Append event 1000 - should trigger auto-snapshot
      repo.append(worldId, 'system', null, null, { index: 1000 });

      // Verify snapshot was created
      snapshots = snapshotRepo.list(worldId);
      expect(snapshots.success).toBe(true);
      expect(snapshots.data!.length).toBe(1);
      expect(snapshots.data![0].event_id).toBe(1000);
      expect(snapshots.data![0].is_auto).toBe(true);
      expect(snapshots.data![0].description).toContain('Auto-snapshot at event 1000');
    });

    it('should create multiple snapshots at intervals', () => {
      const snapshotRepo = new SnapshotRepository(db);
      const worldId = 'world_multi_snapshot';

      // Append 2000 events
      for (let i = 1; i <= 2000; i++) {
        repo.append(worldId, 'system', null, null, { index: i });
      }

      // Verify 2 snapshots created (at 1000 and 2000)
      const snapshots = snapshotRepo.list(worldId);
      expect(snapshots.success).toBe(true);
      expect(snapshots.data!.length).toBe(2);
      expect(snapshots.data![0].event_id).toBe(2000); // Most recent first
      expect(snapshots.data![1].event_id).toBe(1000);
    });

    it('createSnapshot should create manual snapshot', () => {
      const worldId = 'world_manual_snapshot';

      // Append some events
      for (let i = 1; i <= 50; i++) {
        repo.append(worldId, 'system', null, null, { index: i });
      }

      // Create manual snapshot
      const result = repo.createSnapshot(worldId, 'Manual checkpoint');

      expect(result.success).toBe(true);
      expect(result.data!.event_id).toBe(50);
      expect(result.data!.is_auto).toBe(false);
      expect(result.data!.description).toBe('Manual checkpoint');
    });

    it('createSnapshot should fail for world with no events', () => {
      const result = repo.createSnapshot('empty_world');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No events found');
    });
  });
});
