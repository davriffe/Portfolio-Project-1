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
function buildParkMap(data) {
    const parkMap = {
        lands: {},
        connections: [],
        attractions: {}
    };

    data.lands.forEach(land => {
        parkMap.lands[land.id] = land;
    });

    data.connections.forEach(connection => {
        parkMap.connections.push(connection);
    });

    data.attractions.forEach(attraction => {
        parkMap.attractions[attraction.id] = attraciton;
    });

    return parkMap;
}
function getAttractionsByLand(parkMap, landId) {
    const results = [];

    Object.values(parkMap.attractions).forEach(attraction => {
        if (attraction.land === landId) {
            results.push(attraction);
        }
    });

    return results;
}