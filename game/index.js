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
const player_poll_frames = 120; // How many frames we wait before sending each channel refersh request
let poll_counter = 0;

let sono = null;
let rtc = null;
let current_player_list = [];

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

class Laser {
    constructor(x, y, targetX, targetY, color, duration = 200) {
        this.startX = x;
        this.startY = y;
        this.endX = targetX;
        this.endY = targetY;
        this.color = color;
        this.startTime = Date.now();
        this.duration = duration;
    }

    draw() {
        const elapsed = Date.now() - this.startTime;
        const opacity = 1 - (elapsed / this.duration);
        
        if (opacity <= 0) return false;
        
        c.beginPath();
        c.moveTo(this.startX, this.startY);
        c.lineTo(this.endX, this.endY);
        c.strokeStyle = this.color;
        c.globalAlpha = opacity;
        c.lineWidth = 3;
        c.stroke();
        c.globalAlpha = 1;
        
        return true;
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

    handlePeerListChanges();
    handleMovement();

    // Draw local player
    player.draw();

    // Draw other players
    for (const [_id, playerobj] of playerMap) {
        playerobj.draw();
    }

    // Draw all projectiles from the projectile map 
    for (const [_id, proj] of projectileMap) {
        proj.draw();
    }
    
    // Draw active lasers and remove expired ones
    for (let i = lasers.length - 1; i >= 0; i--) {
        if (!lasers[i].draw()) {
            lasers.splice(i, 1);
        }
    }

    // Update enemies
    enemies.forEach((enemy) => {
        enemy.update();
    });

    // Check for collisions
    collisionDetection();
    
    // Send updates to peers
    sendCords();
}



function peerLeft(peerid) {
    // Called when a peer leaves
    console.log("PEER LEFT: " + peerid);
    removePlayer(peerid, 0, 0);
}

function peerJoined(peerid) {
    // Called when a peer leaves
    console.log("PEER JOINED: " + peerid);
    getOrCreatePlayer(peerid, 0, 0);
}

//
function handlePeerListChanges() {
    // Function that checks if any players have left or joined the game and acts accordingly

    // We have to manually refresh the server
    poll_counter += 1;
    if (poll_counter >= player_poll_frames) {
        rtc.server.grab('mychannelclients');
        poll_counter = 0;
    } else {
        return;
    }

    let new_player_list = rtc.mychannelclients;
    if (new_player_list === current_player_list) {
        return; // If there is nothing to update, return
    } else {
        console.log("UPDATED PLAYER LIST: " + new_player_list);
    }
    
    // Somebody left?
    current_player_list.forEach(function(id) {
        if (!new_player_list.includes(id)) {
            peerLeft(id)
        }
    });

    // Somebody joined?
    new_player_list.forEach(function(id) {
        if (!current_player_list.includes(id)) {
            peerJoined(id)
        }
    });

    // Update current player list
    current_player_list = new_player_list
    rtc.createRTCs(); // Adds needed channels for sending messages
}

//Event listeners
addEventListener('click', (event) => {
    if (currentWeapon === WEAPON_TYPES.PROJECTILE) {
        // Original projectile code
        let angle = Math.atan2(event.clientY - player.y, event.clientX - player.x);
        let velocity = { x: Math.cos(angle) * 2, y: Math.sin(angle) * 2 };
        
        // Generate a unique ID for this projectile
        const projectileId = generateProjectileId();
        
        // Create projectile and add to local arrays/maps
        const projectile = new Projectile(player.x, player.y, 5, 'green', velocity);
        projectiles.push(projectile);
        
        // Add to the projectile map with its unique ID
        projectileMap.set(projectileId, projectile);
        
        // Broadcast this new projectile to other players
        rtc.sendMessage("newproj|" + myid + "|" + JSON.stringify({
            id: projectileId,
            x: projectile.x, 
            y: projectile.y,
            vx: velocity.x,
            vy: velocity.y,
            radius: projectile.radius
        }));
    } 
    else if (currentWeapon === WEAPON_TYPES.HITSCAN) {
        // Check cooldown
        const currentTime = Date.now();
        if (currentTime - lastHitscanTime < HITSCAN_COOLDOWN) {
            console.log(`Hitscan cooling down (${Math.floor((HITSCAN_COOLDOWN - (currentTime - lastHitscanTime)) / 100) / 10}s)`);
            return;
        }
        
        lastHitscanTime = currentTime;
        // Calculate trajectory
        let angle = Math.atan2(event.clientY - player.y, event.clientX - player.x);
        
        // Calculate maximum distance (or use canvas dimensions for sight range)
        const maxDistance = 1000;
        const targetX = player.x + Math.cos(angle) * maxDistance;
        const targetY = player.y + Math.sin(angle) * maxDistance;
        
        // Create and add laser effect
        const laser = new Laser(player.x, player.y, targetX, targetY, 'rgba(255, 0, 0, 0.7)');
        lasers.push(laser);
        
        // Broadcast laser shot to other players
        rtc.sendMessage("laser|" + myid + "|" + JSON.stringify({
            startX: player.x,
            startY: player.y,
            endX: targetX,
            endY: targetY
        }));
        
        // Perform hit detection immediately (since hitscan is instant)
        performHitscanDetection(player.x, player.y, angle, maxDistance);
    }
});

function performHitscanDetection(startX, startY, angle, maxDistance) {
    // Check for hits on other players
    let closestHit = null;
    let closestDistance = maxDistance;
    
    // Check each player for hits
    for (const [playerId, otherPlayer] of playerMap.entries()) {
        if (playerId === myid) continue; // Skip self
        
        // Calculate if the laser intersects with this player's circle
        const dx = otherPlayer.x - startX;
        const dy = otherPlayer.y - startY;
        
        // Calculate the closest point on the line to the circle center
        const projectionLength = dx * Math.cos(angle) + dy * Math.sin(angle);
        
        if (projectionLength < 0) continue; // Behind the laser origin
        if (projectionLength > closestDistance) continue; // Beyond our current closest hit
        
        // Calculate closest point on the line to the circle center
        const closestX = startX + Math.cos(angle) * projectionLength;
        const closestY = startY + Math.sin(angle) * projectionLength;
        
        // Check if this point is within the player's radius
        const distance = Math.hypot(closestX - otherPlayer.x, closestY - otherPlayer.y);
        
        if (distance <= otherPlayer.radius) {
            // We have a hit! Check if it's closer than any previous hit
            if (projectionLength < closestDistance) {
                closestHit = playerId;
                closestDistance = projectionLength;
            }
        }
    }
    
    // If we hit someone, send the hit message
    if (closestHit) {
        console.log("Hit player with laser:", closestHit);
        
        // Notify the hit player
        rtc.sendMessage("hit|" + closestHit + "|" + JSON.stringify({
            by: myid,
            weapon: WEAPON_TYPES.HITSCAN,
            damage: 10 // Hitscan does more damage
        }));
    }
}


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
    // 1. Check enemy collisions with players and projectiles
    // for (let index = enemies.length - 1; index >= 0; index--) {
    //     const enemy = enemies[index];

