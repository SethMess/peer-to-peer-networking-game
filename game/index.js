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
import { GameState, InputBuffer, RollbackManager } from './rollback.js';


// Canvas setup
const canvas = document.querySelector('canvas');
canvas.width = innerWidth;
canvas.height = innerHeight;
const c = canvas.getContext('2d');
const scoreEl = document.querySelector('#scoreEl');
const delaycheckbox = document.getElementById("enableartdelay");
const delaysettings = document.getElementById("delaysettings");
const delayslider = document.getElementById("artdelay");
const delaysliderrand = document.getElementById("artdelayrand");
const delaysliderhead = document.getElementById("delaysliderhead");

// Game constants and variables
const player_poll_frames = 120;
let poll_counter = 0;
let sono = null;
let rtc = null;
let netcode_type = null; // Holds the nype of netcode being used
let current_player_list = [];

let delay_dict = {}; // Stores data of incoming delay for each player, used to send out "pong" packets
let DELAY_SEND_INTERVAL = 100;
let DELAY_SAMPLE_SIZE = 10;
let delay_list = Array(DELAY_SAMPLE_SIZE)
delay_list.fill(0);
let delay = 0; // The calculated delay used by delay-based netcode
let packet_list = new PriorityQueue(function (a, b) { a.timestamp - b.timestamp });
let latest_pos_ms = 0;
let art_delay = 0;
let art_delay_rand = 0;
let art_delay_enabled = false;
let isInitialSyncComplete = false;
let isHost = false;

let myid = null;
let animationId;
let score = 0;
let currentWeapon = WEAPON_TYPES.PROJECTILE;
let lastHitscanTime = 0;
let projectileCounter = 0;

// Rollback manager
let rollbackManager = null;


// Game objects
const playerMap = new Map();
const projectileMap = new Map();
const projectiles = [];
const lasers = [];
const enemies = [];

// Player setup
let player = new Player(canvas.width / 2, canvas.height / 2, 30, 'blue');

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
  switch (netcode_type) {
    case 0:
      // Average Delay Based, delay = average of packet delays from peers
      delay = delay_list.reduce((a, b) => a + b) / delay_list.length;
      break;
    case 1:
      // Maximum Delay Based, delay = most delayed package from peers 
      delay = Math.max(...delay_list);
      break;
    case 2:
      // Rollback/Default  
      const currentInput = {
        w: keys.w.pressed,
        a: keys.a.pressed,
        s: keys.s.pressed,
        d: keys.d.pressed
      };
      rollbackManager.recordLocalInput(currentInput);

      // Update the rollback simulation state
      rollbackManager.update();

      // Send input to peers
      broadcastRTC("input", JSON.stringify({
        frame: rollbackManager.currentFrame,
        input: currentInput
      }));
      break;
    default:


  }



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
    // handleMovement(player, keys);
    // For rollback, movement is already handled inside the rollback manager
  } else {
    handleMovementDelay(player, keys);
  }



  for (const [_id, playerObj] of playerMap) {
    let drawColor = playerObj.color;

    if (_id === myid) {
      drawColor = 'blue';
    } else {
      drawColor = 'red';
    }
    const originalColor = playerObj.color;
    playerObj.color = drawColor;

    // Perform the draw call
    if (netcode_type != 2) {
      if (_id === myid) {
        // Draw local player at delayed position
        playerObj.draw_at_delay(c);
      } else {
        // Draw remote players at their latest known position (updated by network)
        playerObj.draw(c);
      }
    } else {
      playerObj.draw(c);
    }

    playerObj.color = originalColor;

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
    // For rollback, collisions are already handled by the rollback manager
    // however we still need network messages
    // update removed cause of double collisions
    // collisionDetection(
    //   player,
    //   playerMap,
    //   projectileMap,
    //   enemies,
    //   myid,
    //   (evnt, msg) => broadcastRTC(evnt, msg),
    //   scoreEl,
    //   animationId,
    //   cancelAnimationFrame
    // );
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

  if (netcode_type === 2 && rollbackManager.isShowingRollbackIndicator()) {
    const elapsed = Date.now() - rollbackManager.lastRollbackTime;
    const opacity = 1 - (elapsed / rollbackManager.rollbackIndicatorDuration);

    c.fillStyle = `rgba(255, 0, 0, ${opacity * 0.1})`;
    c.fillRect(0, 0, canvas.width, canvas.height);


    c.font = '20px Arial';
    c.fillStyle = `rgba(255, 255, 255, ${opacity})`;
    c.fillText(`Rollback: ${rollbackManager.rollbackFrames} frames`, 20, 50);
  }
}

// DELAY-BASED FUNCTIONS

function delayedAction(type, arg, time) {

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
  }
}

