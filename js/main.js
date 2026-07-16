// main.js
// Wires DOM elements (buttons, sliders) to engine.js functions
// Does NOT contain simulation logic - that lives in engine.js
// This file's main job: listen for user input, translate it into a function call
// Same role as server.R reactive functions in R Shiny - input changes drive state changes
// One exception: the sim clock readout below runs the other direction (state -> DOM),
// since it's just formatting simulationState.currentTick for display, not new logic

import { play, pause, reset, setSpeed, setAgentCount, simulationState } from './simulation/engine.js';
import { initScene } from './viz/scene.js';

// PLAY / PAUSE / RESET BUTTONS
// Pure pass-through - a click carries no data, so we just call the matching function
const btnPlay = document.getElementById('btn-play');
const btnPause = document.getElementById('btn-pause');
const btnReset = document.getElementById('btn-reset');

// The Three.js scene (and its own render loop) only needs to spin up once -
// scene.js guards against re-init too, but this keeps the intent explicit here
let sceneInitialized = false;

btnPlay.addEventListener('click', () => {
    if (!sceneInitialized) {
        initScene();
        sceneInitialized = true;
    }
    play();
});

btnPause.addEventListener('click', () => {
    pause();
});

btnReset.addEventListener('click', () => {
    reset();
});

// SPEED SLIDER
// engine.js setSpeed() only recognizes multipliers 1, 2, 4, 8 (see the speeds lookup
// object inside it) - any other number silently falls through to its 1000ms default
// The slider only moves through positions 1-4 (see index.html), so speedMap translates
// "slider position" into "real multiplier" before handing it to the engine
// This translation belongs here, not in engine.js - the engine shouldn't need to know
// anything about slider positions, only about real multiplier values
const sliderSpeed = document.getElementById('slider-speed');
const speedDisplay = document.getElementById('speed-display');
const speedMap = [1, 2, 4, 8];

sliderSpeed.addEventListener('input', (event) => {
    // .value from a range input always comes back as a string ("2", not 2) -
    // Number() converts it before it's used as an array index or passed to setSpeed()
    const position = Number(event.target.value);
    const multiplier = speedMap[position - 1];

    // Template literal: backticks let a variable drop straight into a string via ${},
    // no manual string-joining with + needed
    speedDisplay.textContent = `${multiplier}x`;
    setSpeed(multiplier);
});

// AGENT COUNT SLIDER
// No translation needed here - setAgentCount() already clamps any raw number internally
// (see the Math.min/Math.max inside it), so the slider's value passes straight through
const sliderAgents = document.getElementById('slider-agents');
const agentDisplay = document.getElementById('agent-display');

sliderAgents.addEventListener('input', (event) => {
    const count = Number(event.target.value);
    agentDisplay.textContent = count;
    setAgentCount(count);
});

// SIM CLOCK (added 2026-07-15)
// currentTick is minutes elapsed since the park opened - 1 tick = 1 minute
// (see engine.js's PARK_CLOSED_TICK comment), and the park always opens at
// 9:00 AM per data/park_config.json's openTime. PARK_OPEN_HOUR is hardcoded
// here rather than read from park_config.json because engine.js's own tick
// milestones (SPAWN_CUTOFF_TICK, PARK_CLOSED_TICK, etc.) are already hardcoded
// against a 9 AM open - if that ever becomes configurable, it needs to change
// in both places together.
const PARK_OPEN_HOUR = 9;
const clockDisplay = document.getElementById('clock-display');

function formatSimClock(currentTick) {
    const totalMinutes = PARK_OPEN_HOUR * 60 + currentTick;
    const hour24 = Math.floor(totalMinutes / 60) % 24;
    const minute = totalMinutes % 60;
    const period = hour24 >= 12 ? 'PM' : 'AM';
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

// Runs every animation frame regardless of play/pause/idle state so the clock
// never looks frozen out of sync with currentTick - cost is negligible since
// it only touches the DOM when the displayed minute actually changes
let lastRenderedTick = -1;

function updateSimClock() {
    if (simulationState.currentTick !== lastRenderedTick) {
        lastRenderedTick = simulationState.currentTick;
        clockDisplay.textContent = formatSimClock(simulationState.currentTick);
    }
    requestAnimationFrame(updateSimClock);
}

updateSimClock();