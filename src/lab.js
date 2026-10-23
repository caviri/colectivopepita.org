import * as THREE from "three";
import { getInventory, saveInventory, resetGame } from "./inventory.js";
import { dataURL, loadOBJ, loadOBJBatch, loadTexture, fitToFloor, centerScale } from "./assets.js";
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

const scene = new THREE.Scene();
// Expose for dev tools and the scene exporter (drag-out via puppeteer / console).
window.scene = scene;
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);

scene.add(new THREE.HemisphereLight(0xb8d0e6, 0x3a4a5a, 0.7));

// wall sconces — replaced the ceiling light
const sconceMat = new THREE.MeshStandardMaterial({
    color: 0xfff0d0,
    emissive: 0xffd58a,
    emissiveIntensity: 1.6,
    roughness: 0.5,
});
function spawnWallSconces() {
    const sconces = [
        // (x, y, z, normal-toward-room)
        { x: -3.85, y: 3.0, z: -3, n: [1, 0, 0] },
        { x: -3.85, y: 3.0, z: 3, n: [1, 0, 0] },
        { x: 3.85, y: 3.0, z: -6, n: [-1, 0, 0] },
        { x: 3.85, y: 3.0, z: 6, n: [-1, 0, 0] },
        { x: 0, y: 3.2, z: -8.85, n: [0, 0, 1] },
        { x: 0, y: 3.2, z: 8.85, n: [0, 0, -1] },
    ];
    for (const s of sconces) {
        const bulb = new THREE.Mesh(
            new THREE.SphereGeometry(0.13, 12, 8),
            sconceMat,
        );
        bulb.position.set(s.x + s.n[0] * 0.1, s.y, s.z + s.n[2] * 0.1);
        scene.add(bulb);
        // small bracket plate behind it
        const bracket = new THREE.Mesh(
            new THREE.BoxGeometry(0.18, 0.32, 0.05),
            new THREE.MeshStandardMaterial({ color: 0x2a323a, roughness: 0.5, metalness: 0.4 }),
        );
        bracket.position.set(s.x, s.y, s.z);
        bracket.lookAt(s.x + s.n[0], s.y, s.z + s.n[2]);
        scene.add(bracket);
        const light = new THREE.PointLight(0xfff0d0, 1.0, 12, 1.6);
        light.position.set(s.x + s.n[0] * 0.6, s.y, s.z + s.n[2] * 0.6);
        scene.add(light);
    }
}

// candles get spawned once the room bounds are known (after OBJ load).
// Each entry is the (x, z) of a surface in the room and the surface y.
// Wax sits on the surface; flame and point-light hover above the wick.
const candles = [];
const flameMat = new THREE.MeshBasicMaterial({ color: 0xffd58a });
const waxMat = new THREE.MeshStandardMaterial({ color: 0xe9d8b6, roughness: 0.7 });
const WAX_H = 0.35;
function spawnCandles() {
    const ctH = 0.92;        // U-bench counter top
    const fridgeTopY = 1.95; // fridge body height
    const cartTopY = 0.86;   // centre cart top (added below)
    const surfaces = [
        // U-bench corners (south arm)
        { x: -2.6, z: 8.4, surfaceY: ctH },
        { x:  2.6, z: 8.4, surfaceY: ctH },
        // U-bench mid (side arms)
        { x: -3.4, z: 5.5, surfaceY: ctH },
        { x:  3.4, z: 5.5, surfaceY: ctH },
        // fridge top
        { x: -3.55, z: -3, surfaceY: fridgeTopY },
        // centre cart top
        { x:  0.4, z: 3.0, surfaceY: cartTopY },
    ];
    for (const s of surfaces) {
        const baseY = s.surfaceY;
        const wax = new THREE.Mesh(
            new THREE.CylinderGeometry(0.07, 0.08, WAX_H, 10),
            waxMat,
        );
        wax.position.set(s.x, baseY + WAX_H / 2, s.z);
        wax.castShadow = false;
        scene.add(wax);
        const flameY = baseY + WAX_H + 0.06;
        const flame = new THREE.Mesh(
            new THREE.SphereGeometry(0.09, 10, 8),
            flameMat,
        );
        flame.position.set(s.x, flameY, s.z);
        scene.add(flame);
        const light = new THREE.PointLight(0xffaa55, 1.6, 7.5, 2);
        light.position.set(s.x, flameY, s.z);
        scene.add(light);
        candles.push({
            light,
            flame,
            base: 1.6,
            phase: Math.random() * Math.PI * 2,
            jitterPhase: Math.random() * Math.PI * 2,
        });
    }
}

// player rig (shared across all pages via controls.js)
const playerRig = controls.createPlayer();
const player = playerRig.group;
const { body, head, nose, hand: handBacteria } = playerRig;
controls.setPlayer(player);
scene.add(player);

// inventory: samples (raw) + cultures (petri-cultured)
let sampleCount = 0;
let cultureCount = 0;
let selectedSlot = 0;
const samplesEl = document.getElementById("samples");

// shared mission todo list — same items as the outdoor scene, populated
// from local sample/culture counters so it updates without a round-trip
// through IndexedDB.
mountTodoList(
    document.getElementById("todo-list"),
    () => ({ samples: sampleCount, cultures: cultureCount }),
);
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

function totalFilled() {
    return Math.min(10, cultureCount + sampleCount);
}

function updateHotbar() {
    samplesEl.textContent = `Samples: ${sampleCount} · Cultured: ${cultureCount}`;
    hotbarSlots.forEach((slot, i) => {
        // cultures occupy the first slots, samples the next
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
    handBacteria.visible = selectedSlot < totalFilled();
}

function selectSlot(i) {
    if (i < 0 || i > 9) return;
    selectedSlot = i;
    updateHotbar();
}

getInventory()
    .then((inv) => {
        sampleCount = inv.samples || 0;
        cultureCount = inv.cultures || 0;
        updateHotbar();
        // restore cultured dishes once the petri models exist
        const restore = () => {
            if (!Array.isArray(inv.culturedDishes)) return;
            for (const i of inv.culturedDishes) {
                const dish = petriDishes[i];
                if (dish && !dish.filled) fillDish(dish);
            }
        };
        if (petriDishes.length) restore();
        else setTimeout(restore, 100);
    })
    .catch((e) => console.error("inventory load failed:", e));

function culturedDishIndices() {
    const out = [];
    for (let i = 0; i < petriDishes.length; i++) {
        if (petriDishes[i].filled) out.push(i);
    }
    return out;
}

async function persistInventory() {
    await saveInventory({
        samples: sampleCount,
        cultures: cultureCount,
        culturedDishes: culturedDishIndices(),
    });
}

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

const loaderEl = document.getElementById("loader");
function hideLoader() {
    if (!loaderEl) return;
    loaderEl.classList.add("fade-out");
    setTimeout(() => loaderEl.remove(), 800);
}
setTimeout(hideLoader, 1500);

// audio: door creak
let audioCtx = null;
function ensureAudio() {
    if (audioCtx) return audioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
    return audioCtx;
}

// "Storm heard from inside" — same synthesis approach as the outdoor
// version in main.js, but the lowpass cutoff is dropped to ~280 Hz and
// the master gain to ~1/3, so it reads as muffled wind through the lab
// walls rather than full open-air storm.
let stormAmbient = null;
function startStormAmbient(ctx) {
    if (stormAmbient) return stormAmbient;
    const len = Math.floor(ctx.sampleRate * 4);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
        last = 0.97 * last + 0.03 * (Math.random() * 2 - 1);
        data[i] = last;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 200;     // emphasises the low rumble
    bp.Q.value = 0.6;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 280;     // walls eat the high frequencies
    const master = ctx.createGain();
    master.gain.value = 0;
    src.connect(bp).connect(lp).connect(master).connect(ctx.destination);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.10;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.025;
    lfo.connect(lfoGain);
    lfoGain.connect(master.gain);
    src.start();
    lfo.start();
    const t0 = ctx.currentTime;
    master.gain.setValueAtTime(0, t0);
    master.gain.linearRampToValueAtTime(0.06, t0 + 2.5);
    stormAmbient = { src, master, lfoGain };
    return stormAmbient;
}
function ensureStormAmbient() {
    const ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    startStormAmbient(ctx);
}
function playFootstep() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const dur = 0.08;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.value = 0.3;
    src.connect(lp).connect(g).connect(ctx.destination);
    src.start();
}

function playSampleChime() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t = ctx.currentTime;
    [[880, 0], [1320, 0.09]].forEach(([freq, delay]) => {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t + delay);
        g.gain.linearRampToValueAtTime(0.3, t + delay + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.55);
        o.connect(g).connect(ctx.destination);
        o.start(t + delay);
        o.stop(t + delay + 0.6);
    });
}

function playDoorSound() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t = ctx.currentTime;
    const dur = 0.55;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(420, t);
    lp.frequency.linearRampToValueAtTime(900, t + 0.3);
    lp.frequency.linearRampToValueAtTime(280, t + dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 110;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start(t);
    lfo.stop(t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.45, t + 0.07);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(lp).connect(g).connect(ctx.destination);
    src.start(t);
    src.stop(t + dur);
    const click = ctx.createOscillator();
    click.type = "square";
    click.frequency.setValueAtTime(220, t + dur);
    click.frequency.exponentialRampToValueAtTime(80, t + dur + 0.1);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.32, t + dur);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
    click.connect(cg).connect(ctx.destination);
    click.start(t + dur);
    click.stop(t + dur + 0.18);
}

// --- procedural lab layout ----------------------------------------
// Coordinate convention (top-down view from above):
//   +x = east (right), +z = south (toward bottom of screen)
//   Lab is a long rectangle: 8 wide × 18 long, 4 tall
//   Entry wall at z = -9: door on the right (+x side), window on the left (-x side)
//   Far  wall at z = +9: window centred
//   Inside, going south from the entry: ice closet (right) + fridge (left), then U-shaped bench
let bounds = { minX: -4, maxX: 4, minZ: -9, maxZ: 9, sizeY: 4 };
let labReady = false;
controls.pause("loading"); // released the moment buildLabInterior finishes
const labColliders = [];

// Bakes a single 8 m × 18 m texture for the lab floor — base noise,
// 1 m grid lines (subtle, lab-tile look), a handful of irregular stain
// blobs, and short scuff scratches. Non-tiling so stains don't repeat.
function makeFloorTexture() {
    // 32 px/m at 8 × 18 → 256 × 576. Aspect matches the floor PlaneGeometry.
    const W = 256, H = 576;
    const PX_PER_M = W / 8;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");

    // base noise
    const img = ctx.createImageData(W, H);
    for (let i = 0; i < img.data.length; i += 4) {
        const v = 180 + Math.floor(Math.random() * 50);
        img.data[i]     = v;
        img.data[i + 1] = v + 4;
        img.data[i + 2] = v + 8;
        img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);

    // grid: 1 m cells, mid-grey lines so they read as tile seams
    ctx.strokeStyle = "rgba(60, 72, 84, 0.42)";
    ctx.lineWidth = 1.5;
    for (let x = 0; x <= 8; x++) {
        ctx.beginPath();
        ctx.moveTo(x * PX_PER_M, 0);
        ctx.lineTo(x * PX_PER_M, H);
        ctx.stroke();
    }
    for (let y = 0; y <= 18; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * PX_PER_M);
        ctx.lineTo(W, y * PX_PER_M);
        ctx.stroke();
    }

    // stains: each one is a cluster of 5 jittered radial gradients so the
    // edges feel organic, not perfectly circular.
    const stains = [
        { x: 0.3,  y: 0.18, r: 0.55, alpha: 0.18 },  // near door
        { x: 0.72, y: 0.50, r: 0.45, alpha: 0.14 },  // mid-east
        { x: 0.48, y: 0.83, r: 0.40, alpha: 0.13 },  // south
        { x: 0.22, y: 0.62, r: 0.50, alpha: 0.16 },  // west mid
        { x: 0.65, y: 0.30, r: 0.35, alpha: 0.11 },  // entry-east
        { x: 0.55, y: 0.92, r: 0.30, alpha: 0.10 },  // far south
    ];
    for (const s of stains) {
        const cx = s.x * W;
        const cy = s.y * H;
        const r = s.r * PX_PER_M;
        for (let k = 0; k < 5; k++) {
            const ox = cx + (Math.random() - 0.5) * r * 0.7;
            const oy = cy + (Math.random() - 0.5) * r * 0.7;
            const radius = r * (0.5 + Math.random() * 0.5);
            const grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, radius);
            grad.addColorStop(0, `rgba(40, 30, 25, ${s.alpha})`);
            grad.addColorStop(0.7, `rgba(40, 30, 25, ${s.alpha * 0.35})`);
            grad.addColorStop(1, "rgba(40, 30, 25, 0)");
            ctx.fillStyle = grad;
            ctx.fillRect(ox - radius, oy - radius, radius * 2, radius * 2);
        }
    }

    // scuff scratches — short faint lines, drawn last so they sit over
    // both the grid and the stains
    ctx.strokeStyle = "rgba(50, 60, 72, 0.22)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 18; i++) {
        const x1 = Math.random() * W;
        const y1 = Math.random() * H;
        const len = 6 + Math.random() * 26;
        const a = Math.random() * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 + Math.cos(a) * len, y1 + Math.sin(a) * len);
        ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.anisotropy = 8;
    return tex;
}

