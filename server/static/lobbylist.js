const SERVER_LOCATION = window.location.hostname // Use environment variable or current hostname
const SERVER_PORT = window.location.port || ""; // Empty string as fallback for hosted environments
const SERVER_URL = SERVER_LOCATION + (SERVER_PORT ? ":" + SERVER_PORT : "")
const PROTOCOL = window.location.protocol

console.log(`Connecting to server at ${PROTOCOL}//${SERVER_URL}`);


const NETCODE_TYPES = ["DELAY-AVG", "DELAY-MAX", "ROLLBACK"];

let netcode_type = 0;

window.onload = function () {
  main()
};

async function getLobbies() {
  const url = PROTOCOL + "//" + SERVER_URL + "/lobbies";
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Response status: ${response.status}`);
    }

    const json = await response.json();
    return json;
  } catch (error) {
    console.error(error.message);
    return []; // Return empty array to prevent undefined errors
  }
}

function updateList() {
  // For now just get the server list
  let lobbylist = getLobbies().then(
    function (value) { updateSuccess(value); },
    function (error) { updateFailed(); }
  );
}

function makeLobbyShowcase(name, id, players, max_players, netcode_type, disabled = false) {
  // Returns an html element representing the given lobby
  if (disabled) {
    return `<div class="lobbyitem flex-container-h"> <div> <p class="lobbyinfo">${name} | (${players}/${max_players}) | ${netcode_type} NETCODE </p></div><div><button class="joinbutton" disabled>JOIN</button> </div></div>`
  } else {
    return `<div class="lobbyitem flex-container-h"> <div> <p class="lobbyinfo">${name} | (${players}/${max_players}) | ${netcode_type} NETCODE </p></div><div><button class="joinbutton" onclick="joinLobby('${id}')">JOIN</button> </div></div>`
  }
}

function updateSuccess(lobbies) {
  // Continue the server update if it worked

  // Update number of servers
  let lobbylistheader = document.getElementsByClassName("lobbylistheader")[0]
  let lobbylistelm = document.getElementsByClassName("lobbylistcontent")[0]
  let createlobbyelm = document.getElementsByClassName("createbutton")[0]

  lobbylistheader.innerHTML = `NUMBER OF LOBBIES AVAILABLE: ${lobbies.length}`

  // Generate server buttons
  let lobbyelements = ""
  for (var i = 0; i < lobbies.length; i++) {
    lobbyelements += makeLobbyShowcase(lobbies[i].name, lobbies[i].id, lobbies[i].players, lobbies[i].max_players, lobbies[i].netcodetype, (lobbies[i].players >= lobbies[i].max_players));
  }

  lobbylistelm.innerHTML = lobbyelements

  // Enable lobby creation
  createlobbyelm.disabled = false;
}

function updateFailed() {
  // Lets the user know the server fetch failed
  let lobbylistelm = document.getElementsByClassName("lobbylist")[0]
  lobbylistheader.innerHTML = `ERROR FETCHING LOBBIES!`
  lobbylistelm.innerHTML = "";
  createlobbyelm.disabled = true;
}

function createLobby() {
  // Tries to create a lobby
  let lobbyname = document.getElementById("lobbynameinput").value;
  let lobbysize = document.getElementById("lobbysizeinput").value;

  if (!document.getElementById("lobbynameinput").checkValidity()) {
    alert("Invalid lobby name. Must be within 1-32 characters.")
    return;
  }
  if (!document.getElementById("lobbysizeinput").checkValidity()) {
    alert("Max player coiunt must be within 2-8 characters.")
    return;
  }

  fetch(PROTOCOL + "//" + SERVER_URL + "/lobbies/new", { method: "POST", body: JSON.stringify({ name: lobbyname, max_players: lobbysize, netcodetype: NETCODE_TYPES[netcode_type] }) });
  updateList();
}

function joinLobby(id) {
  // Send user to join the given lobby
  window.location.href = PROTOCOL + "//" + SERVER_URL + "/play/" + id + "?" + netcode_type;
}

function switchNetcode() {
  // Cycle the netcode by one
  netcode_type += 1;
  if (netcode_type >= NETCODE_TYPES.length) {
    netcode_type = 0;
  }

  document.getElementsByClassName("netcodebutton")[0].innerHTML = NETCODE_TYPES[netcode_type];
}

function main() {

  // Disable make lobby button before we start
  document.getElementsByClassName("createbutton")[0].disabled = true;
  // Update the lobbies
  updateList();
}



