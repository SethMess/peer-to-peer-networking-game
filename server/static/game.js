import { SonoClient } from 'https://deno.land/x/sono@v1.2/src/sonoClient.js';
import { SonoRTC } from "./backupRTC.js"

const WS_URL = "ws://localhost:3001" // <- UPDATE TO CORRECT URL!!!
const serverConfig = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun.l.google.com:5349" },
        { urls: "stun:stun1.l.google.com:3478" },
        { urls: "stun:stun1.l.google.com:5349" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:5349" }
    ]
}

const pingbuttonelm = document.getElementsByClassName("pingbutton")[0]

let rtc_connection = null

window.onload = function () {
    main();
};

function main() {
    let spliturl = window.location.href.split("/");
    let lobbyid = spliturl[spliturl.length - 1];
    let lobbynameelm = document.getElementsByClassName("lobbyname")[0];
    lobbynameelm.innerHTML = "LOBBY ID: " + lobbyid;
    pingbuttonelm.disabled = true;

    const sono = new SonoClient(WS_URL + '/join/' + lobbyid);
    waitForConnection(sono, lobbyid)
}

function messageRecieved(message) {
    alert(message.data);
}

function waitForConnection(sono, lobbyid) {
    // COde that waits until sono is fully connected
    if(sono.ws.readyState == 0) {globalThis.setTimeout(function() {waitForConnection(sono, lobbyid)}, 1000); /* this checks the connectionReady flag every 1000 milliseconds*/ }
    else {gameCode(sono, lobbyid)}
}

function gameCode(sono, lobbyid) {
    // Code for the game goes here
    alert("CONNECTED!");

    // Now we setup the webrtc connection
    rtc_connection = new SonoRTC(serverConfig, sono, {}) // No constraints for now
    sono.changeChannel(lobbyid);
    rtc_connection.changeChannel(lobbyid);
    rtc_connection.callback = (message) => messageRecieved(message);
    
    pingbuttonelm.disabled = false;
    pingbuttonelm.addEventListener("click", function() {rtc_connection.sendMessage("PING!")});
    
}