let wallMatsBySide = null; // { north, south, west, east, interior }
const wallMeshes = [];
// labCameraYaw → controls.cameraState.yaw (initial 0, set in init below)

function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
}
function box(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    return m;
}

function addEdges(mesh, color = 0x202830) {
    const edges = new THREE.EdgesGeometry(mesh.geometry);
    const lines = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color }),
    );
    lines.position.copy(mesh.position);
    lines.rotation.copy(mesh.rotation);
    scene.add(lines);
    return lines;
}

// classify a wall position into one of {north, south, west, east, interior}
// so we can fade only the side(s) facing the camera.
function classifyWallSide(x, z) {
    if (z <= -8.5) return "north";
    if (z >= 8.5) return "south";
    if (x <= -3.5) return "west";
    if (x >= 3.5) return "east";
    return "interior";
}

// build a wall box, add its edge wireframe (always visible), pick a per-side
// material so opacity can be animated independently.
function wallBox(w, h, d, _ignoredMat, x, y, z) {
    const side = classifyWallSide(x, z);
    const mat = (wallMatsBySide && wallMatsBySide[side]) || _ignoredMat;
    const m = box(w, h, d, mat, x, y, z);
    addEdges(m);
    wallMeshes.push(m);
    return m;
}

function buildLabInterior() {
    const wallH = bounds.sizeY;
    const t = 0.25;

    // baked 8 × 18 m texture with grid + stains + scuffs (no tiling, since
    // the stains are placed deliberately and shouldn't repeat)
    const floorTex = makeFloorTexture();
    const floorMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: floorTex,
        roughness: 0.92,
    });
    // one material per perimeter side so we can fade the closest wall(s)
    // independently. Interior walls (ice closet) share an opaque mat.
    const baseProps = { color: 0xc4cdd7, roughness: 0.7 };
    wallMatsBySide = {
        north: new THREE.MeshStandardMaterial({ ...baseProps }),
        south: new THREE.MeshStandardMaterial({ ...baseProps }),
        west:  new THREE.MeshStandardMaterial({ ...baseProps }),
        east:  new THREE.MeshStandardMaterial({ ...baseProps }),
        interior: new THREE.MeshStandardMaterial({ ...baseProps }),
    };
    const wallMat = wallMatsBySide.interior; // legacy var still passed to wallBox calls below
    const glassMat = new THREE.MeshStandardMaterial({
        color: 0x88c0d0,
        roughness: 0.05,
        metalness: 0.1,
        emissive: 0x223340,
        emissiveIntensity: 0.2,
        transparent: true,
        opacity: 0.45,
    });
    const fridgeMat = new THREE.MeshStandardMaterial({ color: 0xeaeaea, roughness: 0.45, metalness: 0.15 });
    const fridgeTrim = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.4, metalness: 0.5 });
    const counterTopMat = new THREE.MeshStandardMaterial({ color: 0x434b56, roughness: 0.4, metalness: 0.25 });
    const cabinetMat = new THREE.MeshStandardMaterial({ color: 0xc9d1da, roughness: 0.7 });
    const iceMat = new THREE.MeshStandardMaterial({
        color: 0x8ec5dc,
        roughness: 0.3,
        metalness: 0.05,
        emissive: 0x14334a,
        emissiveIntensity: 0.25,
    });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x2a323a, roughness: 0.5 });

    // floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 18), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // ============= ENTRY WALL (z = -9) =============
    // door:    x in [+1.5 … +3.5], height 0 … 2.6
    // window:  x in [-3.5 … -1.5], height 1.4 … 2.8
    wallBox(0.5, wallH, t, wallMat, -3.75, wallH / 2, -9); // far-left corner
    wallBox(3, wallH, t, wallMat, 0, wallH / 2, -9);       // wall between window and door
    wallBox(0.5, wallH, t, wallMat, 3.75, wallH / 2, -9);  // right corner
    wallBox(2, 1.4, t, wallMat, -2.5, 0.7, -9);            // below window
    wallBox(2, wallH - 2.8, t, wallMat, -2.5, (wallH + 2.8) / 2, -9); // above window
    wallBox(2, wallH - 2.6, t, wallMat, 2.5, (wallH + 2.6) / 2, -9);  // above door
    box(2, 1.4, 0.04, glassMat, -2.5, 2.1, -9);        // window pane
    // door frame (open doorway): just trim above
    box(2, 0.06, 0.06, trimMat, 2.5, 2.62, -9);
    // a small "EXIT" indicator above the door: a yellow strip
    box(2, 0.1, 0.12, new THREE.MeshStandardMaterial({ color: 0xffe156, emissive: 0x665818, emissiveIntensity: 0.6 }), 2.5, 2.78, -9);

    // ============= FAR WALL (z = +9) — centred window =============
    wallBox(2, wallH, t, wallMat, -3, wallH / 2, 9);
    wallBox(2, wallH, t, wallMat, 3, wallH / 2, 9);
    wallBox(4, 1.4, t, wallMat, 0, 0.7, 9);
    wallBox(4, wallH - 2.8, t, wallMat, 0, (wallH + 2.8) / 2, 9);
    box(4, 1.4, 0.04, glassMat, 0, 2.1, 9);

    // ============= LEFT (west) and RIGHT (east) walls — solid =============
    wallBox(t, wallH, 18, wallMat, -4, wallH / 2, 0);
    wallBox(t, wallH, 18, wallMat, 4, wallH / 2, 0);

    // ============= ICE CLOSET (right side, near the entry) =============
    // outer extents: x in [+2.5 … +4], z in [-3 … 0]
    // shares east wall; build north + south + west walls; sliding door on west
    const iceH = 3;
    wallBox(1.5, iceH, t, wallMat, 3.25, iceH / 2, -3); // north wall
    wallBox(1.5, iceH, t, wallMat, 3.25, iceH / 2, 0);  // south wall
    // west wall split for an open doorway from z = -2.2 to z = -0.7 (1.5 wide)
    wallBox(t, iceH, 0.8, wallMat, 2.5, iceH / 2, -2.6); // upper segment
    wallBox(t, iceH, 0.7, wallMat, 2.5, iceH / 2, -0.35); // lower segment
    // sliding door panel parked open against the upper segment
    box(0.04, iceH * 0.94, 1.4, fridgeTrim, 2.46, iceH / 2, -2.6);
    // door track on floor + ceiling
    box(0.06, 0.04, 1.6, trimMat, 2.5, 0.02, -1.45);
    box(0.06, 0.04, 1.6, trimMat, 2.5, iceH - 0.02, -1.45);
    // ice block prop inside
    const iceBlock = new THREE.Mesh(new THREE.BoxGeometry(1, 0.8, 1), iceMat);
    iceBlock.position.set(3.3, 0.4, -1.5);
    iceBlock.castShadow = true;
    iceBlock.receiveShadow = true;
    scene.add(iceBlock);
    // ice closet ceiling light
    const closetLight = new THREE.PointLight(0xb8d8e6, 0.8, 5, 1.6);
    closetLight.position.set(3.25, iceH - 0.2, -1.5);
    scene.add(closetLight);

    // ============= FRIDGE (left wall, opposite the ice closet) =============
    // body
    box(0.7, 1.95, 0.85, fridgeMat, -3.55, 0.975, -3);
    // door split (top freezer)
    box(0.04, 0.04, 0.85, fridgeTrim, -3.19, 1.4, -3);
    // handles
    box(0.06, 0.5, 0.06, fridgeTrim, -3.16, 1.7, -2.7);
    box(0.06, 0.55, 0.06, fridgeTrim, -3.16, 0.85, -2.7);

    // ============= U-SHAPED BENCH (south part of the room) =============
    // U opens toward the entry (north). Bottom of U sits along the far wall.
    const ctH = 0.92;
    const ctTop = 0.05;
    const cabH = ctH - ctTop;
    // bottom arm of U (south, against far wall)
    box(6, cabH, 1, cabinetMat, 0, cabH / 2, 8.4);
    box(6, ctTop, 1, counterTopMat, 0, ctH - ctTop / 2, 8.4);
    labColliders.push({ minX: -3, maxX: 3, minZ: 7.9, maxZ: 8.9 });
    // left arm (west)
    box(1, cabH, 7, cabinetMat, -3.4, cabH / 2, 4.4);
    box(1, ctTop, 7, counterTopMat, -3.4, ctH - ctTop / 2, 4.4);
    labColliders.push({ minX: -3.9, maxX: -2.9, minZ: 0.9, maxZ: 7.9 });
    // right arm (east)
    box(1, cabH, 7, cabinetMat, 3.4, cabH / 2, 4.4);
    box(1, ctTop, 7, counterTopMat, 3.4, ctH - ctTop / 2, 4.4);
    labColliders.push({ minX: 2.9, maxX: 3.9, minZ: 0.9, maxZ: 7.9 });
    // fridge body
    labColliders.push({ minX: -3.9, maxX: -3.2, minZ: -3.43, maxZ: -2.58 });
    // ice closet outer walls (the open doorway gap is z ∈ [-2.2, -0.7])
    labColliders.push({ minX: 2.4, maxX: 4, minZ: -3.13, maxZ: -2.87 });
    labColliders.push({ minX: 2.4, maxX: 4, minZ: -0.13, maxZ: 0.13 });
    labColliders.push({ minX: 2.38, maxX: 2.62, minZ: -3, maxZ: -2.2 });
    labColliders.push({ minX: 2.38, maxX: 2.62, minZ: -0.7, maxZ: 0 });
    // a few props on the U: test tubes, monitor, microscope (boxes/cylinders)
    placeBenchProps();
    placePetriDishes();
}

