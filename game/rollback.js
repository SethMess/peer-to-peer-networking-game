// This file implements various classes used for rollback netcode
import { handleMovement } from './classes.js';


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

    // Clear existing maps before applying state to handle entities that might not exist in the saved state
    // Note: This assumes your main game loop can handle adding players/projectiles back if needed,
    // or that the maps passed in are the ones being directly modified.
    // playerMap.clear(); // Consider if you need to clear or just update existing ones
    // projectileMap.clear(); // Consider if you need to clear or just update existing ones


    // Restore player states
    this.players.forEach((playerData, id) => {
      let player = playerMap.get(id);
      if (!player) {
        // If player doesn't exist, you might need to recreate them based on playerData
        // This depends on how your Player class is structured and managed.
        console.warn(`[GameState Apply] Player ${id} not found in target map.`);
        // Example: player = new Player(id, playerData.x, playerData.y, ...); playerMap.set(id, player);
      }
      if (player) {
        player.x = playerData.x;
        player.y = playerData.y;
        player.radius = playerData.radius;
        // Restore other properties...
      }
    });
    // Optional: Remove players from playerMap that are not in this.players if necessary

    // Restore projectile states
    // Similar logic for projectiles - handle creation/deletion if necessary
    this.projectiles.forEach((projData, id) => {
      let proj = projectileMap.get(id);
      if (!proj) {
        console.warn(`[GameState Apply] Projectile ${id} not found in target map.`);
        // Example: proj = new Projectile(...); projectileMap.set(id, proj);
      }
      if (proj) {
        proj.x = projData.x;
        proj.y = projData.y;
        proj.velocity = { ...projData.velocity };
        // Restore other properties...
      }
    });
    // Optional: Remove projectiles from projectileMap that are not in this.projectiles if necessary
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
    console.log(`[InputBuffer] Using predicted input for Player ${playerId} at Frame ${frame}:`, predictedInput); // DEBUG
    return predictedInput;
  }

  getPredictedInput(playerId) {
    if (this.predictions.has(playerId)) {
      return this.predictions.get(playerId);
    }

    // Default prediction is "do nothing"
    return { w: false, a: false, s: false, d: false };

    // Alternative is keep doing what they did last
    //   return { w: false, a: false, s: false, d: false };
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




class RollbackManager {
  constructor(playerMap, projectileMap, myId) {
    this.playerMap = playerMap;
    this.projectileMap = projectileMap;
    this.myId = myId;
    this.frameStates = []; // Array of GameState objects
    this.inputBuffer = new InputBuffer();
    this.currentFrame = 0;
    this.lastConfirmedFrame = 0; // You might need logic to update this based on acknowledgements from peers
    this.syncInterval = 5; // Save state every 5 frames

    this.isRollingBack = false;
    this.rollbackFrames = 0;
    this.lastRollbackTime = 0;
    this.rollbackIndicatorDuration = 500; // ms

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

      // Keep only recent states (e.g., last ~2 seconds at 60fps)
      const maxSavedStates = 120; // Adjust as needed
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
    console.log(`[RollbackManager] Received remote input for Player ${playerId} at Frame ${frame}:`, input); // DEBUG
    const hadInputAlready = this.inputBuffer.buffer.get(playerId)?.has(frame); // Check if we already had an input (or prediction) for this frame

    this.inputBuffer.recordInput(playerId, frame, input);

    // Update prediction for this player based on the newly received input
    this.inputBuffer.updatePrediction(playerId);

    // If this input is for a past frame AND it's different from what we had/predicted, we need to rollback
    // Note: We only need to rollback if the input is *new* or *different* from a prediction used for that frame.
    // Checking `frame < this.currentFrame` is the basic trigger. A more robust check might compare
    // the new input against what getInput() would have returned for that frame before the new input arrived.
    if (frame < this.currentFrame && !hadInputAlready) { // Simple check: rollback if it's for the past and we didn't have it
      console.log(`[RollbackManager] Remote input for past frame ${frame} (current: ${this.currentFrame}). Triggering rollback.`); // DEBUG
      this.performRollback(frame);
    } else if (frame >= this.currentFrame) {
      // console.log(`[RollbackManager] Remote input for future/current frame ${frame}. No rollback needed.`); // DEBUG
    } else {
      // console.log(`[RollbackManager] Remote input for past frame ${frame}, but already had input. No rollback needed.`); // DEBUG
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

    // Resimulate all frames from the restored state's frame up to the current frame
    let frame = restoreFrame;
    console.log(`[RollbackManager] Resimulating from frame ${frame} up to (but not including) ${this.currentFrame}`); // DEBUG
    while (frame < this.currentFrame) {
      // console.log(`[RollbackManager] Resimulating frame ${frame}...`); // DEBUG (Can be very noisy)
      this.simulateFrame(frame); // Use the corrected inputs now available in the buffer
      frame++;
    }

    console.log(`[RollbackManager] Resimulation complete. Current frame is now ${this.currentFrame}.`); // DEBUG
    this.isRollingBack = false;
    console.log(`[RollbackManager] ---- ROLLBACK END ----`); // DEBUG
  }

  simulateFrame(frame) {
    // Apply inputs for all players for this frame
    this.playerMap.forEach((player, playerId) => {
      const input = this.inputBuffer.getInput(playerId, frame); // This will now use the corrected remote input if available

      // Convert input format to match your keys format
      const keysFormat = {
        w: { pressed: input.w },
        a: { pressed: input.a },
        s: { pressed: input.s },
        d: { pressed: input.d }
      };

      // Use your existing handleMovement function
      // Ensure handleMovement is deterministic!
      handleMovement(player, keysFormat);
    });

    // Update projectiles - this must also be deterministic
    this.projectileMap.forEach(projectile => {
      projectile.update(); // Ensure projectile.update() is deterministic
    });

    // Handle collisions - must be deterministic
    this.handleCollisions();
  }

  handleCollisions() {
    // Check for collisions between projectiles and players
    // Important: The order of checks might matter for determinism if multiple collisions can happen simultaneously.
    // Iterating over maps can have inconsistent order if not careful. Convert to arrays and sort if needed.
    const projectileIds = Array.from(this.projectileMap.keys()); // Consider sorting these IDs if order matters
    const playerIds = Array.from(this.playerMap.keys());       // Consider sorting these IDs if order matters

    projectileIds.forEach(projId => {
      const projectile = this.projectileMap.get(projId);
      if (!projectile) return; // Projectile might have been deleted in a previous collision check this frame

      const projectileOwner = projId.split('-')[0]; // Assuming format 'playerId-timestamp'

      playerIds.forEach(playerId => {
        const player = this.playerMap.get(playerId);
        if (!player) return; // Should not happen if playerIds is derived from the current map

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
          this.projectileMap.delete(projId); // Deterministic removal
          // Important: Since we deleted the projectile, we should skip further checks for it in the outer loop.
          // The `if (!projectile) return;` at the start of the outer loop handles this for subsequent player checks,
          // but breaking/continuing the inner loop might be needed depending on exact logic.
          // For simplicity, the current structure might double-check players against an already-deleted projectile,
          // but the `this.projectileMap.get(projId)` check prevents errors.
        }
      });
    });
  }

  // --- Manual Testing Methods ---

  manualSaveState() {
    const frameToSave = this.currentFrame; // Save the *next* frame state usually
    console.log(`[RollbackManager] MANUAL SAVE requested for frame ${frameToSave}`);
    // Ensure simulation runs for the current frame first if needed, then save.
    // Or adjust logic to save the state *before* simulating currentFrame.
    // Let's assume we save the state *before* simulating the frame it represents.
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