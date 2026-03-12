const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

// O'yin holati (Hamma ma'lumot shu yerda saqlanadi)
let players = {};
let worldObjects = [];

// 1. Dunyoni serverda bir marta yaratish (Hamma uchun bir xil bo'ladi)
function initWorld() {
    worldObjects = [];
    for (let i = 0; i < 40; i++) {
        worldObjects.push({
            id: 'obj_' + i,
            type: Math.random() > 0.5 ? 'tree' : 'stone',
            x: Math.floor(Math.random() * 2500), // Kengroq dunyo
            y: Math.floor(Math.random() * 2500),
            health: 100,
            size: 40 + Math.random() * 20 // Daraxt/tosh o'lchami ham serverda
        });
    }
}
initWorld();

wss.on("connection", (ws) => {
    const id = Math.random().toString(36).substr(2, 9);

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);

            // 2. O'yinchi qo'shilishi
            if (data.type === "join") {
                players[id] = {
                    id: id,
                    name: data.name || "Guest",
                    x: 500 + Math.random() * 500,
                    y: 500 + Math.random() * 500,
                    gold: 0,
                    petType: data.petType || "wolf",
                    angle: 0
                };

                // O'yinchiga dunyoni va mavjud o'yinchilarni yuborish
                ws.send(JSON.stringify({
                    type: "init",
                    myId: id,
                    objects: worldObjects,
                    players: players
                }));

                // Boshqalarga yangi o'yinchi haqida xabar berish
                broadcast({ type: "newPlayer", player: players[id] }, id);
                broadcastLeaderboard();
            }

            // 3. Harakat va Aylanish (Ismlar va Petlar ham birga harakatlanadi)
            if (data.type === "move") {
                if (players[id]) {
                    players[id].x = data.x;
                    players[id].y = data.y;
                    players[id].angle = data.angle;

                    // Faqat kerakli ma'lumotlarni yuboramiz (Optimizatsiya)
                    broadcast({
                        type: "playerUpdate",
                        id: id,
                        x: data.x,
                        y: data.y,
                        angle: data.angle
                    }, id);
                }
            }

            // 4. Resursga urish (Oltin yig'ish)
            if (data.type === "hitObject") {
                const obj = worldObjects.find(o => o.id === data.objectId);
                if (obj && players[id]) {
                    obj.health -= 10;
                    players[id].gold += 10; // Har urishda oltin qo'shish

                    if (obj.health <= 0) {
                        // Resurs qayta tiklanishi (Respawn)
                        obj.x = Math.floor(Math.random() * 2500);
                        obj.y = Math.floor(Math.random() * 2500);
                        obj.health = 100;
                    }

                    // Hamma o'yinchida resurs o'zgarishini ko'rsatish
                    broadcast({ type: "objectSync", object: obj });
                    broadcastLeaderboard();
                }
            }

        } catch (e) {
            console.error("Xatolik yuz berdi:", e);
        }
    });

    ws.on("close", () => {
        delete players[id];
        broadcast({ type: "removePlayer", id: id });
        broadcastLeaderboard();
    });
});

// 5. Leaderboard: Top 10 talikni barchaga tarqatish
function broadcastLeaderboard() {
    const sorted = Object.values(players)
        .sort((a, b) => b.gold - a.gold)
        .slice(0, 10)
        .map(p => ({ name: p.name, gold: p.gold }));

    broadcast({
        type: "leaderboardUpdate",
        leaderboard: sorted
    });
}

// Barchaga xabar yuborish funksiyasi
function broadcast(data, excludeId = null) {
    const msg = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    });
}

console.log(`Server ishga tushdi: PORT ${PORT}`);