// petri dishes — interactive, press E to culture a sample inside one
const petriDishes = [];
function placePetriDishes() {
    const ctH = 0.92;
    const dishMat = new THREE.MeshStandardMaterial({
        color: 0xe8eef2,
        roughness: 0.4,
        metalness: 0.05,
        transparent: true,
        opacity: 0.9,
    });
    const lidMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.05,
        metalness: 0.05,
        transparent: true,
        opacity: 0.3,
    });
    const positions = [
        { x: -1.0, z: 8.4 },
        { x: 0.5, z: 8.4 },
        { x: 2.0, z: 8.4 },
        { x: -3.4, z: 4.0 },
        { x: -3.4, z: 5.5 },
        { x: 3.4, z: 4.0 },
    ];
    // immediate placeholder cylinders so the modal interaction is wired
    // even before the OBJ assets resolve.
    for (const pos of positions) {
        const group = new THREE.Group();
        const base = new THREE.Mesh(
            new THREE.CylinderGeometry(0.18, 0.18, 0.04, 24),
            dishMat,
        );
        base.position.y = ctH + 0.04;
        group.add(base);
        const lid = new THREE.Mesh(
            new THREE.CylinderGeometry(0.19, 0.19, 0.025, 24),
            lidMat,
        );
        lid.position.y = ctH + 0.085;
        group.add(lid);
        group.position.set(pos.x, 0, pos.z);
        scene.add(group);
        petriDishes.push({ group, base, x: pos.x, z: pos.z, filled: false });
    }
    // upgrade to OBJ models once they load
    Promise.all(
        [0, 1, 2, 3].map((i) =>
            loadOBJ(dataURL("Petridish and loop", `models/model_${i}.obj`), (m) => {
                m.material = dishMat;
                m.castShadow = true;
                m.receiveShadow = true;
            }),
        ),
    ).then((groups) => {
        const assembled = new THREE.Group();
        for (const g of groups) if (g) assembled.add(g);
        if (assembled.children.length === 0) return;
        // The petri OBJ bbox is wide-flat (x≈37, y≈3.6, z≈48) — already
        // Y-up. The asset-meta heuristic flagged it Z-up because z is the
        // largest dimension, but for a flat round dish the long axes are
        // both horizontal. Rotating it would tip the dishes on their edge.
        const { size } = fitToFloor(assembled, 0.36);
        if (!size.x) return;
        for (const dish of petriDishes) {
            const replica = assembled.clone(true);
            replica.position.set(dish.x, ctH, dish.z);
            scene.add(replica);
            scene.remove(dish.group);
            dish.group = replica;
        }
    });
}

function fillDish(dish) {
    const culture = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 14, 10),
        new THREE.MeshStandardMaterial({
            color: 0x7ed957,
            emissive: 0x2c5c1d,
            emissiveIntensity: 0.55,
            roughness: 0.6,
        }),
    );
    culture.scale.set(1.2, 0.45, 1.2);
    culture.position.y = 0.97;
    dish.group.add(culture);
    dish.filled = true;
    dish.culture = culture;
}

function nearestUnfilledDish(maxDist) {
    let best = null;
    let bestD = maxDist;
    for (const d of petriDishes) {
        if (d.filled) continue;
        const dx = player.position.x - d.x;
        const dz = player.position.z - d.z;
        const dist = Math.hypot(dx, dz);
        if (dist < bestD) {
            best = d;
            bestD = dist;
        }
    }
    return best;
}

function isNearDoor() {
    return (
        player.position.z < -7 &&
        player.position.x > 1 &&
        player.position.x < 4
    );
}

let lastPromptKey = "";
let promptElapsed = 0;
const PROMPT_FADE_AFTER = 2.0;

function updateLabPrompt(dt) {
    if (exiting) return;
    // let brief flash messages linger their own way
    if (promptInner.textContent === "Picked up!") return;
    if (promptInner.textContent === "Cultured!") return;

    let text = "";
    let key = "idle";
    if (isNearDoor()) {
        text = "Click! Leave the lab!";
        key = "door";
    } else {
        const dish = nearestUnfilledDish(1.2);
        if (nearFieldNotebook()) {
            text = "Click! Open the field manual!";
            key = "notebook";
        } else if (dish && sampleCount > 0) {
            text = "Click or E! Culture a sample!";
            key = "dish-yes";
        } else if (dish) {
            text = "No samples to culture!";
            key = "dish-no";
        }
        // no fallback — when there's nothing nearby to interact with we
        // show no prompt instead of nagging "walk to the door".
    }

    if (key !== lastPromptKey) {
        lastPromptKey = key;
        promptElapsed = 0;
        setPrompt(text);
    }
}

// Field-notebook proximity check. The "loose page" on the typewriter
// desk is the click target that opens the manual; computed once from
// the typewriter's world coords (group at (-3.4,0,2.5), rotated +PI/2
// around Y, flatPage local (0.55,*,0.05) → world ≈ (-3.35, *, 1.95)).
const FIELD_NOTEBOOK_XZ = { x: -3.35, z: 1.95 };
const FIELD_NOTEBOOK_RANGE_SQ = 1.6 * 1.6;
function nearFieldNotebook() {
    const dx = player.position.x - FIELD_NOTEBOOK_XZ.x;
    const dz = player.position.z - FIELD_NOTEBOOK_XZ.z;
    return dx * dx + dz * dz < FIELD_NOTEBOOK_RANGE_SQ;
}

// Animated monitor screen — fakes a live readout with scrolling green
// scan-lines and blinking dots on a CanvasTexture. Module-level handle is
// updated each frame in tick() so the screen reads as alive.
let monitorTex = null;
let monitorCtx = null;
let monitorOffset = 0;
function placeAnimatedMonitor(x, y, z) {
    const W = 256, H = 160;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    monitorCtx = c.getContext("2d");
    // initial fill so first frame isn't blank
    monitorCtx.fillStyle = "#0a1d10";
    monitorCtx.fillRect(0, 0, W, H);
    monitorTex = new THREE.CanvasTexture(c);
    monitorTex.colorSpace = THREE.SRGBColorSpace;
    const screenMat = new THREE.MeshStandardMaterial({
        map: monitorTex,
        emissiveMap: monitorTex,
        emissive: 0xffffff,
        emissiveIntensity: 0.85,
        roughness: 0.4,
    });
    const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(1.28, 0.74),
        screenMat,
    );
    screen.position.set(x, y, z);
    screen.rotation.y = Math.PI; // face -Z (toward room)
    scene.add(screen);
}
function updateMonitor(now) {
    if (!monitorCtx) return;
    const t = now / 1000;
    const W = 256, H = 160;
    monitorOffset = (monitorOffset + 1.6) % H;
    monitorCtx.fillStyle = "#0a1d10";
    monitorCtx.fillRect(0, 0, W, H);
    // sweeping bright bar
    const grad = monitorCtx.createLinearGradient(0, monitorOffset - 28, 0, monitorOffset + 28);
    grad.addColorStop(0, "rgba(126,217,87,0)");
    grad.addColorStop(0.5, "rgba(126,217,87,0.35)");
    grad.addColorStop(1, "rgba(126,217,87,0)");
    monitorCtx.fillStyle = grad;
    monitorCtx.fillRect(0, monitorOffset - 28, W, 56);
    // scan lines
    monitorCtx.fillStyle = "rgba(126,217,87,0.55)";
    for (let y = 0; y < H; y += 4) monitorCtx.fillRect(0, y, W, 1);
    // sample-readout text
    monitorCtx.font = "bold 14px ui-monospace, monospace";
    monitorCtx.fillStyle = "#b8f08a";
    monitorCtx.fillText("SAMPLE_DB", 12, 24);
    monitorCtx.font = "11px ui-monospace, monospace";
    monitorCtx.fillStyle = "#7ed957";
    monitorCtx.fillText(`uptime ${(t).toFixed(1)}s`, 12, 44);
    monitorCtx.fillText(`cultures ${cultureCount}/${10}`, 12, 60);
    monitorCtx.fillText(`samples  ${sampleCount}`, 12, 76);
    // blinking cursor + status dot
    if (Math.floor(t * 2) % 2 === 0) {
        monitorCtx.fillStyle = "#7ed957";
        monitorCtx.fillRect(12, 88, 8, 12);
    }
    monitorCtx.fillStyle = `rgba(126,217,87,${0.6 + 0.4 * Math.sin(t * 4)})`;
    monitorCtx.beginPath();
    monitorCtx.arc(W - 18, 22, 5, 0, Math.PI * 2);
    monitorCtx.fill();
    monitorTex.needsUpdate = true;
}

// Tucked-in stools at the U-bench, facing inward so it reads as a
// workspace people actually sit at. Simple cylinder seats on a 4-leg base.
function placeStools() {
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x2a323a, roughness: 0.55 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x1a1f26, roughness: 0.5, metalness: 0.4 });
    // (x, z) are the stool's centre. Stools live just inside the U opening.
    const spots = [
        { x: -2.6, z: 3.0 },
        { x: -2.6, z: 6.0 },
        { x:  2.6, z: 3.0 },
        { x:  2.6, z: 6.0 },
        { x: -1.0, z: 7.4 },
        { x:  1.0, z: 7.4 },
    ];
    for (const s of spots) {
        const stool = new THREE.Group();
        stool.position.set(s.x, 0, s.z);
        const seat = new THREE.Mesh(
            new THREE.CylinderGeometry(0.22, 0.22, 0.05, 18),
            seatMat,
        );
        seat.position.y = 0.62;
        seat.castShadow = true;
        seat.receiveShadow = true;
        stool.add(seat);
        // central column
        const col = new THREE.Mesh(
            new THREE.CylinderGeometry(0.03, 0.03, 0.55, 8),
            legMat,
        );
        col.position.y = 0.30;
        stool.add(col);
        // 4 small radial feet
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2;
            const foot = new THREE.Mesh(
                new THREE.BoxGeometry(0.22, 0.03, 0.04),
                legMat,
            );
            foot.position.set(Math.cos(a) * 0.12, 0.04, Math.sin(a) * 0.12);
            foot.rotation.y = a;
            stool.add(foot);
        }
        scene.add(stool);
        // small collider — players bump but don't get stuck
        labColliders.push({
            minX: s.x - 0.25, maxX: s.x + 0.25,
            minZ: s.z - 0.25, maxZ: s.z + 0.25,
        });
    }
}

// Floor crates — wooden boxes near the ice closet entry, reads as the
// "incoming samples" pile. Visual variety, low cost.
function placeFloorCrates() {
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a6334, roughness: 0.85 });
    const woodDark = new THREE.MeshStandardMaterial({ color: 0x4a3a1c, roughness: 0.85 });
    const stencilMat = new THREE.MeshStandardMaterial({
        color: 0xeec96a,
        emissive: 0x4a3a10,
        emissiveIntensity: 0.18,
        roughness: 0.7,
    });
    // (x, z, w, h, d, rotY)
    const crates = [
        { x:  1.6, z: -2.4, w: 0.7, h: 0.7, d: 0.7, rotY: 0.2 },
        { x:  0.9, z: -2.0, w: 0.55, h: 0.55, d: 0.55, rotY: -0.3 },
        { x:  1.4, z: -1.4, w: 0.6, h: 0.4, d: 0.6, rotY: 0.0, stack: true },
    ];
    for (const c of crates) {
        const crate = new THREE.Group();
        crate.position.set(c.x, 0, c.z);
        crate.rotation.y = c.rotY;
        const body = new THREE.Mesh(
            new THREE.BoxGeometry(c.w, c.h, c.d),
            woodMat,
        );
        body.position.y = c.h / 2;
        body.castShadow = true;
        body.receiveShadow = true;
        crate.add(body);
        // dark plank trim — top edges, gives crate a built quality
        for (const dz of [-c.d / 2 + 0.02, c.d / 2 - 0.02]) {
            const plank = new THREE.Mesh(
                new THREE.BoxGeometry(c.w + 0.01, 0.04, 0.04),
                woodDark,
            );
            plank.position.set(0, c.h - 0.02, dz);
            crate.add(plank);
        }
        // stencil rectangle on the front face — fakes a stamped label
        const stencil = new THREE.Mesh(
            new THREE.PlaneGeometry(c.w * 0.45, 0.08),
            stencilMat,
        );
        stencil.position.set(0, c.h * 0.55, c.d / 2 + 0.001);
        crate.add(stencil);
        scene.add(crate);
        labColliders.push({
            minX: c.x - c.w / 2 - 0.05,
            maxX: c.x + c.w / 2 + 0.05,
            minZ: c.z - c.d / 2 - 0.05,
            maxZ: c.z + c.d / 2 + 0.05,
        });
    }
}

