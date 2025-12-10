/**
 * Encounter Presets - Pre-configured combat scenarios
 *
 * These reduce token overhead by ~95% compared to manual specification.
 * An LLM can spawn a full encounter with just: { preset: "goblin_ambush" }
 *
 * Usage:
 *   getEncounterPreset('goblin_ambush') -> full encounter config
 *   scaleEncounter(preset, partyLevel, partySize) -> adjusted for difficulty
 *
 * @module data/encounter-presets
 */

/**
 * Participant in an encounter preset
 */
export interface EncounterParticipant {
    template: string;       // Creature template (e.g., "goblin:archer")
    name?: string;          // Optional name override
    position: string;       // Position shorthand "x,y"
    count?: number;         // Number of this creature (default 1)
}

/**
 * Terrain configuration for an encounter
 */
export interface EncounterTerrain {
    obstacles?: string[];           // Blocking terrain "x,y"
    difficultTerrain?: string[];    // Half-speed terrain
    water?: string[];               // Water tiles
    cover?: string[];               // Half cover positions
}

/**
 * Complete encounter preset
 */
export interface EncounterPreset {
    id: string;
    name: string;
    description: string;
    difficulty: 'easy' | 'medium' | 'hard' | 'deadly';
    recommendedLevel: { min: number; max: number };
    participants: EncounterParticipant[];
    terrain?: EncounterTerrain;
    partyPositions?: string[];      // Suggested starting positions
    tags: string[];                 // Searchable tags
    narrativeHook?: string;         // DM prompt for roleplay
}

// ═══════════════════════════════════════════════════════════════════════════
// GOBLINOID ENCOUNTERS
// ═══════════════════════════════════════════════════════════════════════════

