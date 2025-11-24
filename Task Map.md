# Unified MCP Simulation Server — Master Build Checklist (TDD Focus)

## 0. PROJECT PRINCIPLES

- [ ] **Determinism First:** All systems must produce identical output from identical seeds.
- [ ] **Schema-Driven Development:** Every tool input/output validated using Zod schemas.
- [ ] **TDD Driven:** All functionality must be introduced *through tests first*.
- [ ] **Structured, LLM-Safe:** Map editing, world generation, and combat use strict typed structures.
- [ ] **Small Surface Area:** Build minimal valuable components before expanding.
- [ ] **Multi-Transport Stability:** Support stdio, Unix socket, and TCP from day one.
- [ ] **Zero Hidden State:** All state must be explicit in storage, logs, or schemas.
- [ ] **Replayable:** Every operation yields deterministic event logs.

---

## 1. INITIATION

### 1.1 Repo & Project Setup
- [ ] Create new repository with clean structure
- [ ] Initialize TypeScript project with `"strict": true`
- [ ] Add `.editorconfig`, `.gitignore`, `README.md`
- [ ] Configure test runner (Vitest or Jest)
- [ ] Configure CI for lint + type-check + test

### 1.2 Dependencies
- [ ] Install: `typescript`, `tsup/esbuild`, `zod`
- [ ] Install: `better-sqlite3`, `seedrandom`, `uuid`
- [ ] Install: testing libs (`vitest`, `supertest`)
- [ ] Configure scripts: `test`, `test:watch`, `build`, `dev`

### 1.3 Clone Azgaar (Reference Only)
- [ ] Clone https://github.com/Azgaar/Fantasy-Map-Generator into `/reference/azgaar/`
- [ ] Add LICENSE notes
- [ ] Document what we will and will not reuse

---

## 2. SCHEMA LAYER (WRITE TESTS FIRST)

### 2.1 Core Schemas
- [ ] Write failing tests describing desired objects:
  - [ ] `World`
  - [ ] `Region`
  - [ ] `Tile`
  - [ ] `Biome`
  - [ ] `RiverPath`
  - [ ] `Structure`
  - [ ] `Character`, `NPC`
  - [ ] `Encounter`, `Token`
  - [ ] `MapPatch`, `Annotation`
- [ ] Implement minimal Zod schemas to satisfy tests
- [ ] Validate JSON compatibility

---

## 3. STORAGE LAYER (TDD)

### 3.1 SQLite Setup
- [ ] Configure SQLite client with safe synchronous mode
- [ ] Write tests for migrations:
  - [ ] `worlds`
  - [ ] `regions`
  - [ ] `tiles`
  - [ ] `structures`
  - [ ] `rivers`
  - [ ] `patches`
  - [ ] `characters`, `npcs`
  - [ ] `encounters`
  - [ ] `battlefield`
  - [ ] `audit_logs`
  - [ ] `event_logs`

### 3.2 Repository Layer
For each repo:
- [ ] Write failing CRUD tests
- [ ] Implement minimal repo functions
- [ ] Validate schema before DB writes
- [ ] Validate schema after reads
- [ ] Test deterministic data integrity

---

## 4. WORLD GENERATION (TDD + INSPIRED BY AZGAAR)

### 4.1 Algorithm Research Tests
- [ ] Snapshot Azgaar output for a seed
- [ ] Write tests describing expected:
  - [ ] Terrain continuity
  - [ ] Biome plausibility
  - [ ] River validity
- [ ] These tests serve as *quality gates*

### 4.2 Heightmap Generator
- [ ] Write tests for seed → heightmap determinism
- [ ] Implement layered noise heightmap
- [ ] Add ridges/tectonic hints (inspired by Azgaar)
- [ ] Normalize and validate elevation ranges

### 4.3 Climate Layer
- [ ] Tests for temperature gradient by latitude
- [ ] Tests for moisture distribution consistency
- [ ] Implement climate model

