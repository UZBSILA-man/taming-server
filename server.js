const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: process.env.PORT || 3000 });

const WORLD_SIZE = 4000;
const PET_TYPES = ['wolf', 'rabbit', 'bear'];

let players = {};
let objects = [];
let wildPets = [];
let chests = [];

// User Database Persistence
const fs = require('fs');
const USERS_FILE = './users.json';
let users = {};

function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = fs.readFileSync(USERS_FILE, 'utf8');
            users = JSON.parse(data);
        } else {
            users = {};
            saveUsers();
        }
    } catch (e) {
        console.error("Error loading users:", e);
        users = {};
    }
}

function saveUsers() {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    } catch (e) {
        console.error("Error saving users:", e);
    }
}

loadUsers();

// Initialize World State
function initWorld() {
    objects = [];
    wildPets = [];
    chests = [];

    // Generate trees, rocks, and bushes
    for (let i = 0; i < 400; i++) {
        const rand = Math.random();
        let type = 'tree';
        let health = 50;
        if (rand < 0.3) { type = 'rock'; health = 100; }
        else if (rand < 0.5) { type = 'bush'; health = 30; }

        const size = 30 + Math.random() * 40;
        objects.push({
            id: 'obj_' + i,
            type: type,
            x: Math.random() * WORLD_SIZE - WORLD_SIZE / 2,
            y: Math.random() * WORLD_SIZE - WORLD_SIZE / 2,
            size: size,
            health: health,
            maxHealth: health
        });
    }

    // BIG GOLD ROCK
    objects.push({
        id: 'BIG_GOLD_CENTER',
        type: 'gold_rock',
        x: 0,
        y: 0,
        size: 80,
        health: Infinity,
        maxHealth: Infinity
    });

    // Chests
    for (let i = 0; i < 20; i++) {
        chests.push({
            id: 'chest_' + i,
            x: Math.random() * WORLD_SIZE - WORLD_SIZE / 2,
            y: Math.random() * WORLD_SIZE - WORLD_SIZE / 2,
            health: 30,
            maxHealth: 30,
            reward: 2,
            type: 'chest'
        });
    }

    // Initial wild pets
    for (let i = 0; i < 10; i++) {
        spawnWildPet();
    }
}

function spawnWildPet() {
    const type = PET_TYPES[Math.floor(Math.random() * PET_TYPES.length)];
    const id = 'wild_' + Math.random().toString(36).substr(2, 9);
    const pet = {
        id: id,
        type: type,
        x: Math.random() * WORLD_SIZE - WORLD_SIZE / 2,
        y: Math.random() * WORLD_SIZE - WORLD_SIZE / 2,
        vx: 0,
        vy: 0,
        wanderTimer: 0,
        wanderAngle: Math.random() * Math.PI * 2,
        state: 'wander',
        hp: 100,
        maxHp: 100,
        age: 'baby'
    };

    const rand = Math.random();
    if (rand < 0.05) {
        pet.age = 'boss';
        pet.hp = 1000;
        pet.maxHp = 1000;
        pet.damage = 17;
    } else if (rand < 0.4) {
        pet.age = 'adult';
        pet.hp = 300;
        pet.maxHp = 300;
        pet.damage = 5;
    } else {
        pet.age = 'baby';
        pet.hp = 100;
        pet.maxHp = 100;
        pet.damage = 1;
        pet.state = 'sleep';
    }

    wildPets.push(pet);
}

function updateWorld() {
    // Wild Pet AI
    wildPets.forEach(pet => {
        let target = null;
        let minDist = 400;

        // Detect closest player
        for (let pid in players) {
            const p = players[pid];
            const d = Math.hypot(p.x - pet.x, p.y - pet.y);
            if (d < minDist) {
                target = p;
                minDist = d;
            }
        }

        if (target && pet.state !== 'sleep') {
            pet.state = 'attack';
            const angle = Math.atan2(target.y - pet.y, target.x - pet.x);
            const speed = pet.age === 'boss' ? 0.8 : 1.8;
            pet.vx = Math.cos(angle) * speed;
            pet.vy = Math.sin(angle) * speed;
        } else if (pet.state !== 'sleep') {
            pet.state = 'wander';
            pet.wanderTimer--;
            if (pet.wanderTimer <= 0) {
                pet.wanderAngle = Math.random() * Math.PI * 2;
                pet.wanderTimer = 60 + Math.random() * 120;
            }
            const speed = pet.age === 'baby' ? 0.5 : 1;
            pet.vx = Math.cos(pet.wanderAngle) * speed;
            pet.vy = Math.sin(pet.wanderAngle) * speed;
        }

        pet.x += pet.vx;
        pet.y += pet.vy;

        // World Bounds
        pet.x = Math.max(-WORLD_SIZE / 2 + 50, Math.min(WORLD_SIZE / 2 - 50, pet.x));
        pet.y = Math.max(-WORLD_SIZE / 2 + 50, Math.min(WORLD_SIZE / 2 - 50, pet.y));
    });

    // Broadcast world state to all
    broadcast({
        type: "worldUpdate",
        wildPets: wildPets.map(p => ({
            id: p.id, x: p.x, y: p.y, type: p.type, age: p.age, state: p.state, hp: p.hp, maxHp: p.maxHp
        }))
    });
}

