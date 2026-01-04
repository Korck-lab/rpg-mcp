import { z } from 'zod';
import { CombatTokenSchema } from './combat-token.js';

// Re-export CombatTokenSchema as TokenSchema for backwards compatibility
export const TokenSchema = CombatTokenSchema;

export const ConditionSchema = z.object({
    id: z.string(),
    type: z.string(),
    durationType: z.string(),
    duration: z.number().optional(),
    sourceId: z.string().optional(),
    saveDC: z.number().optional(),
    saveAbility: z.string().optional(),
    ongoingEffects: z.array(z.any()).optional(),
    metadata: z.record(z.any()).optional()
});

// CRIT-003: Position schema for spatial combat
export const PositionSchema = z.object({
    x: z.number(),
    y: z.number(),
    z: z.number().optional()
});

export type Position = z.infer<typeof PositionSchema>;

/**
 * Grid bounds schema for spatial validation (BUG-001 fix)
 * Defines the valid coordinate range for an encounter's grid.
 * Default: 0-100 for both axes (101x101 grid)
 */
export const GridBoundsSchema = z.object({
    minX: z.number().default(0),
    maxX: z.number().default(100),
    minY: z.number().default(0),
    maxY: z.number().default(100),
    minZ: z.number().optional(),
    maxZ: z.number().optional()
});

export type GridBounds = z.infer<typeof GridBoundsSchema>;

/**
 * Default grid bounds (101x101 grid from 0-100)
 */
export const DEFAULT_GRID_BOUNDS: GridBounds = {
    minX: 0,
    maxX: 100,
    minY: 0,
    maxY: 100
};

/**
 * Size category for creatures (affects occupied squares)
 * Based on D&D 5e size categories
 */
export const SizeCategorySchema = z.enum([
    'tiny',      // 2.5ft, shares space
    'small',     // 5ft, 1 square
    'medium',    // 5ft, 1 square
    'large',     // 10ft, 2x2 squares
    'huge',      // 15ft, 3x3 squares
    'gargantuan' // 20ft+, 4x4+ squares
]);

export type SizeCategory = z.infer<typeof SizeCategorySchema>;

/**
 * Get the grid footprint (squares occupied) for a size category
 * @param size The creature's size category
 * @returns Number of squares on each side (e.g., 2 for Large = 2x2)
 */
export function getSizeFootprint(size: SizeCategory): number {
    switch (size) {
        case 'tiny':
        case 'small':
        case 'medium':
            return 1;
        case 'large':
            return 2;
        case 'huge':
            return 3;
        case 'gargantuan':
            return 4;
    }
}



// CRIT-003: Terrain schema for blocking obstacles
export const TerrainSchema = z.object({
    obstacles: z.array(z.string()).default([]), // "x,y" format for blocking tiles
    difficultTerrain: z.array(z.string()).default([]), // Future: 2x movement cost
    water: z.array(z.string()).default([]) // Water tiles
});

export type Terrain = z.infer<typeof TerrainSchema>;

export const PropSchema = z.object({
    id: z.string(),
    position: z.string(), // "x,y" format
    label: z.string(),
    propType: z.enum(['structure', 'cover', 'climbable', 'hazard', 'interactive', 'decoration']),
    heightFeet: z.number().optional(),
    cover: z.enum(['none', 'half', 'three_quarter', 'full']).optional(),
    climbable: z.boolean().optional(),
    climbDC: z.number().optional(),
    breakable: z.boolean().optional(),
    hp: z.number().optional(),
    currentHp: z.number().optional(),
    description: z.string().optional()
});

export type Prop = z.infer<typeof PropSchema>;

export const EncounterSchema = z.object({
    id: z.string(),
    worldId: z.string(),
    regionId: z.string().optional(),
    roomId: z.string().optional(),
    tokens: z.array(CombatTokenSchema).optional(),
    round: z.number().int().min(1).default(1),
    activeTokenId: z.string().optional(),
    status: z.enum(['active', 'completed', 'paused']),
    terrain: TerrainSchema.optional(),
    props: z.array(PropSchema).optional(),
    gridMinX: z.number().int().default(0),
    gridMaxX: z.number().int().default(20),
    gridMinY: z.number().int().default(0),
    gridMaxY: z.number().int().default(20),
    seed: z.string().optional(),
    endedAt: z.string().datetime().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});

export type Encounter = z.infer<typeof EncounterSchema>;
