// main.js
// Wires DOM elements (buttons, sliders) to engine.js functions
// Does NOT contain simulation logic - that lives in engine.js
// This file's only job: listen for user input, translate it into a function call
// Same role as server.R reactive functions in R Shiny - input changes drive state changes

import { play, pause, reset, setSpeed, setAgentCount } from './simulation/engine.js';

// PLAY / PAUSE / RESET BUTTONS
// Pure pass-through - a click carries no data, so we just call the matching function
const btnPlay = document.getElementById('btn-play');
const btnPause = document.getElementById('btn-pause');
const btnReset = document.getElementById('btn-reset');

btnPlay.addEventListener('click', () => {
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