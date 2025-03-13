import { SonoClient } from 'https://deno.land/x/sono@v1.2/src/sonoClient.js';
import { SonoRTC } from "./RTC.js"

const WS_URL = "ws://localhost:3001" // <- UPDATE TO CORRECT URL!!!
const serverConfig = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun.l.google.com:5349" },
        { urls: "stun:stun1.l.google.com:3478" },
        { urls: "stun:stun1.l.google.com:5349" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:5349" }
    ]
}

const canvas = document.querySelector('canvas');
canvas.width = innerWidth;
canvas.height = innerHeight;
const c = canvas.getContext('2d');

let sono = null;
let rtc = null;

let myid = null;

const scoreEl = document.querySelector('#scoreEl')

console.log("YIPEEE", canvas);

class Player {
    constructor(x, y, radius, color) {
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.color = color;
    }

    draw() {
        c.beginPath();
        c.arc(this.x, this.y, this.radius, 0, 2 * Math.PI);
        // c.strokeStyle = this.color;
        c.fillStyle = this.color;
        c.stroke();
        c.fill();
        c.closePath();
    }
}

class Projectile {
    constructor(x, y, radius, color, velocity) {
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.color = color;
        this.velocity = velocity;
    }

    draw() {
        c.beginPath();
        c.arc(this.x, this.y, this.radius, 0, 2 * Math.PI);
        c.strokeStyle = this.color;
        c.fillStyle = this.color;
        c.stroke();
        c.fill();
        c.closePath();
    }

    update() {
        this.x = this.x + this.velocity.x;
        this.y = this.y + this.velocity.y;
        this.draw();
    }
}


class Enemy {
    constructor(x, y, radius, color, velocity) {
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.color = color;
        this.velocity = velocity;
    }

    draw() {
        c.beginPath();
        c.arc(this.x, this.y, this.radius, 0, 2 * Math.PI);
        c.strokeStyle = this.color;
        c.fillStyle = this.color;
        c.stroke();
        c.fill();
        c.closePath();
    }

    update() {
        this.x = this.x + this.velocity.x;
        this.y = this.y + this.velocity.y;
        this.draw();
    }
}

let animationId;
let score = 0;

function animate() {
    animationId = requestAnimationFrame(animate);
    c.clearRect(0, 0, canvas.width, canvas.height);

    handleMovement();
    player.draw();

    // Draw other players
    otherPlayers.forEach(otherPlayer => {
        otherPlayer.draw();
        console.log("updated a foreign player");
    });
    console.log("Length of other players: ", otherPlayers.length)

    projectiles.forEach((proj) => {
        proj.update();
    });

    enemies.forEach((enemy) => {
        enemy.update();
    });

    collisionDetection();
    sendCords();
    handleMessages();
}


// function collisionDetection

//Event listeners
addEventListener('click', (event) => {
    console.log("spawn");
    let angle = Math.atan2(event.clientY - player.y, event.clientX - player.x);
    let velocity = { x: Math.cos(angle) * 2, y: Math.sin(angle) * 2 };
    // velocity = velocity * 2;
    const projectile = new Projectile(player.x, player.y, 5, 'green', velocity);
    projectiles.push(projectile);

});


function spawnEnemies() {
    setInterval(() => {
        const radius = Math.random() * (30 - 10) + 10;
        let x;
        let y;
        if (Math.random() < 0.5) {
            x = Math.random() < 0.5 ? 0 - radius : canvas.width + radius;
            y = Math.random() * canvas.height;
        } else {
            x = Math.random() * canvas.width;
            y = Math.random() < 0.5 ? 0 - radius : canvas.height + radius;
        }

        let angle = Math.atan2(player.y - y, player.x - x);
        let velocity = { x: Math.cos(angle), y: Math.sin(angle) };
        enemies.push(new Enemy(x, y, radius, "purple", velocity));
    }, 4000)
}

