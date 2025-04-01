// This file implements various classes used for rollback netcode
import { handleMovement } from './classes.js';


class GameState {
    constructor(timestamp) {
      this.timestamp = timestamp;
      this.players = new Map();
      this.projectiles = new Map();
    }
  
    static captureState(timestamp, playerMap, projectileMap) {
      const state = new GameState(timestamp);
      
      // Deep copy players
      playerMap.forEach((player, id) => {
        state.players.set(id, {
          x: player.x,
          y: player.y,
          radius: player.radius,
          color: player.color
        });
      });
      
      // Deep copy projectiles
      projectileMap.forEach((projectile, id) => {
        state.projectiles.set(id, {
          x: projectile.x,
          y: projectile.y,
          radius: projectile.radius,
          color: projectile.color,
          velocity: {...projectile.velocity}
        });
      });
      
      return state;
    }
    
    apply(playerMap, projectileMap) {
      // Restore player states
      this.players.forEach((playerData, id) => {
        const player = playerMap.get(id);
        if (player) {
          player.x = playerData.x;
          player.y = playerData.y;
          player.radius = playerData.radius;
        }
      });
      
      // Restore projectile states
      this.projectiles.forEach((projData, id) => {
        const proj = projectileMap.get(id);
        if (proj) {
          proj.x = projData.x;
          proj.y = projData.y;
          proj.velocity = {...projData.velocity};
        }
      });
    }
  }




class InputBuffer {
    constructor(maxFrames = 60) {
      this.buffer = new Map(); // playerId -> {frame -> input}
      this.predictions = new Map(); // playerId -> predicted input
      this.maxFrames = maxFrames;
    }
    
    recordInput(playerId, frame, input) {
      if (!this.buffer.has(playerId)) {
        this.buffer.set(playerId, new Map());
      }
      
      this.buffer.get(playerId).set(frame, input);
      
      // Prune old inputs
      const frames = Array.from(this.buffer.get(playerId).keys()).sort((a, b) => a - b);
      while (frames.length > this.maxFrames) {
        this.buffer.get(playerId).delete(frames.shift());
      }
    }
    
    getInput(playerId, frame) {
      const playerInputs = this.buffer.get(playerId);
      if (playerInputs && playerInputs.has(frame)) {
        return playerInputs.get(frame);
      }
      
      // Return predicted input if no actual input exists
      return this.getPredictedInput(playerId);
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
        const frames = Array.from(playerInputs.keys()).sort((a, b) => b - a);
        const latestInput = playerInputs.get(frames[0]);
        this.predictions.set(playerId, {...latestInput});
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
        this.lastConfirmedFrame = 0;
        this.syncInterval = 5; // Save state every 5 frames

        this.isRollingBack = false;
        this.rollbackFrames = 0;
        this.lastRollbackTime = 0;
        this.rollbackIndicatorDuration = 500;
    }
    
    isShowingRollbackIndicator() {
        return Date.now() - this.lastRollbackTime < this.rollbackIndicatorDuration;
    }

    update() {
        // Apply inputs for the current frame
        this.simulateFrame(this.currentFrame);
        
        // Increment frame counter
        this.currentFrame++;
        
        // Save current state periodically
        if (this.currentFrame % this.syncInterval === 0) {
          this.frameStates.push(
            GameState.captureState(this.currentFrame, this.playerMap, this.projectileMap)
          );
          
          // Keep only recent states (last ~2 seconds)
          while (this.frameStates.length > 120) {
            this.frameStates.shift();
          }
        }
    }
    
    recordLocalInput(input) {
      this.inputBuffer.recordInput(this.myId, this.currentFrame, {...input});
    }
    
    recordRemoteInput(playerId, frame, input) {
      this.inputBuffer.recordInput(playerId, frame, input);
      
      // Update prediction for this player
      this.inputBuffer.updatePrediction(playerId);
      
      // If this input is for a past frame, we need to rollback
      if (frame < this.currentFrame) {
        this.performRollback(frame);
      }
    }
    
    performRollback(toFrame) {
            
        // Find the closest saved state before or at toFrame
        let stateIndex = -1;
        for (let i = this.frameStates.length - 1; i >= 0; i--) {
            if (this.frameStates[i].timestamp <= toFrame) {
            stateIndex = i;
            break;
            }
        }
        
        if (stateIndex === -1) return; // Can't rollback that far
        
        
        this.isRollingBack = true;
        this.rollbackFrames = this.currentFrame - toFrame;
        this.lastRollbackTime = Date.now();
        
        console.log(`Rolling back ${this.rollbackFrames} frames from ${this.currentFrame} to ${toFrame}`);
        
        // Restore that state
        const rollbackState = this.frameStates[stateIndex];
        rollbackState.apply(this.playerMap, this.projectileMap);
        
        // Resimulate all frames from that point to current
        let frame = rollbackState.timestamp;
        while (frame < this.currentFrame) {
            this.simulateFrame(frame);
            frame++;
        }
        this.isRollingBack = false;
    }
    
    simulateFrame(frame) {
        // Apply inputs for all players for this frame
        this.playerMap.forEach((player, playerId) => {
          const input = this.inputBuffer.getInput(playerId, frame);
          
          // Convert input format to match your keys format
          const keysFormat = {
            w: { pressed: input.w },
            a: { pressed: input.a },
            s: { pressed: input.s },
            d: { pressed: input.d }
          };
          
          // Use your existing handleMovement function
          handleMovement(player, keysFormat);
        });
        
        // Update projectiles - this can stay the same
        this.projectileMap.forEach(projectile => {
          projectile.update();
        });
        
        // Handle collisions
        this.handleCollisions();
      }

      handleCollisions() {
        // Check for collisions between projectiles and players
        this.projectileMap.forEach((projectile, projId) => {
          // Get the projectile owner from the projId format
          const projectileOwner = projId.split('-')[0];
          
          this.playerMap.forEach((player, playerId) => {
            // Skip collisions with the projectile owner
            if (playerId === projectileOwner) return;
            
            // Calculate distance between projectile and player
            const dx = projectile.x - player.x;
            const dy = projectile.y - player.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // If collision detected
            if (distance < player.radius + projectile.radius) {
              // Handle collision (damage player, remove projectile)
              player.radius = Math.max(10, player.radius - 5);
              this.projectileMap.delete(projId);
            }
          });
        });
      }
  }




export { GameState, InputBuffer, RollbackManager };