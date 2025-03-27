import { SonoClient } from 'https://deno.land/x/sono@v1.2/src/sonoClient.js';
import { SonoRTC } from "./RTC.js";
import { 
  Player, 
  Projectile, 
  Laser, 
  Enemy,
  handleMovement,
  performHitscanDetection,
  spawnEnemies,
  collisionDetection,
  collisionDetectionDelay
} from './classes.js';
import {
  WS_URL,
  NETCODE_TYPES,
  serverConfig,
  getOrCreatePlayer,
  removePlayer,
  waitForConnection,
  waitForRTCConnection,
  handlePeerListChanges,
  handleRTCMessagesDelay,
  handleRTCMessagesRollback,
  sendCords as networkSendCords,
  Packet
} from './network.js';
import {
  WEAPON_TYPES,
  HITSCAN_COOLDOWN,
  generateProjectileId,
  debugSonoConnection,
  debugRTCConnection
} from './utils.js';
import { PriorityQueue } from './prioqueue.js';

// Canvas setup
const canvas = document.querySelector('canvas');
canvas.width = innerWidth;
canvas.height = innerHeight;
const c = canvas.getContext('2d');
const scoreEl = document.querySelector('#scoreEl');

// Game constants and variables
const player_poll_frames = 120;
let poll_counter = 0;
let sono = null;
let rtc = null;
let netcode_type = null; // Holds the nype of netcode being used
let current_player_list = [];

const DELAY_SAMPLES = 10 // The number of samples used to determine how delayed this peer's connection is
const DELAY_FRAME_SIZE = 10 // The number of frames we make wait to make a copy of the player's position
let last_pos_poll_ms = Date.now();
// NOTE: Only used for player position, bullets are much more accurate
const PLAYER_PREV_POS_COUNT = 20
let delay_list = Array(DELAY_SAMPLES); // Delay samples going back DELAY_SAMPLES samples
delay_list.fill(0);
let delay = 0; // The calculated delay used by delay-based netcode
let packet_list = new PriorityQueue(function(a,b) {a.timestamp - b.timestamp});
let latest_pos_ms = 0;
let latest_shoot_ms = 0;

let myid = null;
let animationId;
let score = 0;
let currentWeapon = WEAPON_TYPES.PROJECTILE;
let lastHitscanTime = 0;
let projectileCounter = 0;

// Game objects
const playerMap = new Map();
const projectileMap = new Map();
const projectiles = [];
const lasers = [];
const enemies = [];

// Player setup
const player = new Player(canvas.width / 2, canvas.height / 2, 30, 'blue');

// Input controls
const keys = {
  w: { pressed: false },
  a: { pressed: false },
  s: { pressed: false },
  d: { pressed: false }
};

// Main game loop
function animate() {
  animationId = requestAnimationFrame(animate);
  c.clearRect(0, 0, canvas.width, canvas.height);

  // Show frame delay
  switch(netcode_type) {
    case 0:
      // Average Delay Based, delay = average of packet delays from peers
      delay = delay_list.reduce((a, b) => a + b) / delay_list.length;
      break;
    case 1:
      // Maximum Delay Based, delay = most delayed package from peers 
      delay = Math.max(...delay_list);
      break;
    default:
      // Rollback/Default  
  } 

  // delay = Math.floor(Math.random() * 700); // TEMP FOR TESTING DELAYED INPUTS
  // delay = 200; // TEMP FOR TESTING DELAYED INPUTS WORK

  document.getElementsByClassName("delaylist")[0].innerHTML = delay_list.toString() + "<br/>Functional Delay: " + delay;

  const peerChanges = handlePeerListChanges(
    rtc,
    current_player_list,
    player_poll_frames,
    poll_counter,
    peerLeft,
    peerJoined
  );
  
  poll_counter = peerChanges.updatedPollCounter;
  if (peerChanges.updated) {
    current_player_list = peerChanges.updatedPlayerList;
  }
  
  if (netcode_type == 2) {
    handleMovement(player, keys);
  } else {
    handleMovementDelay(player, keys);
  }

  // pollPosition() // See if we need to poll a new player pos

  if (netcode_type != 2) {
    player.draw_at_delay(c);
  } else {
    player.draw(c);
  }

  for (const [_id, playerObj] of playerMap) {
    playerObj.draw(c);
  }

  for (const [_id, proj] of projectileMap) {
    if (netcode_type != 2) {
      proj.draw_at_delay(c, Date.now());
    } else {
      proj.draw(c);
    }
  }
  
  for (let i = lasers.length - 1; i >= 0; i--) {
    if (!lasers[i].draw(c)) {
      lasers.splice(i, 1);
    }
  }

  enemies.forEach((enemy) => {
    enemy.update();
    enemy.draw(c);
  });

  if (netcode_type == 2) {
    collisionDetection(
      player,
      playerMap,
      projectileMap,
      enemies,
      myid,
      (evnt, msg) => broadcastRTC(evnt, msg),
      scoreEl,
      animationId,
      cancelAnimationFrame
    );
  } else { // Use delay-based colission detection here to compensate for fact that internal and delayed player positions are different
    collisionDetectionDelay(
      player,
      playerMap,
      projectileMap,
      enemies,
      myid,
      (evnt, msg) => broadcastRTC(evnt, msg),
      scoreEl,
      animationId,
      cancelAnimationFrame
    );
  }
  
  sendCords();
}

