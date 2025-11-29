# rpg-mcp: Deterministic Math Engine

## Module Structure

```
src/
├── math/
│   ├── index.ts           # Module exports
│   ├── schemas.ts         # Zod schemas for all math types
│   ├── dice.ts            # Dice rolling with seed support
│   ├── probability.ts     # Statistical distributions
│   ├── algebra.ts         # Equation solving
│   ├── combat.ts          # RPG-specific formulas
│   └── export.ts          # LaTeX/MathML/plaintext output
├── repos/
│   └── calculation.repo.ts
└── migrations/
    └── 003_calculations.sql
```

## Dependencies

```json
{
  "mathjs": "^12.x",
  "nerdamer": "^1.x",
  "seedrandom": "^3.x"
}
```

---

## Phase 1: Schema Foundation ✅ COMPLETE
**Estimate:** 2-3 hours

| ID | Task | Hint | Done When |
|----|------|------|-----------|
| 1.1 | Define `DiceExpression` schema | Zod regex for `NdX+M`, parse to `{count, sides, modifier, advantage?}` | `"2d6+4"` parses, `"garbage"` fails |
| 1.2 | Define `CalculationResult` schema | `input`, `result`, `steps[]`, `timestamp`, `seed` | Serializes, round-trips |
| 1.3 | Define `ProbabilityQuery` schema | Target number, roll type, modifiers | Validates AC/DC checks |
| 1.4 | Define `ExportFormat` enum | `"latex" | "mathml" | "plaintext" | "steps"` | Type-safe selection |

---

## Phase 2: Deterministic Dice Engine ✅ COMPLETE
**Estimate:** 3-4 hours

| ID | Task | Hint | Done When |
|----|------|------|-----------|
| 2.1 | Implement seeded RNG wrapper | `seedrandom` with seed from world state or explicit | Same seed → same sequence |
| 2.2 | Implement `rollDice(expr, seed)` | Parse expression, execute, return breakdown | `{rolls: [3,5], modifier: 4, total: 12}` |
| 2.3 | Implement advantage/disadvantage | Roll twice, take higher/lower | Shows both rolls |
| 2.4 | Implement exploding dice | Reroll on max, sum all | `"2d6!"` handles explosions |
| 2.5 | Implement dice pools | Count successes vs threshold | `pool("5d10", 7)` → `{successes: 2}` |

---

## Phase 3: Probability Calculator ✅ COMPLETE
**Estimate:** 2-3 hours

| ID | Task | Hint | Done When |
|----|------|------|-----------|
| 3.1 | Implement `probability(expr, target)` | Calculate P(roll >= target) | `probability("1d20+5", 15)` → `0.55` |
| 3.2 | Implement distribution curves | Return full probability mass function | `distribution("2d6")` → `{2: 0.028, ...}` |
| 3.3 | Implement expected value | Mean outcome for expression | `expected("1d20+5")` → `15.5` |
| 3.4 | Implement comparison | P(A beats B) | `compare("1d20+7", "1d20+3")` → advantage % |

---

## Phase 4: RPG Combat Math ✅ COMPLETE
**Estimate:** 3-4 hours

| ID | Task | Hint | Done When |
|----|------|------|-----------|
| 4.1 | Implement `attackRoll(attacker, target, seed)` | Full resolution with hit/crit/miss | Returns breakdown |
| 4.2 | Implement `damageRoll(weapon, crit, seed)` | Damage with type, resistance | Crit doubles dice |
| 4.3 | Implement `savingThrow(dc, modifier, seed)` | Save resolution | Pass/fail with margin |
| 4.4 | Implement `encounterBalance(party, enemies)` | CR calculation, difficulty | XP budget analysis |
| 4.5 | Implement `fallDamage(feet)` | 1d6 per 10ft, max 20d6 | `fallDamage(60)` → 6d6 |

---

## Phase 5: Symbolic Algebra ✅ COMPLETE
**Estimate:** 3-4 hours

| ID | Task | Hint | Done When |
|----|------|------|-----------|
| 5.1 | Integrate nerdamer | Wrapper with error handling | Import works |
| 5.2 | Implement `solve(equation, variable)` | Algebraic solving | `solve("2x + 4 = 10", "x")` → `3` |
| 5.3 | Implement `simplify(expression)` | Reduce complexity | `simplify("2x + 3x")` → `5x` |
| 5.4 | Implement `substitute(expr, vars)` | Variable replacement | `substitute("2x + y", {x:3, y:4})` → `10` |

---

## Phase 6: Calculus & Physics ✅ COMPLETE
**Estimate:** 3-4 hours

| ID | Task | Hint | Done When |
|----|------|------|-----------|
| 6.1 | Implement `differentiate(expr, var)` | Symbolic derivative | `diff("x^2", "x")` → `2x` |
| 6.2 | Implement `integrate(expr, var)` | Symbolic integration | `integrate("2x", "x")` → `x^2` |
| 6.3 | Implement `PhysicsEngine` | Kinematics & Projectiles | Class created |
| 6.4 | Implement `projectile(v0, angle)` | Calculate trajectory | Returns path points |
| 6.5 | Implement `kinematics(params)` | Solve SUVAT equations | Solves for missing var |

---

## Phase 7: Export System ✅ COMPLETE
**Estimate:** 2-3 hours

| ID | Task | Hint | Done When |
|----|------|------|-----------|
| 7.1 | Implement LaTeX export | Full formula rendering | `"\\frac{d}{dx}..."` |
| 7.2 | Implement step-by-step export | Human-readable work | Shows intermediates |
| 7.3 | Implement MathML export | Web-compatible format | Valid MathML |
| 7.4 | Implement plaintext export | ASCII math notation | Readable without rendering |

---

## Phase 8: Persistence & History ✅ COMPLETE
**Estimate:** 2-3 hours

| ID | Task | Hint | Done When |
|----|------|------|-----------|
| 8.1 | Create calculations migration | `id, session_id, input, result, seed, timestamp` | Migration runs |
| 8.2 | Implement `CalculationRepository` | CRUD following existing pattern | Matches repo style |
| 8.3 | Implement history queries | By session, type, timerange | `getBySession(id)` works |
| 8.4 | Add calculation to event log | Integrate with event system | Appears in replay |

---

## Phase 9: MCP Tool Registration ✅ COMPLETE
**Estimate:** 2-3 hours

| ID | Task | Hint | Done When |
|----|------|------|-----------|
| 9.1 | Register `dice_roll` tool | Expose dice rolling | Callable |
| 9.2 | Register `probability_calculate` tool | Statistics queries | Returns formatted |
| 9.3 | Register `algebra_solve` tool | Algebra access | Symbolic solving works |
| 9.4 | Register `algebra_simplify` tool | Expression simplification | Simplification works |
| 9.5 | Register `physics_projectile` tool | Projectile calculations | Trajectory works |
