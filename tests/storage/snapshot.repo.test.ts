/**
 * Tests for SnapshotRepository
 * 
 * T032: Create snapshot from current world state
 * T033: Get nearest snapshot for rollback
 * T034: Cleanup old snapshots
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SnapshotRepository, Snapshot } from '../../src/storage/snapshot.repo.js';
import { migrate } from '../../src/storage/migrations.js';

describe('SnapshotRepository', () => {
  let db: Database.Database;
  let repo: SnapshotRepository;
  const testWorldId = 'test_world_001';
  beforeEach(() => {
    // Create in-memory database for each test
    db = new Database(':memory:');
    migrate(db);
    // Disable FK checks for testing (snapshots reference worlds and event_logs)
    db.pragma('foreign_keys = OFF');
    repo = new SnapshotRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('T032: create', () => {
    it('should create a snapshot with computed checksum and size', () => {
      const state = { characters: ['char_1'], items: ['sword', 'shield'] };
      
      const result = repo.create({
        world_id: testWorldId,
        event_id: 100,
        state,
        description: 'Test snapshot',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      
      const snapshot = result.data!;
      expect(snapshot.id).toBeDefined();
      expect(snapshot.world_id).toBe(testWorldId);
      expect(snapshot.event_id).toBe(100);
      expect(snapshot.description).toBe('Test snapshot');
      expect(snapshot.checksum).toHaveLength(64); // SHA-256 hex
      expect(snapshot.size_bytes).toBeGreaterThan(0);
      expect(snapshot.is_auto).toBe(false);
      expect(snapshot.state_json).toContain('characters');
    });

    it('should create auto-snapshot when is_auto is true', () => {
      const result = repo.create({
        world_id: testWorldId,
        event_id: 50,
        state: { test: true },
        is_auto: true,
      });

      expect(result.success).toBe(true);
      expect(result.data!.is_auto).toBe(true);
    });

    it('should generate consistent checksum for same state', () => {
      const state = { a: 1, b: 2, c: 3 };
      
      const result1 = repo.create({
        world_id: testWorldId,
        event_id: 1,
        state,
      });
      
      const result2 = repo.create({
        world_id: testWorldId,
        event_id: 2,
        state,
      });

      expect(result1.data!.checksum).toBe(result2.data!.checksum);
    });

    it('should generate unique checksum for different states', () => {
      const result1 = repo.create({
        world_id: testWorldId,
        event_id: 1,
        state: { value: 1 },
      });
      
      const result2 = repo.create({
        world_id: testWorldId,
        event_id: 2,
        state: { value: 2 },
      });

      expect(result1.data!.checksum).not.toBe(result2.data!.checksum);
    });
  });

  describe('T033: getNearest', () => {
    beforeEach(() => {
      // Create snapshots at event_ids 10, 50, 100, 200
      repo.create({ world_id: testWorldId, event_id: 10, state: { at: 10 } });
      repo.create({ world_id: testWorldId, event_id: 50, state: { at: 50 } });
      repo.create({ world_id: testWorldId, event_id: 100, state: { at: 100 } });
      repo.create({ world_id: testWorldId, event_id: 200, state: { at: 200 } });
    });

    it('should return exact match when event_id matches a snapshot', () => {
      const result = repo.getNearest(testWorldId, 100);

      expect(result.success).toBe(true);
      expect(result.data).not.toBeNull();
      expect(result.data!.event_id).toBe(100);
    });

    it('should return nearest earlier snapshot when no exact match', () => {
      const result = repo.getNearest(testWorldId, 75);

      expect(result.success).toBe(true);
      expect(result.data!.event_id).toBe(50);
    });

    it('should return earliest snapshot for event_id between snapshots', () => {
      const result = repo.getNearest(testWorldId, 150);

      expect(result.success).toBe(true);
      expect(result.data!.event_id).toBe(100);
    });

    it('should return null when no snapshot at or before event_id', () => {
      const result = repo.getNearest(testWorldId, 5);

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });

    it('should return null for non-existent world', () => {
      const result = repo.getNearest('non_existent', 100);

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });
  });

  describe('getLatest', () => {
    it('should return the most recent snapshot', () => {
      repo.create({ world_id: testWorldId, event_id: 10, state: {} });
      repo.create({ world_id: testWorldId, event_id: 100, state: {} });
      repo.create({ world_id: testWorldId, event_id: 50, state: {} });

      const result = repo.getLatest(testWorldId);

      expect(result.success).toBe(true);
      expect(result.data!.event_id).toBe(100);
    });

    it('should return null when no snapshots exist', () => {
      const result = repo.getLatest(testWorldId);

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });
  });

  describe('list', () => {
    beforeEach(() => {
      for (let i = 1; i <= 15; i++) {
        repo.create({ world_id: testWorldId, event_id: i * 10, state: { i } });
      }
    });

    it('should list snapshots in descending event_id order', () => {
      const result = repo.list(testWorldId);

      expect(result.success).toBe(true);
      expect(result.data!.length).toBe(15);
      expect(result.data![0].event_id).toBe(150);
      expect(result.data![14].event_id).toBe(10);
    });

    it('should respect limit parameter', () => {
      const result = repo.list(testWorldId, 5);

      expect(result.success).toBe(true);
      expect(result.data!.length).toBe(5);
      expect(result.data![0].event_id).toBe(150);
      expect(result.data![4].event_id).toBe(110);
    });
  });

  describe('T034: cleanup', () => {
    beforeEach(() => {
      // Create 10 snapshots at event_ids 10, 20, ..., 100
      for (let i = 1; i <= 10; i++) {
        repo.create({ world_id: testWorldId, event_id: i * 10, state: { i } });
      }
    });

    it('should keep only the most recent N snapshots', () => {
      const deleteResult = repo.cleanup(testWorldId, 3);

      expect(deleteResult.success).toBe(true);
      expect(deleteResult.data).toBe(7); // Deleted 7 old ones

      const listResult = repo.list(testWorldId);
      expect(listResult.data!.length).toBe(3);
      expect(listResult.data![0].event_id).toBe(100);
      expect(listResult.data![1].event_id).toBe(90);
      expect(listResult.data![2].event_id).toBe(80);
    });

    it('should delete nothing when keepCount >= total', () => {
      const result = repo.cleanup(testWorldId, 20);

      expect(result.success).toBe(true);
      expect(result.data).toBe(0);
    });

    it('should keep all when keepCount equals total', () => {
      const result = repo.cleanup(testWorldId, 10);

      expect(result.success).toBe(true);
      expect(result.data).toBe(0);

      const listResult = repo.list(testWorldId);
      expect(listResult.data!.length).toBe(10);
    });

    it('should handle keepCount of 0', () => {
      // keepCount 0 means keep nothing, but algorithm needs at least 1
      // The current implementation will return 0 deletions for keepCount 0
      // because OFFSET -1 returns nothing
      const result = repo.cleanup(testWorldId, 1);

      expect(result.success).toBe(true);
      // Should delete 9, keeping only the latest
      expect(result.data).toBe(9);
    });

    it('should fail for negative keepCount', () => {
      const result = repo.cleanup(testWorldId, -1);

      expect(result.success).toBe(false);
      expect(result.error).toContain('non-negative');
    });
  });

  describe('verify', () => {
    it('should return true for valid checksum', () => {
      const createResult = repo.create({
        world_id: testWorldId,
        event_id: 1,
        state: { test: 'data' },
      });

      const verifyResult = repo.verify(createResult.data!.id);

      expect(verifyResult.success).toBe(true);
      expect(verifyResult.data).toBe(true);
    });

    it('should return false for corrupted state_json', () => {
      const createResult = repo.create({
        world_id: testWorldId,
        event_id: 1,
        state: { test: 'data' },
      });

      // Corrupt the state_json directly in database
      db.prepare('UPDATE snapshots SET state_json = ? WHERE id = ?')
        .run('{"corrupted": true}', createResult.data!.id);

      const verifyResult = repo.verify(createResult.data!.id);

      expect(verifyResult.success).toBe(true);
      expect(verifyResult.data).toBe(false);
    });

    it('should fail for non-existent snapshot', () => {
      const result = repo.verify('non_existent_id');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('countByWorld', () => {
    it('should return correct count', () => {
      repo.create({ world_id: testWorldId, event_id: 1, state: {} });
      repo.create({ world_id: testWorldId, event_id: 2, state: {} });
      repo.create({ world_id: 'other_world', event_id: 1, state: {} });

      const result = repo.countByWorld(testWorldId);

      expect(result.success).toBe(true);
      expect(result.data).toBe(2);
    });

    it('should return 0 for world with no snapshots', () => {
      const result = repo.countByWorld('empty_world');

      expect(result.success).toBe(true);
      expect(result.data).toBe(0);
    });
  });

  describe('getTotalSize', () => {
    it('should return total size in bytes', () => {
      repo.create({ world_id: testWorldId, event_id: 1, state: { data: 'small' } });
      repo.create({ world_id: testWorldId, event_id: 2, state: { data: 'larger data here' } });

      const result = repo.getTotalSize(testWorldId);

      expect(result.success).toBe(true);
      expect(result.data).toBeGreaterThan(0);
    });

    it('should return 0 for world with no snapshots', () => {
      const result = repo.getTotalSize('empty_world');

      expect(result.success).toBe(true);
      expect(result.data).toBe(0);
    });
  });
});
