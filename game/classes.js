import { WEAPON_TYPES } from './utils.js';

// Game classes
class Player {
  constructor(x, y, radius, color) {
    this.x = x;
    this.y = y;
    this.delay_x = x; // Only used by non-remote player
    this.delay_y = y; // Only used by non-remote player
    this.radius = radius;
    this.color = color;
    this.last_pos_time = 0;
  }

  draw(c) {
    c.beginPath();
    c.arc(this.x, this.y, this.radius, 0, 2 * Math.PI);
    c.fillStyle = this.color;
    c.stroke();
    c.fill();
    c.closePath();
  }

  draw_at_delay(c) {
    c.beginPath();
    c.arc(this.delay_x, this.delay_y, this.radius, 0, 2 * Math.PI);
    c.fillStyle = this.color;
    c.stroke();
    c.fill();
    c.closePath();
  }
}

class Projectile {
  constructor(x, y, radius, color, velocity, time_made = 0, delay = false) {
    this.x = x;
    this.y = y;
    this.delay_x = x;
    this.delay_y = y;
    this.radius = radius;
    this.color = color;
    this.velocity = velocity;
    this.time_made = time_made; // Only needed for player bullets
    this.delay = delay;
  }

  draw(c) {
    c.beginPath();
    c.arc(this.x, this.y, this.radius, 0, 2 * Math.PI);
    c.strokeStyle = this.color;
    c.fillStyle = this.color;
    c.stroke();
    c.fill();
    c.closePath();
  }

  draw_at_delay(c, time) {
    if (time < this.time_made) { // If we shoudldn't exist yet, don't draw!
      return;
    }
    c.beginPath();
    c.arc(this.delay_x, this.delay_y, this.radius, 0, 2 * Math.PI);
    c.strokeStyle = this.color;
    c.fillStyle = this.color;
    c.stroke();
    c.fill();
    c.closePath();
  }