function handleMovementDelay(player, keys, speed = 3) {

  // Handle movement and then check to see if we need to track movement
  handleMovement(player, keys, speed);

  if (keys.w.pressed || keys.a.pressed || keys.s.pressed || keys.d.pressed) {
    let new_x = player.x
    let new_y = player.y
    let curtime = Date.now();
    globalThis.setTimeout(function () { delayedAction("new_pos", [new_x, new_y], curtime) }, delay)
  }
}

// Helper functions
function peerLeft(peerid) {
  console.log("PEER LEFT: " + peerid);
  delete delay_dict[peerid];
  removePlayer(playerMap, peerid);
}

function peerJoined(peerid) {
  console.log("PEER JOINED: " + peerid);
  getOrCreatePlayer(playerMap, peerid, 0, 0);

  if (netcode_type === 2 && rollbackManager) {
    // Capture the absolute latest state (might be slightly ahead of last saved state)
    // Or grab the most recent state from rollbackManager.frameStates if available and preferred
    const latestState = GameState.captureState(rollbackManager.currentFrame, playerMap, projectileMap);
    const syncData = {
      frame: rollbackManager.currentFrame,
      // Serialize the state. Convert Maps to Arrays of [key, value] pairs for JSON
      state: {
        timestamp: latestState.timestamp,
        players: Array.from(latestState.players.entries()),
        projectiles: Array.from(latestState.projectiles.entries())
      }
    }

    const syncMessageString = `initialSync|${myid}|${Date.now()}|${JSON.stringify(syncData)}`;
    console.log(`[Host] Direct Sync Message Length: ${syncMessageString.length}`); // Check length
    try {
      // Assuming rtc.sendMessage targets all peers or handles specific peer targeting internally.
      // If SonoRTC requires specific peer targeting, adjust this call.
      rtc.sendMessage(syncMessageString);
      console.log(`[Host] Sent direct initialSync message via rtc.sendMessage.`);
    } catch (e) {
      console.error(`[Host] Error sending direct initialSync message:`, e);
    }

  }


  // Add peer to list used for delay calculation etc.
  if (!current_player_list.includes(peerid)) {
    current_player_list.push(peerid);
    delay_list.push(0); // Initialize delay for the new peer
  }

}

function sendCords() {
  networkSendCords(
    rtc,
    myid,
    player,
    projectileMap,
    broadcastRTC,
    canvas,
    netcode_type
  );
}

function sendDelayInfo() {
  // Used to send out intermittent delay packets
  broadcastRTC("pong", JSON.stringify(delay_dict));
  globalThis.setTimeout(function () { sendDelayInfo(); }, DELAY_SEND_INTERVAL)
}

