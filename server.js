const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: process.env.PORT || 3000 });

let players = {};

wss.on("connection", ws => {

    const id = Math.random().toString(36).substr(2, 9);

    players[id] = { x: 0, y: 0 };

    ws.send(JSON.stringify({
        type: "init",
        id: id,
        players: players
    }));

    ws.on("message", msg => {
        const data = JSON.parse(msg);

        if (data.type === "move") {
            players[id] = {
                x: data.x,
                y: data.y,
                name: data.name || "Guest",
                gold: data.gold || 0,
                petType: data.petType,
                petAge: data.petAge
            };

            broadcast({
                type: "update",
                id: id,
                ...players[id]
            });
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

    wss.clients.forEach(client => {
        if (client.readyState === 1) {
            client.send(JSON.stringify(data));
        }
    });

}

console.log("Server running");