function collisionDetection() {
    for (let index = enemies.length - 1; index >= 0; index--) {
        const enemy = enemies[index]

        // enemy.update()

        const dist = Math.hypot(player.x - enemy.x, player.y - enemy.y)

        //end game
        if (dist - enemy.radius - player.radius < 1) {
            cancelAnimationFrame(animationId);
            sono.broadcast({
                type: 'close',
                id: myid
            }, 'close');
        }

        for (
            let projectilesIndex = projectiles.length - 1;
            projectilesIndex >= 0;
            projectilesIndex--
        ) {
            const projectile = projectiles[projectilesIndex]

            const dist = Math.hypot(projectile.x - enemy.x, projectile.y - enemy.y)

            // when projectiles touch enemy
            if (dist - enemy.radius - projectile.radius < 1) {
                // create explosions
                // for (let i = 0; i < enemy.radius * 2; i++) {
                //     particles.push(
                //         new Particle(
                //             projectile.x,
                //             projectile.y,
                //             Math.random() * 2,
                //             enemy.color,
                //             {
                //                 x: (Math.random() - 0.5) * (Math.random() * 6),
                //                 y: (Math.random() - 0.5) * (Math.random() * 6)
                //             }
                //         )
                //     )
                // }
                // this is where we shrink our enemy
                if (enemy.radius - 10 > 5) {
                    score += 100;
                    scoreEl.innerHTML = score;
                    enemy.radius -= 10;

                    projectiles.splice(projectilesIndex, 1)
                } else {
                    // remove enemy if they are too small
                    score += 150;
                    scoreEl.innerHTML = score;

                    enemies.splice(index, 1);
                    projectiles.splice(projectilesIndex, 1);
                }
            }
        }
    }
}


function handleMovement() {
    const speed = 3;
    if (keys.w.pressed) {
        player.y -= 1 * speed;
    }

    if (keys.a.pressed) {
        player.x -= 1* speed;
    }

    if (keys.s.pressed) {
        player.y += 1 * speed;
    }

    if (keys.d.pressed) {
        player.x += 1 * speed;
    }
}


//MAIN area

let x = canvas.width / 2;
let y = canvas.height / 2;


const projectiles = [];
const enemies = [];
const otherPlayers = [];

const player = new Player(x, y, 30, 'blue');

const keys = {
    w: {
        pressed: false
    },
    a: {
        pressed: false
    },
    s: {
        pressed: false
    },
    d: {
        pressed: false
    }
}

// player.draw();

spawnEnemies();
// let projectile = new Projectile(player.x, player.y, 5, 'red', {x: 1, y: 1});
// projectile.draw();
// projectile.update();
// projectiles.push(projectile);


// animate();


function getOrCreatePlayer(playerId, initialX, initialY) {
    if(playerId == undefined){
        playerId = 1;
    }
    let player = playerMap.get(playerId);
    
    if (!player) {
        // Create new player if we don't have one yet
        player = new Player(initialX, initialY, 30, 'red');
        playerMap.set(playerId, player);
        otherPlayers.push(player);
        console.log(`Created new player with ID: ${playerId}`);
    }
    
    return player;
}

window.onload = function () {
    main();
};

function main() {
    let spliturl = window.location.href.split("/");
    let lobbyid = spliturl[spliturl.length - 1];
    let lobbynameelm = document.getElementsByClassName("lobbyname")[0];
    lobbynameelm.innerHTML = "LOBBY ID: " + lobbyid;

    sono = new SonoClient(WS_URL + '/join/' + lobbyid);
    waitForConnection(lobbyid)
}

