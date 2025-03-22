import { SonoClient } from 'https://deno.land/x/sono@v1.2/src/sonoClient.js';
import { Player, Projectile, Laser } from './classes.js';
import { WEAPON_TYPES } from './utils.js';

const serverConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.l.google.com:5349" },
    { urls: "stun:stun1.l.google.com:3478" },
    { urls: "stun:stun1.l.google.com:5349" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:5349" }
  ]
};

const WS_URL = "ws://localhost:3001"; // <- UPDATE TO CORRECT URL!!!
const NETCODE_TYPES = ["DELAY-2", "DELAY-4", "ROLLBACK"];

function getOrCreatePlayer(playerMap, playerId, initialX, initialY) {
  if (playerId === undefined) {
    playerId = 1;
  }
  
  let player = playerMap.get(playerId);
  
  if (!player) {
    player = new Player(initialX, initialY, 30, 'red');
    playerMap.set(playerId, player);
    console.log(`Created new player with ID: ${playerId}`);
  }
  
  return player;
}

function removePlayer(playerMap, playerId) {
  playerMap.delete(playerId);
}

function waitForConnection(sono, lobbyid, establishRTCConnection) {
  if (sono.ws.readyState === 0) {
    globalThis.setTimeout(() => waitForConnection(sono, lobbyid, establishRTCConnection), 1000);
  } else {
    establishRTCConnection(lobbyid);
  }
}

function waitForRTCConnection(rtc, gameCode) {
  if (!rtc.mychannel) {
    globalThis.setTimeout(() => waitForRTCConnection(rtc, gameCode), 1000);
  } else {
    gameCode();
  }
}

function handlePeerListChanges(
  rtc,
  current_player_list,
  player_poll_frames,
  poll_counter,
  peerLeft,
  peerJoined
) {
  let updatedPollCounter = poll_counter + 1;
  if (updatedPollCounter >= player_poll_frames) {
    rtc.server.grab('mychannelclients');
    updatedPollCounter = 0;
  } else {
    return { updatedPollCounter, updated: false };
  }

  let new_player_list = rtc.mychannelclients;
  if (new_player_list === current_player_list) {
    return { updatedPollCounter, updated: false };
  }
  
  console.log("UPDATED PLAYER LIST: " + new_player_list);
  
  current_player_list.forEach(function(id) {
    if (!new_player_list.includes(id)) {
      peerLeft(id);
    }
  });

  new_player_list.forEach(function(id) {
    if (!current_player_list.includes(id)) {
      peerJoined(id);
    }
  });

  rtc.createRTCs();
  
  return {
    updatedPollCounter,
    updatedPlayerList: new_player_list,
    updated: true
  };
}

