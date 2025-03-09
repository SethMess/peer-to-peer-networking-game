import { SonoClient } from 'https://deno.land/x/sono@v1.2/src/sonoClient.js';

const WS_URL = "ws://localhost:3001" // <- UPDATE TO CORRECT URL!!!

window.onload = function () {
    main();
};

function main() {
    let spliturl = window.location.href.split("/");
    let lobbyid = spliturl[spliturl.length - 1];
    let lobbynameelm = document.getElementsByClassName("lobbyname")[0];
    lobbynameelm.innerHTML = "LOBBY ID: " + lobbyid;

    const sono = new SonoClient(WS_URL + '/join/' + lobbyid);
    waitForConnection(sono)
}

function waitForConnection(sono) {
    // COde that waits until sono is fully connected
    if(sono.ws.readyState == 0) {globalThis.setTimeout(function() {waitForConnection(sono)}, 1000); /* this checks the connectionReady flag every 1000 milliseconds*/ }
    else {gameCode(sono)}
}

function gameCode(sono) {
    // Code for the game goes here
    alert("CONNECTED!");
}