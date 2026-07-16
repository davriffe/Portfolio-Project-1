// scene.js
// Builds and renders the live Three.js visualization of the park: land zones,
// terrain, connections, and every agent as a moving instanced pawn.
// Reads simulationState every frame - does NOT mutate it. D3 overlays,
// click/hover interaction, and the results panel are separate layers.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { simulationState } from '../simulation/engine.js';

const DEBUG = false;

// LAND_POSITIONS: hand-placed layout, clock-face around The Crossroads.
// Each value doubles as the "home" point agents sit at when they aren't
// mid-transit or clustered near a queue.
const LAND_POSITIONS = {
    crossroads: new THREE.Vector3(0, 0.1, 0),
    observatory: new THREE.Vector3(0, 0.5, -8),
    lunara: new THREE.Vector3(0, 0, -18),
    enchanted_forest: new THREE.Vector3(14, 0, -14),
    hollow: new THREE.Vector3(18, -1, 0),
    ironhaven: new THREE.Vector3(-18, 0, -8),
    ember_wastes: new THREE.Vector3(-14, 0, 10)
};

// entry sits off the south edge of the canvas (+Z, nearest the camera) so the
// corridor visually reads as "bottom of screen" given the camera looks north
const ENTRY_POSITION = new THREE.Vector3(0, 0, 10);

const LAND_COLORS = {
    crossroads: { primary: '#4A4A4A' },
    observatory: { primary: '#C9B37A' },
    lunara: { primary: '#280137', secondary: '#1A3A6B', accent: '#B87333' },
    enchanted_forest: { primary: '#1B6B5A', secondary: '#E85D9B', accent: '#F5A623' },
    hollow: { primary: '#121916', secondary: '#39352B', accent: '#3D0B4D' },
    ironhaven: { primary: '#006B6B', secondary: '#B87333', accent: '#2D8A8A' },
    ember_wastes: { primary: '#7A2A1A', secondary: '#8B4513', accent: '#3D1A0A' }
};

const CONNECTIONS = [
    { from: 'crossroads', to: 'hollow' },
    { from: 'crossroads', to: 'enchanted_forest' },
    { from: 'crossroads', to: 'ironhaven' },
    { from: 'crossroads', to: 'ember_wastes' },
    { from: 'crossroads', to: 'observatory' },
    { from: 'observatory', to: 'lunara' },
    { from: 'enchanted_forest', to: 'hollow' }
];

const TUNNEL_CONNECTION = { from: 'lunara', to: 'ironhaven' };

const ARCHETYPE_COLORS = {
    ride_activity_enthusiast: '#E63946',
    season_pass_holder: '#457B9D',
    once_in_a_lifetime: '#F4A261',
    friend_group: '#2A9D8F',
    newly_married: '#E9C46A',
    vip_entitled: '#9B5DE5',
    vlogger: '#F15BB5'
};

// generous ceiling - the agent-count slider tops out at 200, this leaves headroom
const MAX_AGENTS_PER_ARCHETYPE = 220;

const AGENT_HEIGHT = 0.8;
const AGENT_REST_Y = AGENT_HEIGHT / 2;

const VIEW_SIZE = 24;
const CAMERA_TARGET = new THREE.Vector3(0, 0, -4);

let scene, camera, renderer, controls, container, canvas;
let archetypeMeshes = {};
let dummy;
let lastStatus = null;
let initialized = false;

function initScene() {
    if (initialized) return;
    initialized = true;

    container = document.getElementById('viz-container');
    canvas = document.getElementById('threejs-canvas');

    scene = new THREE.Scene();
    scene.background = new THREE.Color('#1A1A1A');
    scene.fog = new THREE.Fog('#1A1A1A', 40, 140);

    camera = new THREE.OrthographicCamera(-VIEW_SIZE, VIEW_SIZE, VIEW_SIZE, -VIEW_SIZE, 0.1, 200);
    // ~22 degrees off vertical, tilted in from the south (+Z) toward CAMERA_TARGET
    camera.position.set(CAMERA_TARGET.x, CAMERA_TARGET.y + 40, CAMERA_TARGET.z + 16);
    camera.lookAt(CAMERA_TARGET);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(CAMERA_TARGET);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    buildLights();
    buildLands();
    buildTerrain();
    buildConnections();
    buildAgentMeshes();

    if (DEBUG) {
        scene.add(new THREE.AxesHelper(20));
        scene.add(new THREE.GridHelper(60, 30));
    }

    window.addEventListener('resize', handleResize);
    handleResize();

    requestAnimationFrame(animate);
}