// Whiteboard on the east wall above the U-bench right arm — hand-drawn
// CanvasTexture with sample diagrams + scribbles. Static (no per-frame
// update) since it reads as a real whiteboard, not a screen.
function placeWhiteboard() {
    const W = 1024, H = 640;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#f3f5f1";
    ctx.fillRect(0, 0, W, H);
    // marker scribbles
    ctx.strokeStyle = "#1f2a3a";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.font = "bold 38px 'Comic Sans MS', cursive, sans-serif";
    ctx.fillStyle = "#1f2a3a";
    ctx.fillText("SAMPLES → CULTURES", 36, 70);
    // arrow flow diagram
    ctx.beginPath();
    ctx.arc(140, 200, 50, 0, Math.PI * 2); // sample blob
    ctx.stroke();
    ctx.fillStyle = "#7ed957";
    ctx.beginPath();
    ctx.arc(140, 200, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "22px 'Comic Sans MS', cursive";
    ctx.fillStyle = "#1f2a3a";
    ctx.fillText("ice", 116, 280);
    // arrow
    ctx.beginPath();
    ctx.moveTo(210, 200);
    ctx.lineTo(380, 200);
    ctx.stroke();
    // arrowhead
    ctx.beginPath();
    ctx.moveTo(380, 200); ctx.lineTo(360, 188); ctx.lineTo(360, 212); ctx.closePath();
    ctx.fillStyle = "#1f2a3a";
    ctx.fill();
    // petri dish
    ctx.beginPath();
    ctx.arc(450, 200, 60, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(450, 200, 56, 0, Math.PI * 2);
    ctx.strokeStyle = "#88c0d0";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = "#1f2a3a";
    ctx.lineWidth = 3;
    ctx.fillText("dish", 422, 290);
    // arrow
    ctx.beginPath();
    ctx.moveTo(520, 200);
    ctx.lineTo(680, 200);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(680, 200); ctx.lineTo(660, 188); ctx.lineTo(660, 212); ctx.closePath();
    ctx.fill();
    // bacteria culture
    for (let i = 0; i < 14; i++) {
        const x = 720 + Math.random() * 130;
        const y = 160 + Math.random() * 90;
        ctx.fillStyle = "#7ed957";
        ctx.beginPath();
        ctx.ellipse(x, y, 8, 5, Math.random() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(780, 200, 70, 0, Math.PI * 2);
    ctx.strokeStyle = "#1f2a3a";
    ctx.stroke();
    ctx.fillStyle = "#1f2a3a";
    ctx.fillText("culture!", 730, 305);
    // bottom checklist
    ctx.font = "26px 'Comic Sans MS', cursive";
    ctx.fillText("• keep cold", 60, 400);
    ctx.fillText("• 6 dishes", 60, 440);
    ctx.fillText("• don't drop", 60, 480);
    ctx.fillText("⚠ slippery floor", 60, 530);
    // a scribbled penguin in the corner
    ctx.strokeStyle = "#1a2230";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(900, 480, 38, 60, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(900, 500, 22, 38, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1a2230";
    ctx.beginPath();
    ctx.arc(890, 460, 3, 0, Math.PI * 2);
    ctx.arc(910, 460, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#eec96a";
    ctx.beginPath();
    ctx.moveTo(900, 472); ctx.lineTo(894, 478); ctx.lineTo(906, 478);
    ctx.closePath();
    ctx.fill();

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const boardMat = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.45,
        emissive: 0xffffff,
        emissiveMap: tex,
        emissiveIntensity: 0.12,
    });
    const frame = new THREE.MeshStandardMaterial({ color: 0x2a323a, roughness: 0.5 });
    // east wall is at x=4, board faces -X
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.25), boardMat);
    board.position.set(3.85, 2.1, 5.0);
    board.rotation.y = -Math.PI / 2;
    scene.add(board);
    const frameMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 1.33, 2.08),
        frame,
    );
    frameMesh.position.set(3.88, 2.1, 5.0);
    scene.add(frameMesh);
}

function placeBenchProps() {
    const tubeMat = new THREE.MeshStandardMaterial({ color: 0x9be9d8, roughness: 0.2, metalness: 0.05, transparent: true, opacity: 0.7 });
    const standMat = new THREE.MeshStandardMaterial({ color: 0x2a323a, roughness: 0.5 });
    const flaskMat = new THREE.MeshStandardMaterial({ color: 0xffaa55, roughness: 0.3, transparent: true, opacity: 0.75 });

    // monitor on the far-wall counter — bezel is dark plastic, screen is a
    // CanvasTexture animated each frame in tick() (see updateMonitor).
    const bezelMat = new THREE.MeshStandardMaterial({ color: 0x141821, roughness: 0.4 });
    box(1.4, 0.85, 0.06, bezelMat, -1.4, 1.5, 7.94);
    box(0.4, 0.05, 0.3, standMat, -1.4, 0.95, 8.2);
    // Screen plane sits 3 cm forward of the bezel's front face (which lives
    // at z = 7.94 - 0.06/2 = 7.91). Co-planar surfaces here caused
    // Z-fighting flicker on top of the intentional scan-line "screen" effect.
    placeAnimatedMonitor(-1.4, 1.5, 7.88);

    // microscope on left arm
    const scopeBase = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.1, 16), standMat);
    scopeBase.position.set(-3.4, 0.97, 2);
    scene.add(scopeBase);
    const scopeArm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8), standMat);
    scopeArm.position.set(-3.4, 1.27, 2);
    scene.add(scopeArm);
    const scopeHead = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.3), standMat);
    scopeHead.position.set(-3.4, 1.45, 2.1);
    scene.add(scopeHead);

    // test-tube rack on right arm
    for (let i = 0; i < 5; i++) {
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 10), tubeMat);
        tube.position.set(3.2 + (i % 3) * 0.18, 1.1, 1 + Math.floor(i / 3) * 0.25);
        scene.add(tube);
    }
    // erlenmeyer flask near the centre of the bottom counter
    const flask = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.32, 12), flaskMat);
    flask.position.set(1.5, 1.08, 8.4);
    scene.add(flask);

    // simple wood-toned test-tube rack under the row of tubes (so they
    // stop hovering over the bench top by 3 cm).
    const rackMat = new THREE.MeshStandardMaterial({ color: 0x6b4f2e, roughness: 0.7 });
    const rackBase = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.55), rackMat);
    rackBase.position.set(3.29, 0.95, 1.13);
    rackBase.castShadow = true;
    rackBase.receiveShadow = true;
    scene.add(rackBase);
    // upright back wall of the rack with five drilled "holes" implied by depth
    const rackBack = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.04), rackMat);
    rackBack.position.set(3.29, 1.07, 0.88);
    scene.add(rackBack);
}

// Centre lab cart — fills the dead zone in the middle of the room so the
// player has something to walk around. ~1.4 × 0.8 × 0.85 m (W × D × H), with
// a lower shelf and four small wheels.
function placeCentreCart() {
    const cartMat = new THREE.MeshStandardMaterial({ color: 0xc9d1da, roughness: 0.6 });
    const topMat = new THREE.MeshStandardMaterial({ color: 0x434b56, roughness: 0.4, metalness: 0.25 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1f26, roughness: 0.55 });
    const cart = new THREE.Group();
    cart.position.set(0.4, 0, 3.0);

    const w = 1.4, d = 0.8, h = 0.86;
    const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), topMat);
    top.position.y = h - 0.02;
    top.castShadow = true;
    top.receiveShadow = true;
    cart.add(top);
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(w - 0.05, 0.03, d - 0.05), cartMat);
    shelf.position.y = 0.32;
    cart.add(shelf);
    // four legs
    for (const [lx, lz] of [[-w/2 + 0.05, -d/2 + 0.05], [w/2 - 0.05, -d/2 + 0.05],
                             [-w/2 + 0.05, d/2 - 0.05], [w/2 - 0.05, d/2 - 0.05]]) {
        const leg = new THREE.Mesh(
            new THREE.CylinderGeometry(0.025, 0.025, h - 0.18, 8),
            cartMat,
        );
        leg.position.set(lx, (h - 0.18) / 2 + 0.09, lz);
        cart.add(leg);
        const wheel = new THREE.Mesh(
            new THREE.TorusGeometry(0.07, 0.022, 6, 14),
            wheelMat,
        );
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(lx, 0.07, lz);
        cart.add(wheel);
    }
    // a stack of paper-folder-y shapes on the lower shelf — fills it visually
    const folderMat = new THREE.MeshStandardMaterial({ color: 0xeec96a, roughness: 0.7 });
    const folder = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.32), folderMat);
    folder.position.set(-0.35, 0.36, 0);
    folder.rotation.y = 0.15;
    cart.add(folder);
    const folder2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.32),
        new THREE.MeshStandardMaterial({ color: 0xc8302e, roughness: 0.7 }));
    folder2.position.set(-0.35, 0.40, 0.05);
    folder2.rotation.y = -0.12;
    cart.add(folder2);
    scene.add(cart);

    // collider matching the top footprint (a touch wider so the player
    // doesn't clip the wheels)
    labColliders.push({
        minX: cart.position.x - w / 2 - 0.05,
        maxX: cart.position.x + w / 2 + 0.05,
        minZ: cart.position.z - d / 2 - 0.05,
        maxZ: cart.position.z + d / 2 + 0.05,
    });
}

// Wall shelf with reagent bottles in the dead-zone segment of the west wall
// (between the fridge and the U-bench left arm). Two stacked shelves with
// a row of cylindrical bottles each — high visual density per line of code.
function placeReagentShelf() {
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x6b4f2e, roughness: 0.65 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x2a323a, roughness: 0.5 });
    const bottleColors = [
        { c: 0x6fbf73, e: 0x153a18 },  // green
        { c: 0xeec96a, e: 0x4a3a10 },  // amber
        { c: 0x88c0d0, e: 0x152a35 },  // pale blue
        { c: 0xc8302e, e: 0x3a0a0a },  // red
        { c: 0xb6c1cd, e: 0x202830 },  // clear/grey
        { c: 0x9b59b6, e: 0x2a1438 },  // purple
    ];

    const shelfX = -3.85;          // sits flush against west wall (x=-4)
    const shelfZ = -1.0;
    const shelfLen = 1.6;
    const shelfDepth = 0.22;
    for (const yLevel of [1.55, 2.05]) {
        // shelf plank
        const plank = new THREE.Mesh(
            new THREE.BoxGeometry(shelfDepth, 0.04, shelfLen),
            shelfMat,
        );
        plank.position.set(shelfX + shelfDepth / 2, yLevel, shelfZ);
        plank.castShadow = true;
        plank.receiveShadow = true;
        scene.add(plank);
        // brackets (small triangles approximated as boxes) at each end
        for (const dz of [-shelfLen / 2 + 0.06, shelfLen / 2 - 0.06]) {
            const bracket = new THREE.Mesh(
                new THREE.BoxGeometry(0.16, 0.16, 0.04),
                capMat,
            );
            bracket.position.set(shelfX + 0.08, yLevel - 0.10, shelfZ + dz);
            scene.add(bracket);
        }
        // 5 bottles per shelf, slight scatter
        for (let i = 0; i < 5; i++) {
            const tBottle = i / 4; // 0..1 along the shelf
            const z = shelfZ - shelfLen / 2 + 0.18 + tBottle * (shelfLen - 0.36);
            const palette = bottleColors[(i + (yLevel > 1.8 ? 3 : 0)) % bottleColors.length];
            const bMat = new THREE.MeshStandardMaterial({
                color: palette.c,
                emissive: palette.e,
                emissiveIntensity: 0.18,
                roughness: 0.35,
                metalness: 0.05,
                transparent: true,
                opacity: 0.85,
            });
            const radius = 0.045 + (i % 2) * 0.012;
            const height = 0.20 + ((i * 7) % 5) * 0.018;
            const body = new THREE.Mesh(
                new THREE.CylinderGeometry(radius, radius, height, 14),
                bMat,
            );
            body.position.set(shelfX + 0.12, yLevel + 0.02 + height / 2, z);
            body.castShadow = true;
            scene.add(body);
            const cap = new THREE.Mesh(
                new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, 0.04, 10),
                capMat,
            );
            cap.position.set(shelfX + 0.12, yLevel + 0.02 + height + 0.02, z);
            scene.add(cap);
        }
    }
}

// click on a poster/notebook/typewriter page opens this image full-screen
const inspectables = [];

