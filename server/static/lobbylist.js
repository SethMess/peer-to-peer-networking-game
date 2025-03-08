const SERVER_LOCATION = "localhost" // <-- CHANGE HERE AND IN siteserver.ts TO YOUR LOCAL IP TO AVOID SOP!
const SERVER_PORT = 3000
const SERVER_URL = SERVER_LOCATION + ":" + SERVER_PORT

window.onload = function () {
  main()
};

async function getLobbies() {
    const url = "http://" + SERVER_URL + "/lobbies";
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Response status: ${response.status}`);
      }
  
      const json = await response.json();
      return json;
    } catch (error) {
      console.error(error.message);
    }
  }

function updateList() {
  // For now just get the server list
  let lobbylist = getLobbies().then(
    function(value) {updateSuccess(value);},
    function(error) {updateFailed();}
  );
}

function makeLobbyShowcase(name, id) {
  // Returns an html element representing the given lobby
  return `<div class="lobbyitem flex-container-h"> <div> <p class="lobbyinfo">${name} | ${id}</p></div><div><button class="joinbutton">JOIN</button> </div></div>`
}

function updateSuccess(lobbies) {
  // Continue the server update if it worked

  // Update number of servers
  let lobbylistelm = document.getElementsByClassName("lobbylist")[0]

  let header = `<div class="lobbyitem lobbylistheader"><div class="lobbylistheader">NUMBER OF LOBBIES AVAILABLE: ${lobbies.length}</div></div>`

  // Generate server buttons
  let lobbyelements = ""
  for (var i = 0; i < lobbies.length; i++) { 
    lobbyelements += makeLobbyShowcase(lobbies[i].name, lobbies[i].id) ; 
  }

  let footer = `<div class="lobbyitem lobbylistfooter"><div><button class="createbutton" onclick="createLobby()">CREATE LOBBY</button></div></div>`

  lobbylistelm.innerHTML = header + lobbyelements + footer
}

function updateFailed() {
  // Lets the user know the server fetch failed
  let lobbylistelm = document.getElementsByClassName("lobbylist")[0]
  let header = `<div class="lobbyitem lobbylistheader"><div class="lobbylistheader">ERROR FETCHING LOBBIES!</div></div>`
  let footer = `<div class="lobbyitem lobbylistfooter"><div><button class="createbutton" onclick="createLobby()">CREATE LOBBY</button></div></div>`
  lobbylistelm.innerHTML = header + footer;
}

function createLobby() {
  // Tries to create a lobby
  fetch("http://" + SERVER_URL + "/lobbies/new", {method: "POST"});
  updateList();
}

function main() {
  // Update the lobbies
  updateList();
}



