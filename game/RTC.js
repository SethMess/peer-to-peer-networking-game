export class SonoRTC {
  constructor(serverConfig, signalingServer){
    this.configuration = serverConfig;
    this.peerconnection = {}; // "local" sending connections
    this.remoteconnections = {}; // "remote" recieveing connections
    this.server = signalingServer;
    this.callback = null;
    this.dataStreams = {};
    this.receiveChannels = {};
    // this.eventListeners();
    // this.localtracks = [];
    // this.createOffer = this.createOffer.bind(this)
    // this.createdOffer = null;
  }
  eventListeners(){
    console.log("Setting up event listeners");

    this.server.on('grab', (payload) => {
      //console.log("Grabbing: " + payload.type);
      //console.log(payload.message);
      if(payload.type === 'clients'){
        this.clients = payload.message;
        if(this.mychannelclients && this.myid && this.mychannel){
          this.server.trigger('createRTCs')
        }
      }
      else if(payload.type === 'myid'){
        this.myid = payload.message[0];
        if(this.mychannelclients && this.clients && this.mychannel){
          this.server.trigger('createRTCs')
        }
      }
      else if(payload.type === 'mychannelclients'){
        this.mychannelclients = payload.message;
        if(this.clients && this.myid && this.mychannel){
          this.server.trigger('createRTCs')
        }
      }
      else if (payload.type === 'mychannel'){
        this.mychannel = payload.message;
        if(this.clients && this.myid && this.mychannelclients){
          this.server.trigger('createRTCs')
        }
      }
    })
    this.server.on('sendingOffer', (payload)=> {
      const from = payload.from;
      const message = payload.message
      if(message.type === 'offer'){
        if(this.inRoom === true) this.startConnection();
        else return;

        this.remoteconnections[from].setRemoteDescription(new RTCSessionDescription(message))

        this.remoteconnections[from].createAnswer()
          .then(answer => {
            this.remoteconnections[from].setLocalDescription(answer);
            this.server.directmessage(answer, from, 'sendingAnswer')
          })
          .catch(err => console.log('error: unable to create answer', err))
      }
    })
    this.server.on('sendingAnswer', (payload) => {
      const from = payload.from;
      const message = payload.message;
      if(message.type === 'answer'){

        this.peerconnection[from].setRemoteDescription(new RTCSessionDescription(message));
      }
    })
    this.server.on('createRTCs', ()=> {

      this.createRTCs();
    })
    this.server.on('icecandidate_peer', (payload) => {
      const from = payload.from;
      const message = payload.message;
      this.peerconnection[from].addIceCandidate(message['new-ice-candidate'])
        .catch(err => console.log('err', err))
    })
    this.server.on('icecandidate_remote', (payload) => {
      const from = payload.from;
      const message = payload.message;
      this.remoteconnections[from].addIceCandidate(message['new-ice-candidate'])
        .catch(err => console.log('err', err))
    })

    this.server.on('clientleaving', (payload) => {
      console.log("LEAVING")
      const from = payload.from;

      delete this.peerconnection[from];

      this.startConnection();
    })
    this.server.on('clientjoining', (payload) => {
      console.log("JOINING")
      this.startConnection();
    })
  }
  async startConnection(){
    console.log("Starting RTC Connection");
    if(!this.inRoom) await this.eventListeners();
    this.inRoom = true;
    this.server.grab('clients');
    this.server.grab('myid');
    this.server.grab('mychannelclients');
    this.server.grab('mychannel');
    console.log("Grabbing Info");
  }
  createRTCs(){

    this.mychannelclients.forEach(client => {

      if(client === this.myid || this.peerconnection[client]){
        return; // Already have one or dont need one
      }

      // Create new local peer and remote peer
      this.peerconnection[client] = new RTCPeerConnection(this.configuration);
      this.remoteconnections[client] = new RTCPeerConnection(this.configuration);

      // Create new data stream
      this.dataStreams[client] = this.peerconnection[client].createDataChannel(client);
      
      this.peerconnection[client].onnegotiationneeded = () => {
        this.peerconnection[client].createOffer()
          .then(createdOffer => {

            this.peerconnection[client].setLocalDescription(createdOffer);
            this.server.directmessage(createdOffer, client, 'sendingOffer');
          })
          .catch(err => console.log('err', err))
      }
      this.peerconnection[client].onicecandidate = (event) => {
        if (event.candidate) {

          const message = {'new-ice-candidate': event.candidate}
          this.server.directmessage(message, client, 'icecandidate_remote');
        }
      }
      this.remoteconnections[client].onicecandidate = (event) => {
        if (event.candidate) {

          const message = {'new-ice-candidate': event.candidate}
          this.server.directmessage(message, client, 'icecandidate_peer');
        }
      }
      this.peerconnection[client].onconnectionstatechange = (event) => {
        if (this.peerconnection[client].connectionState === 'connected') {

          console.log('connected with client id:', client);
        }
      }
      this.remoteconnections[client].ondatachannel = (event) => {

        this.receiveChannels[client] = event.channel;
        this.receiveChannels[client].onmessage = this.callback;
        // this.dataStreams[client].onopen = callbacks can be added if needed
        // this.dataStreams[client].onclose = callbacks can be added if needed

      };
    })
  }
  changeChannel(targetChannel){

    if(!this.inRoom && targetChannel === 'home'){
      return this.startConnection();
    }

    if(targetChannel == this.mychannel){

      return;
    }

    this.server.broadcast('clientleaving', 'clientleaving');

    this.server.changeChannel(targetChannel);

    this.server.broadcast('clientjoining', 'clientjoining');

    this.peerconnection = {};
    this.dataStreams = {};
    this.receiveChannels = {};

    this.startConnection();
  }

  sendMessage(message) {
    // Send message to all clients
    //console.log(this.mychannelclients);
    
    if (!this.mychannelclients || !Array.isArray(this.mychannelclients)) {
      console.warn("mychannelclients is undefined; message not sent");
      return;
    }
    this.mychannelclients.forEach(client => {
      if(client === this.myid || this.dataStreams[client].readyState != "open"){
        // NOTHING FOR YOURSEWL
      } else {
        this.dataStreams[client].send(message);
      }
    })
  }
}

console.log("WebRTC Module Loaded!");