// Helper function to debug Sono IDs
function debugSonoConnection(sono) {
    console.log("Sono connection details:");
    console.log("WebSocket ID:", sono.ws);
    
    // Try to inspect the internal state
    console.log("Sono internal state:", sono);
    
    // Check for available methods
    console.log("Available methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(sono)));
}

function debugRTCConnection(rtc) {
    console.log("RTC connection details:");
    console.log("Server ws:", rtc.server);
    console.log("channelclients from grab:", rtc.mychannelclients);
    
    // Check for available methods
    console.log("Available methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(rtc)));
}

// Call this function right after connection is established
function waitForConnection(lobbyid) {
    if(sono.ws.readyState == 0) {
        globalThis.setTimeout(function() {waitForConnection(lobbyid)}, 1000);
    } else {
        establishRTCConnection(lobbyid);
    }
}

function establishRTCConnection(lobbyid) {
    console.log("SONO CONNECTED!");

    rtc = new SonoRTC(serverConfig, sono, {}) // No constraints for now
    sono.changeChannel(lobbyid);
    rtc.changeChannel(lobbyid);

    waitForRTCConnection();
}

function waitForRTCConnection() {
    if(!rtc.mychannel) {
        globalThis.setTimeout(function() {waitForRTCConnection()}, 1000);
    } else {
        gameCode();
    }
}

function gameCode() {
    // Code for the game goes here
    console.log("RTC CONNECTED!");
    
    debugRTCConnection(rtc)

    myid = rtc.myid; // Set myid as a global var as it shouldn't ever change
    
    // Send initial position to everyone using broadcast only
    sono.broadcast({
        type: 'join',
        id: myid,
        x: player.x,
        y: player.y
    }, 'join');
    
    // Setup message handlers
    handleMessages();
    
    // Start the game loop
    animate();
}

function sendCords() {
    sono.broadcast({
        type: 'position',
        id: myid,
        x: player.x, 
        y: player.y
    }, 'position');
}

// Keep track of other players with their peer IDs
const playerMap = new Map(); // Map peer IDs to Player objects

function handleMessages() {
    // When a new peer connects
    sono.onconnection((peer) => {
        // payload
        console.log('New connection from peer:', peer.id); 
        sono.broadcast({
            type: 'join',
            id: myid,
            x: player.x,
            y: player.y
        }, 'join');
        // Send initial position to everyone
        sono.broadcast({
            type: 'position',
            id: myid,
            x: player.x,
            y: player.y
        }, 'position');
    });

    sono.on('join', (msg) => {
        console.log('Join received from peer:', msg.id);
        // Create a new player for this peer
        const foreignPlayer = getOrCreatePlayer(msg.id, msg.x, msg.y);
        
        sono.broadcast({
            type: 'join',
            id: myid,
            x: player.x,
            y: player.y
        }, 'join');
        // Store the player with their peer ID
        // playerMap.set(msg.id, foreignPlayer);
        // otherPlayers.push(foreignPlayer);
        
        // No need to send direct messages back - the broadcast already handled this
    });
    
    // When a peer disconnects
    sono.on('close', (msg) => {
        console.log('Peer disconnected:', msg.id);
        
        // Remove the player from our map and array
        const playerToRemove = playerMap.get(msg.id);
        if (playerToRemove) {
            const index = otherPlayers.indexOf(playerToRemove);
            if (index !== -1) {
                otherPlayers.splice(index, 1);
            }
            playerMap.delete(msg.id);
        }
    });

    sono.on('position', (msg) => {
        // Update the position of the player who sent this message
        if (msg.id && msg.x !== undefined && msg.y !== undefined) {
            const playerToUpdate = playerMap.get(msg.id);
            if (playerToUpdate) {
                playerToUpdate.x = msg.x;
                playerToUpdate.y = msg.y;
            }
        }
    });
}
// Keydown event listener

// Example of how we might send key inputs to other players, but in a peer to peer game we would just send to the peers instead
/*
setInterval(() => {
    if (keys.w.pressed) {
      sequenceNumber++
      playerInputs.push({ sequenceNumber, dx: 0, dy: -SPEED })
      // frontEndPlayers[socket.id].y -= SPEED
      socket.emit('keydown', { keycode: 'KeyW', sequenceNumber })
    }

    if (keys.a.pressed) {
      sequenceNumber++
      playerInputs.push({ sequenceNumber, dx: -SPEED, dy: 0 })
      // frontEndPlayers[socket.id].x -= SPEED
      socket.emit('keydown', { keycode: 'KeyA', sequenceNumber })
    }

    if (keys.s.pressed) {
      sequenceNumber++
      playerInputs.push({ sequenceNumber, dx: 0, dy: SPEED })
      // frontEndPlayers[socket.id].y += SPEED
      socket.emit('keydown', { keycode: 'KeyS', sequenceNumber })
    }

    if (keys.d.pressed) {
      sequenceNumber++
      playerInputs.push({ sequenceNumber, dx: SPEED, dy: 0 })
      // frontEndPlayers[socket.id].x += SPEED
      socket.emit('keydown', { keycode: 'KeyD', sequenceNumber })
    }
  }, 15)
  */

window.addEventListener('keydown', (event) => {
    //check if its a front end player and return if not

    switch (event.code) {
        case 'KeyW':
            keys.w.pressed = true
            break

        case 'KeyA':
            keys.a.pressed = true
            break

        case 'KeyS':
            keys.s.pressed = true
            break

        case 'KeyD':
            keys.d.pressed = true
            break
    }
})

window.addEventListener('keyup', (event) => {
    //check if its a front end player and return if not

    switch (event.code) {
        case 'KeyW':
            keys.w.pressed = false
            break

        case 'KeyA':
            keys.a.pressed = false
            break

        case 'KeyS':
            keys.s.pressed = false
            break

        case 'KeyD':
            keys.d.pressed = false
            break
    }
})