  update() {
    this.x = this.x + this.velocity.x;
    this.y = this.y + this.velocity.y;
    if (!this.delay) {
      this.delay_x = this.delay_x + this.velocity.x;
      this.delay_y = this.delay_y + this.velocity.y;
    }
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

  draw(c) {
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

  draw(c) {
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
  }
}

// Game logic functions
function spawnEnemies(canvas, player, enemies) {
  return setInterval(() => {
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
  }, 4000);
}

function handleMovement(player, keys, speed = 3) {
  if (keys.w.pressed) {
    player.y -= 1 * speed;
  }

  if (keys.a.pressed) {
    player.x -= 1 * speed;
  }

  if (keys.s.pressed) {
    player.y += 1 * speed;
  }

  if (keys.d.pressed) {
    player.x += 1 * speed;
  }
}

function performHitscanDetection(
  startX,
  startY,
  angle,
  maxDistance,
  playerMap,
  myid,
  rtcSendMessage
) {
  let closestHit = null;
  let closestDistance = maxDistance;
  
  for (const [playerId, otherPlayer] of playerMap.entries()) {
    if (playerId === myid) continue;
    
    const dx = otherPlayer.x - startX;
    const dy = otherPlayer.y - startY;
    const projectionLength = dx * Math.cos(angle) + dy * Math.sin(angle);
    
    if (projectionLength < 0) continue;
    if (projectionLength > closestDistance) continue;
    
    const closestX = startX + Math.cos(angle) * projectionLength;
    const closestY = startY + Math.sin(angle) * projectionLength;
    const distance = Math.hypot(closestX - otherPlayer.x, closestY - otherPlayer.y);
    
    if (distance <= otherPlayer.radius) {
      if (projectionLength < closestDistance) {
        closestHit = playerId;
        closestDistance = projectionLength;
      }
    }
  }
  
  if (closestHit) {
    console.log("Hit player with laser:", closestHit);
    
    rtcSendMessage("hit", JSON.stringify({
      by: myid,
      weapon: WEAPON_TYPES.HITSCAN,
      damage: 10
    }));
  }
}

function collisionDetection(
  player,
  playerMap,
  projectileMap,
  enemies,
  myid,
  rtcSendMessage,
  scoreEl,
  animationId,
  cancelAnimationFrame
) {
  // Player-projectile collisions
  for (const [projId, projectile] of projectileMap.entries()) {
    const projectileOwner = projId.split('-')[0];
    if (projectileOwner === myid) continue;

    const projPlayerDist = Math.hypot(projectile.x - player.x, projectile.y - player.y);
    if (projPlayerDist - player.radius - projectile.radius < 1) {
      console.log("Hit by projectile from player:", projectileOwner);
      
      projectileMap.delete(projId);
      player.radius = Math.max(10, player.radius - 5);
      
      rtcSendMessage("hit", JSON.stringify({
        by: projectileOwner,
        projId: projId
      }));
      
      if (player.radius <= 10) {
        // This is where game over is detected, Do anything for the end of the game here or make a seprate function that is called here
        cancelAnimationFrame(animationId);
        rtcSendMessage("left", "{}");
        console.log("Game over - killed by player", projectileOwner);
      }
    }
    
    for (const [otherPlayerId, otherPlayer] of playerMap.entries()) {
      if (otherPlayerId === projectileOwner) continue;
      
      const projOtherPlayerDist = Math.hypot(projectile.x - otherPlayer.x, projectile.y - otherPlayer.y);
      if (projOtherPlayerDist - otherPlayer.radius - projectile.radius < 1) {
        if (projectileOwner === myid) {
          projectileMap.delete(projId);
          rtcSendMessage("projdel", JSON.stringify({
            id: projId
          }));
          
          rtcSendMessage("hit", JSON.stringify({
            by: myid,
            projId: projId
          }));
        }
        break;
      }
    }
  }
}

// Use this one when using delay-based netcode
function collisionDetectionDelay(
  player,
  playerMap,
  projectileMap,
  enemies,
  myid,
  rtcSendMessage,
  scoreEl,
  animationId,
  cancelAnimationFrame
) {
  // Player-projectile collisions
  for (const [projId, projectile] of projectileMap.entries()) {
    
    const projectileOwner = projId.split('-')[0];
    if (projectileOwner === myid) continue;

    const projPlayerDist = Math.hypot(projectile.delay_x - player.delay_x, projectile.delay_y - player.delay_y);
    if (projPlayerDist - player.radius - projectile.radius < 1) {
      console.log("Hit by projectile from player:", projectileOwner);
      
      projectileMap.delete(projId);
      player.radius = Math.max(10, player.radius - 5);
      
      rtcSendMessage("hit", JSON.stringify({
        by: projectileOwner,
        projId: projId
      }));

      rtcSendMessage("projdel", JSON.stringify({
        id: projId
      }));
      
      if (player.radius <= 10) {
        // This is where game over is detected, Do anything for the end of the game here or make a seprate function that is called here
        cancelAnimationFrame(animationId);
        rtcSendMessage("left", "{}");
        console.log("Game over - killed by player", projectileOwner);
      }
    }
    
    console.log("HERE")

    for (const [otherPlayerId, otherPlayer] of playerMap.entries()) {
      if (otherPlayerId === projectileOwner) continue;
      console.log("HERE")
      
      const projOtherPlayerDist = Math.hypot(projectile.delay_x - otherPlayer.x, projectile.delay_x - otherPlayer.y);
      if (projOtherPlayerDist - otherPlayer.radius - projectile.radius < 1) {
        console.log("HITTING OTHER PLAYER")
        if (projectileOwner === myid) {
          projectileMap.delete(projId);
          rtcSendMessage("projdel", JSON.stringify({
            id: projId
          }));

          console.log("HIT!");
          
          rtcSendMessage("hit", JSON.stringify({
            by: myid,
            projId: projId
          }));
        }
        break;
      }
    }
  }
}

// Export all classes and functions at the end
export { 
  Player, 
  Projectile, 
  Laser, 
  Enemy, 
  spawnEnemies, 
  handleMovement, 
  performHitscanDetection, 
  collisionDetection,
  collisionDetectionDelay
};