// ── lockers — Kojima homage. A row of four vertical lockers along the
// east wall; the last one opens to reveal an "EL REY" poster on the
// inside of the door and a low-poly parka hanging on a rod.
const openableLocker = { pivot: null, target: 0, current: 0 };
const LOCKER_OPEN_ANGLE = Math.PI * 110 / 180;
function placeLockers() {
    const W = 0.55;  // locker width  (z direction)
    const H = 1.95;  // locker height (y direction)
    const D = 0.42;  // locker depth  (x direction)
    const wallX = 4.0; // east wall at x=+4

    // A row of four side-by-side along the east wall, between the door
    // zone (z < -7, near x=2.5) and the ice closet (z = -3..0). Sits at
    // z = -6.5 .. -4.85 — close to the door so they're the first thing
    // a player sees walking in, and well clear of the ice-closet wall.
    // Northmost (z = -4.85) is the openable one.
    const positions = [
        { x: wallX - D / 2, z: -6.50, openable: false, jacketColor: 0x2c5e8a }, // navy
        { x: wallX - D / 2, z: -5.95, openable: false, jacketColor: 0x9c4f2a }, // rust
        { x: wallX - D / 2, z: -5.40, openable: false, jacketColor: 0x4a7b3f }, // olive
        { x: wallX - D / 2, z: -4.85, openable: true,  jacketColor: 0xe8542a }, // parka orange
    ];

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x6c7886, roughness: 0.55, metalness: 0.4 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x8090a0, roughness: 0.45, metalness: 0.45 });
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.4, metalness: 0.7 });
    const interiorMat = new THREE.MeshStandardMaterial({ color: 0x4a525e, roughness: 0.85 });
    const ventMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });

    // Poster material — texture loads asynchronously; placeholder is
    // cream paper so the panel is never invisible.
    // DoubleSide so it's visible regardless of which face the door is
    // currently turning toward the player after the open animation.
    // raw:true skips the dataURL .png→.webp rewrite — there's no
    // optimized WebP for this asset, so the rewrite would 404 silently
    // and the poster would just stay cream.
    const posterMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.92,
        side: THREE.DoubleSide,
    });
    loadTexture(dataURL("photo", "elrey.png", { raw: true })).then((tex) => {
        if (!tex) return;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        posterMat.map = tex;
        posterMat.needsUpdate = true;
    });

    for (const pos of positions) {
        const body = new THREE.Group();
        body.position.set(pos.x, 0, pos.z);
        scene.add(body);

        // back wall (against the lab wall at x=+4)
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.02, H, W), bodyMat);
        back.position.set(D / 2 - 0.01, H / 2, 0);
        back.castShadow = back.receiveShadow = true;
        body.add(back);

        // interior lining (slightly darker — visible when the door opens)
        const inside = new THREE.Mesh(new THREE.BoxGeometry(0.005, H - 0.04, W - 0.04), interiorMat);
        inside.position.set(D / 2 - 0.025, H / 2, 0);
        body.add(inside);

        // side walls
        for (const sz of [-1, 1]) {
            const side = new THREE.Mesh(new THREE.BoxGeometry(D, H, 0.02), bodyMat);
            side.position.set(0, H / 2, sz * (W / 2));
            side.castShadow = side.receiveShadow = true;
            body.add(side);
        }

        // top + bottom
        const top = new THREE.Mesh(new THREE.BoxGeometry(D, 0.02, W), bodyMat);
        top.position.set(0, H, 0);
        body.add(top);
        const bottom = new THREE.Mesh(new THREE.BoxGeometry(D, 0.02, W), bodyMat);
        bottom.position.set(0, 0.01, 0);
        body.add(bottom);

        // a small horizontal shelf inside (visual depth)
        const shelf = new THREE.Mesh(
            new THREE.BoxGeometry(D - 0.05, 0.014, W - 0.05),
            interiorMat,
        );
        shelf.position.set(0, H * 0.62, 0);
        body.add(shelf);

        if (pos.openable) {
            // hinge at the front-north corner; door extends in -z
            const pivot = new THREE.Group();
            pivot.position.set(-D / 2, 0, +W / 2);
            body.add(pivot);

            const door = new THREE.Mesh(new THREE.BoxGeometry(0.02, H, W), doorMat);
            door.position.set(0, H / 2, -W / 2);
            door.castShadow = true;
            pivot.add(door);

            // handle near the free end (south side) of the door
            const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.09), handleMat);
            handle.position.set(-0.03, H * 0.5, -W + 0.07);
            pivot.add(handle);

            // poster on the INSIDE face of the door — small offset to avoid
            // z-fighting with the door surface.
            const posterAspect = 184 / 610;
            const posterH = 1.35;
            const posterW = posterH * posterAspect;
            const poster = new THREE.Mesh(new THREE.PlaneGeometry(posterW, posterH), posterMat);
            // door's inside-face is at +x (toward locker interior); plane
            // default normal is +z so rotateY(-PI/2) makes it face -x; we
            // want +x so use +PI/2.
            poster.rotation.y = Math.PI / 2;
            poster.position.set(0.012, H * 0.55, -W / 2);
            pivot.add(poster);

            openableLocker.pivot = pivot;
            openableLocker.target = 0;
            openableLocker.current = 0;

            // clickable: toggle open/close. Push to inspectables on the
            // next microtask so the local mesh ref is captured cleanly.
            queueMicrotask(() => {
                inspectables.push({
                    mesh: door,
                    onClick: () => {
                        openableLocker.target =
                            openableLocker.target === 0 ? LOCKER_OPEN_ANGLE : 0;
                    },
                });
            });

            placeLockerJacket(body, pos.jacketColor, W, H, D);
        } else {
            // fixed front panel
            const door = new THREE.Mesh(new THREE.BoxGeometry(0.02, H, W), doorMat);
            door.position.set(-D / 2 + 0.01, H / 2, 0);
            door.castShadow = true;
            body.add(door);

            // handle on the outside front, near right edge
            const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.09), handleMat);
            handle.position.set(-D / 2 - 0.025, H * 0.5, W * 0.4);
            body.add(handle);

            // ventilation slits along the top of the door
            for (let v = 0; v < 4; v++) {
                const vent = new THREE.Mesh(
                    new THREE.BoxGeometry(0.005, 0.012, W * 0.4),
                    ventMat,
                );
                vent.position.set(-D / 2 - 0.005, H * 0.92 - v * 0.026, 0);
                body.add(vent);
            }
        }

        // collider — keeps the player from walking into the locker. Door
        // swing isn't collided; it's thin enough to clip through harmlessly.
        labColliders.push({
            minX: pos.x - D / 2,
            maxX: pos.x + D / 2,
            minZ: pos.z - W / 2,
            maxZ: pos.z + W / 2,
        });
    }
}

// Low-poly parka inside an openable locker: a hanger rod + simple block
// torso + sleeves. Hung from the rod near the top of the locker.
function placeLockerJacket(body, color, W, H, D) {
    const rodMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.7, roughness: 0.4 });
    const rod = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.008, W - 0.06, 8),
        rodMat,
    );
    rod.rotation.x = Math.PI / 2;
    rod.position.set(0.04, H * 0.82, 0);
    body.add(rod);

    const jacketMat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    // torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.46, 0.26), jacketMat);
    torso.position.set(0.04, H * 0.55, 0);
    torso.castShadow = true;
    body.add(torso);
    // sleeves (slightly angled outward like a parka on a hanger)
    for (const sz of [-1, 1]) {
        const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.36, 0.07), jacketMat);
        sleeve.position.set(0.04, H * 0.55 - 0.04, sz * 0.16);
        sleeve.rotation.x = sz * 0.12;
        sleeve.castShadow = true;
        body.add(sleeve);
    }
    // collar (darker band at the top of the torso)
    const collarMat = new THREE.MeshStandardMaterial({ color: 0x3b2618, roughness: 0.7 });
    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.18), collarMat);
    collar.position.set(0.04, H * 0.78, 0);
    body.add(collar);
}

function updateOpenableLocker(dt) {
    if (!openableLocker.pivot) return;
    const c = openableLocker.current;
    const t = openableLocker.target;
    if (Math.abs(t - c) < 1e-4) return;
    const next = c + (t - c) * Math.min(1, dt * 4);
    openableLocker.pivot.rotation.y = next;
    openableLocker.current = next;
}

(function init() {
    buildLabInterior();
    placeCentreCart();         // before candles — one candle sits on its top
    placeReagentShelf();
    placeStools();
    placeFloorCrates();
    placeWhiteboard();
    spawnCandles();
    spawnWallSconces();
    hangPosters();
    addLabExtras();
    spawnNotebooks();
    spawnTypewriter();
    placeLockers();
    labReady = true;
    controls.unpause("loading");
    // prompt is driven each frame by updateLabPrompt
})();

