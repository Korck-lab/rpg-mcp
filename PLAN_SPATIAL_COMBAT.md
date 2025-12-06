# Plan: Spatial Combat with Grid Positions

## Current State Analysis

### What Works ✅
- **SpatialEngine** (`src/engine/spatial/engine.ts`): A* pathfinding, AoE calculations, line-of-sight
- **CombatEngine** (`src/engine/combat/engine.ts`): Initiative, opportunity attacks, adjacency detection
- **Position schema**: `{ x: number; y: number; z?: number }` defined
- **Terrain obstacles**: Stored as `"x,y"` string format
- **Move action**: Basic pathfinding validation exists in `combat-tools.ts:687-797`

### Critical Gaps 🚨
From EMERGENT_DISCOVERY_LOG.md:

| Issue | Severity | Description |
|-------|----------|-------------|
| **BUG-001** | CRITICAL | Entities can exist outside world boundaries |
| **Position Persistence** | CRITICAL | Positions in-memory only, lost on encounter reload |
| **Collision Enforcement** | HIGH | Destination blocking checked but not enforced |
| **Movement Distance** | HIGH | No distance tracking or action economy |
| **Terrain Costs** | MEDIUM | Difficult terrain defined but not applied |

---

## Implementation Plan

### Phase 1: Position Persistence (P0 - Critical)
**Goal:** Positions survive encounter save/load cycle

1. **Update encounter storage schema**
   - Add `positions` JSON column OR embed in `tokens` JSON
   - Store terrain configuration in encounter record

2. **Modify EncounterRepository**
   - `saveEncounter()`: Serialize participant positions
   - `loadEncounter()`: Restore positions on load
   - Schema: `{ participantId: { x, y, z? } }`

3. **Tests**
   - Create encounter with positions → save → load → verify positions restored
   - Terrain obstacles persist across reload

**Files to modify:**
- `src/storage/repos/encounter.repo.ts`
- `src/storage/schema/encounters.ts` (if separate)
- `tests/storage/encounter.repo.test.ts`

---

### Phase 2: Boundary Validation (P0 - Critical)
**Goal:** Prevent entities from existing outside valid coordinates

1. **Define world/encounter boundaries**
   - Add `bounds: { minX, maxX, minY, maxY }` to encounter creation
   - Default bounds: 0-100 for both axes (configurable)

2. **Validate on position set**
   - `setPosition()` rejects out-of-bounds coordinates
   - Move action validates destination within bounds
   - Clear error message on violation

3. **Tests**
   - Attempt to place entity at negative coordinates → fails
   - Attempt to move outside bounds → fails
   - Valid movement within bounds → succeeds

**Files to modify:**
- `src/engine/combat/engine.ts` (add boundary checking)
- `src/server/combat-tools.ts` (create_encounter accepts bounds)
- `src/schema/encounter.ts` (bounds schema)

---

### Phase 3: Collision Enforcement (P1 - High)
**Goal:** Cannot move through or onto occupied spaces

1. **Enforce pathfinding requirement**
   - Move action MUST use findPath() result
   - If no valid path exists, movement fails
   - Movement follows path exactly (no teleporting)

2. **Block occupied destinations**
   - Destination occupied by another entity → fail
   - Allow "swap" positions via disengage? (optional)

3. **Tests**
   - Move to occupied space → fails with clear message
   - Move through occupied space → takes alternate path or fails
   - Move with clear path → succeeds

**Files to modify:**
- `src/server/combat-tools.ts` (enforce path following)
- `src/engine/combat/engine.ts` (collision helper methods)

---

### Phase 4: Movement Distance & Action Economy (P1 - High)
**Goal:** Implement movement speed and action costs

1. **Add movement speed to participants**
   - `movementSpeed: number` (default 30 for D&D 5e = 6 squares)
   - Track `movementRemaining` per turn

2. **Calculate path cost**
   - Use SpatialEngine pathfinding with terrain costs
   - Diagonal movement: 1.5x cost (D&D 5e alternating rule)
   - Difficult terrain: 2x cost