function broadcastRTC(packet_type, packet_body) {
  // This will make it easier to standardize how packets are sent
  // Also allows for artifical delay to be introduced for testing

  if (!packet_body) {
    console.log("INVALID PACKET!")
    console.log(`${packet_type}|${myid}|${Date.now()}|${packet_body}`)
    return;
  }

  let time = Date.now()
  let message = `${packet_type}|${myid}|${time}|${packet_body}`;
  let rand_delay = Number(Math.random() * art_delay_rand)

  if (art_delay_enabled) { // Artifical delay
    // console.log(rand_delay + art_delay)
    // final_delay = final_delay + (Math.random() * art_delay_rand)
    globalThis.setTimeout(function () { rtc.sendMessage(message); }, rand_delay + art_delay)
  } else { // No artifical delay
    rtc.sendMessage(message);
  }
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
      delay_dict,
      delay_list,
      packet_list
    );
  } else { // Rollback Based netcode

    if (!rollbackManager) {
      // Initialize with placeholder myid if gameCode hasn't run yet
      rollbackManager = new RollbackManager(playerMap, projectileMap, myid || 'pending');
    }

    rtc.callback = (message) => { // message is likely the raw event object { data: "..." }
      // --- Log raw message arrival ---
      // console.log("[Client Debug] Raw message received:", message); // LOG 1

      if (message.data.startsWith('initialSync|')) {
        // console.log("[Client Callback HINT] Received a message starting with 'initialSync|'");
      }

      if (!message || !message.data) {
        // console.error("[Client Debug] Received empty or invalid message object.");
        return;
      }

      let type, senderid, body;
      try {
        const messageString = message.data;
        const parts = messageString.split('|');
        // if (parts.length < 4) throw new Error("Invalid message format");
        type = parts[0];
        senderid = parts[1];
        if (senderid === myid) {
          // console.log(`[Client Debug] Ignoring message from self.`); // Optional: for debugging
          return;
        }

      } catch (e) {
        // console.error("[Client Debug] Error parsing RTC message:", message.data, e);
        return;
      }
      // --- End Parsing ---

      // --- Handle Initial Sync Directly Here ---
      if (type === 'initialSync') {
        // LOG A: Entered initialSync block
        // console.log(`[Client Callback] Processing 'initialSync' from ${senderid}. Current State: isHost=${isHost}, isInitialSyncComplete=${isInitialSyncComplete}`);

        if (!isHost && !isInitialSyncComplete) {
          // LOG B: Conditions met for processing
          // console.log("[Client Callback] Conditions met, attempting to apply initial sync...");
          try {
            // --- Re-parse body specifically for syncData ---
            const messageString = message.data;
            const parts = messageString.split('|');
            if (parts.length < 4) throw new Error("Sync message has too few parts");
            const syncBody = parts.slice(3).join('|');
            // LOG C: About to parse JSON
            // console.log("[Client Callback] Parsing sync JSON body:", syncBody);
            const syncData = JSON.parse(syncBody);
            // LOG D: Parsed sync data frame
            // console.log(`[Client Callback] Parsed sync data. Frame: ${syncData.frame}`);

            const receivedState = new GameState(syncData.state.timestamp);
            receivedState.players = new Map(syncData.state.players);
            receivedState.projectiles = new Map(syncData.state.projectiles);


            playerMap.clear();
            projectileMap.clear();


            receivedState.apply(playerMap, projectileMap); // Check console for errors from apply()



            if (!rollbackManager) {
              console.error("[Client Callback] CRITICAL: rollbackManager is null/undefined before setting frame!");
            } else {
              rollbackManager.currentFrame = syncData.frame;
            }


            // LOG I: Checking local player reference
            if (myid && myid !== 'pending') {
              if (playerMap.has(myid)) {
                player = playerMap.get(myid);
                // Explicitly set local player color AFTER sync application
                player.color = 'blue';
                console.log(`[Client Callback] Updated local player reference (ID: ${myid}) and set color to blue.`);
              } else {
                console.error(`[Client Callback] CRITICAL: Local player ID ${myid} NOT found in playerMap after sync! State apply likely failed.`);
              }
            } else {
              console.warn(`[Client Callback] Cannot verify local player reference: myid is '${myid}'.`);
            }

            // LOG J: Setting sync complete flag
            isInitialSyncComplete = true;
            console.log(`[Client Callback] SUCCESS: SET isInitialSyncComplete = ${isInitialSyncComplete}. Sync process finished.`);

          } catch (error) {
            // LOG K: Error during processing
            console.error("[Client Callback] CRITICAL ERROR processing initialSync message:", error);
            // Log the raw data again on error
            console.error("[Client Callback] Failing message data:", message.data);
          }
        } else {
          // LOG L: Ignoring sync (already host or synced)
          console.log(`[Client Callback] Ignoring initialSync because conditions not met (isHost=${isHost}, isInitialSyncComplete=${isInitialSyncComplete}).`);
        }
      }
      // --- Only call handler for other messages AFTER sync ---
      else if (isInitialSyncComplete || isHost) {
        // console.log(`[Client Debug] Passing message to handleRTCMessagesRollback: type=${type}, sender=${senderid}`); // LOG 8
        // Pass the RAW message object as per your preference
        handleRTCMessagesRollback(
          message, // Pass raw message object
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
          rollbackManager
        );
      } else {
        // console.log(`[Client Debug] Ignoring message type '${type}' from ${senderid} - initial sync not yet complete.`); // LOG 9
      }
    }; // End of rtc.callback assignment

  }

  waitForRTCConnection(rtc, gameCode);
}

