import { z } from 'zod';

/**
 * Biome type enumeration
 */
export enum BiomeType {
  // Water biomes
  OCEAN = 'ocean',
  DEEP_OCEAN = 'deep_ocean',
  LAKE = 'lake',
  CORAL_REEF = 'coral_reef',

  // Hot biomes
  DESERT = 'hot_desert',
  SAVANNA = 'savanna',
  RAINFOREST = 'tropical_rainforest',
  VOLCANIC = 'volcanic',

  // Temperate biomes
  GRASSLAND = 'grassland',
  FOREST = 'temperate_deciduous_forest',
  SWAMP = 'swamp',
  MOUNTAIN = 'mountain',

  // Cold biomes
  TAIGA = 'taiga',
  TUNDRA = 'tundra',
  GLACIER = 'glacier',
  ICE_SHELF = 'ice_shelf',
}

export const BiomeSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  temperatureMin: z.number(),
  temperatureMax: z.number(),
  moistureMin: z.number().min(0).max(1),
  moistureMax: z.number().min(0).max(1),
  elevationMin: z.number(),
  elevationMax: z.number(),
});

export type Biome = z.infer<typeof BiomeSchema>;
