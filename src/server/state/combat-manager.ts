import { CombatEngine } from '../../engine/combat/engine.js';

export class CombatManager {
    private encounters: Map<string, CombatEngine> = new Map();

    create(id: string, engine: CombatEngine): void {
        if (this.encounters.has(id)) {
            throw new Error(`Encounter ${id} already exists`);
        }
        this.encounters.set(id, engine);
    }

    get(id: string): CombatEngine | null {
        return this.encounters.get(id) || null;
    }

    delete(id: string): boolean {
        return this.encounters.delete(id);
    }

    list(): string[] {
        return Array.from(this.encounters.keys());
    }
}

// Singleton for server lifetime
let instance: CombatManager | null = null;
export function getCombatManager(): CombatManager {
    if (!instance) instance = new CombatManager();
    return instance;
}
