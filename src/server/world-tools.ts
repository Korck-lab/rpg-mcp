/**
 * WORLD TOOLS
 *
 * MCP tools for comprehensive world data management:
 * - world_create: Create a new world
 * - world_get: Get world by ID
 * - world_list: List all worlds
 * - world_delete: Delete world (cascades to regions, tiles, structures)
 * - region_create: Create region in world
 * - region_get: Get region by ID
 * - region_list: List regions in world
 * - tile_get: Get tile at position
 * - tile_set: Update tile data
 * - tile_explore: Mark tile as explored
 * - room_create: Create room in structure
 * - room_get: Get room by ID
 * - room_update: Update room state/contents
 * - structure_create: Create structure
 * - structure_get: Get structure by ID
 *
 * @see specs/001-database-architecture/data-model.md
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getDb } from '../storage/index.js';
import { WorldRepository } from '../storage/repos/world.repo.js';
import { RegionRepository } from '../storage/repos/region.repo.js';
import { TileRepository } from '../storage/repos/tile.repo.js';
import { StructureRepository } from '../storage/repos/structure.repo.js';
import { SpatialRepository } from '../storage/repos/spatial.repo.js';
import { StructureType } from '../schema/structure.js';
import { SessionContext } from './types.js';
import { RichFormatter } from './utils/formatter.js';

// ============================================================
// Schema Definitions
// ============================================================

const RegionTypeEnum = z.enum([
  'kingdom', 'duchy', 'county', 'wilderness', 'water',
  'plains', 'forest', 'mountain', 'desert', 'city'
]);

const StructureTypeEnum = z.enum([
  'city', 'town', 'village', 'castle', 'ruins', 'dungeon', 'temple'
]);

// ============================================================
// World Tool Definitions
// ============================================================

export const WorldTools = {
  WORLD_CREATE: {
    name: 'world_create',
    description: `Create a new world with name, seed, and dimensions.

Returns the created world with its generated ID.

Example: { "name": "Forgotten Realms", "seed": "faerun123", "width": 100, "height": 100 }`,
    inputSchema: z.object({
      name: z.string().min(1).describe('World name'),
      seed: z.string().min(1).describe('Seed for procedural generation'),
      width: z.number().positive().default(100).describe('World width in tiles'),
      height: z.number().positive().default(100).describe('World height in tiles'),
      metadata: z.record(z.unknown()).optional().describe('Optional metadata for the world'),
    })
  },

  WORLD_GET: {
    name: 'world_get',
    description: `Get a world by its ID.

Returns full world data including environment settings.`,
    inputSchema: z.object({
      world_id: z.string().min(1).describe('World ID to retrieve'),
    })
  },

  WORLD_LIST: {
    name: 'world_list',
    description: `List all worlds in the database.

Returns an array of all worlds with their metadata.`,
    inputSchema: z.object({})
  },

  WORLD_DELETE: {
    name: 'world_delete',
    description: `Delete a world and all associated data (regions, tiles, structures, rooms).

WARNING: This is destructive and cannot be undone.`,
    inputSchema: z.object({
      world_id: z.string().min(1).describe('World ID to delete'),
    })
  },

  REGION_CREATE: {
    name: 'region_create',
    description: `Create a new region within a world.

Regions are geographic/political divisions of the world map.

Example: { "world_id": "w1", "name": "Sword Coast", "type": "kingdom", "center_x": 50, "center_y": 50, "color": "#4a90d9" }`,
    inputSchema: z.object({
      world_id: z.string().min(1).describe('Parent world ID'),
      name: z.string().min(1).describe('Region name'),
      type: RegionTypeEnum.describe('Region type'),
      center_x: z.number().describe('Center X coordinate'),
      center_y: z.number().describe('Center Y coordinate'),
      color: z.string().default('#888888').describe('Display color (hex)'),
      owner_nation_id: z.string().optional().describe('Optional owning nation ID'),
      control_level: z.number().int().min(0).max(100).default(0).describe('Control level 0-100'),
    })
  },

  REGION_GET: {
    name: 'region_get',
    description: `Get a region by its ID.

Returns full region data including ownership info.`,
    inputSchema: z.object({
      region_id: z.string().min(1).describe('Region ID to retrieve'),
    })
  },

  REGION_LIST: {
    name: 'region_list',
    description: `List all regions in a world.

Returns an array of regions with their metadata.`,
    inputSchema: z.object({
      world_id: z.string().min(1).describe('World ID to list regions for'),
    })
  },

  TILE_GET: {
    name: 'tile_get',
    description: `Get tile data at a specific position.

Returns biome, elevation, moisture, and temperature data.`,
    inputSchema: z.object({
      world_id: z.string().min(1).describe('World ID'),
      x: z.number().int().describe('X coordinate'),
      y: z.number().int().describe('Y coordinate'),
    })
  },

  TILE_SET: {
    name: 'tile_set',
    description: `Update tile data at a specific position.

Can modify biome, elevation, moisture, or temperature.`,
    inputSchema: z.object({
      world_id: z.string().min(1).describe('World ID'),
      x: z.number().int().describe('X coordinate'),
      y: z.number().int().describe('Y coordinate'),
      biome: z.string().optional().describe('New biome type'),
      elevation: z.number().optional().describe('New elevation'),
      moisture: z.number().min(0).max(1).optional().describe('New moisture (0-1)'),
      temperature: z.number().optional().describe('New temperature'),
    })
  },

  TILE_EXPLORE: {
    name: 'tile_explore',
    description: `Mark a tile as explored by the player.

Useful for fog-of-war mechanics.`,
    inputSchema: z.object({
      world_id: z.string().min(1).describe('World ID'),
      x: z.number().int().describe('X coordinate'),
      y: z.number().int().describe('Y coordinate'),
      explorer_id: z.string().optional().describe('ID of exploring entity'),
    })
  },

  STRUCTURE_CREATE: {
    name: 'structure_create',
    description: `Create a new structure (city, dungeon, temple, etc.) in a world.

Structures are points of interest that can contain rooms.

Example: { "world_id": "w1", "name": "Waterdeep", "type": "city", "x": 45, "y": 60, "population": 100000 }`,
    inputSchema: z.object({
      world_id: z.string().min(1).describe('World ID'),
      name: z.string().min(1).describe('Structure name'),
      type: StructureTypeEnum.describe('Structure type'),
      x: z.number().describe('X coordinate'),
      y: z.number().describe('Y coordinate'),
      population: z.number().nonnegative().default(0).describe('Population count'),
      region_id: z.string().optional().describe('Optional parent region ID'),
    })
  },

  STRUCTURE_GET: {
    name: 'structure_get',
    description: `Get a structure by its ID.

Returns full structure data including location and population.`,
    inputSchema: z.object({
      structure_id: z.string().min(1).describe('Structure ID to retrieve'),
    })
  },

  ROOM_CREATE: {
    name: 'room_create',
    description: `Create a new room within a structure or network.

Rooms are navigable spaces with descriptions, exits, and entities.

Atmospheric values: DARKNESS, FOG, ANTIMAGIC, SILENCE, BRIGHT, MAGICAL
Biome values: forest, mountain, urban, dungeon, coastal, cavern, divine, arcane

Example: { "network_id": "n1", "name": "Tavern Common Room", "description": "A warm...", "biome": "urban" }`,
    inputSchema: z.object({
      network_id: z.string().min(1).describe('Parent network ID'),
      name: z.string().min(1).describe('Room name'),
      description: z.string().min(10).describe('Base description of the room (min 10 chars)'),
      biome: z.enum(['forest', 'mountain', 'urban', 'dungeon', 'coastal', 'cavern', 'divine', 'arcane']).default('urban').describe('Biome context'),
      local_x: z.number().int().min(0).optional().describe('Local X coordinate within network'),
      local_y: z.number().int().min(0).optional().describe('Local Y coordinate within network'),
      atmospherics: z.array(z.enum(['DARKNESS', 'FOG', 'ANTIMAGIC', 'SILENCE', 'BRIGHT', 'MAGICAL'])).optional().describe('Environmental effects'),
      exits: z.array(z.object({
        direction: z.enum(['north', 'south', 'east', 'west', 'up', 'down', 'northeast', 'northwest', 'southeast', 'southwest']),
        targetNodeId: z.string().uuid(),
        type: z.enum(['OPEN', 'LOCKED', 'HIDDEN']).default('OPEN'),
        description: z.string().optional(),
        dc: z.number().int().min(5).max(30).optional(),
      })).optional().describe('Room exits'),
      entity_ids: z.array(z.string().uuid()).optional().describe('Entity IDs in the room'),
    })
  },

  ROOM_GET: {
    name: 'room_get',
    description: `Get a room by its ID.

Returns full room data including exits, entities, and atmospherics.`,
    inputSchema: z.object({
      room_id: z.string().min(1).describe('Room ID to retrieve'),
    })
  },

  ROOM_UPDATE: {
    name: 'room_update',
    description: `Update a room's state, contents, or description.

Can modify atmospherics, exits, entities, or mark as visited.

Atmospheric values: DARKNESS, FOG, ANTIMAGIC, SILENCE, BRIGHT, MAGICAL`,
    inputSchema: z.object({
      room_id: z.string().min(1).describe('Room ID to update'),
      name: z.string().optional().describe('New room name'),
      description: z.string().optional().describe('New base description'),
      atmospherics: z.array(z.enum(['DARKNESS', 'FOG', 'ANTIMAGIC', 'SILENCE', 'BRIGHT', 'MAGICAL'])).optional().describe('Replace atmospherics'),
      add_entity_ids: z.array(z.string()).optional().describe('Entity IDs to add'),
      remove_entity_ids: z.array(z.string()).optional().describe('Entity IDs to remove'),
      add_exits: z.array(z.object({
        direction: z.enum(['north', 'south', 'east', 'west', 'up', 'down', 'northeast', 'northwest', 'southeast', 'southwest']),
        targetNodeId: z.string().uuid(),
        type: z.enum(['OPEN', 'LOCKED', 'HIDDEN']).default('OPEN'),
        description: z.string().optional(),
        dc: z.number().int().min(5).max(30).optional(),
      })).optional().describe('Exits to add'),
      mark_visited: z.boolean().optional().describe('Mark the room as visited'),
    })
  },
} as const;

// ============================================================
// Helper Functions
// ============================================================

function ensureDb() {
  const db = getDb();
  const worldRepo = new WorldRepository(db);
  const regionRepo = new RegionRepository(db);
  const tileRepo = new TileRepository(db);
  const structureRepo = new StructureRepository(db);
  const spatialRepo = new SpatialRepository(db);
  return { db, worldRepo, regionRepo, tileRepo, structureRepo, spatialRepo };
}

// ============================================================
// World Tool Handlers
// ============================================================

export async function handleWorldCreate(
  args: z.infer<typeof WorldTools.WORLD_CREATE.inputSchema>,
  _ctx: SessionContext
) {
  const { worldRepo } = ensureDb();

  const now = new Date().toISOString();
  const world = {
    id: randomUUID(),
    name: args.name,
    seed: args.seed,
    width: args.width,
    height: args.height,
    createdAt: now,
    updatedAt: now,
    environment: args.metadata || {},
  };

  worldRepo.create(world);

  let output = RichFormatter.header('World Created', '');
  output += RichFormatter.keyValue({
    'ID': `\`${world.id}\``,
    'Name': world.name,
    'Seed': world.seed,
    'Dimensions': `${world.width} x ${world.height}`,
  });
  output += RichFormatter.success('World created successfully!');
  output += RichFormatter.embedJson(world, 'WORLD');

  return {
    content: [{
      type: 'text' as const,
      text: output
    }]
  };
}

export async function handleWorldGet(
  args: z.infer<typeof WorldTools.WORLD_GET.inputSchema>,
  _ctx: SessionContext
) {
  const { worldRepo } = ensureDb();

  const world = worldRepo.findById(args.world_id);
  if (!world) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: false, error: `World not found: ${args.world_id}` })
      }]
    };
  }

  let output = RichFormatter.world(world as any);
  output += RichFormatter.embedJson(world, 'WORLD');

  return {
    content: [{
      type: 'text' as const,
      text: output
    }]
  };
}

export async function handleWorldList(
  _args: z.infer<typeof WorldTools.WORLD_LIST.inputSchema>,
  _ctx: SessionContext
) {
  const { worldRepo } = ensureDb();

  const worlds = worldRepo.findAll();

  let output = RichFormatter.header('Worlds', '');
  if (worlds.length === 0) {
    output += RichFormatter.alert('No worlds found.', 'info');
  } else {
    const rows = worlds.map((w: any) => [w.name, `\`${w.id}\``, w.seed || '-']);
    output += RichFormatter.table(['Name', 'ID', 'Seed'], rows);
    output += `\n*${worlds.length} world(s) total*\n`;
  }
  output += RichFormatter.embedJson({ worlds, count: worlds.length }, 'WORLDS');

  return {
    content: [{
      type: 'text' as const,
      text: output
    }]
  };
}

export async function handleWorldDelete(
  args: z.infer<typeof WorldTools.WORLD_DELETE.inputSchema>,
  _ctx: SessionContext
) {
  const { db, worldRepo, tileRepo, structureRepo } = ensureDb();

  // Check world exists
  const world = worldRepo.findById(args.world_id);
  if (!world) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: false, error: `World not found: ${args.world_id}` })
      }]
    };
  }

  // Cascade delete
  const tilesDeleted = tileRepo.deleteByWorldId(args.world_id);
  const structuresDeleted = structureRepo.deleteByWorldId(args.world_id);

  // Delete regions (no direct cascade method, use raw SQL)
  const regionsDeleted = db.prepare('DELETE FROM regions WHERE world_id = ?').run(args.world_id).changes;

  // Delete rooms in any networks belonging to this world
  db.prepare('DELETE FROM room_nodes WHERE network_id IN (SELECT id FROM node_networks WHERE world_id = ?)').run(args.world_id);
  const networksDeleted = db.prepare('DELETE FROM node_networks WHERE world_id = ?').run(args.world_id).changes;

  // Finally delete the world
  worldRepo.delete(args.world_id);

  let output = RichFormatter.header('World Deleted', '');
  output += RichFormatter.keyValue({
    'World ID': `\`${args.world_id}\``,
    'Regions Deleted': regionsDeleted,
    'Tiles Deleted': tilesDeleted,
    'Structures Deleted': structuresDeleted,
    'Networks Deleted': networksDeleted,
  });
  output += RichFormatter.success('World and all associated data deleted.');

  return {
    content: [{
      type: 'text' as const,
      text: output
    }]
  };
}

// ============================================================
// Region Tool Handlers
// ============================================================

export async function handleRegionCreate(
  args: z.infer<typeof WorldTools.REGION_CREATE.inputSchema>,
  _ctx: SessionContext
) {
  const { regionRepo } = ensureDb();

  const now = new Date().toISOString();
  const region = {
    id: randomUUID(),
    worldId: args.world_id,
    name: args.name,
    type: args.type,
    centerX: args.center_x,
    centerY: args.center_y,
    color: args.color,
    ownerNationId: args.owner_nation_id || null,
    controlLevel: args.control_level,
    createdAt: now,
    updatedAt: now,
  };

  regionRepo.create(region);

  let output = RichFormatter.header('Region Created', '');
  output += RichFormatter.keyValue({
    'ID': `\`${region.id}\``,
    'Name': region.name,
    'Type': region.type,
    'Center': `(${region.centerX}, ${region.centerY})`,
  });
  output += RichFormatter.success('Region created successfully!');
  output += RichFormatter.embedJson(region, 'REGION');

  return {
    content: [{
      type: 'text' as const,
      text: output
    }]
  };
}

export async function handleRegionGet(
  args: z.infer<typeof WorldTools.REGION_GET.inputSchema>,
  _ctx: SessionContext
) {
  const { regionRepo } = ensureDb();

  const region = regionRepo.findById(args.region_id);
  if (!region) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: false, error: `Region not found: ${args.region_id}` })
      }]
    };
  }

  let output = RichFormatter.header(`Region: ${region.name}`, '');
  output += RichFormatter.keyValue({
    'ID': `\`${region.id}\``,
    'World ID': `\`${region.worldId}\``,
    'Type': region.type,
    'Center': `(${region.centerX}, ${region.centerY})`,
    'Control Level': `${region.controlLevel}%`,
  });
  output += RichFormatter.embedJson(region, 'REGION');

  return {
    content: [{
      type: 'text' as const,
      text: output
    }]
  };
}

export async function handleRegionList(
  args: z.infer<typeof WorldTools.REGION_LIST.inputSchema>,
  _ctx: SessionContext
) {
  const { regionRepo } = ensureDb();

  const regions = regionRepo.findByWorldId(args.world_id);

  let output = RichFormatter.header('Regions', '');
  if (regions.length === 0) {
    output += RichFormatter.alert('No regions found.', 'info');
  } else {
    const rows = regions.map((r: any) => [r.name, r.type, `(${r.centerX}, ${r.centerY})`, `\`${r.id}\``]);
    output += RichFormatter.table(['Name', 'Type', 'Center', 'ID'], rows);
    output += `\n*${regions.length} region(s) total*\n`;
  }
  output += RichFormatter.embedJson({ regions, count: regions.length }, 'REGIONS');

  return {
    content: [{
      type: 'text' as const,
      text: output
    }]
  };
}

// ============================================================
// Tile Tool Handlers
// ============================================================

export async function handleTileGet(
  args: z.infer<typeof WorldTools.TILE_GET.inputSchema>,
  _ctx: SessionContext
) {
  const { tileRepo } = ensureDb();

  const tile = tileRepo.findByCoordinates(args.world_id, args.x, args.y);
  if (!tile) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: false, error: `Tile not found at (${args.x}, ${args.y})` })
      }]
    };
  }

  let output = RichFormatter.header(`Tile (${args.x}, ${args.y})`, '');
  output += RichFormatter.keyValue({
    'Biome': tile.biome,
    'Elevation': tile.elevation,
    'Moisture': tile.moisture.toFixed(2),
    'Temperature': tile.temperature,
  });
  output += RichFormatter.embedJson(tile, 'TILE');

  return {
    content: [{
      type: 'text' as const,
      text: output
    }]
  };
}

export async function handleTileSet(
  args: z.infer<typeof WorldTools.TILE_SET.inputSchema>,
  _ctx: SessionContext
) {
  const { db, tileRepo } = ensureDb();

  // Check if tile exists
  const existing = tileRepo.findByCoordinates(args.world_id, args.x, args.y);
  if (!existing) {
    // Create new tile
    const newTile = {
      id: `tile-${args.world_id}-${args.x}-${args.y}`,
      worldId: args.world_id,
      x: args.x,
      y: args.y,
      biome: args.biome || 'unknown',
      elevation: args.elevation ?? 0,
      moisture: args.moisture ?? 0.5,
      temperature: args.temperature ?? 15,
    };
    tileRepo.create(newTile);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: true, created: true, tile: newTile })
      }]
    };
  }

  // Update existing tile
  const updates: string[] = [];
  const params: any[] = [];

  if (args.biome !== undefined) {
    updates.push('biome = ?');
    params.push(args.biome);
  }
  if (args.elevation !== undefined) {
    updates.push('elevation = ?');
    params.push(args.elevation);
  }
  if (args.moisture !== undefined) {
    updates.push('moisture = ?');
    params.push(args.moisture);
  }
  if (args.temperature !== undefined) {
    updates.push('temperature = ?');
    params.push(args.temperature);
  }

  if (updates.length === 0) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: false, error: 'No updates provided' })
      }]
    };
  }

  params.push(existing.id);
  db.prepare(`UPDATE tiles SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = tileRepo.findByCoordinates(args.world_id, args.x, args.y);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ success: true, updated: true, tile: updated })
    }]
  };
}

export async function handleTileExplore(
  args: z.infer<typeof WorldTools.TILE_EXPLORE.inputSchema>,
  _ctx: SessionContext
) {
  const { tileRepo } = ensureDb();

  const tile = tileRepo.findByCoordinates(args.world_id, args.x, args.y);
  if (!tile) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: false, error: `Tile not found at (${args.x}, ${args.y})` })
      }]
    };
  }

  // For now, we just return success - exploration tracking would be in a separate table
  // This is a placeholder for future fog-of-war implementation
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        success: true,
        tile,
        explored: true,
        explorer_id: args.explorer_id || null,
      })
    }]
  };
}

// ============================================================
// Structure Tool Handlers
// ============================================================

export async function handleStructureCreate(
  args: z.infer<typeof WorldTools.STRUCTURE_CREATE.inputSchema>,
  _ctx: SessionContext
) {
  const { structureRepo } = ensureDb();

  const now = new Date().toISOString();
  const structure = {
    id: randomUUID(),
    worldId: args.world_id,
    regionId: args.region_id,
    name: args.name,
    type: args.type as StructureType,
    x: args.x,
    y: args.y,
    population: args.population,
    createdAt: now,
    updatedAt: now,
  };

  structureRepo.create(structure);

  let output = RichFormatter.header('Structure Created', '');
  output += RichFormatter.keyValue({
    'ID': `\`${structure.id}\``,
    'Name': structure.name,
    'Type': structure.type,
    'Location': `(${structure.x}, ${structure.y})`,
    'Population': structure.population,
  });
  output += RichFormatter.success('Structure created successfully!');
  output += RichFormatter.embedJson(structure, 'STRUCTURE');

  return {
    content: [{
      type: 'text' as const,
      text: output
    }]
  };
}

export async function handleStructureGet(
  args: z.infer<typeof WorldTools.STRUCTURE_GET.inputSchema>,
  _ctx: SessionContext
) {
  const { structureRepo } = ensureDb();

  const structure = structureRepo.findById(args.structure_id);
  if (!structure) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: false, error: `Structure not found: ${args.structure_id}` })
      }]
    };
  }

  let output = RichFormatter.header(`Structure: ${structure.name}`, '');
  output += RichFormatter.keyValue({
    'ID': `\`${structure.id}\``,
    'World ID': `\`${structure.worldId}\``,
    'Type': structure.type,
    'Location': `(${structure.x}, ${structure.y})`,
    'Population': structure.population,
  });
  output += RichFormatter.embedJson(structure, 'STRUCTURE');

  return {
    content: [{
      type: 'text' as const,
      text: output
    }]
  };
}

// ============================================================
// Room Tool Handlers
// ============================================================

export async function handleRoomCreate(
  args: z.infer<typeof WorldTools.ROOM_CREATE.inputSchema>,
  _ctx: SessionContext
) {
  const { spatialRepo } = ensureDb();

  const now = new Date().toISOString();
  const room = {
    id: randomUUID(),
    name: args.name,
    baseDescription: args.description,
    biomeContext: args.biome,
    atmospherics: args.atmospherics || [],
    exits: args.exits || [],
    entityIds: args.entity_ids || [],
    createdAt: now,
    updatedAt: now,
    visitedCount: 0,
    lastVisitedAt: undefined,
    networkId: args.network_id,
    localX: args.local_x,
    localY: args.local_y,
  };

  spatialRepo.create(room);

  let output = RichFormatter.header('Room Created', '');
  output += RichFormatter.keyValue({
    'ID': `\`${room.id}\``,
    'Name': room.name,
    'Network ID': `\`${room.networkId}\``,
    'Biome': room.biomeContext,
  });
  output += RichFormatter.success('Room created successfully!');
  output += RichFormatter.embedJson(room, 'ROOM');

  return {
    content: [{
      type: 'text' as const,
      text: output
    }]
  };
}

export async function handleRoomGet(
  args: z.infer<typeof WorldTools.ROOM_GET.inputSchema>,
  _ctx: SessionContext
) {
  const { spatialRepo } = ensureDb();

  const room = spatialRepo.findById(args.room_id);
  if (!room) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: false, error: `Room not found: ${args.room_id}` })
      }]
    };
  }

  let output = RichFormatter.header(`Room: ${room.name}`, '');
  output += RichFormatter.keyValue({
    'ID': `\`${room.id}\``,
    'Biome': room.biomeContext,
    'Visited': room.visitedCount,
    'Exits': room.exits.length,
    'Entities': room.entityIds.length,
  });
  output += `\n**Description:** ${room.baseDescription}\n`;
  output += RichFormatter.embedJson(room, 'ROOM');

  return {
    content: [{
      type: 'text' as const,
      text: output
    }]
  };
}

export async function handleRoomUpdate(
  args: z.infer<typeof WorldTools.ROOM_UPDATE.inputSchema>,
  _ctx: SessionContext
) {
  const { spatialRepo } = ensureDb();

  const existing = spatialRepo.findById(args.room_id);
  if (!existing) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: false, error: `Room not found: ${args.room_id}` })
      }]
    };
  }

  const updates: Partial<typeof existing> = {};

  if (args.name !== undefined) {
    updates.name = args.name;
  }
  if (args.description !== undefined) {
    updates.baseDescription = args.description;
  }
  if (args.atmospherics !== undefined) {
    updates.atmospherics = args.atmospherics;
  }

  // Handle entity modifications
  let entityIds = [...existing.entityIds];
  if (args.add_entity_ids) {
    for (const id of args.add_entity_ids) {
      if (!entityIds.includes(id)) {
        entityIds.push(id);
      }
    }
  }
  if (args.remove_entity_ids) {
    entityIds = entityIds.filter(id => !args.remove_entity_ids!.includes(id));
  }
  if (args.add_entity_ids || args.remove_entity_ids) {
    updates.entityIds = entityIds;
  }

  // Handle exit additions - convert input exits to full exit schema
  if (args.add_exits) {
    const newExits = args.add_exits.map(exit => ({
      ...exit,
      type: exit.type || 'OPEN' as const,
      difficulty: exit.dc,
    }));
    updates.exits = [...existing.exits, ...newExits];
  }

  // Handle visit marking
  if (args.mark_visited) {
    updates.visitedCount = existing.visitedCount + 1;
    updates.lastVisitedAt = new Date().toISOString();
  }

  const updated = spatialRepo.update(args.room_id, updates);

  let output = RichFormatter.header('Room Updated', '');
  output += RichFormatter.success(`Room ${args.room_id} updated successfully.`);
  output += RichFormatter.embedJson(updated, 'ROOM');

  return {
    content: [{
      type: 'text' as const,
      text: output
    }]
  };
}
