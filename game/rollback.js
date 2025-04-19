// This file implements various classes used for rollback netcode
import { handleMovement, Player, Projectile } from './classes.js';


class GameState {
  constructor(timestamp) {
    this.timestamp = timestamp;
    this.players = new Map();
    this.projectiles = new Map();
  }

  static captureState(timestamp, playerMap, projectileMap) {
    // console.log(`[GameState] Capturing state for frame: ${timestamp}`); // DEBUG
    const state = new GameState(timestamp);

    // Deep copy players
    playerMap.forEach((player, id) => {
      state.players.set(id, {
        x: player.x,
        y: player.y,
        radius: player.radius,
        color: player.color
        // Add any other relevant player properties here
      });
    });

    // Deep copy projectiles
    projectileMap.forEach((projectile, id) => {
      state.projectiles.set(id, {
        x: projectile.x,
        y: projectile.y,
        radius: projectile.radius,
        color: projectile.color,
        velocity: { ...projectile.velocity }
        // Add any other relevant projectile properties here
      });
    });

    return state;
  }

  apply(playerMap, projectileMap) {
    console.log(`[GameState] Applying state from frame: ${this.timestamp}`); // DEBUG

    // --- Player State Restoration ---
    const statePlayerIds = new Set(this.players.keys());

    // Remove players from the game map that are NOT in the saved state
    // const playersToRemove = [];
    // playerMap.forEach((_, id) => {
    //   if (!statePlayerIds.has(id)) {
    //     playersToRemove.push(id);
    //   }
    // });
    // playersToRemove.forEach(id => {
    //   console.log(`[GameState Apply] Removing player ${id} (not in saved state)`); // DEBUG
    //   playerMap.delete(id);
    // });

    // Update or warn about players based on the saved state
    this.players.forEach((playerData, id) => {
      let player = playerMap.get(id);
      if (player) {
        // Player exists, update its state
        player.x = playerData.x;
        player.y = playerData.y;
        player.radius = playerData.radius;
        player.color = playerData.color;
        // Apply other properties if needed
      } else {
        // Player is in saved state but not in the current game map
        console.log(`[GameState Apply] Player ${id} not found in target map. CREATING.`); // DEBUG

        player = new Player(playerData.x, playerData.y, playerData.radius, playerData.color);
        playerMap.set(id, player);
      }
    });

    // --- Projectile State Restoration ---
    const stateProjectileIds = new Set(this.projectiles.keys());

    //Old delete code
    // Remove projectiles from the game map that are NOT in the saved state
    // const projectilesToRemove = [];
    // projectileMap.forEach((_, id) => {
    //   if (!stateProjectileIds.has(id)) {
    //     projectilesToRemove.push(id);
    //   }
    // });
    // projectilesToRemove.forEach(id => {
    //   // console.log(`[GameState Apply] Removing projectile ${id} (not in saved state)`); // DEBUG (Can be noisy)
    //   projectileMap.delete(id);
    // });

    // Update or warn about projectiles based on the saved state
    this.projectiles.forEach((projData, id) => {
      let proj = projectileMap.get(id);
      if (proj) {
        // Projectile exists, update its state
        proj.x = projData.x;
        proj.y = projData.y;
        proj.radius = projData.radius;
        proj.color = projData.color;
        proj.velocity = { ...projData.velocity };
        // Apply other properties if needed
      } else {
        // Projectile is in saved state but not in the current game map
        console.warn(`[GameState Apply] Projectile ${id} found in saved state but not in target map. Cannot restore.`);
        // If recreation is needed:
        // proj = new Projectile(id, projData.x, ...); // Requires Projectile class access and potentially more data
        // projectileMap.set(id, proj);
      }
    });
    console.log(`[GameState Apply] Finished applying state. PlayerMap size: ${playerMap.size}`); // Log end
  }
}




class InputBuffer {
  constructor(maxFrames = 60) {
    this.buffer = new Map(); // playerId -> {frame -> input}
    this.predictions = new Map(); // playerId -> predicted input
    this.maxFrames = maxFrames;
  }