initWorld();
setInterval(updateWorld, 100); // 10fps for AI/World updates
setInterval(saveUsers, 30000); // Periodic save every 30s

wss.on("connection", ws => {
    const id = Math.random().toString(36).substr(2, 9);
    players[id] = { x: 0, y: 0, gold: 0, name: "Guest" };

    ws.send(JSON.stringify({
        type: "init",
        id: id,
        players: players,
        world: {
            objects: objects,
            chests: chests,
            wildPets: wildPets
        }
    }));

    ws.on("message", msg => {
        try {
            const data = JSON.parse(msg);

            // AUTH HANDLERS
            if (data.type === "register") {
                const { email, username, password } = data;
                if (users[username] || Object.values(users).some(u => u.email === email)) {
                    ws.send(JSON.stringify({ type: "auth_error", message: "Username or Email already exists!" }));
                    return;
                }

                users[username] = {
                    email,
                    username,
                    password,
                    goldenApples: 300,
                    petCards: { wolf: 0, rabbit: 0, bear: 0 }
                };
                saveUsers();
                ws.send(JSON.stringify({
                    type: "auth_success",
                    user: users[username],
                    message: "Registration successful! +300 Golden Apples awarded."
                }));
                return;
            }

            if (data.type === "login") {
                const { userOrEmail, password } = data;
                let userRecord = users[userOrEmail];
                if (!userRecord) {
                    userRecord = Object.values(users).find(u => u.email === userOrEmail);
                }

                if (userRecord && userRecord.password === password) {
                    // Update current player state with saved data
                    if (players[id]) {
                        players[id].name = userRecord.username;
                        players[id].gold = userRecord.goldenApples;
                        players[id].isLoggedIn = true;
                        players[id].username = userRecord.username;
                    }
                    ws.send(JSON.stringify({
                        type: "auth_success",
                        user: userRecord,
                        message: `Welcome back, ${userRecord.username}!`
                    }));
                } else {
                    ws.send(JSON.stringify({ type: "auth_error", message: "Invalid username/email or password!" }));
                }
                return;
            }

            if (data.type === "move") {
                if (players[id]) {
                    players[id].x = data.x;
                    players[id].y = data.y;
                    players[id].gold = data.gold || 0;
                    players[id].name = data.name || "Guest";

                    // Sync gold to persistent storage if logged in
                    if (players[id].isLoggedIn && users[players[id].username]) {
                        users[players[id].username].goldenApples = players[id].gold;
                        // We could save periodically instead of every move to optimize
                    }

                    broadcast({
                        type: "update",
                        id: id,
                        x: data.x,
                        y: data.y,
                        gold: players[id].gold,
                        name: players[id].name
                    });
                }
            } else if (data.type === "hit") {
                handleHit(data);
            }
        } catch (e) {
            console.error("Error parsing message", e);
        }
    });

    ws.on("close", () => {
        if (players[id] && players[id].isLoggedIn) {
            saveUsers(); // Final save on disconnect
        }
        delete players[id];
        broadcast({
            type: "remove", id: id
        });
    });
});

function handleHit(data) {
    // Process hits for objects, chests, or wild pets
    if (data.targetType === 'object') {
        const obj = objects.find(o => o.id === data.targetId);
        if (obj && obj.type !== 'gold_rock') {
            obj.health -= data.damage;
            if (obj.health <= 0) {
                obj.x = Math.random() * WORLD_SIZE - WORLD_SIZE / 2;
                obj.y = Math.random() * WORLD_SIZE - WORLD_SIZE / 2;
                obj.health = obj.maxHealth;
            }
            broadcast({ type: "objectUpdate", id: obj.id, x: obj.x, y: obj.y, health: obj.health });
        }
    } else if (data.targetType === 'chest') {
        const chest = chests.find(c => c.id === data.targetId);
        if (chest) {
            chest.health -= data.damage;
            if (chest.health <= 0) {
                chest.x = Math.random() * WORLD_SIZE - WORLD_SIZE / 2;
                chest.y = Math.random() * WORLD_SIZE - WORLD_SIZE / 2;
                chest.health = chest.maxHealth;
            }
            broadcast({ type: "objectUpdate", id: chest.id, x: chest.x, y: chest.y, health: chest.health, isChest: true });
        }
    } else if (data.targetType === 'wildPet') {
        const pet = wildPets.find(p => p.id === data.targetId);
        if (pet) {
            pet.hp -= data.damage;
            if (pet.state === 'sleep') pet.state = 'wander';
            if (pet.hp <= 0) {
                const index = wildPets.indexOf(pet);
                wildPets.splice(index, 1);
                setTimeout(spawnWildPet, 5000); // Respawn after 5s
            }
            // Broadcasters will be sent by updateWorld's loop anyway, but we can send urgent hp update
        }
    }
}

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === 1) {
            client.send(JSON.stringify(data));
        }
    });
}

// Leaderboard broadcast
setInterval(() => {
    const leaderboard = Object.values(players)
        .map(p => ({ name: p.name, gold: p.gold }))
        .sort((a, b) => b.gold - a.gold)
        .slice(0, 10);

    broadcast({
        type: "leaderboard",
        data: leaderboard
    });
}, 2000);

console.log("Server running");