function buildLights() {
    const ambient = new THREE.AmbientLight('#5C6B7A', 0.3);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight('#FFFFFF', 0.8);
    sun.position.set(-20, 30, 15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -45;
    sun.shadow.camera.right = 45;
    sun.shadow.camera.top = 45;
    sun.shadow.camera.bottom = -45;
    sun.shadow.camera.far = 100;
    scene.add(sun);

    // Observatory glow - marks the castle as the visual anchor
    const observatoryGlow = new THREE.PointLight('#FFD9A0', 1.2, 15);
    observatoryGlow.position.set(0, 6, -8);
    scene.add(observatoryGlow);

    // Warmer contribution over Ember Wastes to suggest desert heat
    const emberWarmth = new THREE.PointLight('#FF7A3D', 0.5, 20);
    emberWarmth.position.copy(LAND_POSITIONS.ember_wastes).add(new THREE.Vector3(0, 5, 0));
    scene.add(emberWarmth);
}

function buildLands() {
    const crossroads = new THREE.Mesh(
        new THREE.CircleGeometry(2.5, 24),
        new THREE.MeshStandardMaterial({ color: LAND_COLORS.crossroads.primary, flatShading: true })
    );
    crossroads.rotation.x = -Math.PI / 2;
    crossroads.position.copy(LAND_POSITIONS.crossroads);
    crossroads.receiveShadow = true;
    scene.add(crossroads);

    buildObservatory();

    const lunara = new THREE.Mesh(
        new THREE.PlaneGeometry(16, 12),
        new THREE.MeshStandardMaterial({ color: LAND_COLORS.lunara.primary, flatShading: true })
    );
    lunara.rotation.x = -Math.PI / 2;
    lunara.position.copy(LAND_POSITIONS.lunara);
    lunara.receiveShadow = true;
    scene.add(lunara);

    const forest = new THREE.Mesh(
        new THREE.ShapeGeometry(buildOrganicShape(6.5)),
        new THREE.MeshStandardMaterial({ color: LAND_COLORS.enchanted_forest.primary, flatShading: true })
    );
    forest.rotation.x = -Math.PI / 2;
    forest.position.copy(LAND_POSITIONS.enchanted_forest);
    forest.receiveShadow = true;
    scene.add(forest);

    const hollow = new THREE.Mesh(
        new THREE.PlaneGeometry(11, 11),
        new THREE.MeshStandardMaterial({ color: LAND_COLORS.hollow.primary, flatShading: true })
    );
    hollow.rotation.x = -Math.PI / 2;
    hollow.position.copy(LAND_POSITIONS.hollow);
    hollow.receiveShadow = true;
    scene.add(hollow);

    const hollowHaze = new THREE.Mesh(
        new THREE.PlaneGeometry(15, 15),
        new THREE.MeshBasicMaterial({ color: '#0A0A0A', transparent: true, opacity: 0.18, depthWrite: false })
    );
    hollowHaze.rotation.x = -Math.PI / 2;
    hollowHaze.position.set(LAND_POSITIONS.hollow.x, LAND_POSITIONS.hollow.y + 1.5, LAND_POSITIONS.hollow.z);
    scene.add(hollowHaze);

    const ironhaven = new THREE.Mesh(
        new THREE.PlaneGeometry(11, 11),
        new THREE.MeshStandardMaterial({ color: LAND_COLORS.ironhaven.primary, flatShading: true })
    );
    ironhaven.rotation.x = -Math.PI / 2;
    ironhaven.position.copy(LAND_POSITIONS.ironhaven);
    ironhaven.receiveShadow = true;
    scene.add(ironhaven);

    const emberWastes = new THREE.Mesh(
        new THREE.PlaneGeometry(11, 11),
        new THREE.MeshStandardMaterial({ color: LAND_COLORS.ember_wastes.primary, flatShading: true })
    );
    emberWastes.rotation.x = -Math.PI / 2;
    emberWastes.position.copy(LAND_POSITIONS.ember_wastes);
    emberWastes.receiveShadow = true;
    scene.add(emberWastes);
}

// buildOrganicShape: deterministic wobble (sin/cos of angle, no randomness) so
// Enchanted Forest's outline is irregular but identical on every reload
function buildOrganicShape(baseRadius, points = 16, variance = 0.3) {
    const shape = new THREE.Shape();
    for (let i = 0; i <= points; i++) {
        const angle = (i / points) * Math.PI * 2;
        const wobble = 1 + Math.sin(angle * 3.1) * variance * 0.5 + Math.cos(angle * 1.7) * variance * 0.3;
        const r = baseRadius * wobble;
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
    }
    return shape;
}

function buildObservatory() {
    const platform = new THREE.Mesh(
        new THREE.CircleGeometry(3, 24),
        new THREE.MeshStandardMaterial({ color: LAND_COLORS.observatory.primary, flatShading: true })
    );
    platform.scale.set(1, 1, 0.65);
    platform.rotation.x = -Math.PI / 2;
    platform.position.copy(LAND_POSITIONS.observatory);
    platform.receiveShadow = true;
    scene.add(platform);

    const towerMaterial = new THREE.MeshStandardMaterial({ color: '#D8C9A3', flatShading: true });

    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.4, 4, 8), towerMaterial);
    tower.position.set(LAND_POSITIONS.observatory.x, LAND_POSITIONS.observatory.y + 2, LAND_POSITIONS.observatory.z);
    tower.castShadow = true;
    scene.add(tower);

    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2, 8), towerMaterial);
    roof.position.set(LAND_POSITIONS.observatory.x, LAND_POSITIONS.observatory.y + 5, LAND_POSITIONS.observatory.z);
    roof.castShadow = true;
    scene.add(roof);
}

