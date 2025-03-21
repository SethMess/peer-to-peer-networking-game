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
  collisionDetection 
} from './classes.js';
import {
  WS_URL,
  serverConfig,
  getOrCreatePlayer,
  removePlayer,
  waitForConnection,
  waitForRTCConnection,
  handlePeerListChanges,
  handleRTCMessages,
  sendCords as networkSendCords
} from './network.js';
import {
  WEAPON_TYPES,
  HITSCAN_COOLDOWN,
  generateProjectileId,
  debugSonoConnection,
  debugRTCConnection
} from './utils.js';

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
let current_player_list = [];
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
  
  handleMovement(player, keys);

  player.draw(c);

  for (const [_id, playerObj] of playerMap) {
    playerObj.draw(c);
  }

  for (const [_id, proj] of projectileMap) {
    proj.draw(c);
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

  collisionDetection(
    player,
    playerMap,
    projectileMap,
    enemies,
    myid,
    (msg) => rtc.sendMessage(msg),
    scoreEl,
    animationId,
    cancelAnimationFrame
  );
  
  sendCords();
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

function establishRTCConnection(lobbyid) {
  console.log("SONO CONNECTED!");

  rtc = new SonoRTC(serverConfig, sono, {});
  sono.changeChannel(lobbyid);
  rtc.changeChannel(lobbyid);
  rtc.callback = (message) => handleRTCMessages(
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
  
  rtc.callback = (message) => handleRTCMessages(
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
  
  rtc.sendMessage("forceupdate|" + myid + "|{}");
  sendCords();
  animate();
}

function main() {
  let spliturl = window.location.href.split("/");
  let lobbyid = spliturl[spliturl.length - 1];
  let lobbynameelm = document.getElementsByClassName("lobbyname")[0];
  lobbynameelm.innerHTML = "LOBBY ID: " + lobbyid;

  sono = new SonoClient(WS_URL + '/join/' + lobbyid);
  waitForConnection(sono, lobbyid, establishRTCConnection);
}

// Event listeners
addEventListener('click', (event) => {
  if (currentWeapon === WEAPON_TYPES.PROJECTILE) {
    let angle = Math.atan2(event.clientY - player.y, event.clientX - player.x);
    let velocity = { x: Math.cos(angle) * 2, y: Math.sin(angle) * 2 };
    
    const projectileId = generateProjectileId(myid, projectileCounter++);
    const projectile = new Projectile(player.x, player.y, 5, 'green', velocity);
    projectiles.push(projectile);
    projectileMap.set(projectileId, projectile);
    
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
    
    rtc.sendMessage("laser|" + myid + "|" + JSON.stringify({
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
      (msg) => rtc.sendMessage(msg)
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