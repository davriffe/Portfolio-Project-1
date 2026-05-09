// engine.js
// Runs the main simulation look
// Imports park data from park.js and agent logic from agent.js
// Handles: tick look, spawning, decisions, queues, engery, satisfaction
// Exposes simulation state to viz files

import { loadPark, buildParkMap, getAttractionsByLand } from './park.js';
import { ARCHETYPES, createAgent } from './agent.js';

const ENERGY_RATES = {
    veryLow: 0.25,
    low: 0.50,
    medium: 1.00,
    high: 1.50,
    veryHigh: 2.00
};

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

const SPAWN_WEIGHTS = {
    ride_activity_enthusiast: 0.25,
    season_pass_holder: 0.15,
    once_in_a_lifetime: 0.20,
    friend_group: 0.20,
    newly_married: 0.10,
    vip_entitled: 0.05,
    vlogger: 0.05
};

const CLOSING_SOON_TICK = 660;
const PARK_CLOSED_TICK = 720;
const SPAWN_CUTOFF_TICK = 600;
const VIP_EXIT_TICK = 750;
