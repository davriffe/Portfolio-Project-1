// park.js
// Loads and parses park_config.json
// Exposes park data to the simulation engine
// Handles: lands, connections, attractions
// Does NOT run any simulation logic - that is engine.js

async function loadPark() {
    const response = await fetch('../data/park_config.json');
    const data = await response.json();
    return data;
}