/**
 * POI (Point of Interest) Registry Schema
 *
 * This schema bridges the gap between:
 * - World-level Structures (cities, towns, dungeons on the world map)
 * - Room-level NodeNetworks (navigable room graphs)
 *
 * A POI links a Structure to its corresponding NodeNetwork, enabling:
 * - Click on map → enter location's room network
 * - Room discovery → reveal POI on map
 * - Hierarchical locations (dungeon → sub-levels)
 *
 * @module schema/poi
 */

import { z } from 'zod';

/**
 * POI Category for grouping and filtering
 */
export const POICategorySchema = z.enum([
    'settlement',   // Cities, towns, villages
    'fortification', // Castles, forts, towers
    'dungeon',      // Dungeons, caves, lairs
    'landmark',     // Ruins, monuments, natural wonders
    'religious',    // Temples, shrines, sacred groves
    'commercial',   // Markets, trading posts, inns
    'natural',      // Notable terrain features
    'hidden'        // Secret locations (require discovery)
]);

export type POICategory = z.infer<typeof POICategorySchema>;

/**
 * POI Discovery State
 */
export const POIDiscoveryStateSchema = z.enum([
    'unknown',      // Not yet discovered - hidden from map
    'rumored',      // Heard about but not visited - shown as "?"
    'discovered',   // Visited at least once - shown on map
    'explored',     // Fully explored - all rooms visited
    'mapped'        // Player has created detailed notes
]);

export type POIDiscoveryState = z.infer<typeof POIDiscoveryStateSchema>;

/**
 * POI Icon for map visualization
 */
export const POIIconSchema = z.enum([
    'city',
    'town',
    'village',
    'castle',
    'fort',
    'tower',
    'dungeon',
    'cave',
    'ruins',
    'temple',
    'shrine',
    'inn',
    'market',
    'mine',
    'farm',
    'camp',
    'portal',
    'monument',
    'tree',         // Notable tree (world tree, etc.)
    'mountain',     // Peak or notable mountain
    'lake',
    'waterfall',
    'bridge',
    'crossroads',
    'unknown'       // Generic "?" icon
]);

export type POIIcon = z.infer<typeof POIIconSchema>;

/**
 * POI Registry Entry
 *
 * Links a world-map structure to its room network.
 */
export const POISchema = z.object({
    id: z.string().uuid(),

    // World Map Position
    worldId: z.string().describe('World this POI belongs to'),
    regionId: z.string().optional().describe('Region containing this POI'),
    x: z.number().int().min(0).describe('World grid X coordinate'),
    y: z.number().int().min(0).describe('World grid Y coordinate'),

    // Identity
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional()
        .describe('Brief description for map tooltip'),
    category: POICategorySchema,
    icon: POIIconSchema,

    // Linked Entities
    structureId: z.string().optional()
        .describe('ID of the world-level Structure (if generated)'),
    networkId: z.string().uuid().optional()
        .describe('ID of the NodeNetwork (room graph) for this POI'),
    entranceRoomId: z.string().uuid().optional()
        .describe('ID of the entry RoomNode (where players spawn when visiting)'),

    // Discovery & Visibility
    discoveryState: POIDiscoveryStateSchema.default('unknown'),
    discoveredBy: z.array(z.string().uuid()).default([])
        .describe('Character IDs who have discovered this POI'),
    discoveryDC: z.number().int().min(0).max(30).optional()
        .describe('Perception/Investigation DC to discover if hidden'),

    // Hierarchical POIs (e.g., dungeon with sub-levels)
    parentPOIId: z.string().uuid().optional()
        .describe('Parent POI for nested locations'),
    childPOIIds: z.array(z.string().uuid()).default([])
        .describe('Child POIs (sub-levels, annexes)'),

    // Canonicalization
    isObserved: z.boolean().default(false)
        .describe('Whether this POI has been observed by players - blocks regeneration'),

    // Metadata
    population: z.number().int().min(0).default(0)
        .describe('Population for settlements'),
    level: z.number().int().min(1).max(20).optional()
        .describe('Suggested character level for dungeons'),
    tags: z.array(z.string()).default([])
        .describe('Searchable tags (e.g., "goblin", "abandoned", "haunted")'),

    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
});

export type POI = z.infer<typeof POISchema>;

/**
 * Map Layer for visualization
 * Returned to frontend for rendering
 */
export const MapLayerSchema = z.object({
    layerId: z.string(),
    layerName: z.string(),
    visible: z.boolean().default(true),
    opacity: z.number().min(0).max(1).default(1),

    // POIs in this layer
    pois: z.array(z.object({
        id: z.string(),
        x: z.number(),
        y: z.number(),
        name: z.string(),
        icon: POIIconSchema,
        category: POICategorySchema,
        discoveryState: POIDiscoveryStateSchema,
        hasNetwork: z.boolean(), // Can be entered
        population: z.number().optional()
    }))
});

export type MapLayer = z.infer<typeof MapLayerSchema>;

/**
 * Map Visualization Data
 * Complete data package for frontend map rendering
 */
export const MapVisualizationSchema = z.object({
    worldId: z.string(),
    worldName: z.string(),
    width: z.number(),
    height: z.number(),

    // Base layers (from worldgen)
    terrainLayer: z.object({
        biomes: z.array(z.string()), // Biome palette
        tiles: z.array(z.array(z.number())) // [biomeIdx, elevation, regionId, hasRiver, hasStructure]
    }),

    // Region overlay
    regions: z.array(z.object({
        id: z.number(),
        name: z.string(),
        biome: z.string(),
        capitalX: z.number(),
        capitalY: z.number(),
        color: z.string().optional()
    })),

    // POI layers
    poiLayers: z.array(MapLayerSchema),

    // Active character position (optional)
    playerPosition: z.object({
        characterId: z.string(),
        x: z.number(),
        y: z.number(),
        roomId: z.string().optional()
    }).optional(),

    // Fog of war (tiles discovered by player)
    discoveredTiles: z.array(z.string()).optional() // "x,y" format
});

export type MapVisualization = z.infer<typeof MapVisualizationSchema>;

/**
 * Helper: Get icon for a structure type
 */
export function getIconForStructureType(structureType: string): POIIcon {
    switch (structureType.toLowerCase()) {
        case 'city': return 'city';
        case 'town': return 'town';
        case 'village': return 'village';
        case 'castle': return 'castle';
        case 'ruins': return 'ruins';
        case 'dungeon': return 'dungeon';
        case 'temple': return 'temple';
        default: return 'unknown';
    }
}

/**
 * Helper: Get category for a structure type
 */
export function getCategoryForStructureType(structureType: string): POICategory {
    switch (structureType.toLowerCase()) {
        case 'city':
        case 'town':
        case 'village':
            return 'settlement';
        case 'castle':
            return 'fortification';
        case 'dungeon':
            return 'dungeon';
        case 'ruins':
            return 'landmark';
        case 'temple':
            return 'religious';
        default:
            return 'landmark';
    }
}
