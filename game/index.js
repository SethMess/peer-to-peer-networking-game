const canvas = document.querySelector('canvas');
canvas.width = innerWidth;
canvas.height = innerHeight;
const c = canvas.getContext('2d');

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



let animationId
let score = 0
function animate() {
    animationId = requestAnimationFrame(animate);

    c.clearRect(0, 0, canvas.width, canvas.height);

    handleMovement();
    player.draw();// console.log(projectiles);


    projectiles.forEach((proj) => {
        proj.update();
    })

    enemies.forEach((enemy) => {
        enemy.update();
    })

    collisionDetection();

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
    }, 1000)
}

function collisionDetection() {
    for (let index = enemies.length - 1; index >= 0; index--) {
        const enemy = enemies[index]

        // enemy.update()

        const dist = Math.hypot(player.x - enemy.x, player.y - enemy.y)

        //end game
        if (dist - enemy.radius - player.radius < 1) {
            cancelAnimationFrame(animationId)
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
    if (keys.w.pressed) {
        player.y -= 1;
    }

    if (keys.a.pressed) {
        player.x -= 1;
    }

    if (keys.s.pressed) {
        player.y += 1;
    }

    if (keys.d.pressed) {
        player.x += 1;
    }
}


//MAIN area

let x = canvas.width / 2;
let y = canvas.height / 2;


const projectiles = [];
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

// player.draw();

spawnEnemies();
// let projectile = new Projectile(player.x, player.y, 5, 'red', {x: 1, y: 1});
// projectile.draw();
// projectile.update();
// projectiles.push(projectile);


animate();


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