# Aethermoor — Theme Park Guest-Flow Simulator

**Project 1 of my Data Visualization Portfolio Series** · Status: **beta, in active development**

Aethermoor is a fictional theme park, and this project simulates a full operating day inside it. Hundreds of guests arrive, pick what to do based on who they are, wait in lines (or walk away from them), get tired, recover, and eventually head home. The whole day plays out on a 3D map of the park.

## Why this exists

Theme parks are a good stand-in for a hard visualization problem: a complex system where thousands of individual decisions add up to patterns nobody planned. Queues spill over, one land gets crowded while another sits empty, and different kinds of guests have very different days in the same park.

The goal is to make that system **legible at a glance**: to pair spatial context (where things are happening) with analytical views (what is happening and why), so someone can watch the park and actually understand it.

## What works today

- **Simulation engine** (`js/simulation/engine.js`): a tick-based model where 1 tick = 1 simulated minute and a full day runs 9:00 AM to 9:00 PM. It handles guest spawning, decision-making, queues with capacity-per-hour throughput, balking (leaving a line that's too long), energy drain and recovery, transit between lands, and closing-time exit behavior.
- **Seven guest archetypes** (`js/simulation/agent.js`): Ride/Activity Enthusiast, Season Pass Holder, Once-in-a-Lifetime Family, Friend Group, Newly Married Couple, VIP Guest, and Vlogger. Each has its own preference weights, energy profile, patience, re-ride tendency, and arrival window.
- **Park model** (`data/park_config.json`): 7 themed lands around a central hub, 39 venues (14 attractions, 8 activities, 8 dining spots, and 9 shops), and the walking connections between lands, including a hidden tunnel guests can discover.
- **3D park view** (`js/viz/scene.js`): Three.js rendering of the lands, terrain, and paths, with every guest drawn as a moving pawn that walks between lands and clusters at queues.
- **Controls**: play, pause, reset, speed (1x–8x), guest count (10–1,000), and a live park clock.
- **End-of-day results**: satisfaction by archetype, saved run history (stored in your browser), and CSV/JSON export of the full run.

## In progress

- **D3.js analytical overlays**, layered on top of the 3D view:
  - Queue depth over time by attraction
  - Guest-flow network between lands
  - Satisfaction heatmap by land
- Real-scale layout data for the remaining lands (Ironhaven Cove is done, the rest are next)
- Click and hover inspection of individual guests and attractions

## Grounding and research

The guest behavior model draws on research into how real parks operate (Disney operations logic, queue and throughput behavior, guest-type archetypes) and on published work on visitor traffic at Disneyland, including Hyun et al. (2015, CAADRIA). Park layouts start as hand drawings that are then translated into the simulation's coordinate data.

## Running it locally

There's no build step. It's plain HTML, CSS, and JavaScript, with Three.js loaded from a CDN. Because the park data is loaded with `fetch`, it has to be served instead of opened as a file:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

## Project structure

```
index.html                 Layout: control panel, 3D canvas, overlay panels
css/style.css
data/park_config.json      Lands, connections, venues, capacities
js/main.js                 Wires UI controls to the engine (no sim logic)
js/simulation/engine.js    Tick loop, decisions, queues, energy, satisfaction
js/simulation/agent.js     Guest archetype definitions
js/simulation/park.js      Loads and indexes park data
js/viz/scene.js            Three.js park rendering (reads state, never mutates it)
js/viz/heatmap.js          D3 satisfaction heatmap (in progress)
js/viz/network.js          D3 guest-flow network (in progress)
```

The architecture keeps a strict separation: the engine owns `simulationState`, and every visualization layer only reads from it.
