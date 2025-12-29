/**
 * Tests for RNGStateRepository
 * 
 * T035: RNG state management for deterministic reproducibility
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { RNGStateRepository, RNGState } from '../../src/storage/rng-state.repo.js';
import { migrate } from '../../src/storage/migrations.js';

describe('RNGStateRepository', () => {
  let db: Database.Database;
  let repo: RNGStateRepository;
  const testWorldId = 'test_world_001';

  beforeEach(() => {
    // Create in-memory database for each test
    db = new Database(':memory:');
    migrate(db);
    // Disable FK checks for testing (rng_state references worlds)
    db.pragma('foreign_keys = OFF');
    repo = new RNGStateRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('getOrCreate', () => {
    it('should create new RNG state when context does not exist', () => {
      const result = repo.getOrCreate(testWorldId, 'combat', 'seed_123');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      
      const state = result.data!;
      expect(state.id).toBeDefined();
      expect(state.world_id).toBe(testWorldId);
      expect(state.context).toBe('combat');
      expect(state.seed).toBe('seed_123');
      expect(state.call_index).toBe(0);
      expect(state.last_value).toBeNull();
      expect(state.updated_at).toBeDefined();
    });

    it('should return existing state when context already exists', () => {
      // Create initial state
      const first = repo.getOrCreate(testWorldId, 'combat', 'seed_123');
      
      // Increment to change call_index
      repo.increment(testWorldId, 'combat', '0.5');

      // Try to get or create again (should return existing)
      const second = repo.getOrCreate(testWorldId, 'combat', 'different_seed');

      expect(second.success).toBe(true);
      expect(second.data!.id).toBe(first.data!.id);
      expect(second.data!.seed).toBe('seed_123'); // Original seed preserved
      expect(second.data!.call_index).toBe(1); // Incremented value
    });

    it('should create separate states for different contexts', () => {
      const combat = repo.getOrCreate(testWorldId, 'combat', 'combat_seed');
      const loot = repo.getOrCreate(testWorldId, 'loot', 'loot_seed');

      expect(combat.data!.id).not.toBe(loot.data!.id);
      expect(combat.data!.seed).toBe('combat_seed');
      expect(loot.data!.seed).toBe('loot_seed');
    });

    it('should create separate states for different worlds', () => {
      const world1 = repo.getOrCreate('world_1', 'combat', 'seed');
      const world2 = repo.getOrCreate('world_2', 'combat', 'seed');

      expect(world1.data!.id).not.toBe(world2.data!.id);
    });
  });

  describe('get', () => {
    it('should return existing state', () => {
      repo.getOrCreate(testWorldId, 'combat', 'seed_123');

      const result = repo.get(testWorldId, 'combat');

      expect(result.success).toBe(true);
      expect(result.data).not.toBeNull();
      expect(result.data!.context).toBe('combat');
    });

    it('should return null for non-existent context', () => {
      const result = repo.get(testWorldId, 'non_existent');

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });
  });

  describe('increment', () => {
    beforeEach(() => {
      repo.getOrCreate(testWorldId, 'combat', 'seed_123');
    });

    it('should increment call_index by 1', () => {
      const result = repo.increment(testWorldId, 'combat');

      expect(result.success).toBe(true);
      expect(result.data!.call_index).toBe(1);

      // Increment again
      const result2 = repo.increment(testWorldId, 'combat');
      expect(result2.data!.call_index).toBe(2);
    });

    it('should store last_value when provided', () => {
      const result = repo.increment(testWorldId, 'combat', '0.789');

      expect(result.success).toBe(true);
      expect(result.data!.last_value).toBe('0.789');
    });

    it('should update updated_at timestamp', async () => {
      const before = repo.get(testWorldId, 'combat');
      
      // Small delay to ensure timestamp difference
      await new Promise(r => setTimeout(r, 10));
      
      const after = repo.increment(testWorldId, 'combat');

      expect(after.data!.updated_at).not.toBe(before.data!.updated_at);
    });

    it('should fail for non-existent context', () => {
      const result = repo.increment(testWorldId, 'non_existent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('reset', () => {
    beforeEach(() => {
      repo.getOrCreate(testWorldId, 'combat', 'seed_123');
      // Increment several times
      repo.increment(testWorldId, 'combat', '0.1');
      repo.increment(testWorldId, 'combat', '0.2');
      repo.increment(testWorldId, 'combat', '0.3');
    });

    it('should reset call_index to specified value', () => {
      const result = repo.reset(testWorldId, 'combat', 1);

      expect(result.success).toBe(true);
      expect(result.data!.call_index).toBe(1);
    });

    it('should clear last_value on reset', () => {
      const result = repo.reset(testWorldId, 'combat', 0);

      expect(result.success).toBe(true);
      expect(result.data!.last_value).toBeNull();
    });

    it('should allow reset to 0', () => {
      const result = repo.reset(testWorldId, 'combat', 0);

      expect(result.success).toBe(true);
      expect(result.data!.call_index).toBe(0);
    });

    it('should fail for negative call_index', () => {
      const result = repo.reset(testWorldId, 'combat', -1);

      expect(result.success).toBe(false);
      expect(result.error).toContain('non-negative');
    });

    it('should fail for non-existent context', () => {
      const result = repo.reset(testWorldId, 'non_existent', 0);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('getAllForWorld', () => {
    beforeEach(() => {
      repo.getOrCreate(testWorldId, 'combat', 'combat_seed');
      repo.getOrCreate(testWorldId, 'loot', 'loot_seed');
      repo.getOrCreate(testWorldId, 'encounter', 'encounter_seed');
      repo.getOrCreate('other_world', 'combat', 'other_seed');
    });

    it('should return all contexts for a world', () => {
      const result = repo.getAllForWorld(testWorldId);

      expect(result.success).toBe(true);
      expect(result.data!.length).toBe(3);
    });

    it('should return contexts in alphabetical order', () => {
      const result = repo.getAllForWorld(testWorldId);

      expect(result.data![0].context).toBe('combat');
      expect(result.data![1].context).toBe('encounter');
      expect(result.data![2].context).toBe('loot');
    });

    it('should return empty array for world with no contexts', () => {
      const result = repo.getAllForWorld('empty_world');

      expect(result.success).toBe(true);
      expect(result.data!.length).toBe(0);
    });
  });

  describe('restoreFromSnapshot', () => {
    it('should replace all states with snapshot data', () => {
      // Create existing states
      repo.getOrCreate(testWorldId, 'combat', 'old_seed');
      repo.increment(testWorldId, 'combat');
      repo.getOrCreate(testWorldId, 'loot', 'old_loot_seed');

      // Snapshot data to restore
      const snapshotStates: RNGState[] = [
        {
          id: 'snap_1',
          world_id: testWorldId,
          context: 'combat',
          seed: 'snapshot_combat_seed',
          call_index: 42,
          last_value: '0.123',
          updated_at: '2025-01-01T00:00:00Z',
        },
        {
          id: 'snap_2',
          world_id: testWorldId,
          context: 'magic',
          seed: 'snapshot_magic_seed',
          call_index: 7,
          last_value: null,
          updated_at: '2025-01-01T00:00:00Z',
        },
      ];

      const result = repo.restoreFromSnapshot(testWorldId, snapshotStates);

      expect(result.success).toBe(true);

      // Verify restoration
      const allStates = repo.getAllForWorld(testWorldId);
      expect(allStates.data!.length).toBe(2);

      const combat = repo.get(testWorldId, 'combat');
      expect(combat.data!.seed).toBe('snapshot_combat_seed');
      expect(combat.data!.call_index).toBe(42);

      const magic = repo.get(testWorldId, 'magic');
      expect(magic.data!.seed).toBe('snapshot_magic_seed');
      expect(magic.data!.call_index).toBe(7);

      // Old 'loot' context should be gone
      const loot = repo.get(testWorldId, 'loot');
      expect(loot.data).toBeNull();
    });

    it('should handle empty snapshot array', () => {
      repo.getOrCreate(testWorldId, 'combat', 'seed');

      const result = repo.restoreFromSnapshot(testWorldId, []);

      expect(result.success).toBe(true);

      // All states should be deleted
      const allStates = repo.getAllForWorld(testWorldId);
      expect(allStates.data!.length).toBe(0);
    });
  });

  describe('deleteAllForWorld', () => {
    it('should delete all states for a world', () => {
      repo.getOrCreate(testWorldId, 'combat', 'seed');
      repo.getOrCreate(testWorldId, 'loot', 'seed');
      repo.getOrCreate('other_world', 'combat', 'seed');

      const result = repo.deleteAllForWorld(testWorldId);

      expect(result.success).toBe(true);
      expect(result.data).toBe(2);

      // Verify deletion
      const remaining = repo.getAllForWorld(testWorldId);
      expect(remaining.data!.length).toBe(0);

      // Other world should be unaffected
      const other = repo.getAllForWorld('other_world');
      expect(other.data!.length).toBe(1);
    });
  });

  describe('deleteContext', () => {
    it('should delete specific context', () => {
      repo.getOrCreate(testWorldId, 'combat', 'seed');
      repo.getOrCreate(testWorldId, 'loot', 'seed');

      const result = repo.deleteContext(testWorldId, 'combat');

      expect(result.success).toBe(true);

      const combat = repo.get(testWorldId, 'combat');
      expect(combat.data).toBeNull();

      const loot = repo.get(testWorldId, 'loot');
      expect(loot.data).not.toBeNull();
    });

    it('should fail for non-existent context', () => {
      const result = repo.deleteContext(testWorldId, 'non_existent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('listContexts', () => {
    it('should return list of context names', () => {
      repo.getOrCreate(testWorldId, 'combat', 'seed');
      repo.getOrCreate(testWorldId, 'loot', 'seed');
      repo.getOrCreate(testWorldId, 'encounter', 'seed');

      const result = repo.listContexts(testWorldId);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(['combat', 'encounter', 'loot']);
    });
  });

  describe('updateSeed', () => {
    beforeEach(() => {
      repo.getOrCreate(testWorldId, 'combat', 'original_seed');
      repo.increment(testWorldId, 'combat', '0.5');
      repo.increment(testWorldId, 'combat', '0.7');
    });

    it('should update seed and reset call_index to 0', () => {
      const result = repo.updateSeed(testWorldId, 'combat', 'new_seed');

      expect(result.success).toBe(true);
      expect(result.data!.seed).toBe('new_seed');
      expect(result.data!.call_index).toBe(0);
      expect(result.data!.last_value).toBeNull();
    });

    it('should fail for non-existent context', () => {
      const result = repo.updateSeed(testWorldId, 'non_existent', 'new_seed');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });
});