  recordInput(playerId, frame, input) {
    // console.log(`[InputBuffer] Recording input for Player ${playerId} at Frame ${frame}:`, input); // DEBUG
    if (!this.buffer.has(playerId)) {
      this.buffer.set(playerId, new Map());
    }

    this.buffer.get(playerId).set(frame, input);

    // Prune old inputs
    const frames = Array.from(this.buffer.get(playerId).keys()).sort((a, b) => a - b);
    while (frames.length > this.maxFrames) {
      const deletedFrame = frames.shift();
      this.buffer.get(playerId).delete(deletedFrame);
      // console.log(`[InputBuffer] Pruned input for Player ${playerId} at Frame ${deletedFrame}`); // DEBUG (Optional: can be noisy)
    }
  }

  getInput(playerId, frame) {
    const playerInputs = this.buffer.get(playerId);
    if (playerInputs && playerInputs.has(frame)) {
      const input = playerInputs.get(frame);
      // console.log(`[InputBuffer] Got actual input for Player ${playerId} at Frame ${frame}:`, input); // DEBUG (Optional: can be noisy)
      return input;
    }

    // Return predicted input if no actual input exists
    const predictedInput = this.getPredictedInput(playerId);
    // console.log(`[InputBuffer] Using predicted input for Player ${playerId} at Frame ${frame}:`, predictedInput); // DEBUG
    return predictedInput;
  }

  getPredictedInput(playerId) {
    if (this.predictions.has(playerId)) {
      return this.predictions.get(playerId);
    }
    // Default prediction is "do nothing"
    return { w: false, a: false, s: false, d: false };

  }

  updatePrediction(playerId) {
    // Simple prediction: repeat the last input
    const playerInputs = this.buffer.get(playerId);
    if (playerInputs && playerInputs.size > 0) {
      const frames = Array.from(playerInputs.keys()).sort((a, b) => b - a); // Sort descending to get latest
      const latestInput = playerInputs.get(frames[0]);
      this.predictions.set(playerId, { ...latestInput });
      // console.log(`[InputBuffer] Updated prediction for Player ${playerId}:`, latestInput); // DEBUG (Optional: can be noisy)
    }
  }
}

function inputsAreEqual(inputA, inputB) {
  if (!inputA || !inputB) return false; // Handle cases where one might be undefined
  return inputA.w === inputB.w &&
    inputA.a === inputB.a &&
    inputA.s === inputB.s &&
    inputA.d === inputB.d;
}


class RollbackManager {
  constructor(playerMap, projectileMap, myId) {
    this.playerMap = playerMap;
    this.projectileMap = projectileMap;
    this.myId = myId;
    this.frameStates = []; // Array of GameState objects
    this.inputBuffer = new InputBuffer(300);
    this.currentFrame = 0;
    this.lastConfirmedFrame = 0;
    this.syncInterval = 1; // Save state every 1 frames

    this.isRollingBack = false;
    this.rollbackFrames = 0;
    this.lastRollbackTime = 0;
    this.rollbackIndicatorDuration = 500; // ms

    this.inputIgnoreThreshold = 1000; // Ignore inputs older than this many frames

    console.log(`[RollbackManager] Initialized for Player ${myId}`); // DEBUG
  }

  isShowingRollbackIndicator() {
    return Date.now() - this.lastRollbackTime < this.rollbackIndicatorDuration;
  }

  update() {
    // Apply inputs for the current frame
    // console.log(`[RollbackManager] Simulating frame ${this.currentFrame}`); // DEBUG (Can be very noisy)
    this.simulateFrame(this.currentFrame);

    // Increment frame counter
    this.currentFrame++;

    // Save current state periodically
    if (this.currentFrame % this.syncInterval === 0) {
      // console.log(`[RollbackManager] Saving state at frame ${this.currentFrame}`); // DEBUG
      this.frameStates.push(
        GameState.captureState(this.currentFrame, this.playerMap, this.projectileMap)
      );

      // Keep only recent states 
      const maxSavedStates = 120;
      while (this.frameStates.length > maxSavedStates) {
        this.frameStates.shift();
      }
    }
  }

  recordLocalInput(input) {
    // console.log(`[RollbackManager] Recording local input for frame ${this.currentFrame}:`, input); // DEBUG
    this.inputBuffer.recordInput(this.myId, this.currentFrame, { ...input });
  }

