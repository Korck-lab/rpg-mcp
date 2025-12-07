# LLM Spatial Combat Guide

## Encounter Creation Workflow

Follow this sequence when creating 3D combat encounters:

1. **Generate Terrain** → `generate_terrain_patch` with biome/density
2. **Add Details** → `place_prop` for POIs, buildings, structures
3. **Place Party** → Party members positioned safely
4. **Place Enemies** → Enemies positioned tactically
5. **Start Combat** → `create_encounter` with all positions

---

## Critical Verticality Rules

### Z-Coordinate Semantics

| Z Value | Meaning                          | Use Case                    |
| ------- | -------------------------------- | --------------------------- |
| `z=0`   | Standing on surface at (x,y)     | **Default for everything**  |
| `z>0`   | Flying/levitating in air         | Only with flight capability |
| `z<0`   | In pit/valley/water below ground | Deep rivers, chasms         |

### The Golden Rule

> **"Standing on rocks" = same (x,y) as rock obstacle, z=0**
>
> The terrain height is IMPLICIT. Don't add synthetic Z values!

### Examples

```json
// ✅ CORRECT: Goblin standing ON rock at (15,3)
{ "position": { "x": 15, "y": 3, "z": 0 } }

// ❌ WRONG: Goblin floating above rock (will FALL!)
{ "position": { "x": 15, "y": 3, "z": 25 } }
```

---

## Terrain Generation Rules

### Obstacles Should Cluster

Create natural formations, not random squares:

- **Hills/Mountains**: Obstacles cluster with adjacent slopes
- **Valleys**: Negative elevation with gradual descent
- **Cliffs**: Only isolated vertical surfaces if INTENTIONALLY inaccessible
- **Default**: Add adjacent terrain that steps down to ground level

### Slopes Are Required

Unless designing inaccessible terrain:

```
Ground(0) → Low(1) → Mid(2) → High(3)  ✅ Natural mountain
Ground(0) → HIGH(5)                      ❌ Floating platform (needs flying)
```

### Water Must Connect

Water bodies should be connected as rivers, streams, or pools:

- **Rivers**: Long chains of tiles, narrow (1-2 wide)
- **Streams**: Short chains (2-5 tiles)
- **Pools**: Clustered circular-ish areas
- **Lakes**: Large connected bodies

Never place isolated single water tiles.

---

## Prop Placement

### Height Semantics

`heightFeet` describes the PROP's visual height, NOT entity position:

```json
{
  "position": "5,5",
  "label": "30ft Cliff",
  "heightFeet": 30 // Visual appearance
  // Entity standing on top uses z=0, not z=30!
}
```

### Structure Types

| Type         | Description               | Example               |
| ------------ | ------------------------- | --------------------- |
| `cliff`      | Vertical rocky terrain    | Mountain side         |
| `wall`       | Stone/brick barrier       | Building wall         |
| `bridge`     | Spanning structure        | River crossing        |
| `tree`       | Vegetation                | Forest cover          |
| `stairs`     | Stepped ascent            | Access to high ground |
| `pit`        | Below ground (negative Y) | Trap, ravine          |
| `water_pool` | Recessed water            | Pond, stream section  |

---

## Entity Placement

### Creature Archetypes

| Archetype   | Description   | Examples              |
| ----------- | ------------- | --------------------- |
| `humanoid`  | Bipedal       | Goblins, orcs, humans |
| `quadruped` | Four-legged   | Wolves, horses        |
| `beast`     | Hunched/bulky | Trolls, bears         |
| `serpent`   | Elongated     | Snakes, worms         |
| `avian`     | Winged        | Dragons, harpies      |
| `arachnid`  | Multi-legged  | Spiders, scorpions    |
| `amorphous` | Blob-like     | Oozes, elementals     |

### Tactical Positioning

- **Archers**: On elevated terrain (standing ON obstacles)
- **Melee**: Ground level, near approaches
- **Ambushers**: Behind cover props
- **Flying**: Only creatures with flight (z>0)

---

## Complete Example

```json
{
  "seed": "forest-ambush-001",
  "terrain": {
    "obstacles": [
      "10,5",
      "11,5",
      "12,5", // Hill cluster
      "10,6",
      "11,6", // Slope down
      "10,7" // Ground adjacent
    ],
    "water": [
      "5,10",
      "5,11",
      "5,12",
      "6,12",
      "7,12" // Connected stream
    ],
    "difficultTerrain": [
      "8,8",
      "8,9",
      "9,8",
      "9,9" // Undergrowth cluster
    ]
  },
  "participants": [
    // Party at ground level
    { "id": "player-1", "position": { "x": 15, "y": 15, "z": 0 } },

    // Goblin archer ON the hill (not floating above it)
    { "id": "goblin-archer", "position": { "x": 10, "y": 5, "z": 0 } },

    // Melee goblin at ground near slope
    { "id": "goblin-melee", "position": { "x": 10, "y": 8, "z": 0 } }
  ]
}
```
