const canvas = document.querySelector('canvas');
canvas.width = innerWidth;
canvas.height = innerHeight;
const c = canvas.getContext('2d');


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
    constructor(x, y, radius, color, velocity){
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.color = color;
        this.velocity = velocity;
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

    update() {
        this.x = this.x + this.velocity.x;
        this.y = this.y + this.velocity.y;
    }
}


function animate(){
    requestAnimationFrame(animate);
}

//Event listeners
addEventListener('click', (event) => {
    console.log("spawn");
    let angle = Math.atan2(event.clientY, event.clientX);
    let velocity = {x: Math.cos(angle), y: Math.sin(angle)};
    const projectile = new Projectile(event.clientX, event.clientY, 10, 'black', velocity);
    projectile.draw();
});

//MAIN area

let x = canvas.width / 2;
let y = canvas.height / 2;

const player = new Player(x, y, 30, 'blue');
player.draw();

let projectile = new Projectile(200, 200, 10, 'red', null);
projectile.draw();


animate();