// DELAY-BASED FUNCTIONS

function delayedAction(type, arg, time) {
  // A callback used to perform delayed actions
  // console.log("DELAYED ACTION: " + type + " | " + arg + "| DELAY = " + (Date.now() - time))
  if (type == "new_pos" && latest_pos_ms <= time) {
    player.delay_x = arg[0]
    player.delay_y = arg[1]
    latest_pos_ms = time
  }
  else if (type == "proj") {
    let edit_proj = projectileMap.get(arg);
    if (edit_proj) {
      edit_proj.delay = false;
      projectileMap.set(arg, edit_proj);
    }
    latest_shoot_ms = time
  }
}

function handleMovementDelay(player, keys, speed = 3) {
  
  // Handle movement and then check to see if we need to track movement
  handleMovement(player, keys, speed);

  if (keys.w.pressed || keys.a.pressed || keys.s.pressed || keys.d.pressed) {
    let new_x = player.x
    let new_y = player.y
    let curtime = Date.now();
    globalThis.setTimeout(function() {delayedAction("new_pos", [new_x, new_y], curtime)}, delay)
  }
}

// Helper functions
function peerLeft(peerid) {
  console.log("PEER LEFT: " + peerid);
  removePlayer(playerMap, peerid);
}

function peerJoined(peerid) {
  console.log("PEER JOINED: " + peerid);
  getOrCreatePlayer(playerMap, peerid, 0, 0);
}

function sendCords() {
  networkSendCords(
    rtc,
    myid, 
    player,
    projectileMap,
    canvas
  );
}

function broadcastRTC(packet_type, packet_body) {
  // This will make it easier to standardize how packets are sent
  if (!packet_body) {
    console.log("INVALID PACKET!")
    console.log(`${packet_type}|${myid}|${Date.now()}|${packet_body}`)
    return;
  }
  rtc.sendMessage(`${packet_type}|${myid}|${Date.now()}|${packet_body}`);
}

function establishRTCConnection(lobbyid) {
  console.log("SONO CONNECTED!");

  rtc = new SonoRTC(serverConfig, sono, {});
  sono.changeChannel(lobbyid);
  rtc.changeChannel(lobbyid);
  
  // Use different handleRTCMessages function depending on netcode type
  if (netcode_type < 2) { // Delay Based Netcode
    rtc.callback = (message) => handleRTCMessagesDelay(
      message,
      current_player_list,
      playerMap,
      projectileMap,
      player,
      myid,
      rtc,
      lasers,
      animationId,
      cancelAnimationFrame,
      sendCords,
      (netcode_type * 2) + 2, // 2 frames for DELAY-2 (0), 4 frames for DELAY-4 (1)
      delay_list,
      packet_list
    );
  } else { // Rollback Based netcode
    rtc.callback = (message) => handleRTCMessagesRollback(
      message,
      current_player_list,
      playerMap,
      projectileMap,
      player,
      myid,
      rtc,
      lasers,
      animationId,
      cancelAnimationFrame,
      sendCords
    );
  }

  waitForRTCConnection(rtc, gameCode);
}

function gameCode() {
  console.log("RTC CONNECTED!");

  myid = rtc.myid;
  current_player_list = rtc.mychannelclients;

  current_player_list.forEach(function(playerid) {
    if (playerid != myid) {
      getOrCreatePlayer(playerMap, playerid, -10, -10);
    }
  });
  
  broadcastRTC("forceupdate", "{}");
  sendCords();
  animate();
}

