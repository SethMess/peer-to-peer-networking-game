import { SonoClient } from 'https://deno.land/x/sono@v1.2/src/sonoClient.js';

const SERVER_URL = "http://localhost:3000"
const WS_URL = "ws://localhost:3000"

async function getLobbies() : Promise<string> {
    // Gets a list of all lobbies
    let resp = await fetch(SERVER_URL + "/lobbies");
    if (resp.status == 200) {
        return await resp.text();
    } else {
        return "Could not get lobbies. Code " + resp.status;
    }
}

async function makeLobby(name = "") : Promise<string> {
    // Returns the new lobby object as a string
    let resp = await fetch(SERVER_URL + "/lobbies/new", {method: "POST", body: name})
    if (resp.status == 200) {
        return await resp.text();
    } else {
        return "";
    }
}

async function joinLobby(lobby_id = "") : SonoClient {
    // Returns SonoClient connected to give lobby
    console.log(WS_URL + '/lobbies/' + lobby_id);
    return new SonoClient(WS_URL + '/lobbies/' + lobby_id);
}

// Fetch and print lobby list
console.log("Lobby List");
let lobby_string = await getLobbies()
console.log(lobby_string);

let lobby_list = JSON.parse(lobby_string);

// If no lobbies exist, make one
if (lobby_list.length == 0) {
    let nlobby = JSON.parse(await makeLobby("New Lobby"));
    console.log("New lobby created with id " + nlobby.id);
    lobby_list.push(nlobby);
}

// Join whatever lobby is there currently
const sono : SonoClient = new SonoClient(WS_URL + '/lobbies/' + lobby_list[0].id);
console.log(sono);

// Waits until we have finished the websocket handshake and then continuously runs the code in the 'else' porition of the code
function mainloop() {
    // If 
    if(sono.ws.readyState == 0) {globalThis.setTimeout(mainloop, 100); /* this checks the connectionReady flag every 100 milliseconds*/ }
    
    else {
        // Print Connection message to console
        console.log("Connected!");
        console.log(sono.ws.readyState);

        // Change to lobby channel and broadcast arrival message
        sono.changeChannel(lobby_list[0].id);
        sono.broadcast("Hello!", "arrival");

        // If anyone else joins and sends an arrival message, print it to the console
        sono.on('arrival', (payload) => {
            console.log(payload); // Will look like { message: "Hello!", from: <client_id> } (client id will probably be 100X)
           });
    }
}

// Call our mainloop
mainloop();
