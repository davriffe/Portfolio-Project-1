// engine.js
// Runs the main simulation loop
// Imports park data from park.js and agent logic from agent.js
// Handles: tick loop, spawning, decisions, queues, energy, satisfaction
// Exposes simulation state to viz files

import { loadPark, buildParkMap, getAttractionsByLand } from './park.js';
import { ARCHETYPES, createAgent } from './agent.js';

// ENERGY_RATES: converts archetype drain/recovery strings to numeric multipliers
// Used by tick loop when calculating energy changes per minute
// veryLow = barely drains, veryHigh = exhausts quickly

const ENERGY_RATES = {
    veryLow: 0.25,
    low: 0.50,
    medium: 1.00,
    high: 1.50,
    veryHigh: 2.00
};

// SATISFACTION_EVENTS: point values for things that make agents happy or frustrated
// Positive = good experience, negative = bad experience
// Referenced whenever an agent completes, balks, or hits a threshold

const SATISFACTION_EVENTS = {
    completedPreferred: 10,
    completedNonPreferred: 3,
    shortWait: 5,
    diningCompleted: 8,
    shoppingCompleted: 4,
    discoveredTunnel: 6,
    waitExceededBalk: -15,
    balkedAndLeft: -8,
    energyLow: -10,
    forcedCompromise: -8,
    longTransit: -5,
    attractionOnCooldown: -3
};

// SPAWN_WEIGHTS: probability distribution for archetype selection at spawn
// Must add up to 1.0 exactly
// Higher number = more common in the park

const SPAWN_WEIGHTS = {
    ride_activity_enthusiast: 0.25,
    season_pass_holder: 0.15,
    once_in_a_lifetime: 0.20,
    friend_group: 0.20,
    newly_married: 0.10,
    vip_entitled: 0.05,
    vlogger: 0.05
};

// SIMULATION MILESTONES (in ticks, 1 tick = 1 minute, 720 ticks = full day)
// SPAWN_CUTOFF: no new agents after 7pm
// CLOSING_SOON: agents start heading out at 8pm
// PARK_CLOSED: everyone exits at 9pm
// VIP_EXIT: VIPs linger until 9:30pm

const CLOSING_SOON_TICK = 660;
const PARK_CLOSED_TICK = 720;
const SPAWN_CUTOFF_TICK = 600;
const VIP_EXIT_TICK = 750;

// simulationState: single source of truth for everything happening right now
// Viz files read from this every tick to know what to draw
// status: idle/playing/paused/ended
// agents: all active agents currently in park
// queues: who is waiting at each attraction
// stats: running totals for end state heatmap

let simulationState = {
    status: "idle",
    currentTick: 0,
    agents: [],
    queues: {},
    parkMap: null,
    stats: {
        totalAgentsSpawned: 0,
        totalAgentsExited: 0,
        satisfactionByLand: {},
        peakQueueByAttraction: {}
    }
};

const snapshotInterval = 10;
let snapshots = [];

// initSimulation: runs once when user hits Play
// Loads park data, builds queues, resets all state
// agentCount defaults to 100, control panel can override

async function initSimulation(agentCount = 100) {
    const rawData = await loadPark();
    simulationState.parkMap = buildParkMap(rawData);

    simulationState.queues = {};
    Object.values(simulationState.parkMap.attractions).forEach(attraction => {
        if (attraction.capacityPerHour !== null) {
            simulationState.queues[attraction.id] = [];
        }
    });

    simulationState.agents = [];
    simulationState.currentTick = 0;
    simulationState.status = "idle";
    simulationState.stats = {
        totalAgentsSpawned: 0,
        totalAgentsExited: 0,
        satisfactionByLand: {},
        peakQueueByAttraction: {}
    };

    Object.keys(simulationState.parkMap.lands).forEach(landId => {
        simulationState.stats.satisfactionByLand[landId] = [];
    });

    console.log("Simulation initialized with park:", rawData.park.name);
    console.log("Lands loaded:", Object.keys(simulationState.parkMap.lands).length);
    console.log("Attractions loaded:", Object.values(simulationState.parkMap.attractions).length);
}

// selectArchetype: weighted random selection from SPAWN_WEIGHTS
// Rolls 0-1 and walks through weights until roll is covered
// More weight = bigger slice = more likely to be selected

function selectArchetype() {
    const roll = Math.random();
    let cumulative = 0;

    for (const [archetypeId, weight] of Object.entries(SPAWN_WEIGHTS)) {
        cumulative += weight;
        if (roll < cumulative) {
            return archetypeId;
        }
    }
    return "ride_activity_enthusiast";
}

// isInArrivalWindow: checks if current tick falls in archetype's arrival window
// Prevents late spawning of archetypes who only arrive early (vlogger, VIP)
// Season pass holder has widest window - arrives anytime before 5pm