3. **Movement action consumes movement**
   - Check if path cost ≤ movementRemaining
   - Deduct cost from remaining movement
   - Reset movement at turn start

4. **Dash action**
   - Doubles movement for the turn
   - Consumes action

5. **Tests**
   - 6-square movement succeeds, 7-square fails
   - Difficult terrain costs double
   - Dash allows 12-square movement
   - Movement resets each turn

**Files to modify:**
- `src/schema/encounter.ts` (add movementSpeed, movementRemaining)
- `src/engine/combat/engine.ts` (movement tracking)
- `src/engine/spatial/engine.ts` (path cost calculation with terrain)
- `src/server/combat-tools.ts` (movement action with distance check)

---

### Phase 5: AoE Integration (P2 - Medium)
**Goal:** Spell areas properly target participants by position

1. **Get targets in area**
   - `getParticipantsInCircle(center, radius)`
   - `getParticipantsInCone(origin, direction, length, angle)`
   - `getParticipantsInLine(start, end, width?)`

2. **Integrate with spell casting**
   - Spell action can specify area type and parameters
   - Automatically determine affected targets
   - Respect line-of-sight if spell requires

3. **Tests**
   - Fireball at center hits all within 20ft radius
   - Cone spell hits only those in cone area
   - Lightning bolt hits targets in line

**Files to modify:**
- `src/engine/combat/engine.ts` (area target methods)
- `src/server/combat-tools.ts` (spell action with AoE)

---

## Test File Structure

```
tests/
├── engine/
│   ├── combat/
│   │   ├── spatial-positions.test.ts    # Phase 1 & 2
│   │   ├── collision.test.ts            # Phase 3
│   │   ├── movement-economy.test.ts     # Phase 4
│   │   └── aoe-targeting.test.ts        # Phase 5
│   └── spatial/
│       └── pathfinding-costs.test.ts    # Phase 4 terrain costs
└── server/
    └── spatial-combat.test.ts           # Integration tests
```

---

## Acceptance Criteria

### Phase 1 Complete When:
- [ ] Positions persist across encounter save/load
- [ ] Terrain obstacles persist across save/load
- [ ] All existing tests still pass

### Phase 2 Complete When:
- [ ] Encounters have configurable bounds
- [ ] Out-of-bounds positions rejected
- [ ] Clear error messages on boundary violations
- [ ] BUG-001 from discovery log is RESOLVED

### Phase 3 Complete When:
- [ ] Cannot move to occupied space
- [ ] Pathfinding is mandatory for movement
- [ ] No teleporting through obstacles

### Phase 4 Complete When:
- [ ] Movement speed limits distance per turn
- [ ] Difficult terrain costs extra movement
- [ ] Dash action doubles movement
- [ ] Movement resets each turn

### Phase 5 Complete When:
- [ ] Spells can target areas
- [ ] Area calculations use participant positions
- [ ] Line-of-sight integrated for relevant spells

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Breaking existing combat tests | Run full test suite after each phase |
| Performance regression with pathfinding | Cache common paths, limit max iterations |
| Schema migration for existing data | Make new fields optional with defaults |
| Complexity creep | Each phase is self-contained and shippable |

---

## Estimated Complexity

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1 | Low | None (standalone) |
| Phase 2 | Low | Phase 1 (needs positions to validate) |
| Phase 3 | Medium | Phase 1-2 |
| Phase 4 | Medium | Phase 1-3 |
| Phase 5 | Medium | Phase 1-4 |

**Recommended approach:** Complete Phases 1-3 first (critical fixes), then Phase 4-5 (enhancements).

---

## Questions for User

1. **Default bounds:** Should encounters default to 100x100 grid, or require explicit bounds?
2. **Movement system:** D&D 5e style (30ft = 6 squares) or different scale?
3. **Diagonal movement:** Strict 1.5x cost or simplified 1x cost?
4. **Size categories:** Should Large/Huge creatures occupy multiple squares?
5. **Priority:** Focus on all phases or specific subset first?