    //     // Check if player collides with enemy
    //     const playerEnemyDist = Math.hypot(player.x - enemy.x, player.y - enemy.y);
    //     if (playerEnemyDist - enemy.radius - player.radius < 1) {
    //         cancelAnimationFrame(animationId);
    //         rtc.sendMessage("left|" + myid + "|{}");
    //         console.log("Game over - hit by enemy!");
    //         // You could add a game over screen here
    //         return;
    //     }

    //     // Check all projectiles for collisions with enemies
    //     for (const [projId, projectile] of projectileMap.entries()) {
    //         const projEnemyDist = Math.hypot(projectile.x - enemy.x, projectile.y - enemy.y);

    //         // When projectiles touch enemy
    //         if (projEnemyDist - enemy.radius - projectile.radius < 1) {
    //             // Check if it's the local player's projectile (for scoring)
    //             const isLocalProjectile = projId.startsWith(myid);

    //             // Handle enemy hit logic
    //             if (enemy.radius - 10 > 5) {
    //                 // Only increase score if it's your projectile
    //                 if (isLocalProjectile) {
    //                     score += 100;
    //                     scoreEl.innerHTML = score;
    //                 }
    //                 enemy.radius -= 10;

    //                 // Remove the projectile
    //                 projectileMap.delete(projId);
    //                 if (isLocalProjectile) {
    //                     // Only notify about deletion if it's your projectile
    //                     rtc.sendMessage("projdel|" + myid + "|" + JSON.stringify({
    //                         id: projId
    //                     }));
    //                 }
    //             } else {
    //                 // Remove enemy if they are too small
    //                 if (isLocalProjectile) {
    //                     score += 150;
    //                     scoreEl.innerHTML = score;
    //                 }
    //                 enemies.splice(index, 1);
                    
    //                 // Remove the projectile
    //                 projectileMap.delete(projId);
    //                 if (isLocalProjectile) {
    //                     rtc.sendMessage("projdel|" + myid + "|" + JSON.stringify({
    //                         id: projId
    //                     }));
    //                 }
    //             }
    //             break; // Exit the projectile loop for this enemy
    //         }
    //     }
    // }