function isInArrivalWindow(archetypeId, currentTick) {
    const windows = {
        ride_activity_enthusiast: { min: 0, max: 120 },
        season_pass_holder:       { min: 0, max: 480 },
        once_in_a_lifetime:       { min: 60, max: 180 },
        friend_group:             { min: 60, max: 240 },
        newly_married:            { min: 60, max: 180 },
        vip_entitled:             { min: 0, max: 120 },
        vlogger:                  { min: 0, max: 60 }
    };

    const window = windows[archetypeId];
    return currentTick >= window.min && currentTick <= window.max;
}

// getSpawnChance: returns probability of a spawn attempt succeeding this tick
// Creates realistic arrival curve - busy morning, quiet afternoon
// Returns 0 after tick 600 as backup to SPAWN_CUTOFF check

function getSpawnChance(currentTick) {
    if (currentTick < 60)  return 0.8;
    if (currentTick < 180) return 0.6;
    if (currentTick < 300) return 0.4;
    if (currentTick < 480) return 0.3;
    if (currentTick < 600) return 0.2;
    return 0;
}

// trySpawnAgent: orchestrates all spawn checks in order
// Early returns if any check fails - efficient and readable
// Only creates agent if tick, count, chance, and arrival window all pass

function trySpawnAgent(agentCount) {
    if (simulationState.currentTick >= SPAWN_CUTOFF_TICK) return;
    if (simulationState.agents.length >= agentCount) return;

    const spawnChance = getSpawnChance(simulationState.currentTick);
    if (Math.random() > spawnChance) return;

    const archetypeId = selectArchetype();
    if (!isInArrivalWindow(archetypeId, simulationState.currentTick)) return;

    const agent = createAgent(archetypeId);
    simulationState.agents.push(agent);
    simulationState.stats.totalAgentsSpawned++;
}

// TICK LOOP VARIABLES
// lastTickTime: timestamp of when last tick ran, used to measure real time elapsed
// msPerTick: milliseconds of real time between each simulated minute
//   1000 = 1 real second per tick = 12 real minutes for full day
//   500 = 2 ticks per second = 6 real minutes (2x speed)
// agentCountSetting: max agents allowed in park at once, set by control panel slider

let lastTickTime = 0;
let msPerTick = 1000;
let agentCountSetting = 100;

// simulationLoop: called by requestAnimationFrame ~60 times per second
// Only runs a tick when enough real time has passed (msPerTick threshold)
// Stops immediately if simulation is not in playing status

function simulationLoop(timestamp) {
    if (simulationState.status !== "playing") return;

    if (timestamp - lastTickTime >= msPerTick) {
        lastTickTime = timestamp;
        runTick();
    }
    requestAnimationFrame(simulationLoop);
}

// runTick: executes one simulated minute of park time
// Checks if park should end, spawns new agents, advances clock, records stats
// Order is important - always spawn before advancing tick

function runTick() {
    if (simulationState.currentTick >= PARK_CLOSED_TICK) {
        const activeAgents = simulationState.agents.filter(
            agent => agent.dynamic.currentLand !== "exited"
        );
        if (activeAgents.length === 0) {
            endSimulation();
            return;
        }
    }

    trySpawnAgent(agentCountSetting);

    simulationState.agents.forEach(agent => {
        processAgent(agent, simulationState.parkMap, simulationState.currentTick);
    });

    simulationState.currentTick++;
    recordTickStats();
    captureSnapshot();
}

// recordTickStats: snapshot of current park state saved every tick
// satisfactionByLand: builds array of average satisfaction per land over time
// peakQueueByAttraction: tracks highest queue length ever seen per attraction
// Both feed the end state heatmap and summary visualizations

function recordTickStats() {
    Object.keys(simulationState.parkMap.lands).forEach(landId => {
        const agentsInLand = simulationState.agents.filter(
            agent => agent.dynamic.currentLand === landId
        );

        if (agentsInLand.length > 0) {
            const avgSatisfaction = agentsInLand.reduce(
                (sum, agent) => sum + agent.dynamic.satisfaction, 0) / agentsInLand.length;

            simulationState.stats.satisfactionByLand[landId].push(avgSatisfaction);
        }
    });

    Object.keys(simulationState.queues).forEach(attractionId => {
        const queueLength = simulationState.queues[attractionId].length;
        const current = simulationState.stats.peakQueueByAttraction[attractionId] || 0;
        if (queueLength > current) {simulationState.stats.peakQueueByAttraction[attractionId] = queueLength;}
    });
}

// endSimulation: called when all agents have exited after park close
// Freezes simulation state for viz to display final summary
// Console logs provide quick sanity check during development