### 4.4 Biome Assignment
- [ ] Tests for biome correctness based on (temp, moisture)
- [ ] Implement lookup-table biome mapper

### 4.5 Rivers
- [ ] Tests: rivers must flow downhill
- [ ] Tests: branch correctness & no loops
- [ ] Implement drainage + flow accumulation

### 4.6 Structures & Regions
- [ ] Tests defining correct region segmentation
- [ ] Settlement placement rules:
  - [ ] Cities near coasts
  - [ ] Towns near rivers
- [ ] Implement minimal generator

---

## 5. WORLD EDITING DSL (TDD)

### 5.1 DSL Parsing
- [ ] Write tests for valid DSL commands:
  - [ ] ADD_STRUCTURE
  - [ ] SET_BIOME
  - [ ] EDIT_TILE
  - [ ] ADD_ROAD
  - [ ] MOVE_STRUCTURE
  - [ ] ADD_ANNOTATION

### 5.2 Patch Engine
- [ ] Test patch application → world diff
- [ ] Test patch reversion
- [ ] Test patch history correctness
- [ ] Implement DSL → MapPatch transformer

---

## 6. COMBAT ENGINE (TDD)

### 6.1 Deterministic RNG
- [ ] Test seed consistency
- [ ] Test dice roll determinism

### 6.2 Combat Rules
- [ ] Tests for attack rolls, saving throws
- [ ] Tests for damage calculations
- [ ] Tests for movement + AoO
- [ ] Implement minimal rules to satisfy tests

### 6.3 Encounter Simulation
- [ ] Test turn order mechanics
- [ ] Test conditions & state diffs
- [ ] Implement deterministic encounter loop

---

## 7. SPATIAL REASONING (TDD)

### 7.1 LOS
- [ ] Write tests for obstruction detection
- [ ] Implement LOS algorithm

### 7.2 AoE Tools
- [ ] Tests for cone/sphere/line intersection
- [ ] Implement geometry engine

### 7.3 Pathfinding
- [ ] Tests for shortest path validity
- [ ] Integrate deterministic pathfinding

---

## 8. MCP LAYER (TDD)

### 8.1 Transport Servers
- [ ] Tests: stdio echo server
- [ ] Tests: TCP request/response
- [ ] Tests: Unix socket request/response
- [ ] Implement servers

### 8.2 MCP Tool Metadata & Introspection
- [ ] Tests for:
  - [ ] get_tool_metadata
  - [ ] get_schema
  - [ ] get_server_capabilities

### 8.3 Full Tool Surface
Write failing tests for:
- [ ] generate_world
- [ ] apply_map_patch
- [ ] preview_map_patch
- [ ] get_world
- [ ] get_region_map
- [ ] get_world_map_overview
- [ ] Combat tools
- [ ] Character/world CRUD tools

Implement only enough code to satisfy tests.

---

## 9. EVENT STREAMING (TDD)

### 9.1 Pub/Sub
- [ ] Test subscription registration
- [ ] Test event push
- [ ] Test world + combat notifications

### 9.2 Streaming Protocol
- [ ] Implement JSON events over socket streams

---

## 10. AUDITING & LOGGING (TDD)

### 10.1 Audit Logs
- [ ] Tests for audit record creation
- [ ] Test filtering by tool/time/requestId
- [ ] Implement audit logging

### 10.2 Replay Logs
- [ ] Tests: replay reproduces identical state
- [ ] Implement replay generator

---

## 11. PACKAGING & DISTRIBUTION

### 11.1 Build Pipeline
- [ ] Test build artifact existence
- [ ] Generate unified JS bundle

### 11.2 Binary Packaging
- [ ] Optional: `pkg` or `nexe` tests for binary execution

---

## 12. COMPLETION CRITERIA

- [ ] All tests pass green
- [ ] All MCP tools validated
- [ ] World generation deterministic and high-quality
- [ ] Combat simulation deterministic
- [ ] Visualizer geometry correct
- [ ] Event streaming stable
- [ ] Cross-platform binaries build successfully