function hangPosters() {
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x2a323a, roughness: 0.4 });
    // (folder, file, x, y, z, rotY, w, h, normal)
    // `normal` is the world-space outward direction; we offset the poster
    // off the wall along it (`standoff` below) — the trick that stops
    // z-fighting with the wall mesh.
    //
    // Furniture footprints to avoid clipping into / hiding behind:
    //   west wall (x=-4): cabinet z∈[-8.25,-6.55] h≤1.7 · bench
    //                      z∈[-6.6,-3.8] h≈1.4 · fridge z∈[-3.43,-2.58]
    //                      h≤1.95 · reagent shelf z∈[-1.8,-0.2] y∈[1.5,2.2]
    //                      · U-bench arm z∈[0.9,7.9] h≤0.92
    //   east wall (x=4):  ice closet z∈[-3,0] (occludes wall) ·
    //                      U-bench arm z∈[0.9,7.9] h≤0.92 · whiteboard
    //                      z∈[4,6] y∈[1.5,2.7]
    //   entry (z=-9):     door x∈[1.5,3.5] · window x∈[-3.5,-1.5] y∈[1.4,2.8]
    //                      · crest at (2.5,3.05)
    //   far  (z=+9):      window x∈[-2,2] y∈[1.4,2.8] · U-bench bottom arm
    //                      sits at z=8.4, h≤0.92 (occludes low posters)
    const wall = "photo/wall";
    const photos = [
        // ----- existing posters -----
        ["photo", "arctic-base-exhibition-science-museum-barcelona-catalonia-spain-space-cosmocaixa-displays-original-laboratory-375317270.jpg",
            -4, 2.6, 2.0, Math.PI / 2, 1.6, 1.1, [1, 0, 0]],
        ["photo", "space-cosmocaixa-science-museum-displays-original-laboratory-juan-carlos-i-antarctic-base-thanks-to-375317283.jpg",
            -4, 2.6, 5.0, Math.PI / 2, 1.6, 1.1, [1, 0, 0]],
        ["photo", "Base_Antártica_Española_Juan_Carlos_I.jpg",
            4, 2.7, 7.6, -Math.PI / 2, 1.8, 1.2, [-1, 0, 0]],
        ["photo", "2.8.8.30.10.jpg",
            0, 3.0, -9, Math.PI, 1.4, 0.95, [0, 0, 1]],
        ["photo", "New folder/img_010.jpeg",
            -3, 3.0, 9, 0, 1.4, 0.95, [0, 0, -1]],
        ["photo", "New folder/img_032.jpeg",
            3, 3.0, 9, 0, 1.4, 0.95, [0, 0, -1]],
        // ----- new wall photos (mixed sizes, placed to clear furniture) -----
        // === west wall ===
        // big landscape above the cabinet
        [wall, "agdm_21942_full - Copy.jpg",
            -4, 3.2, -7.4, Math.PI / 2, 1.4, 0.95, [1, 0, 0]],
        // small portrait above the lab bench
        [wall, "Pasted image 20260419105713 - Copy.png",
            -4, 2.55, -5.2, Math.PI / 2, 0.45, 0.6, [1, 0, 0]],
        // medium landscape above the fridge
        [wall, "Pasted image 20260419100406 - Copy.png",
            -4, 3.05, -3.0, Math.PI / 2, 1.0, 0.7, [1, 0, 0]],
        // small portrait between fridge and reagent shelf
        [wall, "Pasted image 20260419101340 - Copy.png",
            -4, 2.65, -2.0, Math.PI / 2, 0.45, 0.6, [1, 0, 0]],
        // small landscape between the two existing posters, lower band
        [wall, "Pasted image 20260419103705 - Copy.png",
            -4, 1.55, 3.5, Math.PI / 2, 0.55, 0.4, [1, 0, 0]],
        // medium landscape past the existing z=5 poster
        [wall, "20230326_Deception_island - Copy.jpg",
            -4, 2.5, 6.6, Math.PI / 2, 0.7, 0.5, [1, 0, 0]],
        // small portrait near the south-west corner
        [wall, "Pasted image 20260419101136 - Copy.png",
            -4, 2.4, 8.0, Math.PI / 2, 0.45, 0.65, [1, 0, 0]],
        // === east wall ===
        // big landscape north of the ice closet
        [wall, "agdm_23631_full - Copy.jpg",
            4, 2.5, -6.0, -Math.PI / 2, 1.3, 0.9, [-1, 0, 0]],
        // small low near the door corner
        [wall, "Pasted image 20260419112926 - Copy.png",
            4, 1.55, -7.8, -Math.PI / 2, 0.5, 0.4, [-1, 0, 0]],
        // medium above U-bench right arm, between closet (z=0) and whiteboard (z=4)
        [wall, "Pasted image 20260419102548 - Copy.png",
            4, 2.4, 2.5, -Math.PI / 2, 0.8, 0.6, [-1, 0, 0]],
        // small portrait between whiteboard and existing 7.6 poster
        [wall, "Pasted image 20260419114555 - Copy.png",
            4, 1.7, 6.7, -Math.PI / 2, 0.45, 0.6, [-1, 0, 0]],
        // === entry wall ===
        // small accent left of centre, above the window
        [wall, "Pasted image 20260416160358 - Copy.png",
            -2.5, 3.5, -9, Math.PI, 0.55, 0.4, [0, 0, 1]],
        // === far wall ===
        // small accent above the window, between existing corner posters
        [wall, "Pasted image 20260416160411 - Copy.png",
            0, 3.4, 9, 0, 0.5, 0.4, [0, 0, -1]],
    ];
    const standoff = 0.22; // distance from wall surface
    const frameDepth = 0.04;
    for (const [folder, file, wx, wy, wz, rotY, w, h, n] of photos) {
        const px = wx + n[0] * standoff;
        const py = wy;
        const pz = wz + n[2] * standoff;
        const placeholder = new THREE.MeshStandardMaterial({ color: 0xddd8c4, roughness: 0.6 });
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), placeholder);
        plane.position.set(px, py, pz);
        plane.rotation.y = rotY;
        scene.add(plane);
        // frame: behind the plane (closer to the wall) by frameDepth
        const frame = new THREE.Mesh(
            new THREE.BoxGeometry(w + 0.08, h + 0.08, frameDepth),
            trimMat,
        );
        frame.position.set(
            px - n[0] * (frameDepth / 2 + 0.005),
            py,
            pz - n[2] * (frameDepth / 2 + 0.005),
        );
        frame.rotation.y = rotY;
        scene.add(frame);
        const url = dataURL(folder, file);
        inspectables.push({ mesh: plane, url });
        loadTexture(url).then((tex) => {
            if (!tex) return;
            tex.anisotropy = 4;
            plane.material = new THREE.MeshStandardMaterial({
                map: tex,
                roughness: 0.6,
                metalness: 0,
            });
            plane.material.needsUpdate = true;
        });
    }
}

function addLabExtras() {
    // --- lab bench OBJ assembly (21 parts) — placed along the east wall
    const benchMats = [
        new THREE.MeshStandardMaterial({ color: 0xc9d1da, roughness: 0.65 }), // cabinet
        new THREE.MeshStandardMaterial({ color: 0x434b56, roughness: 0.4, metalness: 0.25 }), // counter
        new THREE.MeshStandardMaterial({ color: 0xa9b2bd, roughness: 0.6 }), // alt
        new THREE.MeshStandardMaterial({ color: 0x2a323a, roughness: 0.5, metalness: 0.4 }), // metal
    ];
    Promise.all(
        Array.from({ length: 21 }, (_, i) =>
            loadOBJ(dataURL("lab bench", `models/model_${i}.obj`), (m) => {
                m.material = benchMats[i % benchMats.length];
                m.castShadow = true;
                m.receiveShadow = true;
            }),
        ),
    ).then((groups) => {
        const assembled = new THREE.Group();
        for (const g of groups) if (g) assembled.add(g);
        if (assembled.children.length === 0) return;
        // many OBJ exporters write Z-up; rotate so the bench stands vertically
        assembled.rotation.x = -Math.PI / 2;
        const wrap = new THREE.Group();
        wrap.add(assembled);
        const { size } = fitToFloor(wrap, 2.8);
        // Sits along the west wall between the science cabinet (-3.5,-7.4)
        // and the fridge (-3.55,-3). Pushed in tight to the wall (x=-3.2)
        // so the entry corridor reads as a workbench wall, not floating
        // furniture in the middle of the room.
        wrap.position.set(-3.2, 0, -5.2);
        wrap.rotation.y = Math.PI / 2;
        scene.add(wrap);
        labColliders.push({
            minX: -3.9,
            maxX: -2.1,
            minZ: -6.4,
            maxZ: -4.0,
        });
    });

    // --- Juan Carlos I station crest mounted on the south wall above the U-bench
    const crestPartMats = [
        new THREE.MeshStandardMaterial({ color: 0xfaf2dc, roughness: 0.5, metalness: 0.2, emissive: 0x332200, emissiveIntensity: 0.15 }),
        new THREE.MeshStandardMaterial({ color: 0x1f3d80, roughness: 0.55, metalness: 0.2, emissive: 0x0a1a3a, emissiveIntensity: 0.1 }),
        new THREE.MeshStandardMaterial({ color: 0xc8302e, roughness: 0.55, metalness: 0.2, emissive: 0x4a1010, emissiveIntensity: 0.1 }),
        new THREE.MeshStandardMaterial({ color: 0xffd633, roughness: 0.45, metalness: 0.4, emissive: 0x664400, emissiveIntensity: 0.15 }),
    ];
    // mounted on the entry wall (north) just above the door so the player
    // sees it as soon as they walk in
    const crestHolder = new THREE.Group();
    crestHolder.position.set(2.5, 3.05, -8.78);
    crestHolder.rotation.y = 0; // faces +z (into the room)
    scene.add(crestHolder);
    Promise.all(
        [0, 1, 2, 3].map((i) =>
            loadOBJ(
                dataURL(
                    "Logo of the _Juan Carlos I_ station",
                    `models/model_${i}.obj`,
                ),
                (m) => {
                    m.material = crestPartMats[i];
                    m.castShadow = true;
                },
            ),
        ),
    ).then((groups) => {
        const inner = new THREE.Group();
        for (const g of groups) if (g) inner.add(g);
        if (inner.children.length === 0) return;
        centerScale(inner, 1.4);
        crestHolder.add(inner);
    });

    // Science lab cabinet against the entry wall (left of the door area).
    Promise.all([
        loadOBJ(dataURL("Science lab cabinet", "models/model_0.obj")),
        loadTexture(dataURL("Science lab cabinet", "textures/lambert1_albedo.png")),
        loadTexture(dataURL("Science lab cabinet", "textures/lambert1_normal.png"), { colorSpace: THREE.NoColorSpace }),
        loadTexture(dataURL("Science lab cabinet", "textures/lambert1_roughness.png"), { colorSpace: THREE.NoColorSpace }),
    ]).then(([g, albedo, normal, rough]) => {
        if (!g) return;
        const mat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: albedo || null,
            normalMap: normal || null,
            roughnessMap: rough || null,
            roughness: rough ? 1 : 0.7,
        });
        g.traverse((o) => {
            if (o.isMesh) {
                o.material = mat;
                o.castShadow = true;
                o.receiveShadow = true;
            }
        });
        const wrap = new THREE.Group();
        wrap.add(g);
        const { size } = fitToFloor(wrap, 1.7);
        // Tucked closer to the west wall (was -3.0) so the bench + cabinet
        // read as a continuous run of furniture along it.
        wrap.position.set(-3.5, 0, -7.4);
        wrap.rotation.y = Math.PI / 2;
        scene.add(wrap);
        labColliders.push({
            minX: -3.9,
            maxX: -2.9,
            minZ: -7.4 - size.x / 2,
            maxZ: -7.4 + size.x / 2,
        });
    });

    // Lab Equipment Pack — scatter the 6 OBJ models on the bench.
    const benchSpots = [
        { x: -2, z: 8.4, scale: 0.6, rotY: 0 },
        { x: 1.7, z: 8.4, scale: 0.7, rotY: 0.4 },
        { x: -3.4, z: 1.5, scale: 0.55, rotY: Math.PI / 2 },
        { x: 3.4, z: 2.4, scale: 0.55, rotY: -Math.PI / 2 },
        { x: 3.4, z: 6.5, scale: 0.6, rotY: -Math.PI / 2 + 0.2 },
        { x: -1.0, z: 8.4, scale: 0.55, rotY: -0.3 },
    ];
    const equipMat = new THREE.MeshStandardMaterial({ color: 0xcfd6dd, roughness: 0.55, metalness: 0.2 });
    for (let i = 0; i < 6; i++) {
        const spot = benchSpots[i];
        loadOBJ(
            dataURL("Laboratory Equipment Pack", `models/model_${i}.obj`),
            (m) => {
                m.material = equipMat;
                m.castShadow = true;
                m.receiveShadow = true;
            },
        ).then((g) => {
            if (!g) return;
            const wrap = new THREE.Group();
            wrap.add(g);
            const { size } = fitToFloor(wrap, 0.8 * spot.scale);
            wrap.position.set(spot.x, 0.94, spot.z);
            wrap.rotation.y = spot.rotY;
            scene.add(wrap);
        });
    }
}

