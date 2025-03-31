
import { Sono } from 'https://deno.land/x/sono@v1.2/mod.ts';
import { serveDir, serveFile } from "jsr:@std/http/file-server";

const sono = new Sono();

// Now takes command line arguments for hosting params
// EX. deno --allow-net --allow-read siteserver.ts localhost 8100 3001
// const PORT = Deno.args[1]; // Default HTTP port
// const WEBSOCKETPORT = Deno.args[2]; // Chose it cause it is cool B)
// In production, use standard ports
const PORT = Deno.env.get("PORT") || Deno.args[1] || "8080";
// const WEBSOCKETPORT = Deno.args[2] || (Deno.env.get("NODE_ENV") === "production" ? "443" : "3001");
const HOSTNAME = Deno.args[0]; // <-- CHANGE HERE AND IN lobbylist.js TO YOUR LOCAL IP TO AVOID SOP!
const MAX_LOBBIES = 10;

class Lobby {
  id = "";
  name = "Unamed Lobby";
  max_players = 4;
  players = 0;
  netcodetype = "NONE";
};

let lobby_list: Array<Lobby> = []; // Holds all current lobbies
let id_list: Array<string> = []; // Holds all current lobby IDs to assure none are reused
let connected_players = null;


function addCorsHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}


function isLobbyFilled(id: string): boolean {
  // Returns wether the given lobby is full or not, non-existant lobbies are counted as full

  for (var i = 0; i < lobby_list.length; i++) {
    if (lobby_list[i].id == id) {
      let players_inside = Object.keys(sono.channelsList[id]).length;
      if (players_inside < lobby_list[i].max_players) {
        return false;
      } else {
        return true;
      }
    }
  }

  return true;
}

function generateLobbyID(length: number): string {
  // Generates a random hexidecimal code of length provided
  // all letters are lowercase, numbers are 0-9

  let new_id = "";

  for (let i = 0; i < length; i++) {
    new_id += Math.floor(Math.random() * 16).toString(16);
  }

  return new_id;
}

function generateUniqueLobbyID(length: number): string {
  // Generates a lobby id of given length that is not in use

  let new_id = "";

  while (new_id === "" || id_list.includes(new_id)) {
    new_id = generateLobbyID(length);
  }

  return new_id;
}

function playerPolling(timetowait: number) {

  let players_inside = 0;

  lobby_list.forEach(function (lobby) {
    players_inside = Object.keys(sono.channelsList[lobby.id]).length;
    if (players_inside == 0) {
      lobby.players = 0;
    } else {
      lobby.players = players_inside;
    }
  })

  globalThis.setTimeout(function () { playerPolling(timetowait) }, timetowait);
}
// Poll for players every second
playerPolling(1000);


Deno.serve({ port: PORT, hostname: HOSTNAME }, async (req: Request) => {

  const url = new URL(req.url);
  const split_path = url.pathname.split("/");

  let body = "";
  if (req.body) {
    body = await req.text();
  }

  // WebSocket handling
  if (req.method === "GET" && split_path.length == 3 && split_path[1] === "join") {
    if (id_list.includes(split_path[2])) {
      // If lobby is full, refuse connection
      if (isLobbyFilled(split_path[2])) {
        return new Response("Lobby Full!", { status: 409 });
      }

      // Lobby exists, connect user
      return sono.connect(req, () => {
        console.log("New client connected to lobby " + split_path[2]);
      });
    }
    else {
      // Lobby does not exist
      return new Response("Lobby not found!", { status: 404 });
    }
  }


  //HTTP signaling

  // Index Page
  else if (req.method === "GET" && url.pathname === "/") {
    console.log("FETCH INDEX")
    return serveFile(req, "./static/lobbylist.html");
  }

  // Get server list
  else if (req.method === "GET" && url.pathname === "/lobbies") {
    return addCorsHeaders(new Response(JSON.stringify(lobby_list), { status: 200 }));
  }

  // Add a new server to the server list with the desired name, respond with the lobby object created
  else if (req.method === "POST" && url.pathname === "/lobbies/new") {

    // Only make another lobby if we can
    if (lobby_list.length < MAX_LOBBIES) {

      const new_lobby = new Lobby();
      let lobby_info = JSON.parse(body);
      new_lobby.name = lobby_info.name.substring(0, 32); // Cap server names at 32 characters
      if (new_lobby.name == "") { new_lobby.name = "New Lobby"; }
      new_lobby.max_players = Number(lobby_info.max_players); // Max player count
      if (new_lobby.max_players < 2) { new_lobby.max_players = 2; }
      if (new_lobby.max_players > 8) { new_lobby.max_players = 8; }
      new_lobby.netcodetype = lobby_info.netcodetype.substring(0, 32); // Netcode type

      new_lobby.id = generateUniqueLobbyID(6); // Generate and log lobby id, create channel of that name
      id_list.push(new_lobby.id);
      sono.channel(new_lobby.id, () => {
        console.log('new lobby channel created: ' + new_lobby.id);
      })

      lobby_list.push(new_lobby);

      return addCorsHeaders(new Response(JSON.stringify(new_lobby), { status: 200 }));

    } else {
      return addCorsHeaders(new Response("Full lobby list - Cannot create new lobby", { status: 409 }));
    }
  }

  // Send them to the game!
  else if (req.method === "GET" && split_path[1] === "play") {

    // const file = await Deno.open("./static/game.html", { read: true, write: false });
    // return new Response(file.readable);

    // If requesting the main HTML page (just /play or /play/{lobby_id})
    if (split_path.length <= 3 && !url.pathname.includes('.')) {
      console.log(isLobbyFilled(split_path[2]))
      if (isLobbyFilled(split_path[2])) {
        return new Response("Lobby is full!", { status: 409 });
      }
      return serveFile(req, "../game/index.html");
      // return serveFile(req, "./static/game.html");  // TEMP path change!
    }
    // If requesting JavaScript file
    else if (url.pathname.endsWith('.js')) { // TEMP false!
      return new Response(await Deno.readFile("../game" + url.pathname.substring(5)), {
        headers: {
          "Content-Type": "application/javascript"
        }
      });
    }
    // If requesting other assets
    else {
      try {
        const filePath = "../game" + url.pathname.substring(5);
        console.log("Attempting to serve: " + filePath);
        return serveFile(req, filePath);
      } catch (err) {
        console.error("Error serving file:", err);
        return addCorsHeaders(new Response("File not found", { status: 404 }));
      }
    }
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
// Deno.serve({ port: WEBSOCKETPORT, hostname: HOSTNAME }, async (req: Request) => {

//   const url = new URL(req.url);
//   const split_path = url.pathname.split("/");

//   let body = "";
//   if (req.body) {
//     body = await req.text();
//   }

//   // Connect to server (WebSocket/RTC)
//   else if (req.method === "GET" && split_path.length == 3 && split_path[1] === "join") {
//     if (id_list.includes(split_path[2])) {

//       // If lobby is full, refuse connection
//       let players_inside = Object.keys(sono.channelsList[split_path[2]]).length;
//       if (isLobbyFilled(split_path[2])) {
//         return new Response("Lobby Full!", { status: 409 });
//       }

//       // Lobby exists, connect user
//       return sono.connect(req, () => {
//         console.log("New client connected to lobby " + split_path[2]);
//       });
//     }
//     else {
//       // Lobby does not exist, do nothing
//       return new Response("Lobby not found!", { status: 404 });
//     }
//   }

//   else { // If all else fails, 404!
//     return new Response("404 Not Found", { status: 404 });
//   }
// });