// buildTerrain: mountain row blocking the Ironhaven -> Observatory sightline
function buildTerrain() {
    const from = new THREE.Vector3(-10, 0, -10);
    const to = new THREE.Vector3(-4, 0, -16);
    const heights = [4, 5.5, 3.5, 6, 4.5, 3];
    const material = new THREE.MeshStandardMaterial({ color: '#3A3A3A', flatShading: true });

    heights.forEach((height, i) => {
        const t = i / (heights.length - 1);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(2, height, 6), material);
        cone.position.lerpVectors(from, to, t);
        cone.position.y = height / 2;
        cone.castShadow = true;
        cone.receiveShadow = true;
        scene.add(cone);
    });
}

function buildConnections() {
    const pathMaterial = new THREE.LineBasicMaterial({ color: '#555555' });

    CONNECTIONS.forEach(({ from, to }) => {
        const points = [LAND_POSITIONS[from], LAND_POSITIONS[to]].map(p => new THREE.Vector3(p.x, p.y + 0.05, p.z));
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        scene.add(new THREE.Line(geometry, pathMaterial));
    });

    // Entry/exit corridor - a path plane running south off the bottom edge
    const corridorLength = ENTRY_POSITION.distanceTo(LAND_POSITIONS.crossroads);
    const corridor = new THREE.Mesh(
        new THREE.PlaneGeometry(2, corridorLength),
        new THREE.MeshStandardMaterial({ color: '#4A4A4A', flatShading: true })
    );
    corridor.rotation.x = -Math.PI / 2;
    corridor.position.set(0, 0.05, (LAND_POSITIONS.crossroads.z + ENTRY_POSITION.z) / 2);
    scene.add(corridor);

    // Tunnel (Lunara <-> Ironhaven) - dashed and distinctly colored per park_config.json's isTunnel flag
    const tunnelPoints = [LAND_POSITIONS[TUNNEL_CONNECTION.from], LAND_POSITIONS[TUNNEL_CONNECTION.to]]
        .map(p => new THREE.Vector3(p.x, p.y + 0.1, p.z));
    const tunnelGeometry = new THREE.BufferGeometry().setFromPoints(tunnelPoints);
    const tunnelMaterial = new THREE.LineDashedMaterial({ color: '#2D8A8A', dashSize: 1, gapSize: 0.5, linewidth: 2 });
    const tunnelLine = new THREE.Line(tunnelGeometry, tunnelMaterial);
    tunnelLine.computeLineDistances();
    scene.add(tunnelLine);
}

