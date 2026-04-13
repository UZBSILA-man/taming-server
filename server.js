const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: process.env.PORT || 3000 });

let players = {};
let worldObjects = [];
let wildPets = [];
let chests = [];

const WORLD_SIZE = 4000;
const PET_TYPES = ['wolf', 'rabbit', 'bear'];

let worldSeed = 12345;
function seededRandom() {
    worldSeed = (worldSeed * 16807) % 2147483647;
    return (worldSeed - 1) / 2147483646;
}

function initWorld() {
    console.log("Generating deterministic world objects...");
    worldSeed = 12345; // Reset seed
    worldObjects = [];
    wildPets = [];
    chests = [];

    // Generate trees, rocks, and BUSHES
    for (let i = 0; i < 400; i++) {
        const rnd = seededRandom();
        let type = 'tree';
        let health = 50;
        if (rnd < 0.3) { type = 'rock'; health = 100; }
        else if (rnd < 0.5) { type = 'bush'; health = 30; }

        const size = 30 + seededRandom() * 40;
        worldObjects.push({
            id: i,
            type: type,
            x: seededRandom() * WORLD_SIZE - WORLD_SIZE / 2,
            y: seededRandom() * WORLD_SIZE - WORLD_SIZE / 2,
            size: size,
            health: health,
            maxHealth: health
        });
    }

    // Spawn single BIG GOLD ROCK at center
    worldObjects.push({
        id: 'BIG_GOLD_CENTER',
        type: 'gold_rock',
        x: 0,
        y: 0,
        size: 80,
        health: Infinity,
        maxHealth: Infinity
    });

    // Spawn initial wild pets (deterministic)
    for (let i = 0; i < 10; i++) {
        spawnWildPet(i);
    }

    // Spawn chests (deterministic IDs)
    for (let i = 0; i < 20; i++) {
        chests.push({
            id: 'chest_' + i,
            x: seededRandom() * WORLD_SIZE - WORLD_SIZE / 2,
            y: seededRandom() * WORLD_SIZE - WORLD_SIZE / 2,
            health: 30,
            maxHealth: 30,
            reward: 2,
            type: 'chest'
        });
    }
}

let petSpawnCount = 0;
function spawnWildPet(seedIndex) {
    // Use seededRandom for deterministic spawning
    const typeIdx = Math.floor(seededRandom() * PET_TYPES.length);
    const type = PET_TYPES[typeIdx];
    const textureIndex = Math.floor(seededRandom() * 3);
    let px, py;
    do {
        px = (seedIndex !== undefined ? seededRandom() : Math.random()) * WORLD_SIZE - WORLD_SIZE / 2;
        py = (seedIndex !== undefined ? seededRandom() : Math.random()) * WORLD_SIZE - WORLD_SIZE / 2;
    } while (Math.hypot(px, py) < 400);
    const ageRand = seededRandom();

    const petId = seedIndex !== undefined ? 'pet_' + seedIndex : 'pet_' + (++petSpawnCount);
    const pet = {
        id: petId,
        type: type,
        textureIndex: textureIndex,
        x: px,
        y: py,
        state: 'wander',
        age: 'baby',
        hp: 100,
        maxHp: 100,
        health: 100,
        damage: 2
    };

    if (ageRand < 0.05) {
        pet.age = 'boss';
        pet.hp = 1000;
        pet.maxHp = 1000;
        pet.health = 1000;
        pet.damage = 17;
    } else if (ageRand < 0.4) {
        pet.age = 'adult';
        pet.hp = 300;
        pet.maxHp = 300;
        pet.health = 300;
        pet.damage = 5;
    } else {
        pet.state = 'sleep';
        // damage already set to 2 (baby default)
    }

    wildPets.push(pet);
}

initWorld();

setInterval(() => {
    if (wildPets.length < 30) {
        spawnWildPet();
        broadcast({
            type: "worldUpdate",
            worldObjects: false,
            wildPets: wildPets,
            chests: false
        });
    }
}, 1000); // Check and spawn a pet every 1 sec to reach 30

wss.on("connection", ws => {
    const id = Math.random().toString(36).substr(2, 9);
    players[id] = { x: 0, y: 0, gold: 0, name: "Guest", hp: 100, maxHp: 100 };

    try {
        ws.send(JSON.stringify({
            type: "init",
            id: id,
            players: players,
            worldObjects: worldObjects,
            wildPets: wildPets,
            chests: chests
        }));
    } catch (e) {
        console.error("Failed to send init message:", e);
    }

    ws.on("message", msg => {
        try {
            const data = JSON.parse(msg);
            if (data.type === "move") {
                if (players[id]) {
                    players[id].x = data.x;
                    players[id].y = data.y;
                    players[id].gold = data.gold || 0;
                    players[id].name = data.name || "Guest";
                    // HP is NOT updated from client move - server is the authority

                    broadcast({
                        type: "update",
                        id: id,
                        x: data.x,
                        y: data.y,
                        gold: players[id].gold,
                        name: players[id].name,
                        hp: players[id].hp,
                        maxHp: players[id].maxHp
                    });
                }
            } else if (data.type === "pvp_hit") {
                // Player vs Player damage
                const targetId = data.targetId;
                const dmg = Math.max(0, data.damage || 1);
                if (players[targetId]) {
                    players[targetId].hp = (players[targetId].hp || 100) - dmg;
                    if (players[targetId].hp < 0) players[targetId].hp = 0;
                    broadcast({
                        type: "pvp_damage",
                        targetId: targetId,
                        hp: players[targetId].hp,
                        maxHp: players[targetId].maxHp || 100,
                        damage: dmg,
                        attackerId: id
                    });
                    // If target died, respawn them on server side
                    if (players[targetId].hp <= 0) {
                        players[targetId].hp = 100; // Reset HP after death
                    }
                }
            } else if (data.type === "hit") {
                handleHit(data);
            }
        } catch (e) {
            console.error("Error parsing message:", e);
        }
    });

    ws.on("close", () => {
        delete players[id];
        broadcast({
            type: "remove", id: id
        });
    });
});

function broadcast(data) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(msg);
            } catch (e) {
                console.error("Failed to broadcast message:", e);
            }
        }
    });
}

function handleHit(data) {
    let target = null;
    if (data.targetType === 'object') {
        target = worldObjects.find(o => o.id === data.targetId);
    } else if (data.targetType === 'chest') {
        target = chests.find(c => c.id === data.targetId);
    } else if (data.targetType === 'wildPet') {
        target = wildPets.find(p => p.id === data.targetId);
    }

    if (target) {
        // Use 'health' property for all hit-able targets
        const currentHealth = target.health !== undefined ? target.health : target.hp;
        const newHealth = currentHealth - data.damage;

        if (target.health !== undefined) target.health = newHealth;
        else target.hp = newHealth;

        if (newHealth <= 0) {
            if (data.targetType === 'object') {
                target.x = Math.random() * WORLD_SIZE - WORLD_SIZE / 2;
                target.y = Math.random() * WORLD_SIZE - WORLD_SIZE / 2;
                target.health = target.maxHealth;
            } else if (data.targetType === 'chest') {
                chests = chests.filter(c => c.id !== target.id);
            } else if (data.targetType === 'wildPet') {
                wildPets = wildPets.filter(p => p.id !== target.id);
            }

            broadcast({
                type: "worldUpdate",
                worldObjects,
                wildPets,
                chests
            });
        } else {
            broadcast({
                type: "hitUpdate",
                targetType: data.targetType,
                targetId: data.targetId,
                health: newHealth
            });
        }
    }
}

console.log("Server running on port " + (process.env.PORT || 3000));