function gameCode() {
  console.log("RTC CONNECTED!");

  myid = rtc.myid;
  current_player_list = rtc.mychannelclients;

  let sortedPeers = [];
  if (current_player_list && current_player_list.length > 0) {
    sortedPeers = [...current_player_list].sort();
    isHost = (sortedPeers[0] === myid);
    console.log(`Determined host status: ${isHost}. Lowest ID: ${sortedPeers[0]}, My ID: ${myid}`);
  } else {
    console.warn("Peer list empty or undefined during host determination, assuming host.");
    isHost = true;
  }
  if (!isInitialSyncComplete) {
    isInitialSyncComplete = isHost;
  }
  if (isHost) console.log("This client is the HOST.");
  else console.log("This client is a CLIENT. Waiting for initial sync...");

  if (netcode_type === 2) {
    if (!rollbackManager) { // If not created early by client callback setup
      rollbackManager = new RollbackManager(playerMap, projectileMap, myid);
    } else { // If created early by client callback setup
      rollbackManager.myId = myid; // Ensure myId is set correctly
      console.log(`[RollbackManager Client] Updated myId to ${myid}`);
    }
  }


  // playerMap.set(myid, player); // Add the existing local 'player' object to the map
  // player.color = 'blue'; // Ensure local player color is set (or set in constructor)

  let localPlayerObject = playerMap.get(myid);
  if (!localPlayerObject) {
    // Use initial properties from the global 'player' only if not in map yet
    localPlayerObject = new Player(player.x, player.y, player.radius, player.color); // Or use default spawn pos
    playerMap.set(myid, localPlayerObject);
    console.log(`[gameCode] Created local player ${myid} in map.`);
  } else {
    // Player might exist if created during state application before gameCode fully ran
    console.log(`[gameCode] Local player ${myid} already exists in map.`);
  }
  // Ensure the global 'player' variable references the object in the map
  player = localPlayerObject;
  player.color = 'blue'; // Explicitly set local player color if needed

  current_player_list.forEach(function (playerid) {
    if (playerid != myid) {
      getOrCreatePlayer(playerMap, playerid, -10, -10);
    }
  });


  if (isHost && current_player_list.length > 1) {
    console.log("[Host] Broadcasting initial state to existing peers.");
    current_player_list.forEach(peerId => {
      if (peerId !== myid) {
        if (rollbackManager) { // Ensure rollbackManager exists
          const latestState = GameState.captureState(rollbackManager.currentFrame, playerMap, projectileMap);
          const syncData = {
            frame: rollbackManager.currentFrame,
            state: {
              timestamp: latestState.timestamp,
              players: Array.from(latestState.players.entries()),
              projectiles: Array.from(latestState.projectiles.entries())
            }
          };
          broadcastRTC('initialSync', JSON.stringify(syncData)); // Use broadcastRTC
        } else {
          console.error("[Host] RollbackManager not ready during initial broadcast in gameCode!");
        }
      }
    });
  }

  broadcastRTC("forceupdate", "{}");
  // sendCords();
  if (netcode_type != 2) {
    sendDelayInfo();
  }

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
  const localPlayer = playerMap.get(myid);
  if (!localPlayer) {
    console.error("Cannot shoot: Local player not found in playerMap!");
    return;
  }

  if (currentWeapon === WEAPON_TYPES.PROJECTILE) {

    let angle = Math.atan2(event.clientY - localPlayer.y, event.clientX - localPlayer.x);
    let velocity = { x: Math.cos(angle) * 2, y: Math.sin(angle) * 2 };

    const projectileId = generateProjectileId(myid, projectileCounter++);
    let projectile;
    if (netcode_type != 2) {
      projectile = new Projectile(localPlayer.x, localPlayer.y, 5, 'green', velocity, Date.now() + delay, true);
    } else {
      projectile = new Projectile(localPlayer.x, localPlayer.y, 5, 'green', velocity, Date.now(), false);
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
      globalThis.setTimeout(function () { delayedAction("proj", projectileId, time) }, delay)
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
    let angle = Math.atan2(event.clientY - localPlayer.y, event.clientX - localPlayer.x);

    const maxDistance = 1000;
    const targetX = localPlayer.x + Math.cos(angle) * maxDistance;
    const targetY = localPlayer.y + Math.sin(angle) * maxDistance;

    const laser = new Laser(localPlayer.x, localPlayer.y, targetX, targetY, 'rgba(255, 0, 0, 0.7)');
    lasers.push(laser);

    broadcastRTC("laser", JSON.stringify({
      startX: localPlayer.x,
      startY: localPlayer.y,
      endX: targetX,
      endY: targetY
    }));

    performHitscanDetection(
      localPlayer.x,
      localPlayer.y,
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

  if (event.key === 'o') {
    if (rollbackManager) {
      console.log("'o' key pressed - Manually saving state...");
      rollbackManager.manualSaveState();
    } else {
      console.warn("Cannot save state: RollbackManager not initialized (is netcode_type === 2?)");
    }
  }
  // Check if the pressed key is F9
  else if (event.key === 'p') {
    if (rollbackManager) {
      const framesToRollback = 60; // Example: Roll back 60 frames
      console.log(`'p' key pressed - Manually rolling back ${framesToRollback} frames...`);
      rollbackManager.manualRollback(framesToRollback);
    } else {
      console.warn("Cannot rollback: RollbackManager not initialized (is netcode_type === 2?)");
    }
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

// Artifical Delay settings

delaycheckbox.addEventListener("change", () => {
  if (delaycheckbox.checked) {
    delaysettings.style.visibility = "visible";
    art_delay_enabled = true
  } else {
    delaysettings.style.visibility = "hidden";
    art_delay_enabled = false
  }
});

delayslider.addEventListener("change", () => {
  art_delay = delayslider.value;
  delaysliderhead.innerHTML = "Delay: " + art_delay + "ms (+~" + art_delay_rand + "ms)";
});

delaysliderrand.addEventListener("change", () => {
  art_delay_rand = delaysliderrand.value;
  delaysliderhead.innerHTML = "Delay: " + art_delay + "ms (+~" + art_delay_rand + "ms)";
});

// Start with artifical delay hidden
delaysettings.style.visibility = "hidden";
art_delay_enabled = false

window.onload = main;