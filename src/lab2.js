import * as THREE from "three";
import { getInventory, saveInventory, resetGame } from "./inventory.js";
import { dataURL, loadOBJ, loadTexture, fitToFloor } from "./assets.js";
import * as controls from "./controls.js";
import { createMenu } from "./menu.js";
import { createManual } from "./manual.js";
import { mountTodoList } from "./todo.js";
import { exportScene } from "./engine/core/export.js";

const canvas = document.getElementById("game");
let renderer;
try {
    renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        powerPreference: "default",
        failIfMajorPerformanceCaveat: false,
    });
} catch (err) {
    console.error("WebGL renderer failed:", err);
    const el = document.getElementById("loader");
    if (el) {
        el.classList.add("visible");
        el.classList.remove("fade-out");
        el.innerHTML =
            '<h1>WebGL unavailable</h1><p>Close other tabs and refresh.</p>';
    }
    throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
// (ceiling clip removed — at the smaller 32 m room size the auto-clip
// dropped below head height and chopped the world off when looking up
// in first-person. The model's actual roof handles framing now.)
const ceilPlane = null;

const scene = new THREE.Scene();
// Expose for dev tools and the scene exporter.
window.scene = scene;
scene.background = new THREE.Color(0x2a323c);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);

// brighter lighting so the lab is actually visible
scene.add(new THREE.HemisphereLight(0xeaf4fb, 0x3a4252, 1.6));
const sun = new THREE.DirectionalLight(0xffe6c0, 1.6);
sun.position.set(40, 60, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -50;
sun.shadow.camera.right = 50;
sun.shadow.camera.top = 50;
sun.shadow.camera.bottom = -50;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 160;
scene.add(sun);
// accent coloured emissives for atmosphere — subtle screen-glow vibe
for (const [px, pz, color] of [
    [-12, -12, 0x7ed957],
    [12, -12, 0xc8302e],
    [-12, 12, 0x88c0d0],
    [12, 12, 0xeec96a],
]) {
    const accent = new THREE.PointLight(color, 0.7, 18, 2);
    accent.position.set(px, 3.5, pz);
    scene.add(accent);
}

// player rig (shared across all pages via controls.js)
const playerRig = controls.createPlayer();
const player = playerRig.group;
const { body, head, nose, hand: handBacteria } = playerRig;
controls.setPlayer(player);
scene.add(player);

// inventory readout (read-only here)
let sampleCount = 0;
let cultureCount = 0;
mountTodoList(
    document.getElementById("todo-list"),
    () => ({ samples: sampleCount, cultures: cultureCount }),
);
let selectedSlot = 0;
const samplesEl = document.getElementById("samples");
const hotbarSlots = document.querySelectorAll("#hotbar .slot");

const BACTERIA_SVG_MINI = `<svg viewBox="0 0 32 32" width="32" height="32" style="display:block">
  <ellipse cx="16" cy="16" rx="11" ry="7" fill="#7ed957" stroke="#0d0d0d" stroke-width="2"/>
  <circle cx="11" cy="14" r="1.6" fill="#0d0d0d"/>
  <circle cx="18" cy="17" r="1.3" fill="#0d0d0d"/>
  <circle cx="20" cy="13" r="1.0" fill="#0d0d0d"/>
  <line x1="6" y1="14" x2="2" y2="11" stroke="#0d0d0d" stroke-width="2" stroke-linecap="round"/>
  <line x1="6" y1="18" x2="3" y2="22" stroke="#0d0d0d" stroke-width="2" stroke-linecap="round"/>
  <line x1="26" y1="13" x2="30" y2="9" stroke="#0d0d0d" stroke-width="2" stroke-linecap="round"/>
  <line x1="26" y1="18" x2="29" y2="22" stroke="#0d0d0d" stroke-width="2" stroke-linecap="round"/>
</svg>`;

const CULTURE_SVG_MINI = `<svg viewBox="0 0 32 32" width="32" height="32" style="display:block">
  <circle cx="16" cy="16" r="13" fill="#dde6ee" stroke="#1a2230" stroke-width="2"/>
  <ellipse cx="16" cy="16" rx="6.5" ry="4.5" fill="#7ed957" stroke="#0d0d0d" stroke-width="1.4"/>
  <circle cx="13" cy="15" r="0.9" fill="#0d0d0d"/>
  <circle cx="18" cy="17" r="0.8" fill="#0d0d0d"/>
</svg>`;

function updateHotbar() {
    samplesEl.textContent = `Samples: ${sampleCount} · Cultured: ${cultureCount}`;
    hotbarSlots.forEach((slot, i) => {
        const isCulture = i < cultureCount;
        const isSample = !isCulture && i < cultureCount + sampleCount;
        const filled = isCulture || isSample;
        slot.classList.toggle("filled", filled);
        slot.classList.toggle("culture", isCulture);
        slot.classList.toggle("selected", i === selectedSlot);
        slot.querySelectorAll("svg").forEach((s) => s.remove());
        if (isCulture) slot.insertAdjacentHTML("beforeend", CULTURE_SVG_MINI);
        else if (isSample) slot.insertAdjacentHTML("beforeend", BACTERIA_SVG_MINI);
    });
    handBacteria.visible = selectedSlot < Math.min(10, cultureCount + sampleCount);
}

getInventory().then((inv) => {
    sampleCount = inv.samples;
    cultureCount = inv.cultures || 0;
    updateHotbar();
});

async function triggerNewGame() {
    if (!confirm("Start a new game? Everything will be reset.")) return;
    await resetGame();
    sessionStorage.setItem("newGameLoading", "1");
    window.location.href = "outdoor.html";
}
document.getElementById("new-game").addEventListener("click", (e) => {
    e.preventDefault();
    triggerNewGame();
});

// floating prompt
const promptEl = document.getElementById("prompt");
const promptInner = document.createElement("span");
promptEl.appendChild(promptInner);
function setPrompt(text) {
    if (text) {
        if (promptInner.textContent !== text) promptInner.textContent = text;
        promptEl.classList.add("visible");
    } else {
        promptEl.classList.remove("visible");
    }
}

// --- Virtueel laboratorium loaded as the entire scene -----------------
// palette cycled per-OBJ so the room reads as a real lab (cabinets, glass,
// counters, accent panels) instead of a uniform grey blob.
const labMatPalette = [
    new THREE.MeshStandardMaterial({ color: 0xb6c1cd, roughness: 0.7 }),                 // light wall
    new THREE.MeshStandardMaterial({ color: 0x434b56, roughness: 0.4, metalness: 0.3 }), // dark counter
    new THREE.MeshStandardMaterial({ color: 0x6d7c8c, roughness: 0.6 }),                 // mid grey
    new THREE.MeshStandardMaterial({ color: 0x88c0d0, roughness: 0.3, metalness: 0.2,
        emissive: 0x223340, emissiveIntensity: 0.25 }),                                  // glass / screen
    new THREE.MeshStandardMaterial({ color: 0x2a323a, roughness: 0.5 }),                 // dark frame
    new THREE.MeshStandardMaterial({ color: 0xeec96a, roughness: 0.45, metalness: 0.25 }), // yellow accent
    new THREE.MeshStandardMaterial({ color: 0xc8302e, roughness: 0.5 }),                 // red accent
    new THREE.MeshStandardMaterial({ color: 0x7ed957, roughness: 0.5,
        emissive: 0x2c5c1d, emissiveIntensity: 0.2 }),                                   // green emissive
];

// console / control-panel materials with the actual atlas textures
const consoleMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.55,
    metalness: 0.1,
    emissive: 0x222222,
    emissiveIntensity: 0.4,
});
const screenMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.25,
    metalness: 0.05,
    emissive: 0xffffff,
    emissiveIntensity: 0.45,
});
loadTexture(dataURL(
    "Virtueel laboratorium _ Virtual Laboratory",
    "textures/Signals_Color.png",
)).then((tex) => {
    if (!tex) return;
    consoleMat.map = tex;
    consoleMat.emissiveMap = tex;
    consoleMat.needsUpdate = true;
});
loadTexture(dataURL(
    "Virtueel laboratorium _ Virtual Laboratory",
    "textures/ScreenSurface_Color.png",
)).then((tex) => {
    if (!tex) return;
    screenMat.map = tex;
    screenMat.emissiveMap = tex;
    screenMat.needsUpdate = true;
});

