import { GeneratedWorld } from '../worldgen/index.js';
import { PatchCommand, CommandType } from './schema.js';
import { validateStructurePlacement, getSuggestedBiomesForStructure } from '../worldgen/validation.js';
import { StructureType } from '../../schema/structure.js';

export interface PatchResult {
    success: boolean;
    commandsExecuted: number;
    errors: PatchError[];
    warnings: PatchWarning[];
}

export interface PatchError {
    command: string;
    message: string;
    location?: { x: number; y: number };
}

export interface PatchWarning {
    command: string;
    message: string;
}

/**
 * Options for patch application
 */
export interface PatchOptions {
    /** If true, skip invalid commands instead of failing. Default: false */
    skipInvalid?: boolean;
    /** If true, validate but don't apply. Default: false */
    dryRun?: boolean;
}

/**
 * Applies a list of patch commands to a generated world.
 * Mutates the world object in place for performance.
 * 
 * @returns PatchResult with success status and any errors/warnings
 */
export function applyPatch(
    world: GeneratedWorld, 
    commands: PatchCommand[],
    options: PatchOptions = {}
): PatchResult {
    const { skipInvalid = false, dryRun = false } = options;
    const result: PatchResult = {
        success: true,
        commandsExecuted: 0,
        errors: [],
        warnings: []
    };

    for (const command of commands) {
        const cmdResult = validateAndApplyCommand(world, command, dryRun);
        
        if (cmdResult.error) {
            result.errors.push(cmdResult.error);
            if (!skipInvalid) {
                result.success = false;
                break; // Stop on first error unless skipInvalid
            }
        } else {
            result.commandsExecuted++;
        }
        
        if (cmdResult.warning) {
            result.warnings.push(cmdResult.warning);
        }
    }

    return result;
}

interface CommandResult {
    error?: PatchError;
    warning?: PatchWarning;
}

function validateAndApplyCommand(
    world: GeneratedWorld, 
    command: PatchCommand,
    dryRun: boolean
): CommandResult {
    switch (command.command) {
        case CommandType.ADD_STRUCTURE: {
            const { type, x, y, name } = command.args;
            
            // Validate structure placement
            const validation = validateStructurePlacement(
                type as StructureType,
                x,
                y,
                world
            );
            
            if (!validation.valid) {
                const suggestedBiomes = getSuggestedBiomesForStructure(type as StructureType);
                return {
                    error: {
                        command: `ADD_STRUCTURE ${type} ${x} ${y}`,
                        message: `${validation.reason}. Suggested biomes for ${type}: ${suggestedBiomes.join(', ')}`,
                        location: { x, y }
                    }
                };
            }
            
            if (!dryRun) {
                world.structures.push({
                    type,
                    location: { x, y },
                    name,
                    score: 100 // Manual placement gets max score
                });
            }
            
            return {};
        }

        case CommandType.SET_BIOME: {
            const { x, y, type } = command.args;
            if (!isValidCoordinate(world, x, y)) {
                return {
                    error: {
                        command: `SET_BIOME ${type} ${x} ${y}`,
                        message: `Coordinates (${x}, ${y}) are out of bounds`,
                        location: { x, y }
                    }
                };
            }
            
            if (!dryRun) {
                world.biomes[y][x] = type;
            }
            return {};
        }

        case CommandType.EDIT_TILE: {
            const { x, y, elevation, moisture, temperature } = command.args;
            if (!isValidCoordinate(world, x, y)) {
                return {
                    error: {
                        command: `EDIT_TILE ${x} ${y}`,
                        message: `Coordinates (${x}, ${y}) are out of bounds`,
                        location: { x, y }
                    }
                };
            }
            
            if (!dryRun) {
                const idx = y * world.width + x;
                if (elevation !== undefined) world.elevation[idx] = elevation;
                if (moisture !== undefined) world.moisture[idx] = moisture;
                if (temperature !== undefined) world.temperature[idx] = temperature;
            }
            return {};
        }

        case CommandType.MOVE_STRUCTURE: {
            const { id, x, y } = command.args;
            const structure = world.structures.find(s => s.name === id);
            
            if (!structure) {
                return {
                    error: {
                        command: `MOVE_STRUCTURE ${id} ${x} ${y}`,
                        message: `Structure not found: ${id}`,
                        location: { x, y }
                    }
                };
            }
            
            // Validate new location
            const validation = validateStructurePlacement(
                structure.type as StructureType,
                x,
                y,
                world
            );
            
            if (!validation.valid) {
                return {
                    error: {
                        command: `MOVE_STRUCTURE ${id} ${x} ${y}`,
                        message: validation.reason!,
                        location: { x, y }
                    }
                };
            }
            
            if (!dryRun) {
                structure.location = { x, y };
            }
            return {};
        }

        case CommandType.ADD_ROAD:
        case CommandType.ADD_ANNOTATION:
            return {
                warning: {
                    command: command.command,
                    message: `Command ${command.command} is not yet implemented`
                }
            };
    }
    
    // This should never be reached due to exhaustive switch
    // but satisfies TypeScript's control flow analysis
    return {};
}

function isValidCoordinate(world: GeneratedWorld, x: number, y: number): boolean {
    return x >= 0 && x < world.width && y >= 0 && y < world.height;
}