export const ENCOUNTER_PRESETS: Record<string, EncounterPreset> = {
    goblin_ambush: {
        id: 'goblin_ambush',
        name: 'Goblin Ambush',
        description: 'A group of goblins attacks from hiding, with archers providing cover fire.',
        difficulty: 'easy',
        recommendedLevel: { min: 1, max: 3 },
        participants: [
            { template: 'goblin:warrior', position: '5,8' },
            { template: 'goblin:warrior', position: '7,8' },
            { template: 'goblin:archer', position: '4,4' },
            { template: 'goblin:archer', position: '8,4' },
        ],
        terrain: {
            obstacles: ['3,3', '3,4', '9,3', '9,4'],  // Rocks for archer cover
            difficultTerrain: ['5,6', '6,6', '7,6'], // Underbrush
        },
        partyPositions: ['6,12', '7,12', '5,13', '8,13'],
        tags: ['goblin', 'ambush', 'forest', 'road'],
        narrativeHook: 'Rustling in the bushes... then arrows fly from the treeline!'
    },

    goblin_lair: {
        id: 'goblin_lair',
        name: 'Goblin Lair',
        description: 'The party discovers a goblin hideout with a boss and his minions.',
        difficulty: 'medium',
        recommendedLevel: { min: 1, max: 4 },
        participants: [
            { template: 'goblin:boss', name: 'Griknak the Cruel', position: '10,3' },
            { template: 'goblin:warrior', position: '8,5' },
            { template: 'goblin:warrior', position: '12,5' },
            { template: 'goblin:shaman', position: '10,2' },
            { template: 'goblin:archer', position: '6,3' },
            { template: 'goblin:archer', position: '14,3' },
        ],
        terrain: {
            obstacles: ['5,0', '5,1', '5,2', '15,0', '15,1', '15,2'],  // Cave walls
            difficultTerrain: ['9,4', '10,4', '11,4'],  // Debris
        },
        partyPositions: ['10,10', '9,11', '11,11', '10,12'],
        tags: ['goblin', 'lair', 'cave', 'boss'],
        narrativeHook: 'The stench of goblins fills the cave. Their leader sits on a crude throne of bones.'
    },

    hobgoblin_patrol: {
        id: 'hobgoblin_patrol',
        name: 'Hobgoblin Patrol',
        description: 'A disciplined hobgoblin patrol with a captain leading warriors.',
        difficulty: 'medium',
        recommendedLevel: { min: 2, max: 5 },
        participants: [
            { template: 'hobgoblin:captain', name: 'Sergeant Korgath', position: '10,5' },
            { template: 'hobgoblin:warrior', position: '8,6' },
            { template: 'hobgoblin:warrior', position: '12,6' },
            { template: 'hobgoblin:warrior', position: '9,7' },
            { template: 'hobgoblin:warrior', position: '11,7' },
            { template: 'hobgoblin:archer', position: '10,3' },
        ],
        terrain: {
            obstacles: ['5,5', '15,5'],  // Road markers/posts
        },
        partyPositions: ['10,12', '9,13', '11,13', '10,14'],
        tags: ['hobgoblin', 'patrol', 'road', 'military'],
        narrativeHook: 'The marching boots of hobgoblins echo down the road. Their captain barks orders.'
    },

    bugbear_ambush: {
        id: 'bugbear_ambush',
        name: 'Bugbear Ambush',
        description: 'Bugbears strike from surprise with devastating first hits.',
        difficulty: 'hard',
        recommendedLevel: { min: 2, max: 5 },
        participants: [
            { template: 'bugbear', name: 'Skullcrusher', position: '5,5' },
            { template: 'bugbear', position: '8,4' },
            { template: 'bugbear', position: '11,5' },
            { template: 'goblin:warrior', position: '7,8' },
            { template: 'goblin:warrior', position: '9,8' },
        ],
        terrain: {
            obstacles: ['4,3', '5,3', '10,3', '11,3'],  // Boulders
            difficultTerrain: ['6,6', '7,6', '8,6', '9,6', '10,6'],  // Thick brush
        },
        partyPositions: ['8,12', '7,13', '9,13', '8,14'],
        tags: ['bugbear', 'goblin', 'ambush', 'surprise', 'forest'],
        narrativeHook: 'Massive shapes burst from hiding! The bugbears\' first strikes are devastating.'
    },

    // ═══════════════════════════════════════════════════════════════════════
    // ORC ENCOUNTERS
    // ═══════════════════════════════════════════════════════════════════════

    orc_raiding_party: {
        id: 'orc_raiding_party',
        name: 'Orc Raiding Party',
        description: 'Aggressive orcs looking for plunder and violence.',
        difficulty: 'medium',
        recommendedLevel: { min: 2, max: 5 },
        participants: [
            { template: 'orc:warrior', position: '6,6' },
            { template: 'orc:warrior', position: '8,6' },
            { template: 'orc:warrior', position: '10,6' },
            { template: 'orc:berserker', name: 'Gromm Bloodrage', position: '8,4' },
        ],
        terrain: {
            difficultTerrain: ['7,8', '8,8', '9,8'],  // Churned ground
        },
        partyPositions: ['8,12', '7,13', '9,13', '8,14'],
        tags: ['orc', 'raid', 'aggressive', 'open'],
        narrativeHook: 'WAAAGH! The orcs charge with reckless fury!'
    },

    orc_warband: {
        id: 'orc_warband',
        name: 'Orc Warband',
        description: 'A full orc warband with a war chief leading the charge.',
        difficulty: 'deadly',
        recommendedLevel: { min: 3, max: 6 },
        participants: [
            { template: 'orc:warleader', name: 'Warchief Gorgul', position: '10,4' },
            { template: 'orc:berserker', position: '8,5' },
            { template: 'orc:berserker', position: '12,5' },
            { template: 'orc:warrior', position: '7,6' },
            { template: 'orc:warrior', position: '9,6' },
            { template: 'orc:warrior', position: '11,6' },
            { template: 'orc:warrior', position: '13,6' },
        ],
        terrain: {
            obstacles: ['5,4', '5,5', '15,4', '15,5'],  // War banners/totems
            difficultTerrain: ['8,8', '9,8', '10,8', '11,8', '12,8'],
        },
        partyPositions: ['10,12', '8,13', '12,13', '10,14'],
        tags: ['orc', 'warband', 'boss', 'deadly'],
        narrativeHook: 'The Warchief raises his bloody greataxe. His warriors roar in response!'
    },

    // ═══════════════════════════════════════════════════════════════════════
    // UNDEAD ENCOUNTERS
    // ═══════════════════════════════════════════════════════════════════════

    skeleton_patrol: {
        id: 'skeleton_patrol',
        name: 'Skeleton Patrol',
        description: 'Animated skeletons guarding ancient ruins.',
        difficulty: 'easy',
        recommendedLevel: { min: 1, max: 3 },
        participants: [
            { template: 'skeleton:warrior', position: '6,6' },
            { template: 'skeleton:warrior', position: '10,6' },
            { template: 'skeleton:archer', position: '5,4' },
            { template: 'skeleton:archer', position: '11,4' },
        ],
        terrain: {
            obstacles: ['4,3', '5,3', '11,3', '12,3'],  // Broken pillars
            difficultTerrain: ['7,5', '8,5', '9,5'],  // Rubble
        },
        partyPositions: ['8,12', '7,13', '9,13', '8,14'],
        tags: ['skeleton', 'undead', 'ruins', 'patrol'],
        narrativeHook: 'Bones rattle as the skeletons turn their empty eye sockets toward you.'
    },

    zombie_horde: {
        id: 'zombie_horde',
        name: 'Zombie Horde',
        description: 'A shambling mass of undead slowly closing in.',
        difficulty: 'medium',
        recommendedLevel: { min: 1, max: 4 },
        participants: [
            { template: 'zombie', position: '6,5' },
            { template: 'zombie', position: '8,5' },
            { template: 'zombie', position: '10,5' },
            { template: 'zombie', position: '7,6' },
            { template: 'zombie', position: '9,6' },
            { template: 'zombie:brute', name: 'Hulking Corpse', position: '8,4' },
        ],
        terrain: {
            difficultTerrain: ['6,7', '7,7', '8,7', '9,7', '10,7'],  // Graveyard mud
        },
        partyPositions: ['8,12', '6,13', '10,13', '8,14'],
        tags: ['zombie', 'undead', 'horde', 'graveyard'],
        narrativeHook: 'The dead rise from their graves, moaning hungrily...'
    },

    crypt_guardians: {
        id: 'crypt_guardians',
        name: 'Crypt Guardians',
        description: 'Powerful undead defending an ancient tomb.',
        difficulty: 'hard',
        recommendedLevel: { min: 3, max: 6 },
        participants: [
            { template: 'wight', name: 'Tomb Warden', position: '10,3' },
            { template: 'ghoul', position: '7,5' },
            { template: 'ghoul', position: '13,5' },
            { template: 'skeleton:warrior', position: '8,6' },
            { template: 'skeleton:warrior', position: '12,6' },
            { template: 'skeleton:mage', position: '10,4' },
        ],
        terrain: {
            obstacles: ['5,2', '5,3', '15,2', '15,3'],  // Sarcophagi
            difficultTerrain: ['9,5', '10,5', '11,5'],  // Ancient dust
        },
        partyPositions: ['10,10', '8,11', '12,11', '10,12'],
        tags: ['wight', 'ghoul', 'skeleton', 'undead', 'crypt', 'boss'],
        narrativeHook: 'Cold air emanates from the Tomb Warden as it draws its blackened blade.'
    },

    // ═══════════════════════════════════════════════════════════════════════
    // BEAST ENCOUNTERS
    // ═══════════════════════════════════════════════════════════════════════

    wolf_pack: {
        id: 'wolf_pack',
        name: 'Wolf Pack',
        description: 'A pack of hungry wolves with their alpha.',
        difficulty: 'easy',
        recommendedLevel: { min: 1, max: 3 },
        participants: [
            { template: 'wolf:alpha', name: 'Alpha', position: '8,5' },
            { template: 'wolf', position: '6,6' },
            { template: 'wolf', position: '10,6' },
            { template: 'wolf', position: '7,7' },
            { template: 'wolf', position: '9,7' },
        ],
        terrain: {
            obstacles: ['4,4', '12,4'],  // Trees
            difficultTerrain: ['5,6', '6,6', '10,6', '11,6'],  // Underbrush
        },
        partyPositions: ['8,12', '7,13', '9,13', '8,14'],
        tags: ['wolf', 'beast', 'pack', 'forest', 'wilderness'],
        narrativeHook: 'Yellow eyes gleam in the darkness. The pack has found its prey.'
    },

    spider_nest: {
        id: 'spider_nest',
        name: 'Spider Nest',
        description: 'Giant spiders lurking in webbed terrain.',
        difficulty: 'medium',
        recommendedLevel: { min: 2, max: 5 },
        participants: [
            { template: 'giant_spider', position: '8,4' },
            { template: 'giant_spider', position: '10,6' },
            { template: 'giant_spider', position: '6,6' },
        ],
        terrain: {
            difficultTerrain: [
                '5,3', '6,3', '7,3', '8,3', '9,3', '10,3', '11,3',
                '5,4', '6,4', '10,4', '11,4',
                '5,5', '11,5',
            ],  // Web coverage
            obstacles: ['4,2', '12,2'],  // Cocooned victims
        },
        partyPositions: ['8,10', '7,11', '9,11', '8,12'],
        tags: ['spider', 'beast', 'cave', 'dungeon', 'web'],
        narrativeHook: 'Webs cover everything. Something large moves in the darkness above...'
    },

    owlbear_territory: {
        id: 'owlbear_territory',
        name: 'Owlbear Territory',
        description: 'The party stumbles into an owlbear\'s hunting ground.',
        difficulty: 'hard',
        recommendedLevel: { min: 3, max: 5 },
        participants: [
            { template: 'owlbear', name: 'Razorfeather', position: '8,5' },
        ],
        terrain: {
            obstacles: ['4,3', '5,3', '11,3', '12,3'],  // Dense trees
            difficultTerrain: ['6,6', '7,6', '8,6', '9,6', '10,6'],  // Thick underbrush
        },
        partyPositions: ['8,12', '7,13', '9,13', '8,14'],
        tags: ['owlbear', 'beast', 'solo', 'forest'],
        narrativeHook: 'A terrifying screech echoes through the trees. The owlbear charges!'
    },

    // ═══════════════════════════════════════════════════════════════════════
    // BANDIT ENCOUNTERS
    // ═══════════════════════════════════════════════════════════════════════

    bandit_roadblock: {
        id: 'bandit_roadblock',
        name: 'Bandit Roadblock',
        description: 'Bandits demand toll or threaten violence.',
        difficulty: 'easy',
        recommendedLevel: { min: 1, max: 3 },
        participants: [
            { template: 'bandit', position: '7,6' },
            { template: 'bandit', position: '9,6' },
            { template: 'bandit:thug', name: 'Big Marcus', position: '8,5' },
            { template: 'bandit:archer', position: '5,4' },
            { template: 'bandit:archer', position: '11,4' },
        ],
        terrain: {
            obstacles: ['6,7', '7,7', '9,7', '10,7'],  // Overturned cart
        },
        partyPositions: ['8,12', '7,13', '9,13', '8,14'],
        tags: ['bandit', 'road', 'robbery', 'human'],
        narrativeHook: '"Your gold or your life!" A scarred thug steps forward, cracking his knuckles.'
    },

    bandit_camp: {
        id: 'bandit_camp',
        name: 'Bandit Camp',
        description: 'Raiding a bandit encampment with their captain.',
        difficulty: 'medium',
        recommendedLevel: { min: 2, max: 5 },
        participants: [
            { template: 'bandit_captain', name: 'Captain Redhand', position: '10,3' },
            { template: 'bandit:thug', position: '8,5' },
            { template: 'bandit:thug', position: '12,5' },
            { template: 'bandit', position: '7,6' },
            { template: 'bandit', position: '9,6' },
            { template: 'bandit', position: '11,6' },
            { template: 'bandit:archer', position: '6,4' },
            { template: 'bandit:archer', position: '14,4' },
        ],
        terrain: {
            obstacles: ['5,2', '5,3', '15,2', '15,3'],  // Tents
            difficultTerrain: ['8,4', '9,4', '10,4', '11,4', '12,4'],  // Camp debris
        },
        partyPositions: ['10,12', '8,13', '12,13', '10,14'],
        tags: ['bandit', 'camp', 'boss', 'raid'],
        narrativeHook: 'Captain Redhand draws twin blades. "Kill them all! Leave no witnesses!"'
    },

    // ═══════════════════════════════════════════════════════════════════════
    // TAVERN/URBAN ENCOUNTERS
    // ═══════════════════════════════════════════════════════════════════════

    tavern_brawl: {
        id: 'tavern_brawl',
        name: 'Tavern Brawl',
        description: 'A bar fight escalates into a full combat.',
        difficulty: 'easy',
        recommendedLevel: { min: 1, max: 3 },
        participants: [
            { template: 'thug', position: '6,6' },
            { template: 'thug', position: '8,5' },
            { template: 'thug', position: '10,6' },
            { template: 'bandit', name: 'Drunk Patron', position: '7,7' },
            { template: 'bandit', name: 'Angry Sailor', position: '9,7' },
        ],
        terrain: {
            obstacles: ['5,5', '11,5'],  // Tables
            difficultTerrain: ['6,7', '7,7', '9,7', '10,7'],  // Broken chairs/bottles
        },
        partyPositions: ['8,10', '7,11', '9,11', '8,12'],
        tags: ['thug', 'bandit', 'tavern', 'urban', 'brawl', 'nonlethal'],
        narrativeHook: '"You spilled my drink!" A chair flies across the room as chaos erupts!'
    },

    cult_ritual: {
        id: 'cult_ritual',
        name: 'Cult Ritual',
        description: 'Interrupting a dark ritual in progress.',
        difficulty: 'medium',
        recommendedLevel: { min: 2, max: 5 },
        participants: [
            { template: 'cultist', position: '8,4' },
            { template: 'cultist', position: '10,4' },
            { template: 'cultist', position: '7,5' },
            { template: 'cultist', position: '11,5' },
            { template: 'cultist', position: '9,3', name: 'Cult Leader' },
        ],
        terrain: {
            obstacles: ['9,4'],  // Ritual altar
            difficultTerrain: ['8,5', '9,5', '10,5'],  // Ritual circle
        },
        partyPositions: ['9,10', '8,11', '10,11', '9,12'],
        tags: ['cultist', 'ritual', 'urban', 'dungeon'],
        narrativeHook: 'Chanting fills the chamber. Dark energy swirls around the altar...'
    },

    // ═══════════════════════════════════════════════════════════════════════
    // DUNGEON ENCOUNTERS
    // ═══════════════════════════════════════════════════════════════════════

    animated_guardians: {
        id: 'animated_guardians',
        name: 'Animated Guardians',
        description: 'Magical constructs guarding a wizard\'s tower.',
        difficulty: 'medium',
        recommendedLevel: { min: 2, max: 5 },
        participants: [
            { template: 'animated_armor', position: '7,5' },
            { template: 'animated_armor', position: '11,5' },
            { template: 'flying_sword', position: '8,4' },
            { template: 'flying_sword', position: '10,4' },
        ],
        terrain: {
            obstacles: ['6,3', '12,3'],  // Pillars
        },
        partyPositions: ['9,10', '8,11', '10,11', '9,12'],
        tags: ['construct', 'animated', 'dungeon', 'tower', 'magic'],
        narrativeHook: 'The suits of armor creak to life. Swords float menacingly in the air!'
    },

    mimic_trap: {
        id: 'mimic_trap',
        name: 'Mimic Trap',
        description: 'What appears to be treasure is actually a deadly mimic.',
        difficulty: 'hard',
        recommendedLevel: { min: 3, max: 6 },
        participants: [
            { template: 'mimic', name: 'Treasure Chest', position: '9,5' },
        ],
        terrain: {
            obstacles: ['6,3', '12,3'],  // Real chests (for confusion)
        },
        partyPositions: ['9,10', '8,11', '10,11', '9,12'],
        tags: ['mimic', 'trap', 'dungeon', 'surprise', 'solo'],
        narrativeHook: 'The treasure chest\'s lid opens... revealing rows of teeth!'
    },

    troll_bridge: {
        id: 'troll_bridge',
        name: 'Troll Bridge',
        description: 'A troll guards the only crossing.',
        difficulty: 'deadly',
        recommendedLevel: { min: 4, max: 7 },
        participants: [
            { template: 'troll', name: 'Grukk the Bridge Keeper', position: '9,5' },
        ],
        terrain: {
            water: [
                '0,6', '1,6', '2,6', '3,6', '4,6', '5,6',
                '13,6', '14,6', '15,6', '16,6', '17,6', '18,6',
                '0,7', '1,7', '2,7', '3,7', '4,7', '5,7',
                '13,7', '14,7', '15,7', '16,7', '17,7', '18,7',
            ],  // River on both sides
            obstacles: ['6,5', '7,5', '11,5', '12,5'],  // Bridge railings
        },
        partyPositions: ['9,10', '8,11', '10,11', '9,12'],
        tags: ['troll', 'bridge', 'solo', 'regeneration'],
        narrativeHook: '"PAY TOLL OR GRUKK EAT YOU!" The massive troll blocks the bridge.'
    },

    dragon_wyrmling_lair: {
        id: 'dragon_wyrmling_lair',
        name: 'Dragon Wyrmling Lair',
        description: 'A young dragon\'s first hoard.',
        difficulty: 'deadly',
        recommendedLevel: { min: 3, max: 6 },
        participants: [
            { template: 'dragon_wyrmling_red', name: 'Flamescale', position: '10,3' },
        ],
        terrain: {
            obstacles: ['5,2', '6,2', '14,2', '15,2'],  // Cave walls
            difficultTerrain: ['8,4', '9,4', '10,4', '11,4', '12,4'],  // Gold coins/treasure
        },
        partyPositions: ['10,10', '8,11', '12,11', '10,12'],
        tags: ['dragon', 'wyrmling', 'lair', 'solo', 'fire', 'boss'],
        narrativeHook: 'Smoke curls from the wyrmling\'s nostrils. "MORE TREASURE FOR MY HOARD!"'
    },

    // ═══════════════════════════════════════════════════════════════════════
    // FIEND ENCOUNTERS
    // ═══════════════════════════════════════════════════════════════════════

    imp_swarm: {
        id: 'imp_swarm',
        name: 'Imp Swarm',
        description: 'Pesky imps harassing the party.',
        difficulty: 'medium',
        recommendedLevel: { min: 2, max: 4 },
        participants: [
            { template: 'imp', position: '6,5' },
            { template: 'imp', position: '8,4' },
            { template: 'imp', position: '10,4' },
            { template: 'imp', position: '12,5' },
        ],
        partyPositions: ['9,10', '8,11', '10,11', '9,12'],
        tags: ['imp', 'fiend', 'flying', 'annoying'],
        narrativeHook: 'Cackling laughter fills the air as tiny winged devils appear!'
    },

    // ═══════════════════════════════════════════════════════════════════════
    // ELEMENTAL ENCOUNTERS
    // ═══════════════════════════════════════════════════════════════════════

    elemental_breach: {
        id: 'elemental_breach',
        name: 'Elemental Breach',
        description: 'Elementals pour through a planar rift.',
        difficulty: 'deadly',
        recommendedLevel: { min: 5, max: 8 },
        participants: [
            { template: 'fire_elemental', position: '7,5' },
            { template: 'water_elemental', position: '11,5' },
        ],
        terrain: {
            difficultTerrain: ['8,4', '9,4', '10,4'],  // Planar rift energy
        },
        partyPositions: ['9,10', '8,11', '10,11', '9,12'],
        tags: ['elemental', 'fire', 'water', 'planar', 'magic'],
        narrativeHook: 'The air crackles as beings of pure elemental fury emerge from the rift!'
    },
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get an encounter preset by ID
 */
export function getEncounterPreset(id: string): EncounterPreset | null {
    const normalized = id.toLowerCase().replace(/[\s-]/g, '_');
    return ENCOUNTER_PRESETS[normalized] || null;
}

/**
 * List all encounter presets
 */
export function listEncounterPresets(): string[] {
    return Object.keys(ENCOUNTER_PRESETS);
}

/**
 * Get encounters by difficulty
 */
export function getEncountersByDifficulty(difficulty: EncounterPreset['difficulty']): EncounterPreset[] {
    return Object.values(ENCOUNTER_PRESETS).filter(e => e.difficulty === difficulty);
}

/**
 * Get encounters by tag
 */
export function getEncountersByTag(tag: string): EncounterPreset[] {
    const normalizedTag = tag.toLowerCase();
    return Object.values(ENCOUNTER_PRESETS).filter(e =>
        e.tags.some(t => t.toLowerCase() === normalizedTag)
    );
}

/**
 * Get encounters suitable for a party level
 */
export function getEncountersForLevel(level: number): EncounterPreset[] {
    return Object.values(ENCOUNTER_PRESETS).filter(e =>
        level >= e.recommendedLevel.min && level <= e.recommendedLevel.max
    );
}

/**
 * Scale an encounter for party size/level
 * Returns a modified copy with adjusted creature counts
 */
export function scaleEncounter(
    preset: EncounterPreset,
    _partyLevel: number,  // Reserved for future level-based scaling
    partySize: number
): EncounterPreset {
    const scaledPreset = { ...preset, participants: [...preset.participants] };

    // Simple scaling: adjust creature count based on party size
    // Default assumption is 4-player party
    const sizeFactor = partySize / 4;

    // For larger parties, add more minions (not bosses)
    if (sizeFactor > 1) {
        const minions = scaledPreset.participants.filter(p =>
            !p.name && !p.template.includes('boss') && !p.template.includes('captain')
        );

        // Add extra minions proportional to party size increase
        const extraCount = Math.floor((sizeFactor - 1) * minions.length);
        for (let i = 0; i < extraCount && minions.length > 0; i++) {
            const template = minions[i % minions.length];
            // Offset position slightly
            const [x, y] = template.position.split(',').map(Number);
            scaledPreset.participants.push({
                ...template,
                position: `${x + 1 + i},${y}`
            });
        }
    }

    return scaledPreset;
}

/**
 * Get a random encounter for the given criteria
 */
export function getRandomEncounter(options?: {
    difficulty?: EncounterPreset['difficulty'];
    level?: number;
    tags?: string[];
}): EncounterPreset | null {
    let candidates = Object.values(ENCOUNTER_PRESETS);

    if (options?.difficulty) {
        candidates = candidates.filter(e => e.difficulty === options.difficulty);
    }

    if (options?.level) {
        candidates = candidates.filter(e =>
            options.level! >= e.recommendedLevel.min &&
            options.level! <= e.recommendedLevel.max
        );
    }

    if (options?.tags && options.tags.length > 0) {
        candidates = candidates.filter(e =>
            options.tags!.some(tag =>
                e.tags.some(t => t.toLowerCase() === tag.toLowerCase())
            )
        );
    }

    if (candidates.length === 0) return null;

    return candidates[Math.floor(Math.random() * candidates.length)];
}