const labModelsGroup = new THREE.Group();
scene.add(labModelsGroup);
let bounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10, sizeY: 4 };
let labReady = false;
controls.pause("loading");

const loaderEl = document.getElementById("loader");
function hideLoader() {
    if (!loaderEl) return;
    loaderEl.classList.add("fade-out");
    setTimeout(() => loaderEl.remove(), 800);
}

setPrompt("Loading the container lab…");

(async function loadAll() {
    const promises = [];
    const total = 35;
    for (let i = 0; i < total; i++) {
        // pick a material for this OBJ index. Every 7th becomes a console
        // (Signals_Color atlas) and every 11th a wall screen — the rest
        // cycle through the palette so cabinets/walls/glass/etc. vary.
        let mat;
        if (i > 0 && i % 11 === 0) mat = screenMat;
        else if (i > 0 && i % 7 === 0) mat = consoleMat;
        else mat = labMatPalette[i % labMatPalette.length];
        promises.push(
            loadOBJ(
                dataURL(
                    "Virtueel laboratorium _ Virtual Laboratory",
                    `models/model_${i}.obj`,
                ),
                (m) => {
                    m.material = mat;
                    m.castShadow = true;
                    m.receiveShadow = true;
                },
            ),
        );
    }
    const groups = await Promise.all(promises);
    for (const g of groups) if (g) labModelsGroup.add(g);

    const bbox = new THREE.Box3().setFromObject(labModelsGroup);
    if (!bbox.isEmpty()) {
        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        bbox.getCenter(center);
        bbox.getSize(size);
        // 48 m max dim — visually playable. We deliberately don't use
        // folderMeta.targetSize (~16 m, the real-world container-lab estimate)
        // because at TPS framing distances a metric-accurate room reads
        // cramped; gameplay scale wins over metric truth here.
        const targetMaxDim = 24;
        const maxDim = Math.max(size.x, size.y, size.z);
        const s = maxDim > 0 ? targetMaxDim / maxDim : 1;
        labModelsGroup.scale.setScalar(s);
        labModelsGroup.position.set(-center.x * s, -bbox.min.y * s, -center.z * s);
        size.multiplyScalar(s);
        const padding = 3;
        bounds = {
            minX: -size.x / 2 - padding,
            maxX: size.x / 2 + padding,
            minZ: -size.z / 2 - padding,
            maxZ: size.z / 2 + padding,
            sizeY: Math.max(3, size.y),
        };
        // (no clip plane — the model's own roof frames the scene)
    }
    // textured floor under the model
    const w = bounds.maxX - bounds.minX;
    const d = bounds.maxZ - bounds.minZ;
    const floorMat = new THREE.MeshStandardMaterial({
        color: 0x6e7783,
        roughness: 0.9,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    loadTexture(
        dataURL("Virtueel laboratorium _ Virtual Laboratory", "textures/Floor.png"),
    ).then((tex) => {
        if (!tex) return;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(Math.max(2, w / 6), Math.max(2, d / 6));
        floorMat.map = tex;
        floorMat.color.setHex(0xffffff);
        floorMat.needsUpdate = true;
    });

    // 3×3 ceiling fluorescent grid, scaled to the room
    const gridX = [-bounds.maxX * 0.6, 0, bounds.maxX * 0.6];
    const gridZ = [-bounds.maxZ * 0.6, 0, bounds.maxZ * 0.6];
    for (const px of gridX) {
        for (const pz of gridZ) {
            const fl = new THREE.PointLight(0xfff0d8, 1.6, 60, 1.4);
            fl.position.set(px, 9, pz);
            scene.add(fl);
            // tiny visible bulb so the user sees fixtures, not just light
            const bulb = new THREE.Mesh(
                new THREE.SphereGeometry(0.18, 10, 8),
                new THREE.MeshBasicMaterial({ color: 0xfff5dc }),
            );
            bulb.position.set(px, 9, pz);
            scene.add(bulb);
        }
    }

    labReady = true;
    controls.unpause("loading");
    setPrompt("Click anywhere to leave the container");
    hideLoader();
})();

// audio
let audioCtx = null;
function ensureAudio() {
    if (audioCtx) return audioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
    return audioCtx;
}
function playDoor() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t = ctx.currentTime;
    const dur = 0.5;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(380, t);
    lp.frequency.linearRampToValueAtTime(220, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.07);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(lp).connect(g).connect(ctx.destination);
    src.start();
    src.stop(t + dur);
}

// input + exit
controls.init(canvas);
controls.setPlayer(player);
const keys = controls.keys;
let exiting = false;
async function exitContainer() {
    if (exiting) return;
    exiting = true;
    controls.pause("nav");
    const ctx = ensureAudio();
    if (ctx && ctx.state === "suspended") ctx.resume();
    setPrompt("Heading out…");
    playDoor();
    await saveInventory({ samples: sampleCount, cultures: cultureCount });
    setTimeout(() => {
        window.location.href = "outdoor.html?from=ship";
    }, 500);
}

async function doExport(id, name) {
    setPrompt("Exporting scene…");
    const status = await exportScene(scene, { id, name });
    setPrompt(status);
    setTimeout(() => setPrompt(""), 3000);
}

const manual = createManual();
const menu = createMenu({
    title: "Container Lab",
    subtitle: "Shipping container · field analysis",
    primaryActions: [
        { label: "Return to Surface", primary: true, onClick: () => exitContainer() },
        { label: "Field Manual", onClick: () => manual.open() },
        { label: "Export Scene", onClick: () => doExport("lab2", "Container Lab") },
        { label: "New Game", danger: true, onClick: () => triggerNewGame() },
    ],
    sliders: [
        { label: "Move",     min: 1,   max: 12,  step: 0.1,  get: () => controls.params.moveSpeed,       set: (v) => { controls.params.moveSpeed = v; controls.persistPrefs(); } },
        { label: "Look",     min: 0.2, max: 3,   step: 0.05, get: () => controls.params.lookSensitivity, set: (v) => { controls.params.lookSensitivity = v; controls.persistPrefs(); } },
    ],
});

canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || controls.isPaused()) return;
    // While right is held (fp-temp), a left-click zooms in instead of
    // exiting the container — matches the outdoor and lab behaviour.
    if (controls.cameraState.mode === "fp-temp") {
        controls.tryLeftClickZoom();
        return;
    }
    exitContainer();
});
window.addEventListener("keydown", (e) => {
    if (e.code === "Escape") {
        e.preventDefault();
        menu.toggle();
        return;
    }
    if (menu.isOpen) return;
    if (controls.isPaused()) return;
    if (e.code === "KeyE") exitContainer();
    if (e.code === "Space") {
        if (controls.tryJump(jumpState)) e.preventDefault();
    }
    const m = e.code.match(/^(?:Digit|Numpad)(\d)$/);
    if (m) {
        const n = parseInt(m[1], 10);
        const slot = n === 0 ? 9 : n - 1;
        selectedSlot = slot;
        updateHotbar();
    }
});