    // 2. Check collisions between projectiles and other players
    for (const [projId, projectile] of projectileMap.entries()) {
        // Skip if it's the local player's projectile (players can't hit themselves)
        const projectileOwner = projId.split('-')[0]; // Extract owner ID from projectile ID
        if (projectileOwner === myid) continue;

        // Check if this projectile hits the local player
        const projPlayerDist = Math.hypot(projectile.x - player.x, projectile.y - player.y);
        if (projPlayerDist - player.radius - projectile.radius < 1) {
            // Player was hit by another player's projectile
            console.log("Hit by projectile from player:", projectileOwner);
            
            // Remove the projectile
            projectileMap.delete(projId);
            
            // Reduce player health/size or implement other hit effects
            player.radius = Math.max(10, player.radius - 5); // Shrink but don't go below 10
            
            // Notify other players about the hit
            rtc.sendMessage("hit|" + myid + "|" + JSON.stringify({
                by: projectileOwner,
                projId: projId
            }));
            
            // You could implement a death mechanism if player gets too small
            if (player.radius <= 10) {
                cancelAnimationFrame(animationId);
                rtc.sendMessage("left|" + myid + "|{}");
                console.log("Game over - killed by player", projectileOwner);
                // Show game over screen
            }
        }
        
        // Check if this projectile hits any other players
        for (const [otherPlayerId, otherPlayer] of playerMap.entries()) {
            // Skip if it's the projectile owner (can't hit yourself)
            if (otherPlayerId === projectileOwner) continue;
            
            const projOtherPlayerDist = Math.hypot(projectile.x - otherPlayer.x, projectile.y - otherPlayer.y);
            if (projOtherPlayerDist - otherPlayer.radius - projectile.radius < 1) {
                // Another player was hit by someone's projectile
                
                // Only remove the projectile if it's your projectile
                if (projectileOwner === myid) {
                    projectileMap.delete(projId);
                    rtc.sendMessage("projdel|" + myid + "|" + JSON.stringify({
                        id: projId
                    }));
                    
                    // Signal a hit - this lets the other player know they were hit
                    rtc.sendMessage("hit|" + otherPlayerId + "|" + JSON.stringify({
                        by: myid,
                        projId: projId
                    }));
                }
                
                // The size reduction will be handled by the hit player themselves
                break;
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



// player.draw();

// spawnEnemies(); <- TEMP disabled to make testing easier
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
        console.log(`Created new player with ID: ${playerId}`);
    }
    
    return player;
}

function removePlayer(playerId) {
    playerMap.delete(playerId);
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
    rtc.callback = (message) => handleRTCMessages(message);

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

    myid = rtc.myid; // Set myid as a global var as it shouldn't ever change
    current_player_list = rtc.mychannelclients; // RTC keeps an updated player list from the sono server

    console.log(rtc.dataStreams)
    
    // Create other players for players in game
    current_player_list.forEach(function(playerid) {
        if (playerid != myid) {
            getOrCreatePlayer(playerid, -10, -10);
        }
    })
    
    // Setup message handlers for sono and RTC
    //handleMessages();
    rtc.callback = (message) => handleRTCMessages(message);
    
    // Start the game loop
    animate();
}

function sendCords() { // TEMP DISABLED
    // Send player position
    rtc.sendMessage("pos|" + myid + "|" + JSON.stringify({
        x: player.x, 
        y: player.y,
        radius: player.radius
    }));
    
    // Send projectile positions
    projectileMap.forEach((projectile, id) => {
        // Update projectile position
        projectile.update();
        
        // Send updated position to peers
        rtc.sendMessage("projpos|" + myid + "|" + JSON.stringify({
            id: id,
            x: projectile.x, 
            y: projectile.y
        }));
        
        // Remove projectiles that are off-screen
        if (projectile.x < -50 || projectile.x > canvas.width + 50 || 
            projectile.y < -50 || projectile.y > canvas.height + 50) {
            projectileMap.delete(id);
            // Notify peers that projectile should be removed
            rtc.sendMessage("projdel|" + myid + "|" + JSON.stringify({
                id: id
            }));
        }
    });
    
}

const WEAPON_TYPES = {
    PROJECTILE: 'projectile',
    HITSCAN: 'hitscan'
};
  
let currentWeapon = WEAPON_TYPES.PROJECTILE; 
let lastHitscanTime = 0;
const HITSCAN_COOLDOWN = 1000; // 1 second cooldown
// Keep track of other players with their peer IDs
const playerMap = new Map(); // Map peer IDs to Player objects
const projectileMap = new Map();

//MAIN area

let x = canvas.width / 2;
let y = canvas.height / 2;


const projectiles = [];
// Add a global array to store active lasers
const lasers = [];
const enemies = [];

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


// Generate unique IDs for projectiles
let projectileCounter = 0;
function generateProjectileId() {
    return `${myid}-proj-${projectileCounter++}`;
}

function handleRTCMessages(message) {
    // Each RTC Message comes in the format of eventname|senderid|JSONobject
    console.log("RTC: " + message.data);
    let split_message = message.data.split("|");
    let eventname = split_message[0];
    let senderid = split_message[1];
    let packetdata = JSON.parse(split_message[2]);

    // Left game messages
    if (eventname == "left") {
        removePlayer(senderid);
        return;
    }

    // Location update messages
    if (eventname == "pos" && current_player_list.includes(senderid)) {
        console.log("PLAYER POS: " + packetdata.x + ", " + packetdata.y);
        let edit_player = playerMap.get(senderid);
        edit_player.x = Number(packetdata.x)
        edit_player.y = Number(packetdata.y)
        edit_player.radius = Number(packetdata.radius)
        playerMap.set(senderid, edit_player)

        console.print
        return;
    }

    // New projectile message
    if (eventname == "newproj" && current_player_list.includes(senderid)) {
        console.log("New projectile received:", packetdata);
        
        // Create new projectile with the received data
        const projectile = new Projectile(
            Number(packetdata.x),
            Number(packetdata.y),
            5, // radius
            'red', // color for other players' projectiles
            {
                x: Number(packetdata.vx),
                y: Number(packetdata.vy)
            }
        );
        
        // Add to projectile map with the received ID
        projectileMap.set(packetdata.id, projectile);
        return;
    }
    
    // Projectile position update
    if (eventname == "projpos" && current_player_list.includes(senderid)) {
        const projectile = projectileMap.get(packetdata.id);
        if (projectile) {
            projectile.x = Number(packetdata.x);
            projectile.y = Number(packetdata.y);
        }
        return;
    }
    
    // Projectile deletion
    if (eventname == "projdel" && current_player_list.includes(senderid)) {
        projectileMap.delete(packetdata.id);
        return;
    }

    // Hit notification
    if (eventname == "hit" && senderid === myid) {
        console.log("You were hit by player", packetdata.by);
        
        // Implement hit effects - reduce player size/health based on weapon type
        const damage = packetdata.weapon === WEAPON_TYPES.HITSCAN ? 10 : 5;
        player.radius = Math.max(10, player.radius - damage);
        
        // Check if player is now "dead"
        if (player.radius <= 10) {
            cancelAnimationFrame(animationId);
            rtc.sendMessage("left|" + myid + "|{}");
            console.log("Game over - killed by player", packetdata.by);
            // Show game over screen
        }
        return;
    }

    // Add this to your existing handleRTCMessages function
    if (eventname == "laser" && current_player_list.includes(senderid)) {
        console.log("Laser received from:", senderid);
        
        // Create a laser visual effect
        const laser = new Laser(
            Number(packetdata.startX),
            Number(packetdata.startY),
            Number(packetdata.endX),
            Number(packetdata.endY),
            'rgba(255, 0, 0, 0.7)'
        );
        lasers.push(laser);
        return;
    }
}

// Keydown event listener

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
        
        case 'KeyQ': // Q key switches weapons
            // Toggle between weapon types
            currentWeapon = currentWeapon === WEAPON_TYPES.PROJECTILE ? 
                WEAPON_TYPES.HITSCAN : WEAPON_TYPES.PROJECTILE;
            
            // Notify the player which weapon is active
            console.log(`Switched to ${currentWeapon} weapon`);
            
            // Optional: Display weapon type on screen
            const weaponTypeDisplay = document.createElement('div');
            weaponTypeDisplay.style.position = 'absolute';
            weaponTypeDisplay.style.top = '40px';
            weaponTypeDisplay.style.left = '8px';
            weaponTypeDisplay.style.color = 'white';
            weaponTypeDisplay.style.fontFamily = 'sans-serif';
            weaponTypeDisplay.style.padding = '5px';
            weaponTypeDisplay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
            weaponTypeDisplay.textContent = `Weapon: ${currentWeapon.toUpperCase()}`;
            weaponTypeDisplay.id = 'weaponTypeDisplay';
            
            // Remove previous display if it exists
            const oldDisplay = document.getElementById('weaponTypeDisplay');
            if (oldDisplay) document.body.removeChild(oldDisplay);
            
            document.body.appendChild(weaponTypeDisplay);
            
            // Fade out after 2 seconds
            setTimeout(() => {
                weaponTypeDisplay.style.transition = 'opacity 1s';
                weaponTypeDisplay.style.opacity = '0';
            }, 2000);
            
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