
import { Sono } from 'https://deno.land/x/sono@v1.2/mod.ts';
import { serveDir, serveFile } from "jsr:@std/http/file-server";

const sono = new Sono();
const PORT = 80; // Default HTTP port
const WEBSOCKETPORT = 3001 // Chose it cause it is cool B)
const HOSTNAME = "localhost"; // <-- CHANGE HERE AND IN lobbylist.js TO YOUR LOCAL IP TO AVOID SOP!

class Lobby {
  id = "";
  name = "Unamed Lobby";
  max_players = 4;
  players = 0;
};

let lobby_list : Array<Lobby> = []; // Holds all current lobbies
let id_list : Array<string> = []; // Holds all current lobby IDs to assure none are reused

function generateLobbyID(length : number): string {
  // Generates a random hexidecimal code of length provided
  // all letters are lowercase, numbers are 0-9

  let new_id = "";

  for (let i = 0; i < length; i++) {
    new_id += Math.floor(Math.random() * 16).toString(16);
  }

  return new_id;
}

function generateUniqueLobbyID(length : number): string {
  // Generates a lobby id of given length that is not in use

  let new_id = "";

  while (new_id === "" || id_list.includes(new_id)) {
    new_id = generateLobbyID(length);
  }

  return new_id;
}

Deno.serve({ port: PORT, hostname: HOSTNAME }, async (req : Request) => {

  const url = new URL(req.url);
  const split_path = url.pathname.split("/");

  let body = "";
  if (req.body) {
    body = await req.text();
  }

  // Index Page
  if (req.method === "GET" && url.pathname === "/") {
    console.log("FETCH INDEX")
    return serveFile(req, "./static/lobbylist.html");
  }

  // Get server list
  else if (req.method === "GET" && url.pathname === "/lobbies") {
    return new Response(JSON.stringify(lobby_list), { status: 200 });
  }

  // Add a new server to the server list with the desired name, respond with the lobby object created
  else if (req.method === "POST" && url.pathname === "/lobbies/new") {
    const  new_lobby = new Lobby();
    new_lobby.name = body.substring(0, 32); // Cap server names at 32 characters
    if (new_lobby.name == "") {new_lobby.name = "Lobby";}

    new_lobby.id = generateUniqueLobbyID(6); // Generate and log lobby id, create channel of that name
    id_list.push(new_lobby.id);
    sono.channel(new_lobby.id, () => {
      console.log('new lobby channel created: ' + new_lobby.id);
    })

    lobby_list.push(new_lobby);

    return new Response(JSON.stringify(new_lobby), { status: 200 });
  }

  // Send them to the game!
  else if (req.method === "GET" && split_path[1] === "play") {
    console.log("SERVING GAMER")
    const file = await Deno.open("./static/game.html", { read: true, write: false });
    return new Response(file.readable);
  }

  else { // If all else fails, serve a regular file
    let filepath = url.pathname;
    console.log(filepath);
    try {
      return serveFile(req, "./static" + filepath);
    } catch {
      return new Response("404 Not Found", { status: 404 });
    }
  }
});

// WEBSOCKET PORT
Deno.serve({ port: WEBSOCKETPORT, hostname: HOSTNAME }, async (req : Request) => {

  const url = new URL(req.url);
  const split_path = url.pathname.split("/");

  let body = "";
  if (req.body) {
    body = await req.text();
  }

  // Connect to server (WebSocket/RTC)
  else if (req.method === "GET" && split_path.length == 3 && split_path[1] === "join") {
    if (id_list.includes(split_path[2])) {
      // Lobby exists, connect user
      return sono.connect(req, () => {
        console.log("New client connected to lobby " + split_path[2]);
      });
    }
    else {
      // Lobby does not exist, do nothing
      return new Response("Lobby not found!", { status: 404 });
    }
  }

  else { // If all else fails, 404!
      return new Response("404 Not Found", { status: 404 });
  }
});