function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// main loop
const PLAYER_RADIUS = 0.4;
const jumpState = { vy: 0, grounded: true };
let last = performance.now();
function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    controls.applyMovement(dt, player, { sprint: false });
    player.position.x = Math.max(
        bounds.minX + PLAYER_RADIUS,
        Math.min(bounds.maxX - PLAYER_RADIUS, player.position.x),
    );
    player.position.z = Math.max(
        bounds.minZ + PLAYER_RADIUS,
        Math.min(bounds.maxZ - PLAYER_RADIUS, player.position.z),
    );

    // jump + gravity
    controls.applyJump(dt, player, jumpState);

    controls.syncFP(playerRig, () => selectedSlot < cultureCount + sampleCount);

    // shared third-person / orbit / first-person camera. Bigger room → bigger
    // follow distance so we can take the whole space in.
    // Match the outdoor + lab1 follow rig so the feel of WASD + mouse-look
    // + V (first person) is identical no matter which scene you're in.
    controls.updateCamera(dt, player, camera, {
        followHeight: 5.5,
        followDist: 8,
        targetOffset: 1.2,
    });

    if (handBacteria.visible) {
        handBacteria.position.y = 1.05 + Math.sin(now / 1000 * 2.4) * 0.05;
        handBacteria.rotation.y += dt * 1.6;
    }

    controls.updatePromptPosition(player, camera, promptEl, renderer);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