function endSimulation() {
    simulationState.status = "ended";
    console.log("Simulation ended at tick:", simulationState.currentTick);
    console.log("Total agents spawned:", simulationState.stats.totalAgentsSpawned);
    console.log("Total agents exited:", simulationState.stats.totalAgentsExited);
}

// SIMULATION CONTROLS: functions called directly by the UI control panel
// play: initializes if needed then starts the tick loop
// pause: freezes simulation in place, can be resumed
// stop: ends simulation and resets everything to initial state
// setSpeed: adjusts msPerTick to change how fast simulation runs
// setAgentCount: updates max agent cap, takes effect on next spawn attempt

async function play() {
    if (simulationState.status === "idle") {
        await initSimulation(agentCountSetting);
    }
    simulationState.status = "playing";
    requestAnimationFrame(simulationLoop);
}

function pause() {
    if (simulationState.status === "playing") {
        simulationState.status = "paused";
    } else if (simulationState.status === "paused") {
        simulationState.status = "playing";
        requestAnimationFrame(simulationLoop);
    }
}

function stop() {
    simulationState.status = "idle";
    console.log("Simulation stopped.");
}

function reset() {
    simulationState.status = "idle";
    simulationState.currentTick = 0;
    simulationState.agents = [];
    simulationState.queues = {};
    lastTickTime = 0;
    snapshots = [];
    console.log("Simulation reset.");
}

function setSpeed(multiplier) {
    const speeds = { 1: 1000, 2: 500, 4: 250, 8: 125 };
    msPerTick = speeds[multiplier] || 1000;
}

function setAgentCount(count) {
    agentCountSetting = Math.min(Math.max(count, 10), 200);
}

// TIMELINE / HISTORY
// snapshots: array of simulation state captures taken every 10 ticks
// Enables timeline scrubbing — seek to any point by loading nearest snapshot
// snapshotInterval: how often to capture state (every 10 ticks = every 10 minutes)
// WARNING: storing full state every tick would use too much memory
// Every 10 ticks is a reasonable tradeoff between accuracy and memory

// TODO V2: connect seekToTick() to timeline scrubber drag event in viz layer
// TODO V2: add timeline bar component to index.html  
// TODO V2: style timeline to disappear when cursor not at bottom of screen
// TODO V2: consider AWS for larger agent counts beyond 200

function captureSnapshot() {
    if (simulationState.currentTick % snapshotInterval !== 0) return;

    snapshots.push({
        tick: simulationState.currentTick,
        agents: JSON.parse(JSON.stringify(simulationState.agents)),
        queues: JSON.parse(JSON.stringify(simulationState.queues)),
        stats: JSON.parse(JSON.stringify(simulationState.stats))
    });
}

function seekToTick(targetTick) {
    const snapshot = snapshots.reduce((closest, current) => {
        return Math.abs(current.tick - targetTick) < 
               Math.abs(closest.tick - targetTick) ? current : closest;
    });

    simulationState.currentTick = snapshot.tick;
    simulationState.agents = JSON.parse(JSON.stringify(snapshot.agents));
    simulationState.queues = JSON.parse(JSON.stringify(snapshot.queues));
    simulationState.stats = JSON.parse(JSON.stringify(snapshot.stats));
    simulationState.status = "paused";
}

// ENERGY_LOW_THRESHOLD: below this, energy override beats archetype preference entirely
// "Time is currency, energy is currency too" - an exhausted guest needs to recover
// regardless of what they'd normally choose to do
const ENERGY_LOW_THRESHOLD = 25;

// PREFERENCE_TO_TYPE: preferenceWeights keys are plural, but park_config.json's
// attraction "type" field is singular - this maps one to the other so a rolled
// category can actually be used to filter real venues
const PREFERENCE_TO_TYPE = {
    attractions: "attraction",
    activities: "activity",
    shopping: "shopping"
};

// decideNextAction: picks what an idle agent does next
// Does NOT move the agent or spend any time - that's the transit step, built separately
// Sets dynamic.targetAttraction (where they're headed), distinct from currentAttraction
// (where they currently ARE, only set once they actually arrive)
function decideNextAction(agent, parkMap) {
    let type;

    if (agent.dynamic.energy < ENERGY_LOW_THRESHOLD) {
        type = "dining";
    } else {
        const category = rollPreferenceCategory(agent.fixed.preferenceWeights);
        type = PREFERENCE_TO_TYPE[category];
    }

    const target = pickRandomVenueByType(parkMap, type);
    agent.dynamic.targetAttraction = target ? target.id : null;
}

