import { GeneratedWorld } from '../../engine/worldgen/index.js';

export class WorldManager {
    private worlds: Map<string, GeneratedWorld> = new Map();

    create(id: string, world: GeneratedWorld): void {
        if (this.worlds.has(id)) {
            throw new Error(`World ${id} already exists`);
        }
        this.worlds.set(id, world);
    }

    get(id: string): GeneratedWorld | null {
        return this.worlds.get(id) || null;
    }

    delete(id: string): boolean {
        return this.worlds.delete(id);
    }

    list(): string[] {
        return Array.from(this.worlds.keys());
    }
}

// Singleton for server lifetime
let instance: WorldManager | null = null;
export function getWorldManager(): WorldManager {
    if (!instance) instance = new WorldManager();
    return instance;
}