function makeNotebookTexture(side = "left") {
    const w = 512;
    const h = 360;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    // paper
    ctx.fillStyle = "#f5ecd2";
    ctx.fillRect(0, 0, w, h);
    // subtle grain
    for (let i = 0; i < 600; i++) {
        ctx.fillStyle = `rgba(120,90,40,${0.02 + Math.random() * 0.04})`;
        ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
    }
    // ruled lines
    ctx.strokeStyle = "rgba(70, 90, 120, 0.35)";
    ctx.lineWidth = 1;
    for (let y = 30; y < h; y += 26) {
        ctx.beginPath();
        ctx.moveTo(20, y);
        ctx.lineTo(w - 20, y);
        ctx.stroke();
    }
    // margin red line
    ctx.strokeStyle = "rgba(180, 50, 60, 0.55)";
    ctx.beginPath();
    ctx.moveTo(48, 0);
    ctx.lineTo(48, h);
    ctx.stroke();

    ctx.fillStyle = "#1a2230";
    ctx.font = "italic 18px 'Caveat','Brush Script MT', cursive";
    if (side === "left") {
        // handwritten notes
        const lines = [
            "Día 12 — sondeo",
            "muestra 0042 ✓",
            "T° hielo: -3.4 °C",
            "pH cultivo: 7.2",
            "color = verde claro",
            "→ revisar mañana",
        ];
        let y = 50;
        for (const ln of lines) {
            ctx.fillText(ln, 60, y);
            y += 26;
        }
        // tiny sketch of a flask
        ctx.strokeStyle = "#1a2230";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(360, 220);
        ctx.lineTo(355, 240);
        ctx.lineTo(340, 290);
        ctx.lineTo(420, 290);
        ctx.lineTo(405, 240);
        ctx.lineTo(400, 220);
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = "rgba(126, 217, 87, 0.5)";
        ctx.beginPath();
        ctx.moveTo(345, 270);
        ctx.lineTo(415, 270);
        ctx.lineTo(420, 290);
        ctx.lineTo(340, 290);
        ctx.closePath();
        ctx.fill();
    } else {
        // right page: simple cell diagram
        ctx.strokeStyle = "#1a2230";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(220, 160, 90, 60, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(220, 160, 18, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#1a2230";
        ctx.font = "italic 16px 'Caveat','Brush Script MT', cursive";
        ctx.fillText("núcleo", 240, 162);
        ctx.beginPath();
        ctx.moveTo(150, 100);
        ctx.lineTo(180, 130);
        ctx.stroke();
        ctx.fillText("pared", 110, 96);
        // arrow
        ctx.beginPath();
        ctx.moveTo(60, 280);
        ctx.lineTo(190, 280);
        ctx.lineTo(180, 270);
        ctx.moveTo(190, 280);
        ctx.lineTo(180, 290);
        ctx.stroke();
        ctx.fillText("muestra → cultivo", 65, 268);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

function spawnNotebooks() {
    const ctH = 0.92;
    const placements = [
        { x: -2.4, z: 8.4, rotY: -0.2 },
        { x: 1.6, z: 8.4, rotY: 0.15 },
        { x: -3.4, z: 6.6, rotY: Math.PI / 2 + 0.1 },
    ];
    for (const p of placements) {
        const group = new THREE.Group();
        // back cover
        const cover = new THREE.Mesh(
            new THREE.BoxGeometry(0.72, 0.02, 0.45),
            new THREE.MeshStandardMaterial({ color: 0x2b3a4a, roughness: 0.6 }),
        );
        cover.position.y = ctH + 0.025;
        cover.castShadow = true;
        group.add(cover);
        // left page
        const leftTex = makeNotebookTexture("left");
        const leftPage = new THREE.Mesh(
            new THREE.PlaneGeometry(0.32, 0.42),
            new THREE.MeshStandardMaterial({
                map: leftTex,
                roughness: 0.85,
            }),
        );
        leftPage.rotation.x = -Math.PI / 2;
        leftPage.position.set(-0.18, ctH + 0.036, 0);
        group.add(leftPage);
        const rightTex = makeNotebookTexture("right");
        const rightPage = new THREE.Mesh(
            new THREE.PlaneGeometry(0.32, 0.42),
            new THREE.MeshStandardMaterial({
                map: rightTex,
                roughness: 0.85,
            }),
        );
        rightPage.rotation.x = -Math.PI / 2;
        rightPage.position.set(0.18, ctH + 0.036, 0);
        group.add(rightPage);
        try {
            inspectables.push({ mesh: leftPage, url: leftTex.image.toDataURL() });
            inspectables.push({ mesh: rightPage, url: rightTex.image.toDataURL() });
        } catch (_) { /* canvas tainted — skip inspect */ }
        // spine seam
        const spine = new THREE.Mesh(
            new THREE.BoxGeometry(0.02, 0.005, 0.45),
            new THREE.MeshStandardMaterial({ color: 0x14181d }),
        );
        spine.position.y = ctH + 0.04;
        group.add(spine);
        group.position.set(p.x, 0, p.z);
        group.rotation.y = p.rotY;
        scene.add(group);
    }
}

function makeTypewrittenTexture() {
    const w = 480;
    const h = 600;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#f1ecde";
    ctx.fillRect(0, 0, w, h);
    // paper grain
    for (let i = 0; i < 1500; i++) {
        ctx.fillStyle = `rgba(60,40,20,${0.015 + Math.random() * 0.04})`;
        ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
    }
    ctx.fillStyle = "#1a1a1a";
    ctx.font = "bold 22px 'Courier New', monospace";
    ctx.fillText("EXPEDITION LOG", 100, 60);
    ctx.font = "16px 'Courier New', monospace";
    const lines = [
        "JUAN CARLOS I  —  STATION  —  DAY 12",
        "",
        "  06:14  Departure to ice wall sector 0.5pi.",
        "  07:02  Sample No. 0042 collected, ice core",
        "         intact, blue-green tint observed.",
        "  09:30  Returned to base, transferred to",
        "         the cold closet.",
        "  10:00  Plated culture #17 -> incubation.",
        "         Will inspect at 24h.",
        "",
        "  Notes: wind 12 kt, visibility good, fog",
        "  thickening past the 50m line.",
        "",
        "  -- E. Vivar, primary investigator --",
    ];
    let y = 110;
    for (const ln of lines) {
        // simulate typewriter inkiness
        for (const ch of ln) {
            // letter-by-letter so we can offset for character feel
        }
        ctx.fillText(ln, 50, y);
        y += 22;
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

function spawnTypewriter() {
    const ctH = 0.92;
    const tx = -3.4; // left arm of the U
    const tz = 2.5;
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x1f2530, roughness: 0.6, metalness: 0.2 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x70220e, roughness: 0.5 });
    const keyMat = new THREE.MeshStandardMaterial({ color: 0xeee8d8, roughness: 0.6 });
    const group = new THREE.Group();
    // base
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.4), baseMat);
    base.position.y = ctH + 0.08;
    base.castShadow = true;
    group.add(base);
    // carriage
    const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.12), trim);
    carriage.position.set(0, ctH + 0.2, -0.13);
    group.add(carriage);
    // platen roller
    const roller = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.55, 16),
        new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.4 }),
    );
    roller.rotation.z = Math.PI / 2;
    roller.position.set(0, ctH + 0.235, -0.08);
    group.add(roller);
    // key bed (slightly tilted)
    const keyBed = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.22), baseMat);
    keyBed.rotation.x = -0.2;
    keyBed.position.set(0, ctH + 0.18, 0.08);
    group.add(keyBed);
    // tiny keys (3 rows × 9)
    for (let r = 0; r < 3; r++) {
        for (let k = 0; k < 9; k++) {
            const key = new THREE.Mesh(
                new THREE.CylinderGeometry(0.015, 0.015, 0.02, 8),
                keyMat,
            );
            const dx = (k - 4) * 0.05;
            const dz = 0.02 + r * 0.05;
            key.position.set(dx, ctH + 0.215 + r * 0.005, dz);
            key.rotation.x = -0.2;
            group.add(key);
        }
    }
    // ribbon spool nubs
    for (const dx of [-0.2, 0.2]) {
        const sp = new THREE.Mesh(
            new THREE.CylinderGeometry(0.04, 0.04, 0.025, 16),
            new THREE.MeshStandardMaterial({ color: 0xcfd6dd, roughness: 0.4, metalness: 0.5 }),
        );
        sp.position.set(dx, ctH + 0.205, -0.13);
        group.add(sp);
    }
    // typed page sticking out
    const pageTex = makeTypewrittenTexture();
    const page = new THREE.Mesh(
        new THREE.PlaneGeometry(0.42, 0.55),
        new THREE.MeshStandardMaterial({
            map: pageTex,
            roughness: 0.9,
        }),
    );
    page.rotation.x = -Math.PI / 2 + 0.55;
    page.position.set(0, ctH + 0.36, -0.18);
    group.add(page);
    // a finished sheet flat on the counter
    const flatTex = makeTypewrittenTexture();
    const flatPage = new THREE.Mesh(
        new THREE.PlaneGeometry(0.42, 0.55),
        new THREE.MeshStandardMaterial({
            map: flatTex,
            roughness: 0.9,
        }),
    );
    flatPage.rotation.x = -Math.PI / 2;
    flatPage.position.set(0.55, ctH + 0.005, 0.05);
    flatPage.rotation.z = 0.18;
    group.add(flatPage);
    // queue inspectables once the group is parented; toDataURL can throw on
    // tainted canvases so wrap defensively to avoid crashing init.
    queueMicrotask(() => {
        try {
            inspectables.push({ mesh: page, url: pageTex.image.toDataURL() });
            // The loose page lying on the desk is the player's field
            // notebook — clicking it opens the Field Manual instead of a
            // flat zoom, so the click "spawns" the bookopening animation.
            inspectables.push({ mesh: flatPage, onClick: () => manual.open() });
        } catch (_) { /* canvas tainted — skip inspect */ }
    });

    group.position.set(tx, 0, tz);
    group.rotation.y = Math.PI / 2;
    scene.add(group);
}

// input + exit handling
controls.init(canvas);
controls.setPlayer(player);
const keys = controls.keys;
let exiting = false;
async function exitLab() {
    if (exiting) return;
    exiting = true;
    controls.pause("nav");
    setPrompt("Heading out…");
    const ctx = ensureAudio();
    if (ctx && ctx.state === "suspended") ctx.resume();
    playDoorSound();
    await persistInventory();
    setTimeout(() => {
        window.location.href = "outdoor.html?from=lab";
    }, 550);
}

async function doExport(id, name) {
    setPrompt("Exporting scene…");
    const status = await exportScene(scene, { id, name });
    setPrompt(status);
    setTimeout(() => setPrompt(""), 3000);
}

const manual = createManual();
const menu = createMenu({
    title: "The Lab",
    subtitle: "Indoor research station",
    primaryActions: [
        { label: "Return to Surface", primary: true, onClick: () => exitLab() },
        { label: "Field Manual", onClick: () => manual.open() },
        { label: "Export Scene", onClick: () => doExport("lab1", "Red Lab") },
        { label: "New Game", danger: true, onClick: () => triggerNewGame() },
    ],
    sliders: [
        { label: "Move",     min: 1,   max: 12,  step: 0.1,  get: () => controls.params.moveSpeed,       set: (v) => { controls.params.moveSpeed = v; controls.persistPrefs(); } },
        { label: "Look",     min: 0.2, max: 3,   step: 0.05, get: () => controls.params.lookSensitivity, set: (v) => { controls.params.lookSensitivity = v; controls.persistPrefs(); } },
    ],
});
const inspectModal = document.getElementById("inspect-modal");
const inspectImage = document.getElementById("inspect-image");
let inspectOpen = false;
function openInspect(url) {
    inspectImage.src = url;
    inspectModal.classList.add("visible");
    inspectOpen = true;
    controls.pause("inspect");
}
function closeInspect() {
    inspectModal.classList.remove("visible");
    inspectOpen = false;
    controls.unpause("inspect");
}
inspectModal.addEventListener("click", closeInspect);

const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
function raycastInspectableAt(ndcX, ndcY) {
    _ndc.set(ndcX, ndcY);
    _raycaster.setFromCamera(_ndc, camera);
    const meshes = inspectables.map((i) => i.mesh);
    const hits = _raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return null;
    const hit = hits[0].object;
    return inspectables.find((i) => i.mesh === hit) || null;
}
function raycastInspectable(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return raycastInspectableAt(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
    );
}

canvas.addEventListener("mousedown", (e) => {
    ensureStormAmbient();
    if (e.button !== 0) return;
    if (controls.isPaused()) return;
    // 0) While right-click is held (fp-temp), the left-click is
    //    *exclusively* a hold-to-zoom. Pages stay frozen — no inspect
    //    modal, no door exit, no culture. Just zoom into the detail.
    if (controls.cameraState.mode === "fp-temp") {
        controls.tryLeftClickZoom();
        return;
    }
    // 1) Raycast first so a click that actually lands on a specific
    //    inspectable mesh (typewriter page, poster, flat field-manual
    //    page) wins. In FP the pointer is locked, so we ray from screen
    //    center (the crosshair direction) instead of the cursor.
    const target = controls.isFP()
        ? raycastInspectableAt(0, 0)
        : raycastInspectable(e.clientX, e.clientY);
    if (target) {
        if (target.onClick) target.onClick();
        else if (target.url) openInspect(target.url);
        return;
    }
    // 2) Proximity fallbacks — handy when aiming at small targets in FP
    //    or when the user just wants to "click the area".
    if (nearFieldNotebook()) {
        manual.open();
        return;
    }
    if (nearestUnfilledDish(1.2)) {
        tryCulture();
        return;
    }
    if (isNearDoor()) {
        exitLab();
        return;
    }
    // 3) Nothing to interact with → if the user is right-holding (fp-temp)
    //    treat the left-click as a zoom-in.
    controls.tryLeftClickZoom();
});
window.addEventListener("keydown", (e) => {
    ensureStormAmbient();
    // modals own Esc → close themselves before the world gets a turn.
    if (inspectOpen) {
        if (e.code === "Escape") closeInspect();
        return;
    }
    if (petriOpen) {
        if (e.code === "Escape") closePetriModal();
        return;
    }
    if (e.code === "Escape") {
        e.preventDefault();
        menu.toggle();
        return;
    }
    if (menu.isOpen) return;
    if (controls.isPaused()) return;
    if (e.code === "KeyQ") throwSample();
    if (e.code === "KeyE") tryCulture();
    if (e.code === "Space") {
        if (controls.tryJump(jumpState, { onJump: playFootstep })) {
            e.preventDefault();
        }
    }
    const m = e.code.match(/^(?:Digit|Numpad)(\d)$/);
    if (m) {
        const n = parseInt(m[1], 10);
        selectSlot(n === 0 ? 9 : n - 1);
    }
});