// buildAgentMeshes: one InstancedMesh per archetype - every agent of an
// archetype shares one color, so per-instance color data would be wasted work
function buildAgentMeshes() {
    const geometry = new THREE.CylinderGeometry(0.15, 0.3, AGENT_HEIGHT, 8);
    dummy = new THREE.Object3D();

    Object.entries(ARCHETYPE_COLORS).forEach(([archetypeId, color]) => {
        const material = new THREE.MeshStandardMaterial({ color });
        const mesh = new THREE.InstancedMesh(geometry, material, MAX_AGENTS_PER_ARCHETYPE);
        mesh.count = 0;
        mesh.castShadow = true;
        scene.add(mesh);
        archetypeMeshes[archetypeId] = mesh;
    });
}

function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = (h << 5) - h + str.charCodeAt(i);
        h |= 0;
    }
    return h;
}

// getAttractionClusterOffset: deterministic spot within a land where a given
// attraction's queue gathers, so different attractions in the same land don't overlap
function getAttractionClusterOffset(attractionId) {
    const h = hashString(attractionId);
    const angle = (h % 360) * (Math.PI / 180);
    const radius = 2 + (Math.abs(h) % 100) / 50;
    return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

function getQueueOffset(agent, attractionId) {
    const cluster = getAttractionClusterOffset(attractionId);
    const queue = simulationState.queues[attractionId];
    const queueIndex = queue ? queue.indexOf(agent) : -1;
    const spread = queueIndex >= 0 ? queueIndex : 0;
    const spiralAngle = spread * 0.6;
    const spiralRadius = 0.3 + spread * 0.15;
    return {
        x: cluster.x + Math.cos(spiralAngle) * spiralRadius,
        z: cluster.z + Math.sin(spiralAngle) * spiralRadius
    };
}

function getIdleOffset(agent) {
    const h = hashString(agent.id);
    const angle = (h % 360) * (Math.PI / 180);
    return { x: Math.cos(angle) * 1.5, z: Math.sin(angle) * 1.5 };
}

function computeAgentPosition(agent) {
    const { currentLand, transit, targetAttraction } = agent.dynamic;

    if (transit) {
        const from = LAND_POSITIONS[transit.fromLand];
        const to = LAND_POSITIONS[transit.toLand];
        const span = transit.arriveTick - transit.departTick;
        const t = span > 0 ? (simulationState.currentTick - transit.departTick) / span : 1;
        const clampedT = Math.min(1, Math.max(0, t));
        return new THREE.Vector3().lerpVectors(from, to, clampedT).setY(
            THREE.MathUtils.lerp(from.y, to.y, clampedT) + AGENT_REST_Y
        );
    }

    const base = LAND_POSITIONS[currentLand] || LAND_POSITIONS.crossroads;
    const offset = targetAttraction ? getQueueOffset(agent, targetAttraction) : getIdleOffset(agent);
    return new THREE.Vector3(base.x + offset.x, base.y + AGENT_REST_Y, base.z + offset.z);
}

function updateAgentInstances() {
    const counts = {};
    Object.keys(archetypeMeshes).forEach(id => { counts[id] = 0; });

    simulationState.agents.forEach(agent => {
        if (agent.dynamic.currentLand === 'exited') return;

        const mesh = archetypeMeshes[agent.archetypeId];
        if (!mesh) return;

        const index = counts[agent.archetypeId]++;
        if (index >= MAX_AGENTS_PER_ARCHETYPE) return;

        dummy.position.copy(computeAgentPosition(agent));
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
    });

    Object.entries(archetypeMeshes).forEach(([id, mesh]) => {
        mesh.count = counts[id];
        mesh.instanceMatrix.needsUpdate = true;
    });
}

function clearAgentInstances() {
    Object.values(archetypeMeshes).forEach(mesh => { mesh.count = 0; });
}

function handleResize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    const aspect = width / height;

    camera.left = -VIEW_SIZE * aspect;
    camera.right = VIEW_SIZE * aspect;
    camera.top = VIEW_SIZE;
    camera.bottom = -VIEW_SIZE;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height);
}

function animate() {
    requestAnimationFrame(animate);
    updateScene();
}

function updateScene() {
    controls.update();

    const isActive = simulationState.status === 'playing' || simulationState.status === 'paused';
    if (isActive) {
        updateAgentInstances();
    } else if (lastStatus === 'playing' || lastStatus === 'paused') {
        // one-time cleanup on the transition out of playing/paused (e.g. reset)
        // so instances don't freeze in their last position
        clearAgentInstances();
    }
    lastStatus = simulationState.status;

    renderer.render(scene, camera);
}

export { initScene, updateScene };
