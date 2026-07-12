// engine.js
// Runs the main simulation loop
// Imports park data from park.js and agent logic from agent.js
// Handles: tick loop, spawning, decisions, queues, energy, satisfaction
// Exposes simulation state to viz files

import { loadPark, buildParkMap, getAttractionsByLand } from './park.js';
import { ARCHETYPES, createAgent } from './agent.js';

// DRAIN_RATES: converts energyDrainRate strings to numeric multipliers
// Used when calculating energy cost of transit and activity
// Scale: veryLow (barely tires) → veryHigh (exhausts quickly)
const DRAIN_RATES = {
    veryLow: 0.25,
    low: 0.50,
    medium: 1.00,
    high: 1.50,
    veryHigh: 2.00
};

// RECOVERY_RATES: converts energyRecoveryRate strings to numeric multipliers
// Used when an agent eats or rests - how much energy they recover per minute
// Scale: veryLow (barely recovers) → veryHigh (bounces back quickly)
const RECOVERY_RATES = {
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
        simulationState.stats.balkCountByAttraction = {};

        Object.values(simulationState.parkMap.attractions).forEach(attraction => {
            if (attraction.capacityPerHour !== null) {
                simulationState.queues[attraction.id] = [];
                simulationState.stats.balkCountByAttraction[attraction.id] = 0;
            }
        });

    simulationState.agents = [];
    simulationState.currentTick = 0;
    simulationState.status = "idle";
    simulationState.stats = {
        totalAgentsSpawned: 0,
        totalAgentsExited: 0,
        satisfactionByLand: {},
        peakQueueByAttraction: {},
        balkCountByAttraction: {}
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

    processQueues(simulationState.parkMap);

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
// Builds run summary, saves to localStorage, triggers results panel
// Full time series (satisfactionByLand) only goes in JSON export - too large for localStorage
function endSimulation() {
    simulationState.status = "ended";

    // BUILD RUN SUMMARY
    // Derived values calculated once here rather than tracked tick by tick
    const agentSummary = simulationState.agents.map(agent => ({
        archetypeId: agent.archetypeId,
        finalSatisfaction: Math.round(agent.dynamic.satisfaction),
        finalEnergy: Math.round(agent.dynamic.energy),
        finalLand: agent.dynamic.currentLand
    }));

    // Average satisfaction per archetype - preview of radar chart data
    const archetypeIds = [...new Set(agentSummary.map(a => a.archetypeId))];
    const satisfactionByArchetype = {};
    archetypeIds.forEach(id => {
        const group = agentSummary.filter(a => a.archetypeId === id);
        satisfactionByArchetype[id] = Math.round(
            group.reduce((sum, a) => sum + a.finalSatisfaction, 0) / group.length
        );
    });

    // Park rating: average satisfaction across all agents, 0-100
    const parkRating = Math.round(
        agentSummary.reduce((sum, a) => sum + a.finalSatisfaction, 0) / agentSummary.length
    );

    // Most congested attraction by peak queue length
    const peakEntries = Object.entries(simulationState.stats.peakQueueByAttraction);
    const mostCongested = peakEntries.length > 0
        ? peakEntries.reduce((a, b) => b[1] > a[1] ? b : a)[0]
        : null;

    // Most balked attraction by balk count
    const balkEntries = Object.entries(simulationState.stats.balkCountByAttraction);
    const mostBalked = balkEntries.length > 0
        ? balkEntries.reduce((a, b) => b[1] > a[1] ? b : a)[0]
        : null;

    // Land average satisfaction summary (from time series)
    const landSummary = {};
    Object.entries(simulationState.stats.satisfactionByLand).forEach(([landId, readings]) => {
        landSummary[landId] = readings.length > 0
            ? Math.round(readings.reduce((s, v) => s + v, 0) / readings.length)
            : null;
    });

    // RUN RECORD: compact object stored in localStorage and shown in history table
    // Does NOT include full time series - keeps each record under 1KB
    const runRecord = {
        runId: Date.now(),
        runDate: new Date().toLocaleString(),
        totalTicks: simulationState.currentTick,
        agentCount: simulationState.stats.totalAgentsSpawned,
        parkRating,
        mostCongested,
        mostBalked,
        satisfactionByArchetype,
        landSummary,
        agentSummary
    };

    // FULL EXPORT DATA: includes time series, used only for JSON download
    const fullExportData = {
        ...runRecord,
        satisfactionByLand: simulationState.stats.satisfactionByLand,
        peakQueueByAttraction: simulationState.stats.peakQueueByAttraction,
        balkCountByAttraction: simulationState.stats.balkCountByAttraction
    };

    // LOCALSTORAGE: save run record, keep last 20 runs max
    // Each record is compact (no time series) so 20 runs stays well under 5MB limit
    try {
        const stored = JSON.parse(localStorage.getItem("aethermoor_runs") || "[]");
        stored.unshift(runRecord);
        if (stored.length > 20) stored.splice(20);
        localStorage.setItem("aethermoor_runs", JSON.stringify(stored));
    } catch (e) {
        console.warn("localStorage save failed:", e);
    }

    console.log("Simulation ended at tick:", simulationState.currentTick);
    console.log("Total agents spawned:", simulationState.stats.totalAgentsSpawned);
    console.log("Total agents exited:", simulationState.stats.totalAgentsExited);
    console.log("Park rating:", parkRating);

    showResultsPanel(runRecord, fullExportData);
}

// arrayToCSV: converts an array of flat objects into a CSV string
// Headers pulled from first object's keys - only works on flat objects
function arrayToCSV(rows) {
    if (rows.length === 0) return "";
    const headers = Object.keys(rows[0]);
    const lines = rows.map(row =>
        headers.map(h => JSON.stringify(row[h] ?? "")).join(",")
    );
    return [headers.join(","), ...lines].join("\n");
}

// triggerDownload: creates a temporary link element, clicks it, then cleans up
function triggerDownload(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// showResultsPanel: injects end-of-run overlay into the page
// Shows current run stats, run history from localStorage, and export options
// Dismissing returns to the paused end state so D3/Three.js panels are still usable
function showResultsPanel(runRecord, fullExportData) {
    // Remove any existing panel first (e.g. if user ran sim twice without dismissing)
    const existing = document.getElementById("results-panel");
    if (existing) existing.remove();

    // Load run history from localStorage
    let history = [];
    try {
        history = JSON.parse(localStorage.getItem("aethermoor_runs") || "[]");
    } catch (e) {
        history = [];
    }

    // Build archetype satisfaction rows
    const archetypeRows = Object.entries(runRecord.satisfactionByArchetype)
        .map(([id, score]) => `
            <tr>
                <td style="color:var(--text-secondary);padding:2px 8px 2px 0;">${id.replace(/_/g, " ")}</td>
                <td style="text-align:right;">${score}</td>
            </tr>`)
        .join("");

    // Build run history rows (most recent first, already sorted by localStorage save)
    const historyRows = history.map((run, i) => `
        <tr style="opacity:${i === 0 ? "1" : "0.6"};">
            <td style="padding:2px 8px 2px 0;">${run.runDate}</td>
            <td style="text-align:right;">${run.agentCount}</td>
            <td style="text-align:right;">${run.parkRating}</td>
            <td style="padding-left:8px;color:var(--text-secondary);">
                ${run.mostCongested ? run.mostCongested.replace(/_/g, " ") : "—"}
            </td>
        </tr>`).join("");

    const panel = document.createElement("div");
    panel.id = "results-panel";
    panel.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #252525;
        border: 1px solid #444444;
        border-radius: 8px;
        padding: 1.5rem;
        width: 520px;
        max-height: 80vh;
        overflow-y: auto;
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.8rem;
        color: #C8C8C8;
        z-index: 1000;
        box-shadow: 0 8px 32px rgba(0,0,0,0.6);
    `;

    panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:1rem;">
            <span style="font-size:1rem;">Aethermoor — Run Complete</span>
            <span style="color:#7A7A7A;">${runRecord.runDate}</span>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:1rem;">
            <div style="background:#1A1A1A;border-radius:4px;padding:0.75rem;">
                <div style="color:#7A7A7A;margin-bottom:0.25rem;">Park Rating</div>
                <div style="font-size:1.5rem;">${runRecord.parkRating}<span style="font-size:0.7rem;color:#7A7A7A;">/100</span></div>
            </div>
            <div style="background:#1A1A1A;border-radius:4px;padding:0.75rem;">
                <div style="color:#7A7A7A;margin-bottom:0.25rem;">Agents</div>
                <div style="font-size:1.5rem;">${runRecord.agentCount}</div>
            </div>
            <div style="background:#1A1A1A;border-radius:4px;padding:0.75rem;">
                <div style="color:#7A7A7A;margin-bottom:0.25rem;">Most Congested</div>
                <div>${runRecord.mostCongested ? runRecord.mostCongested.replace(/_/g, " ") : "—"}</div>
            </div>
            <div style="background:#1A1A1A;border-radius:4px;padding:0.75rem;">
                <div style="color:#7A7A7A;margin-bottom:0.25rem;">Most Balked</div>
                <div>${runRecord.mostBalked ? runRecord.mostBalked.replace(/_/g, " ") : "—"}</div>
            </div>
        </div>

        <div style="margin-bottom:1rem;">
            <div style="color:#7A7A7A;margin-bottom:0.5rem;">Satisfaction by Archetype</div>
            <table style="width:100%;border-collapse:collapse;">${archetypeRows}</table>
        </div>

        <div style="margin-bottom:1rem;">
            <div style="color:#7A7A7A;margin-bottom:0.5rem;">Run History (this session)</div>
            <table style="width:100%;border-collapse:collapse;">
                <tr style="color:#7A7A7A;border-bottom:1px solid #333333;">
                    <td style="padding:2px 8px 4px 0;">Date</td>
                    <td style="text-align:right;">Agents</td>
                    <td style="text-align:right;">Rating</td>
                    <td style="padding-left:8px;">Top Congestion</td>
                </tr>
                ${historyRows}
            </table>
        </div>

        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <button id="rp-run-again" style="flex:1;">Run Again</button>
            <button id="rp-export-json" style="flex:1;">Export JSON</button>
            <button id="rp-export-csv" style="flex:1;">Export CSV</button>
            <button id="rp-dismiss" style="flex:1;color:#7A7A7A;">Dismiss</button>
        </div>
    `;

    document.body.appendChild(panel);

    // Wire buttons
    document.getElementById("rp-run-again").addEventListener("click", () => {
        panel.remove();
        reset();
        play();
    });

    document.getElementById("rp-export-json").addEventListener("click", () => {
        triggerDownload(
            JSON.stringify(fullExportData, null, 2),
            `aethermoor_run_${runRecord.runId}.json`,
            "application/json"
        );
    });

    document.getElementById("rp-export-csv").addEventListener("click", () => {
        triggerDownload(
            arrayToCSV(runRecord.agentSummary),
            `aethermoor_agents_${runRecord.runId}.csv`,
            "text/csv"
        );
    });

    document.getElementById("rp-dismiss").addEventListener("click", () => {
        panel.remove();
    });
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

    const drainRate = DRAIN_RATES[agent.fixed.energyDrainRate];
    agent.dynamic.energy = Math.max(0, agent.dynamic.energy - drainRate * minutes);
    agent.dynamic.stayMinutesRemaining -= minutes;

    agent.dynamic.transit = {
        fromLand: fromLand,
        toLand: toLand,
        departTick: currentTick,
        arriveTick: currentTick + minutes
    };

}

// checkTransitArrival: finalizes a transit once enough ticks have passed
// Only updates currentLand - does NOT touch targetAttraction, since the agent
// still needs to queue at the actual attraction once they're in the right land
function checkTransitArrival(agent, currentTick) {
    if (currentTick >= agent.dynamic.transit.arriveTick) {
        const arrivedLand = agent.dynamic.transit.toLand;
        agent.dynamic.currentLand = arrivedLand;
        agent.dynamic.transit = null;
    }
}

// processAgent: per-tick dispatcher for a single agent's state
// Checks, in order: mid-transit? wait or finish. No target? decide one.
// Has a target but not there yet? start traveling. Otherwise: arrived,
// ready to queue - step 3, not built yet
function processAgent(agent, parkMap, currentTick) {

    // Exit check runs first - an agent who should leave does nothing else this tick
    checkAgentExit(agent, currentTick);
    if (agent.dynamic.currentLand === "exited") return;

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
        return;
    }

    if (target.capacityPerHour === null) {
        completeNoQueueVisit(agent, target);
        return;
    }

    const queue = simulationState.queues[target.id];
    if (queue.includes(agent)) {
        checkBalking(agent, target);
    } else {
        joinQueue(agent, target);
    }
}

// TYPE_TO_PREFERENCE: reverse of PREFERENCE_TO_TYPE - given a venue's singular
// type, find the matching plural preferenceWeights key. Dining has no entry,
// since dining is energy-driven, not a preference category an agent can favor
const TYPE_TO_PREFERENCE = {
    attraction: "attractions",
    activity: "activities",
    shopping: "shopping"
};

// isPreferredCategory: an agent's "preferred" category is whichever one carries
// the highest weight in their preferenceWeights - this is what balkingMinutes
// (preferred vs other) and completedPreferred vs completedNonPreferred both key off
function isPreferredCategory(agent, attractionType) {
    const category = TYPE_TO_PREFERENCE[attractionType];
    if (!category) return false;

    const weights = agent.fixed.preferenceWeights;
    const maxWeight = Math.max(...Object.values(weights));
    return weights[category] === maxWeight;
}

// getTickCapacity: converts an attraction's hourly capacity into how many
// riders it can process in a single tick (1 tick = 1 minute)
// Math.max(1, ...) guards against rounding an already-low capacity down to 0
function getTickCapacity(attraction) {
    return Math.max(1, Math.round(attraction.capacityPerHour / 60));
}

// joinQueue: adds an agent to an attraction's queue, only if they aren't
// already in it - queue stores the actual agent objects, not just ids, since
// there's no need for a separate lookup step this way
function joinQueue(agent, attraction) {
    const queue = simulationState.queues[attraction.id];
    if (!queue.includes(agent)) {
        queue.push(agent);
        agent.dynamic.waitingMinutes = 0;
    }
}

// checkBalking: runs once per tick for an agent already sitting in a queue
// Increments their wait time, then checks it against the threshold that
// matches whether this is their preferred category or not
function checkBalking(agent, attraction) {
    agent.dynamic.waitingMinutes++;

    const preferred = isPreferredCategory(agent, attraction.type);
    const threshold = preferred
        ? agent.dynamic.balkingMinutes.preferred
        : agent.dynamic.balkingMinutes.other;

    if (agent.dynamic.waitingMinutes > threshold) {
            const queue = simulationState.queues[attraction.id];
            const index = queue.indexOf(agent);
            if (index !== -1) queue.splice(index, 1);

            simulationState.stats.balkCountByAttraction[attraction.id]++;

            agent.dynamic.satisfaction += SATISFACTION_EVENTS.waitExceededBalk;
            agent.dynamic.satisfaction += SATISFACTION_EVENTS.balkedAndLeft;
            agent.dynamic.satisfaction = Math.min(100, Math.max(0, agent.dynamic.satisfaction));

            agent.dynamic.targetAttraction = null;
            agent.dynamic.waitingMinutes = 0;
        }
}

// processQueues: runs ONCE per tick, not per-agent (called directly from runTick)
// For every attraction with an active queue, pulls off however many riders
// this tick's capacity allows, front of the line first
function processQueues(parkMap) {
    Object.keys(simulationState.queues).forEach(attractionId => {
        const queue = simulationState.queues[attractionId];
        if (queue.length === 0) return;

        const attraction = parkMap.attractions[attractionId];
        const capacity = getTickCapacity(attraction);
        const riders = queue.splice(0, capacity);

        riders.forEach(agent => completeRide(agent, attraction));
    });
}

// completeRide: applies satisfaction for finishing an attraction/activity
// Distinguishes preferred vs non-preferred using the same helper as balking
// completeRide: cap satisfaction at 100, floor at 0
function completeRide(agent, attraction) {
    const preferred = isPreferredCategory(agent, attraction.type);
    agent.dynamic.satisfaction += preferred
        ? SATISFACTION_EVENTS.completedPreferred
        : SATISFACTION_EVENTS.completedNonPreferred;

    agent.dynamic.satisfaction = Math.min(100, Math.max(0, agent.dynamic.satisfaction));

    agent.dynamic.currentAttraction = attraction.id;
    agent.dynamic.targetAttraction = null;
    agent.dynamic.waitingMinutes = 0;
}

// DINING_RECOVERY_MINUTES: assumed flat time an agent spends eating, used to
// scale how much energy they recover - first real use of energyRecoveryRate
const DINING_RECOVERY_MINUTES = 20;

// completeNoQueueVisit: dining and shopping have no capacityPerHour, so they
// skip the queue system entirely and resolve the instant an agent arrives
// completeNoQueueVisit: cap satisfaction at 100, floor at 0
function completeNoQueueVisit(agent, attraction) {
    if (attraction.type === "dining") {
        const recoveryRate = RECOVERY_RATES[agent.fixed.energyRecoveryRate];
        agent.dynamic.energy = Math.min(100, agent.dynamic.energy + recoveryRate * DINING_RECOVERY_MINUTES);
        agent.dynamic.satisfaction += SATISFACTION_EVENTS.diningCompleted;
    } else {
        agent.dynamic.satisfaction += SATISFACTION_EVENTS.shoppingCompleted;
    }

    agent.dynamic.satisfaction = Math.min(100, Math.max(0, agent.dynamic.satisfaction));

    agent.dynamic.currentAttraction = attraction.id;
    agent.dynamic.targetAttraction = null;
}

// checkAgentExit: runs every tick for every agent via processAgent
// Decrements stayMinutesRemaining each tick the agent is actively waiting in a queue
// Triggers exit when time runs out OR when park is closed and agent has no transit
// Removes agent from any active queue before marking exited - prevents ghost queue entries
function checkAgentExit(agent, currentTick) {

    // Drain stay time for agents sitting in queues - transit already drains in startTransit
    if (agent.dynamic.currentLand !== "exited") {
        const inQueue = Object.values(simulationState.queues).some(
            queue => queue.includes(agent)
        );
        if (inQueue) {
            agent.dynamic.stayMinutesRemaining--;
        }
    }

    // Check if agent should leave - either out of time or park is closed
    const outOfTime = agent.dynamic.stayMinutesRemaining <= 0;
    const parkClosed = simulationState.currentTick >= PARK_CLOSED_TICK;
    const notTransiting = !agent.dynamic.transit;

    if ((outOfTime || parkClosed) && notTransiting && 
         agent.dynamic.currentLand !== "exited") {

        // Remove from any queue they're sitting in
        Object.values(simulationState.queues).forEach(queue => {
            const index = queue.indexOf(agent);
            if (index !== -1) queue.splice(index, 1);
        });

        agent.dynamic.currentLand = "exited";
        agent.dynamic.targetAttraction = null;
        simulationState.stats.totalAgentsExited++;
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