  recordRemoteInput(playerId, frame, input) {

    if (frame < this.currentFrame - this.inputIgnoreThreshold) {
      console.warn(`[RollbackManager] Ignoring very old input for Player ${playerId} at Frame ${frame} (Current: ${this.currentFrame}). Likely from join.`); // DEBUG
      // Still record the input in case it's needed for future predictions, but don't rollback
      this.inputBuffer.recordInput(playerId, frame, input);
      this.inputBuffer.updatePrediction(playerId);
      return; // Exit early, do not process for rollback
    }
    console.log(`[RollbackManager Debug] P${this.myId} received input for P${playerId} frame ${frame}. My currentFrame is ${this.currentFrame}. Frame < Current: ${frame < this.currentFrame}`);
    // console.log(`[RollbackManager] Received remote input for Player ${playerId} at Frame ${frame}:`, input); // DEBUG
    let needsRollback = false;
    if (frame < this.currentFrame) {
      // Get the input that was used (or predicted) for this frame before recording the new one
      const previousInputForFrame = this.inputBuffer.getInput(playerId, frame); // Get prediction/actual before update
      if (!inputsAreEqual(input, previousInputForFrame)) {
        console.log(`[RollbackManager] Remote input for past frame ${frame} differs from previous input/prediction. Triggering rollback.`); // DEBUG
        needsRollback = true;
      } else {
        console.log(`[RollbackManager] Remote input for past frame ${frame} matches prediction. No rollback needed.`); // DEBUG
      }
    } else {
      // console.log(`[RollbackManager] Remote input for future/current frame ${frame}. No rollback needed yet.`); // DEBUG
    }


    // Record the actual input regardless of rollback decision
    this.inputBuffer.recordInput(playerId, frame, input);

    this.inputBuffer.updatePrediction(playerId);

    // Perform rollback if needed
    if (needsRollback) {
      this.performRollback(frame);
    }
  }

