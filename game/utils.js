// Constants
const WEAPON_TYPES = {
    PROJECTILE: 'projectile',
    HITSCAN: 'hitscan'
  };
  
  const HITSCAN_COOLDOWN = 1000; // 1 second cooldown
  
  // Utility functions
  function generateProjectileId(playerId, counter) {
    return `${playerId}-proj-${counter}`;
  }
  
  // Debug utilities
  function debugSonoConnection(sono) {
    console.log("Sono connection details:");
    console.log("WebSocket ID:", sono.ws);
    console.log("Sono internal state:", sono);
    console.log("Available methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(sono)));
  }
  
  function debugRTCConnection(rtc) {
    console.log("RTC connection details:");
  }
  
  export { WEAPON_TYPES, 
    HITSCAN_COOLDOWN, 
    generateProjectileId, 
    debugSonoConnection, 
    debugRTCConnection };