function resolveLabColliders() {
    const r = PLAYER_RADIUS;
    for (const c of labColliders) {
        if (
            player.position.x > c.minX - r &&
            player.position.x < c.maxX + r &&
            player.position.z > c.minZ - r &&
            player.position.z < c.maxZ + r
        ) {
            const dxLeft = player.position.x - (c.minX - r);
            const dxRight = c.maxX + r - player.position.x;
            const dzNorth = player.position.z - (c.minZ - r);
            const dzSouth = c.maxZ + r - player.position.z;
            const minPush = Math.min(dxLeft, dxRight, dzNorth, dzSouth);
            if (minPush === dxLeft) player.position.x = c.minX - r;
            else if (minPush === dxRight) player.position.x = c.maxX + r;
            else if (minPush === dzNorth) player.position.z = c.minZ - r;
            else player.position.z = c.maxZ + r;
        }
    }
}

// petri culture modal
const petriModal = document.getElementById("petri-modal");
const petriStage = petriModal.querySelector(".petri-stage");
const petriCultureG = petriModal.querySelector("#petri-culture");
const petriHint = document.getElementById("petri-hint");
let petriOpen = false;
let petriDishBeingCultured = null;

function openPetriModal(dish) {
    petriOpen = true;
    petriDishBeingCultured = dish;
    petriCultureG.style.display = "none";
    petriStage.classList.remove("culturing");
    petriHint.textContent = "Click the dish to culture a sample!";
    petriModal.classList.add("visible");
    controls.pause("petri");
}

function closePetriModal() {
    petriOpen = false;
    petriModal.classList.remove("visible");
    petriDishBeingCultured = null;
    controls.unpause("petri");
}

petriStage.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (!petriOpen || !petriDishBeingCultured) return;
    if (petriDishBeingCultured.filled) {
        petriHint.textContent = "Already cultured! Click outside.";
        return;
    }
    if (sampleCount <= 0) {
        petriHint.textContent = "No samples to culture!";
        return;
    }
    // perform the culture
    fillDish(petriDishBeingCultured);
    sampleCount -= 1;
    cultureCount += 1;
    persistInventory();
    updateHotbar();
    petriCultureG.style.display = "";
    petriStage.classList.remove("culturing");
    void petriStage.offsetWidth; // restart animation
    petriStage.classList.add("culturing");
    petriHint.textContent = "Cultured! Click outside to close.";
    playSampleChime();
});

petriModal.addEventListener("click", () => {
    closePetriModal();
});

function tryCulture() {
    if (controls.isPaused()) return;
    const dish = nearestUnfilledDish(1.0);
    if (!dish) return;
    if (sampleCount <= 0) {
        setPrompt("No samples to culture!");
        return;
    }
    openPetriModal(dish);
}

// thrown bacteria (Q)
const thrownBacteria = [];
const _handLocal = new THREE.Vector3();
function throwSample() {
    // Throw whatever is in the selected slot — cultures (slots 0..N-1)
    // or raw samples (the rest). Empty slot does nothing.
    const total = cultureCount + sampleCount;
    if (selectedSlot >= total) return;
    const isCulture = selectedSlot < cultureCount;
    _handLocal.set(0.45, 1.05, 0.35);
    const handWorld = _handLocal.applyMatrix4(player.matrixWorld);
    let mesh;
    if (isCulture) {
        // flat petri dish projectile with a green colony on top
        mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(0.16, 0.16, 0.05, 20),
            new THREE.MeshStandardMaterial({
                color: 0xdde6ee,
                emissive: 0x2a3a40,
                emissiveIntensity: 0.18,
                roughness: 0.3,
                metalness: 0.05,
            }),
        );
        const colony = new THREE.Mesh(
            new THREE.SphereGeometry(0.06, 12, 8),
            new THREE.MeshStandardMaterial({ color: 0x7ed957, emissive: 0x2c5c1d, emissiveIntensity: 0.5, roughness: 0.6 }),
        );
        colony.scale.set(1.0, 0.45, 1.0);
        colony.position.y = 0.025;
        mesh.add(colony);
    } else {
        mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.13, 14, 10),
            new THREE.MeshStandardMaterial({
                color: 0x7ed957,
                emissive: 0x2c5c1d,
                emissiveIntensity: 0.55,
                roughness: 0.5,
            }),
        );
        mesh.scale.set(1.5, 0.95, 1.5);
    }
    mesh.position.copy(handWorld);
    mesh.castShadow = true;
    scene.add(mesh);
    const yaw = player.rotation.y;
    const speed = 8;
    thrownBacteria.push({
        mesh,
        vx: Math.sin(yaw) * speed,
        vz: Math.cos(yaw) * speed,
        vy: 5,
        age: 0,
        settled: false,
    });
    if (isCulture) cultureCount -= 1;
    else sampleCount -= 1;
    const newTotal = cultureCount + sampleCount;
    if (selectedSlot >= newTotal) selectedSlot = Math.max(0, newTotal - 1);
    persistInventory();
    updateHotbar();
}

function updateThrown(dt) {
    for (let i = thrownBacteria.length - 1; i >= 0; i--) {
        const p = thrownBacteria[i];
        p.age += dt;
        if (!p.settled) {
            p.vy -= 22 * dt;
            p.mesh.position.x += p.vx * dt;
            p.mesh.position.y += p.vy * dt;
            p.mesh.position.z += p.vz * dt;
            p.mesh.rotation.x += dt * 6;
            p.mesh.rotation.y += dt * 4;
            // wall bounce inside lab bounds
            if (p.mesh.position.x < bounds.minX + 0.15) {
                p.mesh.position.x = bounds.minX + 0.15;
                p.vx = -p.vx * 0.4;
            } else if (p.mesh.position.x > bounds.maxX - 0.15) {
                p.mesh.position.x = bounds.maxX - 0.15;
                p.vx = -p.vx * 0.4;
            }
            if (p.mesh.position.z < bounds.minZ + 0.15) {
                p.mesh.position.z = bounds.minZ + 0.15;
                p.vz = -p.vz * 0.4;
            } else if (p.mesh.position.z > bounds.maxZ - 0.15) {
                p.mesh.position.z = bounds.maxZ - 0.15;
                p.vz = -p.vz * 0.4;
            }
            if (p.mesh.position.y <= 0.13) {
                p.mesh.position.y = 0.13;
                p.vx *= 0.45;
                p.vz *= 0.45;
                p.vy = -p.vy * 0.35;
                if (Math.abs(p.vy) < 0.5 && Math.hypot(p.vx, p.vz) < 0.3) {
                    p.settled = true;
                    p.vx = p.vy = p.vz = 0;
                }
            }
        } else {
            p.mesh.rotation.y += dt * 0.6;
            p.mesh.position.y = 0.13 + Math.sin(p.age * 3) * 0.02;
        }
        if (p.age > 0.5) {
            const dx = player.position.x - p.mesh.position.x;
            const dz = player.position.z - p.mesh.position.z;
            if (Math.hypot(dx, dz) < 0.7) {
                scene.remove(p.mesh);
                p.mesh.geometry.dispose();
                p.mesh.material.dispose();
                thrownBacteria.splice(i, 1);
                sampleCount += 1;
                updateHotbar();
                persistInventory();
                const original = promptInner.textContent;
                setPrompt("Picked up!");
                setTimeout(() => {
                    if (promptInner.textContent === "Picked up!") setPrompt(original);
                }, 900);
                continue;
            }
        }
        if (p.age > 60) {
            scene.remove(p.mesh);
            p.mesh.geometry.dispose();
            p.mesh.material.dispose();
            thrownBacteria.splice(i, 1);
        }
    }
}

// resize
function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// main loop — MOVE_SPEED now lives in controls.params (shared with the
// outdoor scene's sliders).
const PLAYER_RADIUS = 0.4;
let walkPhase = 0;
let lastFootstepStep = 0;
const jumpState = { vy: 0, grounded: true };
let last = performance.now();
function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const moveResult = controls.applyMovement(dt, player, { sprint: false });
    const moving = moveResult.moved;
    player.position.x = Math.max(
        bounds.minX + PLAYER_RADIUS,
        Math.min(bounds.maxX - PLAYER_RADIUS, player.position.x),
    );
    player.position.z = Math.max(
        bounds.minZ + PLAYER_RADIUS,
        Math.min(bounds.maxZ - PLAYER_RADIUS, player.position.z),
    );
    resolveLabColliders();

    // jump + gravity (Space binding lives in the keydown handler above)
    controls.applyJump(dt, player, jumpState, { onLand: playFootstep });

    // walk bob, hand bob, footsteps
    if (moving) {
        walkPhase += dt * 9;
        body.position.y = 0.9 + Math.sin(walkPhase) * 0.06;
        head.position.y = 1.7 + Math.sin(walkPhase) * 0.05;
        const stepCount = Math.floor(walkPhase / Math.PI);
        if (stepCount > lastFootstepStep) {
            playFootstep();
            lastFootstepStep = stepCount;
        }
    } else {
        walkPhase = 0;
        lastFootstepStep = 0;
        body.position.y += (0.9 - body.position.y) * Math.min(1, dt * 8);
        head.position.y += (1.7 - head.position.y) * Math.min(1, dt * 8);
    }
    if (handBacteria.visible) {
        handBacteria.position.y = 1.05 + Math.sin(now / 1000 * 2.4) * 0.05;
        handBacteria.rotation.y += dt * 1.6;
    }

    controls.syncFP(playerRig, () => selectedSlot < cultureCount + sampleCount);

    // shared third-person / orbit / first-person camera
    controls.updateCamera(dt, player, camera, {
        followHeight: 5.5,
        followDist: 8,
        targetOffset: 1.2,
    });

    // fade only the wall(s) between camera and player
    if (wallMatsBySide) {
        const cdx = camera.position.x - player.position.x;
        const cdz = camera.position.z - player.position.z;
        const targets = {
            north: cdz < -1 ? 0.05 : 1, // camera is north → north wall blocks view
            south: cdz > 1 ? 0.05 : 1,
            west:  cdx < -1 ? 0.05 : 1,
            east:  cdx > 1 ? 0.05 : 1,
            interior: 1,
        };
        for (const side in wallMatsBySide) {
            const m = wallMatsBySide[side];
            const target = targets[side];
            m.opacity += (target - m.opacity) * Math.min(1, dt * 6);
            const isFading = m.opacity < 0.99;
            if (m.transparent !== isFading) {
                m.transparent = isFading;
                m.needsUpdate = true;
            }
            m.depthWrite = m.opacity > 0.5;
        }
    }

    updateThrown(dt);
    updateLabPrompt(dt);
    updateOpenableLocker(dt);

    // animated monitor
    updateMonitor(now);

    // candle flicker
    const tSec = now / 1000;
    for (const c of candles) {
        const f =
            0.82 +
            Math.sin(tSec * 11 + c.phase) * 0.07 +
            Math.sin(tSec * 23 + c.jitterPhase) * 0.05 +
            (Math.random() - 0.5) * 0.04;
        c.light.intensity = c.base * f;
        c.flame.scale.setScalar(0.85 + f * 0.25);
    }

    controls.updatePromptPosition(player, camera, promptEl, renderer);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