function handleRTCMessagesDelay(
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
  delayFrames
) {
  console.log("RTC: " + message.data);
  let split_message = message.data.split("|");
  let eventname = split_message[0];
  let senderid = split_message[1];
  let timestamp = split_message[2];
  let packetdata = JSON.parse(split_message[3]);

  // Left game messages
  if (eventname === "left") {
    removePlayer(playerMap, senderid);
    return;
  }

  // Location update messages
  if (eventname === "pos" && current_player_list.includes(senderid)) {
    let edit_player = playerMap.get(senderid);
    if (edit_player) {
      edit_player.x = Number(packetdata.x);
      edit_player.y = Number(packetdata.y);
      edit_player.radius = Number(packetdata.radius);
      playerMap.set(senderid, edit_player);
    }
    return;
  }

  // New projectile message
  if (eventname === "newproj" && current_player_list.includes(senderid)) {
    const projectile = new Projectile(
      Number(packetdata.x),
      Number(packetdata.y),
      5,
      'red',
      {
        x: Number(packetdata.vx),
        y: Number(packetdata.vy)
      }
    );
    
    projectileMap.set(packetdata.id, projectile);
    return;
  }
  
  // Projectile position update
  if (eventname === "projpos" && current_player_list.includes(senderid)) {
    const projectile = projectileMap.get(packetdata.id);
    if (projectile) {
      projectile.x = Number(packetdata.x);
      projectile.y = Number(packetdata.y);
    }
    return;
  }
  
  // Projectile deletion
  if (eventname === "projdel" /*&& (current_player_list.includes(senderid) || senderid === myid)*/) {
    const projectile = projectileMap.get(packetdata.id);
    if (projectile) {
      projectile.color = "pink";
    }
    projectileMap.delete(packetdata.id);
    return;
  }

  // Hit notification
  if (eventname === "hit" && senderid === myid) {
    console.log("You were hit by player", packetdata.by);

    //THis message was added trying to debug the projectile not spawning on player side
    rtcSendMessage("projdel|" + myid + "|" + JSON.stringify({
        id: projId
      }));
    const damage = packetdata.weapon === WEAPON_TYPES.HITSCAN ? 10 : 5;
    player.radius = Math.max(10, player.radius - damage);
    
    if (player.radius <= 10) {
      cancelAnimationFrame(animationId);
      rtc.sendMessage("left|" + myid + "|" + Date.now() + "|{}");
      console.log("Game over - killed by player", packetdata.by);
    }
    return;
  }

  // Laser message
  if (eventname === "laser" && current_player_list.includes(senderid)) {
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

  // Force update
  if (eventname === "forceupdate") {
    sendCords();
    return;
  }
}

function handleRTCMessagesRollback(
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
) {
  console.log("RTC: " + message.data);
  let split_message = message.data.split("|");
  let eventname = split_message[0];
  let senderid = split_message[1];
  let timestamp = split_message[2];
  let packetdata = JSON.parse(split_message[3]);

  // Left game messages
  if (eventname === "left") {
    removePlayer(playerMap, senderid);
    return;
  }

  // Location update messages
  if (eventname === "pos" && current_player_list.includes(senderid)) {
    let edit_player = playerMap.get(senderid);
    if (edit_player) {
      edit_player.x = Number(packetdata.x);
      edit_player.y = Number(packetdata.y);
      edit_player.radius = Number(packetdata.radius);
      playerMap.set(senderid, edit_player);
    }
    return;
  }

  // New projectile message
  if (eventname === "newproj" && current_player_list.includes(senderid)) {
    const projectile = new Projectile(
      Number(packetdata.x),
      Number(packetdata.y),
      5,
      'red',
      {
        x: Number(packetdata.vx),
        y: Number(packetdata.vy)
      }
    );
    
    projectileMap.set(packetdata.id, projectile);
    return;
  }
  
  // Projectile position update
  if (eventname === "projpos" && current_player_list.includes(senderid)) {
    const projectile = projectileMap.get(packetdata.id);
    if (projectile) {
      projectile.x = Number(packetdata.x);
      projectile.y = Number(packetdata.y);
    }
    return;
  }
  
  // Projectile deletion
  if (eventname === "projdel" /*&& (current_player_list.includes(senderid) || senderid === myid)*/) {
    const projectile = projectileMap.get(packetdata.id);
    if (projectile) {
      projectile.color = "pink";
    }
    projectileMap.delete(packetdata.id);
    return;
  }

  // Hit notification
  if (eventname === "hit" && senderid === myid) {
    console.log("You were hit by player", packetdata.by);

    //THis message was added trying to debug the projectile not spawning on player side
    rtcSendMessage("projdel|" + myid + "|" + JSON.stringify({
        id: projId
      }));
    const damage = packetdata.weapon === WEAPON_TYPES.HITSCAN ? 10 : 5;
    player.radius = Math.max(10, player.radius - damage);
    
    if (player.radius <= 10) {
      cancelAnimationFrame(animationId);
      rtc.sendMessage("left|" + myid + "|" + Date.now() + "|{}");
      console.log("Game over - killed by player", packetdata.by);
    }
    return;
  }

  // Laser message
  if (eventname === "laser" && current_player_list.includes(senderid)) {
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

  // Force update
  if (eventname === "forceupdate") {
    sendCords();
    return;
  }
}

function sendCords(
  rtc,
  myid,
  player,
  projectileMap,
  canvas
) {
  rtc.sendMessage("pos|" + myid + "|" + Date.now() +  "|" + JSON.stringify({
    x: player.x, 
    y: player.y,
    radius: player.radius
  }));
  
  projectileMap.forEach((projectile, id) => {
    projectile.update();
    
    rtc.sendMessage("projpos|" + myid + "|" + Date.now() +  "|" + JSON.stringify({
      id: id,
      x: projectile.x, 
      y: projectile.y
    }));
    
    if (projectile.x < -50 || projectile.x > canvas.width + 50 || 
        projectile.y < -50 || projectile.y > canvas.height + 50) {
      projectileMap.delete(id);
      rtc.sendMessage("projdel|" + myid + "|" + Date.now() +  "|" + JSON.stringify({
        id: id
      }));
      
    }
  });
}

export { 
  serverConfig, 
  WS_URL,
  NETCODE_TYPES,
  getOrCreatePlayer, 
  removePlayer, 
  waitForConnection, 
  waitForRTCConnection, 
  handlePeerListChanges, 
  handleRTCMessagesDelay, 
  handleRTCMessagesRollback, 
  sendCords 
};