// rollPreferenceCategory: weighted random pick from an agent's preferenceWeights
// Same cumulative-weight pattern as selectArchetype() above
function rollPreferenceCategory(preferenceWeights) {
    const roll = Math.random();
    let cumulative = 0;

    for (const [category, weight] of Object.entries(preferenceWeights)) {
        cumulative += weight;
        if (roll < cumulative) {
            return category;
        }
    }
    return "attractions";
}

// pickRandomVenueByType: V1 stub - picks any matching venue anywhere in the park
// Does NOT consider distance or transit time yet - that's the transit step's job
// TODO: replace with nearest-by-transit-time once transit logic exists
function pickRandomVenueByType(parkMap, type) {
    const matches = Object.values(parkMap.attractions).filter(
        attraction => attraction.type === type
    );

    if (matches.length === 0) return null;

    const index = Math.floor(Math.random() * matches.length);
    return matches[index];
}

// TRANSIT_FALLBACK_MINUTES: used when no direct connection exists between two lands
// The connections graph isn't fully connected (e.g. Hollow has no direct link to
// Lunara - only Observatory does) - real multi-hop pathfinding is a V2 refinement
// For V1, this flat estimate plus the longTransit penalty stands in for
// "that was a long, indirect walk"
const TRANSIT_FALLBACK_MINUTES = 8;

// findConnectionMinutes: looks up direct transit time between two lands
// Connections are stored one-directional in park_config.json but represent a
// physical path usable both ways, so both directions get checked
// Returns null if no direct connection exists - caller decides the fallback
function findConnectionMinutes(parkMap, landA, landB) {
    const connection = parkMap.connections.find(
        c => (c.from === landA && c.to === landB) || (c.from === landB && c.to === landA)
    );
    return connection ? connection.transitMinutes : null;
}

// startTransit: begins moving an agent toward its target's land
// Cost (time + energy) is deducted as a lump sum the moment travel begins,
// not drained tick-by-tick during the trip - engine.js only needs to record
// WHEN transit started and ends; a visualization layer can interpolate the
// agent's position smoothly between those two known ticks on its own later
function startTransit(agent, parkMap, currentTick) {
    const target = parkMap.attractions[agent.dynamic.targetAttraction];
    const toLand = target.land;
    const fromLand = agent.dynamic.currentLand;

    let minutes = findConnectionMinutes(parkMap, fromLand, toLand);

    if (minutes === null) {
        minutes = TRANSIT_FALLBACK_MINUTES;
        agent.dynamic.satisfaction += SATISFACTION_EVENTS.longTransit;
    }

    const drainRate = ENERGY_RATES[agent.fixed.energyDrainRate];
    agent.dynamic.energy = Math.max(0, agent.dynamic.energy - drainRate * minutes);
    agent.dynamic.stayMinutesRemaining -= minutes;

    agent.dynamic.transit = {
        fromLand: fromLand,
        toLand: toLand,
        departTick: currentTick,
        arriveTick: currentTick + minutes
    };

    // TEMPORARY TEST - confirms transit starts correctly, remove once confirmed
    if (!window.__loggedTransitStart) {
        console.log("Transit started:", fromLand, "->", toLand, ", arriving tick", currentTick + minutes);
        window.__loggedTransitStart = true;
    }
}

// checkTransitArrival: finalizes a transit once enough ticks have passed
// Only updates currentLand - does NOT touch targetAttraction, since the agent
// still needs to queue at the actual attraction once they're in the right land
function checkTransitArrival(agent, currentTick) {
    if (currentTick >= agent.dynamic.transit.arriveTick) {
        const arrivedLand = agent.dynamic.transit.toLand;
        agent.dynamic.currentLand = arrivedLand;
        agent.dynamic.transit = null;

        // TEMPORARY TEST - confirms transit completes correctly, remove once confirmed
        if (!window.__loggedTransitArrival) {
            console.log("Transit arrived: now at", arrivedLand);
            window.__loggedTransitArrival = true;
        }
    }
}

// processAgent: per-tick dispatcher for a single agent's state
// Checks, in order: mid-transit? wait or finish. No target? decide one.
// Has a target but not there yet? start traveling. Otherwise: arrived,
// ready to queue - step 3, not built yet
function processAgent(agent, parkMap, currentTick) {
    if (agent.dynamic.transit) {
        checkTransitArrival(agent, currentTick);
        return;
    }

    if (!agent.dynamic.targetAttraction) {
        decideNextAction(agent, parkMap);
        return;
    }

    const target = parkMap.attractions[agent.dynamic.targetAttraction];
    if (agent.dynamic.currentLand !== target.land) {
        startTransit(agent, parkMap, currentTick);
    }
}

export { 
    simulationState, 
    play, 
    pause, 
    stop, 
    reset,
    setSpeed, 
    setAgentCount,
    seekToTick
};

