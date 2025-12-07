
import { CombatEngine } from '../src/engine/combat/engine.js';
import { CombatTools, handleGenerateTerrainPatch, handlePlaceProp } from '../src/server/combat-tools.js';
import { SessionContext } from '../src/server/types.js';

// Mock context
const ctx: SessionContext = {
    sessionId: 'test-session',
    clientId: 'test-client',
    connectionId: 'test-conn'
};

async function run() {
    console.log('⚔️ Generating Massive Battlefield Scenario...');

    // 1. Initialize Engine
    const encounterId = 'massive-battle-1';
    const engine = new CombatEngine(encounterId);
    
    // Initialize empty state so we can add to it
    engine.startEncounter([]);
    
    const state = engine.getState();
    if (!state) throw new Error("Failed to initialize state");

    // 2. Generate Terrain (Battlefield Biome)
    console.log('🌍 Generating randomized battlefield terrain...');
    
    // Initialize properties
    state.terrain = { obstacles: [], difficultTerrain: [], water: [] };
    state.props = [];
    
    // Simulate Generate Terrain Patch
    const mapWidth = 30;
    const mapHeight = 30;
    
    // Manually run the generation logic (simplified from handler for script)
    // or better, just import the handler? We need the tool registry to be set up or called directly.
    // I exported the handler, so I can call it IF I mock the storage/db dependencies.
    // The handler uses 'getCombatManager()' which is global. That's tricky in a standalone script.
    // I'll just use the engine API directly.
    
    // --- Procedural Generation (matching the tool logic) ---
    for (let x = 0; x < mapWidth; x++) {
        for (let y = 0; y < mapHeight; y++) {
             const key = `${x},${y}`;
             const rand = Math.random();
             
             // Clear center
             const dx = x - mapWidth/2;
             const dy = y - mapHeight/2;
             if (Math.sqrt(dx*dx + dy*dy) < 6) continue;

             if (rand < 0.05) state.terrain.obstacles.push(key);
             else if (rand < 0.25) state.terrain.difficultTerrain?.push(key); // Rubble/Craters
        }
    }
    
    // Add props manually
    state.props?.push({
        id: 'prop-cart-1',
        position: '10,10',
        label: 'Burning Cart',
        propType: 'cover',
        cover: 'three_quarter',
        heightFeet: 5
    });
    
    state.props?.push({
        id: 'prop-tower-1',
        position: '20,20',
        label: 'Ruined Watchtower',
        propType: 'structure',
        cover: 'full',
        heightFeet: 25,
        climbable: true
    });

    // 3. Populate Entities
    console.log('👥 Spawning hordes...');
    
    const heroes = [
        { name: 'Sir Galen', id: 'hero-1', hp: 45, maxHp: 45, ac: 18, initiative: 12, isEnemy: false, position: {x: 14, y: 14} },
        { name: 'Elara', id: 'hero-2', hp: 32, maxHp: 32, ac: 14, initiative: 16, isEnemy: false, position: {x: 15, y: 16} },
        { name: 'Thorgar', id: 'hero-3', hp: 58, maxHp: 58, ac: 16, initiative: 8, isEnemy: false, position: {x: 16, y: 15} }
    ];

    heroes.forEach(h => {
        state.participants.push({
            ...h,
            type: 'character',
            conditions: []
        } as any);
        state.turnOrder.push(h.id);
    });

    // Enemies (Horde)
    const enemies = [
        { name: 'Goblin Skirmisher', hp: 7, ac: 12 },
        { name: 'Hobgoblin Captain', hp: 39, ac: 18 },
        { name: 'Worg', hp: 26, ac: 13 },
        { name: 'Ogre', hp: 59, ac: 11 }
    ];

    // Circle formation logic
    for (let i = 0; i < 25; i++) {
        const angle = (Math.PI * 2 * i) / 25;
        const dist = 8 + Math.random() * 8;
        const ex = Math.round(15 + Math.cos(angle) * dist);
        const ey = Math.round(15 + Math.sin(angle) * dist);
        
        const type = Math.random() > 0.9 ? enemies[3] : (Math.random() > 0.8 ? enemies[2] : enemies[0]);
        
        const enemy = {
            name: `${type.name}`,
            id: `enemy-${i}`,
            hp: type.hp,
            maxHp: type.hp,
            ac: type.ac,
            initiative: Math.floor(Math.random() * 20) + 1,
            isEnemy: true,
            position: { x: ex, y: ey },
            type: 'monster',
            conditions: []
        };
        
        state.participants.push(enemy as any);
        state.turnOrder.push(enemy.id);
    }

    console.log(`✅ Created encounter with ${state.participants.length} entities`);
    console.log(`✅ Terrain: ${state.terrain.obstacles.length} obstacles, ${state.terrain.difficultTerrain?.length} diff. terrain`);
    console.log(`✅ Props: ${state.props?.length} props`);
    
    console.log('\n--- ENTITY LIST ---');
    state.participants.forEach(p => {
        console.log(`- [${p.isEnemy ? 'ENEMY' : 'ALLY '}] ${p.name} (HP: ${p.hp}/${p.maxHp}) at ${p.position?.x},${p.position?.y}`);
    });
}

run().catch(console.error);
