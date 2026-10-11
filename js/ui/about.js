// about.js
// Page chrome for first-time visitors: the intro ("About") card and the guest-type legend.
// Does NOT contain simulation or scene logic - it only reads two lookup tables:
//   ARCHETYPES (agent.js) for each guest type's display name
//   ARCHETYPE_COLORS (scene.js) for the pawn color that type renders with
// Building the legend from those two tables (instead of hand-typing names and hex codes
// into index.html) keeps one source of truth: change a color in scene.js and the legend
// follows automatically.

import { ARCHETYPES } from '../simulation/agent.js';
import { ARCHETYPE_COLORS } from '../viz/scene.js';

// localStorage key that remembers "this browser has already seen the intro card"
// Wrapped in try/catch below because storage can be blocked (private windows, strict
// privacy settings) - if it fails, the card just shows every visit, which is harmless
const SEEN_KEY = 'aethermoor_intro_seen';

function hasSeenIntro() {
    try {
        return localStorage.getItem(SEEN_KEY) === '1';
    } catch (err) {
        return false;
    }
}

function markIntroSeen() {
    try {
        localStorage.setItem(SEEN_KEY, '1');
    } catch (err) {
        // Storage unavailable - nothing to do, the card will simply show again next visit
    }
}

// buildLegend: one row per archetype - a color swatch plus the archetype's display name
// Object.entries(ARCHETYPE_COLORS) gives [id, color] pairs in the same order scene.js
// creates the meshes, so the legend order matches the render order
function buildLegend(container) {
    Object.entries(ARCHETYPE_COLORS).forEach(([archetypeId, color]) => {
        const archetype = ARCHETYPES[archetypeId];
        if (!archetype) return;

        const row = document.createElement('li');
        row.className = 'legend-row';

        const swatch = document.createElement('span');
        swatch.className = 'legend-swatch';
        swatch.style.backgroundColor = color;   // data-driven, so it can't live in style.css

        const label = document.createElement('span');
        label.textContent = archetype.name;

        row.append(swatch, label);
        container.appendChild(row);
    });
}

// initAbout: wires the About button, the card's close button, Escape-to-close,
// and the "show automatically on a first visit" behavior
function initAbout() {
    const card = document.getElementById('about-card');
    const btnAbout = document.getElementById('btn-about');
    const btnClose = document.getElementById('about-close');
    const legendList = document.getElementById('legend-list');

    buildLegend(legendList);

    function openCard() {
        card.hidden = false;
        btnClose.focus();
    }

    function closeCard() {
        card.hidden = true;
        markIntroSeen();
        btnAbout.focus();
    }

    btnAbout.addEventListener('click', openCard);
    btnClose.addEventListener('click', closeCard);

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !card.hidden) closeCard();
    });

    if (!hasSeenIntro()) openCard();
}

export { initAbout };