  performRollback(toFrame) {
    console.log(`[RollbackManager] ---- ROLLBACK START ----`); // DEBUG
    console.log(`[RollbackManager] Attempting rollback to frame: ${toFrame} (Current frame: ${this.currentFrame})`); // DEBUG

    // Find the closest saved state *before or exactly at* toFrame
    let stateIndex = -1;
    let restoreFrame = -1;
    for (let i = this.frameStates.length - 1; i >= 0; i--) {
      if (this.frameStates[i].timestamp <= toFrame) {
        stateIndex = i;
        restoreFrame = this.frameStates[i].timestamp;
        break;
      }
    }

    if (stateIndex === -1) {
      console.error(`[RollbackManager] Cannot rollback to frame ${toFrame}. No suitable saved state found. Oldest state: ${this.frameStates[0]?.timestamp}`); // DEBUG
      console.log(`[RollbackManager] ---- ROLLBACK ABORTED ----`); // DEBUG
      return; // Can't rollback that far
    }

    this.isRollingBack = true; // Set flag early
    this.rollbackFrames = this.currentFrame - restoreFrame; // How many frames we resimulate
    this.lastRollbackTime = Date.now();

    console.log(`[RollbackManager] Found state at index ${stateIndex} for frame ${restoreFrame}. Rolling back ${this.currentFrame - toFrame} frames (resimulating ${this.rollbackFrames} frames).`); // DEBUG

    // Restore that state
    const rollbackState = this.frameStates[stateIndex];
    rollbackState.apply(this.playerMap, this.projectileMap);
    console.log(`[RollbackManager] State for frame ${restoreFrame} applied.`); // DEBUG

    //temp logs
    console.log(`[RollbackManager] Positions AFTER applying state for frame ${restoreFrame}:`);
    this.playerMap.forEach((p, id) => {
      console.log(`  - Player ${id}: (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
    });

    // Resimulate all frames from the restored state's frame up to the current frame
    let frame = restoreFrame;
    console.log(`[RollbackManager] Resimulating from frame ${frame} up to (but not including) ${this.currentFrame}`); // DEBUG
    while (frame < this.currentFrame) {
      this.simulateFrame(frame); // Use the corrected inputs now available in the buffer
      frame++;
    }

    console.log(`[RollbackManager] Resimulation complete. Current frame is now ${this.currentFrame}.`); // DEBUG
    this.isRollingBack = false;
    console.log(`[RollbackManager] ---- ROLLBACK END ----`); // DEBUG
  }

  simulateFrame(frame) {

    const isResimulating = this.isRollingBack; // Check if we are currently in a rollback resimulation phase

    if (isResimulating) {
      console.log(`--- Resimulating Frame ${frame} ---`);
    }

    // Apply inputs for all players for this frame
    this.playerMap.forEach((player, playerId) => {
      const input = this.inputBuffer.getInput(playerId, frame); // This will now use the corrected remote input if available

      if (isResimulating) {
        console.log(`  [Resim Frame ${frame}] Input for ${playerId}:`, JSON.stringify(input));
      }

      // Convert input format to match your keys format
      const keysFormat = {
        w: { pressed: input?.w || false }, // Use input value or default to false if input is null/undefined
        a: { pressed: input?.a || false },
        s: { pressed: input?.s || false },
        d: { pressed: input?.d || false }
    };

      // Use your existing handleMovement function
      // Ensure handleMovement is deterministic!
      handleMovement(player, keysFormat);

      if (isResimulating) {
        console.log(`  [Resim Frame ${frame}] Pos AFTER move for ${playerId}: (${player.x.toFixed(1)}, ${player.y.toFixed(1)})`);
      }
    });

    // Update projectiles - this must also be deterministic
    this.projectileMap.forEach(projectile => {
      projectile.update(); // Ensure projectile.update() is deterministic
    });

    // Handle collisions - must be deterministic
    this.handleCollisions();

    if (isResimulating) {
      console.log(`--- Finished Resimulating Frame ${frame} ---`);
    }
  }

  handleCollisions() {

    const projectileIds = Array.from(this.projectileMap.keys());
    const playerIds = Array.from(this.playerMap.keys());

    projectileIds.forEach(projId => {
      const projectile = this.projectileMap.get(projId);
      if (!projectile) return; // Projectile might have been deleted in a previous collision check this frame

      const projectileOwner = projId.split('-')[0];

      playerIds.forEach(playerId => {
        const player = this.playerMap.get(playerId);
        if (!player) return;

        // Skip collisions with the projectile owner
        if (playerId === projectileOwner) return;

        // Calculate distance between projectile and player
        const dx = projectile.x - player.x;
        const dy = projectile.y - player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // If collision detected
        if (distance < player.radius + projectile.radius) {
          console.log(`[RollbackManager] Collision detected between Proj ${projId} and Player ${playerId} at frame ${this.isRollingBack ? '(resim)' : this.currentFrame}`); // DEBUG
          // Handle collision (damage player, remove projectile)
          // Ensure these operations are deterministic
          player.radius = Math.max(10, player.radius - 5); // Deterministic math
          if (player.radius <= 10) { 
            player.color = "purple"; // Change color if radius is too small
          }
          this.projectileMap.delete(projId); // Deterministic removal
          return; // Exit inner loop to avoid double processing
        }
      });
      //   if (!this.projectileMap.has(projId)) {
      //     // If we didn't return/break from inner loop, we might need this
      //     // continue; // Go to the next projectileId
      //  }
    });
  }

  // --- Manual Testing Methods ---

  manualSaveState() {
    const frameToSave = this.currentFrame; // Save the next frame state
    console.log(`[RollbackManager] MANUAL SAVE requested for frame ${frameToSave}`);
    const state = GameState.captureState(frameToSave, this.playerMap, this.projectileMap);
    this.frameStates.push(state);
    console.log(`[RollbackManager] MANUAL SAVE completed for frame ${frameToSave}. Total states: ${this.frameStates.length}`);

    // Optional: Prune states if you add too many manually
    const maxSavedStates = 120;
    while (this.frameStates.length > maxSavedStates) {
      this.frameStates.shift();
    }
  }

  manualRollback(framesToRollback) {
    if (this.frameStates.length === 0) {
      console.error("[RollbackManager] MANUAL ROLLBACK failed: No saved states available.");
      return;
    }
    const targetFrame = this.currentFrame - framesToRollback;
    console.log(`[RollbackManager] MANUAL ROLLBACK requested for ${framesToRollback} frames (to frame ${targetFrame})`);
    this.performRollback(targetFrame);
  }

}




export { GameState, InputBuffer, RollbackManager };