function main() {
  let spliturl = window.location.href.split("/");
  let lobbyinfo = spliturl[spliturl.length - 1];
  lobbyinfo = lobbyinfo.split("?")
  let lobbyid = lobbyinfo[0];
  netcode_type = Number(lobbyinfo[1]);
  let lobbynameelm = document.getElementsByClassName("lobbyname")[0];
  let netcodetypeelm = document.getElementsByClassName("netcodetype")[0];
  lobbynameelm.innerHTML = "LOBBY ID: " + lobbyid;
  netcodetypeelm.innerHTML = "NETCODE TYPE: " + NETCODE_TYPES[netcode_type];

  sono = new SonoClient(WS_URL + '/join/' + lobbyid);
  waitForConnection(sono, lobbyid, establishRTCConnection);
}

// Event listeners
addEventListener('click', (event) => {
  if (currentWeapon === WEAPON_TYPES.PROJECTILE) {

    let angle = Math.atan2(event.clientY - player.y, event.clientX - player.x);
    let velocity = { x: Math.cos(angle) * 2, y: Math.sin(angle) * 2 };
    
    const projectileId = generateProjectileId(myid, projectileCounter++);
    let projectile;
    if (netcode_type != 2) {
      projectile = new Projectile(player.x, player.y, 5, 'green', velocity, Date.now() + delay, true);
    } else {
      projectile = new Projectile(player.x, player.y, 5, 'green', velocity, Date.now(), false);
    }
    projectiles.push(projectile);
    projectileMap.set(projectileId, projectile);
    
    broadcastRTC("newproj", JSON.stringify({
      id: projectileId,
      x: projectile.x, 
      y: projectile.y,
      vx: velocity.x,
      vy: velocity.y,
      radius: projectile.radius
    }));

    if (netcode_type != 2) { // Set up delay parts if using delay based netcode
      let time = Date.now();
      globalThis.setTimeout(function() {delayedAction("proj", projectileId, time)}, delay)
      return;
    }
  } 
  else if (currentWeapon === WEAPON_TYPES.HITSCAN) {
    const currentTime = Date.now();
    if (currentTime - lastHitscanTime < HITSCAN_COOLDOWN) {
      console.log(`Hitscan cooling down (${Math.floor((HITSCAN_COOLDOWN - (currentTime - lastHitscanTime)) / 100) / 10}s)`);
      return;
    }
    
    lastHitscanTime = currentTime;
    let angle = Math.atan2(event.clientY - player.y, event.clientX - player.x);
    
    const maxDistance = 1000;
    const targetX = player.x + Math.cos(angle) * maxDistance;
    const targetY = player.y + Math.sin(angle) * maxDistance;
    
    const laser = new Laser(player.x, player.y, targetX, targetY, 'rgba(255, 0, 0, 0.7)');
    lasers.push(laser);
    
    broadcastRTC("laser", JSON.stringify({
      startX: player.x,
      startY: player.y,
      endX: targetX,
      endY: targetY
    }));
    
    performHitscanDetection(
      player.x, 
      player.y, 
      angle, 
      maxDistance, 
      playerMap, 
      myid, 
      (msg) => broadcastRTC(msg)
    );
  }
});

window.addEventListener('keydown', (event) => {
  switch (event.code) {
    case 'KeyW':
      keys.w.pressed = true;
      break;
    case 'KeyA':
      keys.a.pressed = true;
      break;
    case 'KeyS':
      keys.s.pressed = true;
      break;
    case 'KeyD':
      keys.d.pressed = true;
      break;
    case 'KeyQ':
    // TEMP: DISABLING ALT WEAPON JUST TO ENSURE THAT DELAY BASED NETCODE WORKS FULLY
    break;
      currentWeapon = currentWeapon === WEAPON_TYPES.PROJECTILE ? 
          WEAPON_TYPES.HITSCAN : WEAPON_TYPES.PROJECTILE;
      
      console.log(`Switched to ${currentWeapon} weapon`);
      
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
      
      const oldDisplay = document.getElementById('weaponTypeDisplay');
      if (oldDisplay) document.body.removeChild(oldDisplay);
      
      document.body.appendChild(weaponTypeDisplay);
      
      setTimeout(() => {
        weaponTypeDisplay.style.transition = 'opacity 1s';
        weaponTypeDisplay.style.opacity = '0';
      }, 2000);
      break;
  }
});

window.addEventListener('keyup', (event) => {
  switch (event.code) {
    case 'KeyW':
      keys.w.pressed = false;
      break;
    case 'KeyA':
      keys.a.pressed = false;
      break;
    case 'KeyS':
      keys.s.pressed = false;
      break;
    case 'KeyD':
      keys.d.pressed = false;
      break;
  }
});

window.onload = main;