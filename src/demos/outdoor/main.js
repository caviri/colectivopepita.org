import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { getInventory, saveInventory, resetGame } from "../../inventory.js";
import { dataURL, loadOBJ, loadTexture, fitToFloor, centerScale, onLoadProgress, getLoadStats } from "../../assets.js";
import * as controls from "../../controls.js";
import { createMenu } from "../../menu.js";
import { createManual } from "../../manual.js";
import { mountTodoList } from "../../todo.js";
import { exportScene } from "../../engine/core/export.js";

const WORLD_RADIUS = 50;
const FOG_NEAR = 28;
const FOG_FAR = 58;
const PLAY_RADIUS = WORLD_RADIUS - 4;
const ICE_ZONE_ANGLE = Math.PI * 0.5;
const ICE_ZONE_HALF_WIDTH = Math.PI * 0.22;
const SPAWN = new THREE.Vector3(0, 0, 6);

const canvas = document.getElementById("game");
let renderer;
try {
    renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false, // antialias doubles GPU memory; off helps avoid context-loss blocking
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
            '<h1>WebGL unavailable</h1><p>Close other tabs and refresh — Chrome blocked a new GL context.</p>';
    }
    throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    console.warn("WebGL context lost — pausing");
});
canvas.addEventListener("webglcontextrestored", () => {
    console.warn("WebGL context restored");
});

const scene = new THREE.Scene();
// Expose for dev tools and the scene exporter.
window.scene = scene;
scene.background = new THREE.Color(0x7a8693);
scene.fog = new THREE.Fog(0x7a8693, FOG_NEAR, FOG_FAR);
// Stash initial env values for the exporter — the cloud loop modulates
// scene.background / scene.fog.color / sun.intensity at runtime, so reading
// them at export time would capture mid-drift values, not the player's
// first-frame view.
scene.userData.initialEnv = {
    background: 0x7a8693,
    fog: { color: 0x7a8693, near: FOG_NEAR, far: FOG_FAR },
};
// night palette — moonlit silvery sky drifting between brighter and darker patches
const fogColorBright = new THREE.Color(0x2c3650);
const fogColorShadow = new THREE.Color(0x0e1525);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);

// --- lighting ----------------------------------------------------------
// "moonlight" hemi — cool blue from the sky, deep slate from the ground
const hemi = new THREE.HemisphereLight(0x6e7da0, 0x10141e, 0.35);
scene.add(hemi);

// the moon casts the directional light. baseFov stays warm-cool to keep
// snow readable under low intensity.
const sun = new THREE.DirectionalLight(0x9eb0d8, 0.25);
sun.position.set(20, 35, 12);
sun.userData.initialIntensity = 0.25;
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40;
sun.shadow.camera.bottom = -40;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 80;
scene.add(sun);

// --- moon, stars, and the player's headlamp ---------------------------
// big bright sphere parked behind the play area, slightly above the horizon
const moon = new THREE.Mesh(
    new THREE.SphereGeometry(8, 32, 24),
    new THREE.MeshBasicMaterial({ color: 0xfaf5e6 }),
);
moon.position.set(-30, 50, -50);
scene.add(moon);
// soft halo behind the moon so it doesn't look like a flat disc
const moonHalo = new THREE.Mesh(
    new THREE.SphereGeometry(13, 24, 16),
    new THREE.MeshBasicMaterial({
        color: 0xc8d4ff,
        transparent: true,
        opacity: 0.16,
    }),
);
moonHalo.position.copy(moon.position);
scene.add(moonHalo);

// scattered points across a dome — quick & cheap starfield
(function addStars() {
    const starCount = 1200;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
        // random direction on a sphere, push outward to skybox radius
        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        // bias toward upper hemisphere
        const y = Math.abs(Math.cos(phi)) * 0.9 + 0.05;
        const r = 90;
        positions[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
        positions[i * 3 + 1] = y * r;
        positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const stars = new THREE.Points(
        geom,
        new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.6,
            sizeAttenuation: false,
            transparent: true,
            opacity: 0.85,
        }),
    );
    scene.add(stars);
})();

// the player's headlamp — a spotlight anchored at the head, pointing along
// the camera's yaw + pitch each frame so wherever you look gets lit.
const headlamp = new THREE.SpotLight(0xfff5dc, 6, 30, Math.PI / 5, 0.45, 1.4);
headlamp.castShadow = true;
headlamp.shadow.mapSize.set(1024, 1024);
headlamp.shadow.camera.near = 0.5;
headlamp.shadow.camera.far = 30;
const headlampTarget = new THREE.Object3D();
scene.add(headlamp);
scene.add(headlampTarget);
headlamp.target = headlampTarget;

// --- world wrapper (everything outside the lab interior) --------------
const worldGroup = new THREE.Group();
scene.add(worldGroup);

// --- procedural noise texture (used for snow + cloud light noise) -----
function makeValueNoiseTexture(size = 256, cells = 16) {
    const grid = new Float32Array(cells * cells);
    for (let i = 0; i < grid.length; i++) grid[i] = Math.random();
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(size, size);
    const smooth = (t) => t * t * (3 - 2 * t);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const fx = (x / size) * cells;
            const fy = (y / size) * cells;
            const x0 = Math.floor(fx) % cells;
            const y0 = Math.floor(fy) % cells;
            const x1 = (x0 + 1) % cells;
            const y1 = (y0 + 1) % cells;
            const sx = smooth(fx - Math.floor(fx));
            const sy = smooth(fy - Math.floor(fy));
            const a = grid[y0 * cells + x0];
            const b = grid[y0 * cells + x1];
            const cc = grid[y1 * cells + x0];
            const d = grid[y1 * cells + x1];
            const ab = a + (b - a) * sx;
            const cd = cc + (d - cc) * sx;
            const v = ab + (cd - ab) * sy;
            const jitter = (Math.random() - 0.5) * 0.06;
            const g = Math.max(0, Math.min(1, v * 0.85 + 0.15 + jitter));
            const idx = (y * size + x) * 4;
            const px = Math.floor(200 + g * 55);
            img.data[idx] = img.data[idx + 1] = img.data[idx + 2] = px;
            img.data[idx + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

const snowNoiseTex = makeValueNoiseTexture(256, 16);
snowNoiseTex.repeat.set(10, 10);

// --- snow terrain ------------------------------------------------------
// Gentle hills via low-frequency sum-of-sines. Used both for vertex
// displacement and to look up "ground height" for the player so they
// follow the contours instead of clipping through hilltops.
function snowHeight(x, z) {
    return (
        0.5 * Math.sin(x * 0.05) * Math.cos(z * 0.04) +
        0.28 * Math.sin(x * 0.11 + 0.7) * Math.cos(z * 0.09 + 1.2) +
        0.12 * Math.sin(x * 0.21 + 1.4) * Math.cos(z * 0.18 + 0.5)
    );
}

const snowMat = new THREE.MeshStandardMaterial({
    color: 0xf6fbff,
    map: snowNoiseTex,
    bumpMap: snowNoiseTex,
    bumpScale: 0.06,
    roughness: 0.95,
    metalness: 0,
    vertexColors: true,
});
// square plane wider than the play radius — fog hides the corners. Plenty
// of segments so displacement reads as smooth contours.
const snowGeo = new THREE.PlaneGeometry(WORLD_RADIUS * 2.2, WORLD_RADIUS * 2.2, 96, 96);
{
    const pos = snowGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        // Plane is rotated -π/2 around X when added to the scene, so a
        // vertex's local +Y axis maps to world -Z. We need to sample
        // snowHeight at the *world* z (= -y) here so that the mesh and
        // the runtime samplers (player ground-snap, penguin terrain
        // following) agree on the surface — otherwise penguins clip into
        // hills that don't exist in the height function they sample.
        const h = snowHeight(x, -y);
        pos.setZ(i, h);
        // topographic banding: darken every ~0.2 m elevation step
        const band = (h + 5) % 0.22; // shifted so hills + valleys both band
        const lineWidth = 0.04;
        const isLine = band < lineWidth;
        const baseTone = 0.93 + h * 0.05; // slightly lighter on peaks
        const tone = isLine ? baseTone * 0.78 : baseTone;
        colors[i * 3] = tone;
        colors[i * 3 + 1] = tone;
        colors[i * 3 + 2] = Math.min(1, tone + 0.02); // hint of cool blue
    }
    snowGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    snowGeo.computeVertexNormals();
}
const snow = new THREE.Mesh(snowGeo, snowMat);
snow.rotation.x = -Math.PI / 2;
snow.receiveShadow = true;
worldGroup.add(snow);

// --- falling snow particles -------------------------------------------
// Atmospheric flurry around the player. We track a column of points that
// recycles to the top when a flake lands or drifts out of the player's
// neighbourhood — this lets us use a small particle count (~600) while
// still feeling "everywhere", since we only render flakes the player can
// actually see. Particles fade with the existing scene.fog automatically.
function makeSnowflakeTexture() {
    const sz = 64;
    const c = document.createElement("canvas");
    c.width = c.height = sz;
    const ctx = c.getContext("2d");
    const grad = ctx.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2);
    grad.addColorStop(0, "rgba(255,255,255,0.95)");
    grad.addColorStop(0.45, "rgba(255,255,255,0.4)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, sz, sz);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

const SNOW_COUNT = 600;
const SNOW_RADIUS = 20;     // around player
const SNOW_TOP_Y = 14;
const SNOW_BOTTOM_Y = 0.0;
const snowFlakeGeom = new THREE.BufferGeometry();
const snowPositions = new Float32Array(SNOW_COUNT * 3);
const snowFallSpeed = new Float32Array(SNOW_COUNT);  // y-velocity
const snowSeed = new Float32Array(SNOW_COUNT);       // per-flake jitter phase
for (let i = 0; i < SNOW_COUNT; i++) {
    snowPositions[i * 3]     = (Math.random() - 0.5) * SNOW_RADIUS * 2;
    snowPositions[i * 3 + 1] = Math.random() * SNOW_TOP_Y;
    snowPositions[i * 3 + 2] = (Math.random() - 0.5) * SNOW_RADIUS * 2;
    snowFallSpeed[i] = 0.6 + Math.random() * 0.9; // 0.6..1.5 m/s
    snowSeed[i] = Math.random() * Math.PI * 2;
}
snowFlakeGeom.setAttribute("position", new THREE.BufferAttribute(snowPositions, 3));
const snowFlakeMat = new THREE.PointsMaterial({
    map: makeSnowflakeTexture(),
    size: 0.22,
    transparent: true,
    depthWrite: false,
    fog: true,
    sizeAttenuation: true,
    color: 0xffffff,
    opacity: 0.85,
});
const snowFlakes = new THREE.Points(snowFlakeGeom, snowFlakeMat);
worldGroup.add(snowFlakes);

let weatherWindX = 0;
let weatherWindZ = 0;
function updateSnow(dt, now) {
    const t = now / 1000;
    // slow wandering wind direction. Two sines at irrational ratios keeps
    // it from looping on a perceptible cycle. During a gust event the
    // existing windCooldown counter pushes particles harder along the same
    // direction so they read as part of the same gust the player hears.
    weatherWindX = Math.sin(t * 0.14) * 0.6 + Math.sin(t * 0.071 + 1.3) * 0.3;
    weatherWindZ = Math.cos(t * 0.11) * 0.6 + Math.cos(t * 0.063 + 0.7) * 0.3;
    const gustBoost = windCooldown > 0 ? Math.min(2.5, windCooldown) : 0;
    const wx = weatherWindX * (1 + gustBoost * 1.2);
    const wz = weatherWindZ * (1 + gustBoost * 1.2);
    const px = player.position.x;
    const pz = player.position.z;
    const arr = snowPositions;
    const r2 = SNOW_RADIUS * SNOW_RADIUS;
    for (let i = 0; i < SNOW_COUNT; i++) {
        const ix = i * 3;
        // sine flutter so each flake takes its own path down
        const flx = Math.sin(t * 1.6 + snowSeed[i]) * 0.4;
        const flz = Math.cos(t * 1.3 + snowSeed[i] + 0.7) * 0.4;
        arr[ix]     += (wx + flx) * dt * 0.6;
        arr[ix + 1] -= snowFallSpeed[i] * dt;
        arr[ix + 2] += (wz + flz) * dt * 0.6;
        // recycle: respawn at top when it lands or drifts out of range
        const dxF = arr[ix] - px;
        const dzF = arr[ix + 2] - pz;
        if (
            arr[ix + 1] < SNOW_BOTTOM_Y ||
            dxF * dxF + dzF * dzF > r2
        ) {
            arr[ix]     = px + (Math.random() - 0.5) * SNOW_RADIUS * 2;
            arr[ix + 1] = SNOW_TOP_Y - Math.random() * 2;
            arr[ix + 2] = pz + (Math.random() - 0.5) * SNOW_RADIUS * 2;
        }
    }
    snowFlakeGeom.attributes.position.needsUpdate = true;
}

// --- footprint trail decals -------------------------------------------
// Both the player and the penguins drop footprints as they walk. We pool
// a fixed number of decal planes that fade out over their lifetime; once
// faded they're invisible and reusable. Boot prints are larger + longer
// lived; penguin paw prints are smaller. The pool size caps memory and
// frame cost — when full, the oldest is recycled.
function makeFootprintTexture(kind) {
    const sz = 64;
    const c = document.createElement("canvas");
    c.width = c.height = sz;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, sz, sz);
    if (kind === "boot") {
        // sole shape: tall oval with a separate heel circle
        ctx.fillStyle = "rgba(28, 38, 60, 0.85)";
        ctx.beginPath();
        ctx.ellipse(sz / 2, sz * 0.42, sz * 0.22, sz * 0.32, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(sz / 2, sz * 0.78, sz * 0.18, sz * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();
    } else {
        // penguin paw: three small toes + a heel pad
        ctx.fillStyle = "rgba(40, 28, 18, 0.82)";
        for (const [tx, ty, tr] of [
            [sz * 0.35, sz * 0.35, sz * 0.10],
            [sz * 0.50, sz * 0.30, sz * 0.10],
            [sz * 0.65, sz * 0.35, sz * 0.10],
        ]) {
            ctx.beginPath();
            ctx.arc(tx, ty, tr, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.beginPath();
        ctx.ellipse(sz / 2, sz * 0.62, sz * 0.18, sz * 0.14, 0, 0, Math.PI * 2);
        ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

const bootFootTex = makeFootprintTexture("boot");
const pawFootTex = makeFootprintTexture("paw");

const FOOTPRINT_POOL = 80;
const footprints = [];
for (let i = 0; i < FOOTPRINT_POOL; i++) {
    const mat = new THREE.MeshBasicMaterial({
        map: bootFootTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.015;     // hover just above the snow to avoid z-fighting
    mesh.visible = false;
    worldGroup.add(mesh);
    footprints.push({ mesh, mat, age: 0, lifetime: 0 });
}

function dropFootprint(x, z, yaw, kind) {
    // pick a free print, otherwise recycle the oldest
    let target = null;
    let oldest = null;
    let oldestAge = -Infinity;
    for (const fp of footprints) {
        if (!fp.mesh.visible) { target = fp; break; }
        if (fp.age > oldestAge) { oldestAge = fp.age; oldest = fp; }
    }
    if (!target) target = oldest;
    if (!target) return;
    const isPaw = kind === "paw";
    target.mat.map = isPaw ? pawFootTex : bootFootTex;
    target.mat.opacity = isPaw ? 0.6 : 0.7;
    target.mat.needsUpdate = true;
    target.mesh.position.set(x, 0.015, z);
    // mesh.rotation.x is fixed at -π/2 (lying flat). After that rotation
    // the plane's local +Y points to world -Z, so we add π so the texture's
    // "up" (toes of the boot) lines up with the walker's forward direction.
    target.mesh.rotation.z = Math.PI + yaw;
    target.mesh.scale.set(isPaw ? 0.32 : 0.42, isPaw ? 0.32 : 0.55, 1);
    target.mesh.visible = true;
    target.age = 0;
    target.lifetime = isPaw ? 12 : 22;
}

function updateFootprints(dt) {
    for (const fp of footprints) {
        if (!fp.mesh.visible) continue;
        fp.age += dt;
        if (fp.age >= fp.lifetime) {
            fp.mesh.visible = false;
            fp.mat.opacity = 0;
        } else {
            // hold full opacity for the first 30% of life, then fade out
            const fade = fp.age / fp.lifetime;
            const initial = fp.mat.map === pawFootTex ? 0.6 : 0.7;
            fp.mat.opacity = fade < 0.3 ? initial : initial * (1 - (fade - 0.3) / 0.7);
        }
    }
}

// --- heart particles (penguin click reaction) ------------------------
// Tiny pool of heart sprites. Each spawn (3 hearts on a click) puts them
// near the penguin's chest with random upward + sideways velocity, slight
// horizontal wobble per frame, fading out as they rise — bubble-like.
function makeHeartTexture() {
    const sz = 64;
    const c = document.createElement("canvas");
    c.width = c.height = sz;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ff5577";
    ctx.beginPath();
    ctx.arc(sz * 0.32, sz * 0.36, sz * 0.18, 0, Math.PI * 2);
    ctx.arc(sz * 0.68, sz * 0.36, sz * 0.18, 0, Math.PI * 2);
    ctx.moveTo(sz * 0.16, sz * 0.45);
    ctx.lineTo(sz * 0.5, sz * 0.86);
    ctx.lineTo(sz * 0.84, sz * 0.45);
    ctx.fill();
    // soft white inner highlight so the heart reads at small scales
    ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
    ctx.beginPath();
    ctx.ellipse(sz * 0.36, sz * 0.32, sz * 0.06, sz * 0.04, -0.4, 0, Math.PI * 2);
    ctx.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}
const heartTex = makeHeartTexture();
const HEART_POOL = 24;
const hearts = [];
for (let i = 0; i < HEART_POOL; i++) {
    const mat = new THREE.MeshBasicMaterial({
        map: heartTex,
        transparent: true,
        depthWrite: false,
        opacity: 0,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), mat);
    mesh.visible = false;
    worldGroup.add(mesh);
    hearts.push({
        mesh, mat,
        age: 0, lifetime: 0,
        vx: 0, vy: 0, vz: 0,
        wobble: 0,
        attachedTo: null,        // penguin while it's still jumping
        attachOffsetX: 0,
        attachOffsetY: 0,
        attachOffsetZ: 0,
    });
}
function spawnHearts(x, y, z, count = 3, attachedTo = null) {
    let placed = 0;
    for (const h of hearts) {
        if (placed >= count) break;
        if (h.mesh.visible) continue;
        h.mesh.position.set(
            x + (Math.random() - 0.5) * 0.3,
            y + Math.random() * 0.2,
            z + (Math.random() - 0.5) * 0.3,
        );
        // Per-heart offset relative to the chest while attached. Picked at
        // spawn so each heart settles into a slightly different spot.
        h.attachedTo = attachedTo;
        h.attachOffsetX = (Math.random() - 0.5) * 0.3;
        h.attachOffsetY = 0.55 + Math.random() * 0.18;
        h.attachOffsetZ = (Math.random() - 0.5) * 0.3;
        // Velocity used after detaching from the penguin — bumped from
        // 0.55–0.9 to 1.5–2.1 so the hearts rocket upward instead of
        // floating gently.
        h.vx = (Math.random() - 0.5) * 0.7;
        h.vy = 1.5 + Math.random() * 0.6;
        h.vz = (Math.random() - 0.5) * 0.7;
        h.wobble = Math.random() * Math.PI * 2;
        h.age = 0;
        h.lifetime = 2.4 + Math.random() * 0.4;
        h.mat.opacity = 1;
        h.mesh.scale.setScalar(0.6 + Math.random() * 0.3);
        h.mesh.visible = true;
        placed++;
    }
}
function updateHearts(dt) {
    const tSec = performance.now() / 1000;
    for (const h of hearts) {
        if (!h.mesh.visible) continue;
        h.age += dt;
        if (h.age >= h.lifetime) {
            h.mesh.visible = false;
            h.mat.opacity = 0;
            continue;
        }
        // Phase 1: tracking the penguin's chest while it hops. The hearts
        // EASE toward the target instead of snapping to it — that softness
        // is the "air drag" the user asked for, so the hearts visibly lag
        // behind each peak of the jump.
        if (h.attachedTo && tSec < h.attachedTo.jumpUntil) {
            const tx = h.attachedTo.mesh.position.x + h.attachOffsetX;
            const ty = h.attachedTo.mesh.position.y + h.attachOffsetY;
            const tz = h.attachedTo.mesh.position.z + h.attachOffsetZ;
            // Stiffer tracking (was 6 → 14) so hearts keep up with the
            // penguin's hops instead of lagging behind every peak.
            const k = Math.min(1, 14 * dt);
            h.mesh.position.x += (tx - h.mesh.position.x) * k;
            h.mesh.position.y += (ty - h.mesh.position.y) * k;
            h.mesh.position.z += (tz - h.mesh.position.z) * k;
            h.mesh.lookAt(camera.position);
            // hold full opacity through the attached phase — fade only
            // starts once they detach
            h.mat.opacity = 1;
            continue;
        }
        // Phase 2: detached — drift with the wind and rise like bubbles.
        if (h.attachedTo) {
            // first detached frame — keep the spawn velocities and let
            // the wind take over from there
            h.attachedTo = null;
        }
        // Wind influence + air drag — vx eases toward wind*0.5 with time
        // constant ~0.33 s. Same `weatherWindX/Z` driving the snow + flag.
        const k = Math.min(1, 3 * dt);
        h.vx += (weatherWindX * 0.5 - h.vx) * k;
        h.vz += (weatherWindZ * 0.5 - h.vz) * k;
        h.mesh.position.x += h.vx * dt + Math.sin(h.age * 5 + h.wobble) * 0.005;
        h.mesh.position.y += h.vy * dt;
        h.mesh.position.z += h.vz * dt;
        h.vy *= 0.992; // very gentle decel — keep the upward zip alive
        h.mesh.lookAt(camera.position);
        // Fade: full opacity through the first 60% of life, then to 0
        const fade = h.age / h.lifetime;
        h.mat.opacity = fade < 0.6 ? 1 : (1 - fade) / 0.4;
        h.mesh.scale.setScalar(0.6 + h.age * 0.35);
    }
}

// raycast against penguins for click reaction
const _penguinRay = new THREE.Raycaster();
const _penguinNDC = new THREE.Vector2();
function raycastPenguin(clientX, clientY) {
    if (!penguins.length) return null;
    const rect = canvas.getBoundingClientRect();
    if (controls.isFP()) {
        _penguinNDC.set(0, 0); // crosshair (centre) in first-person
    } else {
        _penguinNDC.set(
            ((clientX - rect.left) / rect.width) * 2 - 1,
            -((clientY - rect.top) / rect.height) * 2 + 1,
        );
    }
    _penguinRay.setFromCamera(_penguinNDC, camera);
    const meshes = penguins.map((p) => p.mesh);
    const hits = _penguinRay.intersectObjects(meshes, true);
    if (!hits.length) return null;
    // walk up the parent chain of the first hit until we find a penguin root
    let node = hits[0].object;
    while (node) {
        const found = penguins.find((p) => p.mesh === node);
        if (found) return found;
        node = node.parent;
    }
    return null;
}
function delightPenguin(p) {
    const t = performance.now() / 1000;
    p.jumpStart = t;
    p.jumpUntil = t + 1.4;            // ~3 hops in 1.4 s
    p.idleUntil = p.jumpUntil + 0.2;  // small recovery before resuming AI
    const chest = p.mesh.position.y + 0.6;
    // attached to the penguin so they lag-track the hops; they detach and
    // bubble away once jumpUntil passes
    spawnHearts(p.mesh.position.x, chest, p.mesh.position.z, 3, p);
    playKiss();
}

// gentle bumps so the disc reads as terrain rather than a flat plate
const bumpColliders = [];
for (let i = 0; i < 40; i++) {
    const r = Math.random() * (WORLD_RADIUS - 6) + 4;
    const a = Math.random() * Math.PI * 2;
    const s = 0.6 + Math.random() * 1.6;
    const bump = new THREE.Mesh(
        new THREE.SphereGeometry(s, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xeef6fb, roughness: 1 }),
    );
    const bx = Math.cos(a) * r;
    const bz = Math.sin(a) * r;
    bump.position.set(bx, -s * 0.6, bz);
    bump.castShadow = true;
    bump.receiveShadow = true;
    worldGroup.add(bump);
    // ground-level slice radius of the half-buried sphere
    bumpColliders.push({ x: bx, z: bz, r: s * 0.7 });
}

// --- ice wall sector (sample zone) ------------------------------------
const iceGroup = new THREE.Group();
worldGroup.add(iceGroup);

const iceNoiseTex = makeValueNoiseTexture(256, 24);
iceNoiseTex.repeat.set(2, 2);
const iceMat = new THREE.MeshStandardMaterial({
    color: 0x7fb5d6,
    map: iceNoiseTex,
    bumpMap: iceNoiseTex,
    bumpScale: 0.12,
    roughness: 0.55,
    metalness: 0.1,
    emissive: 0x14334a,
    emissiveIntensity: 0.15,
});

const blockColliders = [];

// Things that should cast a ground-shadow on the minimap. Each entry is
// either a rotated rectangle (`{type:"rect", x, z, hw, hd, angle, color}`)
// or a circle (`{type:"circle", x, z, r, color}`). Pushed lazily as props
// are added below — never includes the play boundary, ice blocks, or snow
// bumps (too small to be useful and would drown the map in noise).
const mapShadows = [];

// Visible bacteria sample sitting on top of each ice block. Removed when
// the player finishes mining that block. Tracked in iceSamples so the
// mining handler can find the closest live one to the player.
const sampleMat = new THREE.MeshStandardMaterial({
    color: 0xb8f08a,
    emissive: 0x4ea024,
    emissiveIntensity: 0.7,
    roughness: 0.45,
    metalness: 0.0,
});
const sampleGeom = new THREE.SphereGeometry(0.22, 16, 12);
const iceSamples = []; // { mesh, x, z, topY, alive }

const ICE_BLOCKS = 14;
for (let i = 0; i < ICE_BLOCKS; i++) {
    const t = (i / (ICE_BLOCKS - 1)) * 2 - 1; // -1..1 across the arc
    const a = ICE_ZONE_ANGLE + t * ICE_ZONE_HALF_WIDTH;
    const r = WORLD_RADIUS - 6 - Math.random() * 1.5;
    const w = 2.4 + Math.random() * 1.8;
    const h = 2.2 + Math.random() * 2.6;
    const d = 1.6 + Math.random() * 1.4;
    const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), iceMat);
    const bx = Math.cos(a) * r;
    const bz = Math.sin(a) * r;
    const angle = a + Math.PI / 2 + (Math.random() - 0.5) * 0.4;
    block.position.set(bx, h / 2 - 0.2, bz);
    block.rotation.y = angle;
    block.castShadow = true;
    block.receiveShadow = true;
    iceGroup.add(block);
    blockColliders.push({
        x: bx, z: bz,
        hw: w / 2, hd: d / 2,
        cos: Math.cos(angle), sin: Math.sin(angle),
    });

    // sample sphere on the inward face of the block (player-facing side),
    // at chest-height — easier to reach + readable from outside the arc
    const distFromOrigin = Math.hypot(bx, bz);
    const inwardX = -bx / distFromOrigin;
    const inwardZ = -bz / distFromOrigin;
    const off = d / 2 + 0.18;
    const sideY = block.position.y; // mid-height of the block
    const sample = new THREE.Mesh(sampleGeom, sampleMat);
    sample.position.set(bx + inwardX * off, sideY, bz + inwardZ * off);
    sample.castShadow = true;
    iceGroup.add(sample);
    iceSamples.push({
        mesh: sample,
        x: sample.position.x,
        z: sample.position.z,
        sideY,
        alive: true,
    });
}

// invisible zone marker used for proximity checks
const iceZoneCenter = new THREE.Vector3(
    Math.cos(ICE_ZONE_ANGLE) * (WORLD_RADIUS - 7),
    0,
    Math.sin(ICE_ZONE_ANGLE) * (WORLD_RADIUS - 7),
);

// --- central lab container (the door / exterior) ----------------------
const LAB_W = 11, LAB_H = 4.4, LAB_D = 6;
const labGroup = new THREE.Group();
worldGroup.add(labGroup);

const labBody = new THREE.Mesh(
    new THREE.BoxGeometry(LAB_W, LAB_H, LAB_D),
    new THREE.MeshStandardMaterial({ color: 0xb84a3a, roughness: 0.8, metalness: 0.1 }),
);
labBody.position.y = LAB_H / 2;
labBody.castShadow = true;
labBody.receiveShadow = true;
labGroup.add(labBody);

// door panel hint (front-facing toward spawn at +z)
const door = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 2.6),
    new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 1 }),
);
door.position.set(0, 1.5, LAB_D / 2 + 0.01);
labGroup.add(door);

// roof stripe so it reads as a container
const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(LAB_W + 0.05, 0.16, LAB_D + 0.05),
    new THREE.MeshStandardMaterial({ color: 0xf6f6f6, roughness: 0.6 }),
);
stripe.position.y = LAB_H + 0.05;
labGroup.add(stripe);

// exterior collider: keep the player from walking through the lab walls
blockColliders.push({
    x: 0, z: 0,
    hw: LAB_W / 2, hd: LAB_D / 2,
    cos: 1, sin: 0,
});
mapShadows.push({
    type: "rect", x: 0, z: 0,
    hw: LAB_W / 2, hd: LAB_D / 2, angle: 0,
    color: "#b84a3a",
});

const labCenter = new THREE.Vector3(0, 0, 0);

// --- Juan Carlos I station logo on the front face --------------------
// each of the 4 OBJ files is one part of the emblem, painted in a distinct
// colour so it actually reads like a flag/crest from across the world.
export const JC_LOGO_PART_MATS = [
    new THREE.MeshStandardMaterial({ color: 0xfaf2dc, roughness: 0.5, metalness: 0.2, emissive: 0x332200, emissiveIntensity: 0.18 }), // ivory
    new THREE.MeshStandardMaterial({ color: 0x1f3d80, roughness: 0.55, metalness: 0.2, emissive: 0x0a1a3a, emissiveIntensity: 0.12 }), // navy blue
    new THREE.MeshStandardMaterial({ color: 0xc8302e, roughness: 0.55, metalness: 0.2, emissive: 0x4a1010, emissiveIntensity: 0.12 }), // Spanish red
    new THREE.MeshStandardMaterial({ color: 0xffd633, roughness: 0.45, metalness: 0.4, emissive: 0x664400, emissiveIntensity: 0.18 }), // gold
];
const logoHolder = new THREE.Group();
logoHolder.position.set(0, LAB_H * 0.78, LAB_D / 2 + 0.05);
labGroup.add(logoHolder);
(function loadLogo() {
    const inner = new THREE.Group();
    logoHolder.add(inner);
    const promises = [];
    for (let i = 0; i < 4; i++) {
        promises.push(
            loadOBJ(
                dataURL(
                    "Logo of the _Juan Carlos I_ station",
                    `models/model_${i}.obj`,
                ),
                (m) => {
                    m.material = JC_LOGO_PART_MATS[i];
                    m.castShadow = true;
                },
            ),
        );
    }
    Promise.all(promises).then((groups) => {
        for (const g of groups) if (g) inner.add(g);
        // logo OBJs are Y-up flat plaques — centerScale handles the
        // scale-then-center math correctly (see assets.js for the why).
        centerScale(inner, 2.4);
    });
})();

// --- outdoor decoration -------------------------------------------------
let antarcticMan = null;

function makeSpanishFlagTexture() {
    const c = document.createElement("canvas");
    c.width = 600;
    c.height = 400;
    const ctx = c.getContext("2d");
    // top red band (1/4)
    ctx.fillStyle = "#aa151b";
    ctx.fillRect(0, 0, 600, 100);
    // yellow band (1/2)
    ctx.fillStyle = "#f1bf00";
    ctx.fillRect(0, 100, 600, 200);
    // bottom red band (1/4)
    ctx.fillStyle = "#aa151b";
    ctx.fillRect(0, 300, 600, 100);
    // simple coat-of-arms shield in the yellow band
    ctx.fillStyle = "#aa151b";
    ctx.beginPath();
    ctx.ellipse(180, 200, 36, 50, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f1bf00";
    ctx.fillRect(146, 175, 68, 34);
    ctx.fillStyle = "#aa151b";
    ctx.fillRect(150, 178, 14, 26);
    ctx.fillRect(170, 178, 14, 26);
    ctx.fillRect(190, 178, 14, 26);
    // gold crown on top of shield
    ctx.fillStyle = "#f1bf00";
    ctx.fillRect(160, 145, 40, 8);
    ctx.beginPath();
    ctx.moveTo(165, 145);
    ctx.lineTo(170, 138);
    ctx.lineTo(175, 145);
    ctx.lineTo(180, 138);
    ctx.lineTo(185, 145);
    ctx.lineTo(190, 138);
    ctx.lineTo(195, 145);
    ctx.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

// Two flag poles: Spanish flag and Juan Carlos I station logo plaque.
// flagsToSway → rigid plaques that gently rock around their mount (sign sway).
// clothFlags  → flag-shaped planes that get a per-vertex ripple each frame.
const flagsToSway = [];
const clothFlags = [];
(function addFlags() {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xc8d0d8, roughness: 0.4, metalness: 0.4 });

    // --- pole #1: Spanish flag ---
    const pole1 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 6, 12), poleMat);
    pole1.position.set(-7, 3, 4);
    pole1.castShadow = true;
    worldGroup.add(pole1);
    const flag1 = new THREE.Mesh(
        new THREE.PlaneGeometry(2.0, 1.3, 16, 8),
        new THREE.MeshBasicMaterial({
            map: makeSpanishFlagTexture(),
            side: THREE.DoubleSide,
        }),
    );
    flag1.position.set(-7 + 1.0, 5.4, 4);
    flag1.castShadow = true;
    worldGroup.add(flag1);
    bumpColliders.push({ x: -7, z: 4, r: 0.4 });
    // hoist edge is at local x = -1 (left of the plane) where it attaches to
    // the pole; fly end is at +1. The cloth-ripple update keys on this.
    clothFlags.push({ mesh: flag1, hoistLocalX: -1, planeWidth: 2.0, planeHeight: 1.3 });

    // --- pole #2: Juan Carlos I station logo plaque ---
    const pole2 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 6, 12), poleMat);
    pole2.position.set(-4, 3, 4);
    pole2.castShadow = true;
    worldGroup.add(pole2);
    bumpColliders.push({ x: -4, z: 4, r: 0.4 });
    // backing plate so the logo reads from a distance — warm ivory so all
    // four logo colours (navy, red, gold, ivory) stay visible against it.
    const backing = new THREE.Mesh(
        new THREE.PlaneGeometry(1.6, 1.2, 1, 1),
        new THREE.MeshStandardMaterial({
            color: 0xeaddc4,
            roughness: 0.6,
            metalness: 0.0,
            emissive: 0x4a3a1c,
            emissiveIntensity: 0.12,
            side: THREE.DoubleSide,
        }),
    );
    // Wrap the backing in a group anchored AT the pole so it pivots from
    // the mount when it sways (like a hanging sign), instead of rocking
    // around its own centre. The backing's logo now faces +X so the player
    // sees it from the spawn / lab side rather than from out beyond the pole.
    const plaqueGroup = new THREE.Group();
    plaqueGroup.position.set(-4, 5.3, 4);   // at the pole
    worldGroup.add(plaqueGroup);
    backing.position.set(0.8, 0, 0);        // 0.8 m east of pole
    backing.rotation.y = Math.PI / 2;       // logo face → +X (toward player)
    plaqueGroup.add(backing);
    flagsToSway.push(plaqueGroup);
    // load the JC logo OBJs and mount them on the backing
    const logoHolderPlaque = new THREE.Group();
    backing.add(logoHolderPlaque);
    logoHolderPlaque.position.set(0, 0, 0.04); // slight forward offset
    Promise.all(
        [0, 1, 2, 3].map((i) =>
            loadOBJ(
                dataURL("Logo of the _Juan Carlos I_ station", `models/model_${i}.obj`),
                (m) => {
                    m.material = JC_LOGO_PART_MATS[i];
                    m.castShadow = true;
                },
            ),
        ),
    ).then((groups) => {
        const inner = new THREE.Group();
        for (const g of groups) if (g) inner.add(g);
        if (inner.children.length === 0) return;
        centerScale(inner, 1.1);
        // Rotate the logo 90° on its local Z (the axis perpendicular to
        // the plaque face). Applied to the inner asset group rather than
        // the plaque pivot, so the sway animation on plaqueGroup keeps
        // working unchanged — the whole plaque still rocks back and
        // forth around the pole, and the rotated logo rocks with it.
        inner.rotation.z = Math.PI / 2;
        logoHolderPlaque.add(inner);
    });
})();

// Low-poly shipping container — a second portal/door into another lab page.
const shippingContainer = { x: -22, z: -10, r: 0 };
(function addShippingContainer() {
    Promise.all([
        loadOBJ(dataURL("Low Poly Shipping Container", "models/model_0.obj")),
        loadTexture(dataURL("Low Poly Shipping Container", "textures/LowPolyExport_1001_BaseColor.png")),
        loadTexture(dataURL("Low Poly Shipping Container", "textures/LowPolyExport_1001_Normal.png"), { colorSpace: THREE.NoColorSpace }),
        loadTexture(dataURL("Low Poly Shipping Container", "textures/LowPolyExport_1001_Roughness.png"), { colorSpace: THREE.NoColorSpace }),
    ]).then(([g, color, normal, rough]) => {
        if (!g) return;
        const mat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: color || null,
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
        // 2/3 of the previous big version → ~13 m max-dim
        const { size } = fitToFloor(wrap, 13);
        wrap.userData.assetFolder = "Low Poly Shipping Container";
        wrap.userData.targetSize = 13;
        const angle = 0.3;
        wrap.position.set(shippingContainer.x, 0, shippingContainer.z);
        wrap.rotation.y = angle;
        worldGroup.add(wrap);
        // tight oriented-rect collider matching the container's footprint
        blockColliders.push({
            x: shippingContainer.x,
            z: shippingContainer.z,
            hw: size.x / 2,
            hd: size.z / 2,
            cos: Math.cos(angle),
            sin: Math.sin(angle),
        });
        mapShadows.push({
            type: "rect",
            x: shippingContainer.x, z: shippingContainer.z,
            hw: size.x / 2, hd: size.z / 2, angle,
            color: "#dde6ee",
        });
        // generous radius for zone-prompt detection only (not collision)
        shippingContainer.r = Math.max(size.x, size.z) * 0.5 + 1;
    });
})();

// Cargo container placed off to the right of the lab.
(function addCargoContainer() {
    Promise.all([
        loadOBJ(dataURL("Low Poly Cargo Container", "models/model_0.obj")),
        loadTexture(dataURL("Low Poly Cargo Container", "textures/Cargo_Container_01_UV_Map_01.png")),
    ]).then(([g, tex]) => {
        if (!g) return;
        const wrap = new THREE.Group();
        wrap.add(g);
        const containerMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: tex || null,
            roughness: 0.7,
        });
        // fallback colour if the atlas didn't load
        if (!tex) containerMat.color.setHex(0x8a3a2e);
        wrap.traverse((o) => {
            if (o.isMesh) {
                o.material = containerMat;
                o.castShadow = true;
                o.receiveShadow = true;
            }
        });
        const { size } = fitToFloor(wrap, 6);
        wrap.userData.assetFolder = "Low Poly Cargo Container";
        wrap.userData.targetSize = 6;
        const angle = -0.5;
        wrap.position.set(11, 0, -4);
        wrap.rotation.y = angle;
        worldGroup.add(wrap);
        blockColliders.push({
            x: 11, z: -4,
            hw: size.x / 2, hd: size.z / 2,
            cos: Math.cos(angle), sin: Math.sin(angle),
        });
        mapShadows.push({
            type: "rect", x: 11, z: -4,
            hw: size.x / 2, hd: size.z / 2, angle,
            color: "#8a3a2e",
        });
    });
})();

// Antarctic Research Truck parked near the lab. Deferred — 5 OBJs / 226k
// vertices loading at startup is what tipped Chrome's GPU rate-limiter.
setTimeout(addTruck, 4000);
function addTruck() {
    const wrap = new THREE.Group();
    const folder = "Antarctic Research Truck";
    Promise.all([
        loadTexture(dataURL(folder, "textures/In2_Body_BaseColor.png")),
        loadTexture(dataURL(folder, "textures/In2_Body_Normal.png"), { colorSpace: THREE.NoColorSpace }),
        loadTexture(dataURL(folder, "textures/In2_Body_Roughness.png"), { colorSpace: THREE.NoColorSpace }),
        loadTexture(dataURL(folder, "textures/In2_Body_Metallic.png"), { colorSpace: THREE.NoColorSpace }),
    ]).then(([color, normal, rough, metal]) => {
        const truckMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: color || null,
            normalMap: normal || null,
            roughnessMap: rough || null,
            metalnessMap: metal || null,
            roughness: rough ? 1 : 0.55,
            metalness: metal ? 1 : 0.2,
        });
        if (!color) truckMat.color.setHex(0xeec96a); // fallback yellow
        return Promise.all(
            [0, 1, 2, 3, 4].map((i) =>
                loadOBJ(dataURL(folder, `models/model_${i}.obj`), (m) => {
                    m.material = truckMat;
                    m.castShadow = true;
                    m.receiveShadow = true;
                }),
            ),
        );
    }).then((groups) => {
        for (const g of groups) if (g) wrap.add(g);
        if (wrap.children.length === 0) return;
        // truck OBJs are Z-up — rotate via an inner group so fitToFloor
        // recomputes bbox from the correct orientation
        const inner = new THREE.Group();
        while (wrap.children.length) inner.add(wrap.children[0]);
        inner.rotation.x = -Math.PI / 2;
        wrap.add(inner);
        const { size } = fitToFloor(wrap, 5.5);
        wrap.userData.assetFolder = folder;
        wrap.userData.targetSize = 5.5;
        const angle = 0.6;
        wrap.position.set(-12, 0, -2);
        wrap.rotation.y = angle;
        worldGroup.add(wrap);
        blockColliders.push({
            x: -12, z: -2,
            hw: size.x / 2, hd: size.z / 2,
            cos: Math.cos(angle), sin: Math.sin(angle),
        });
        mapShadows.push({
            type: "rect", x: -12, z: -2,
            hw: size.x / 2, hd: size.z / 2, angle,
            color: "#eec96a",
        });
    });
}

// Antarctic Man standing near the lab door. The OBJ is a single mesh with
// no submeshes, so we paint per-vertex colours along the vertical axis
// (local Z; that's world Y after the -π/2 X-rotation we apply below):
// boots → trousers → parka → face → hood. Renders with `vertexColors: true`.
const ANTARCTIC_MAN_BANDS = [
    // (height fraction 0..1, [r, g, b])
    { upTo: 0.10, c: [0.10, 0.08, 0.07] }, // boots — near black
    { upTo: 0.42, c: [0.13, 0.20, 0.40] }, // trousers — navy
    { upTo: 0.78, c: [0.78, 0.18, 0.16] }, // parka body — red
    { upTo: 0.85, c: [0.94, 0.79, 0.63] }, // face / scarf — skin tone
    { upTo: 1.00, c: [0.86, 0.20, 0.18] }, // hood — brighter red
];
function antarcticManBandColor(t) {
    for (const b of ANTARCTIC_MAN_BANDS) if (t <= b.upTo) return b.c;
    return ANTARCTIC_MAN_BANDS[ANTARCTIC_MAN_BANDS.length - 1].c;
}
(function addAntarcticMan() {
    loadOBJ(dataURL("Antarctic Man", "models/model_0.obj"), (m) => {
        m.castShadow = true;
        m.receiveShadow = true;
        const pos = m.geometry.attributes.position;
        // First pass: find local-Z range so we can normalise.
        let minZ = Infinity, maxZ = -Infinity;
        for (let i = 0; i < pos.count; i++) {
            const z = pos.getZ(i);
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
        }
        const range = Math.max(1e-6, maxZ - minZ);
        const colors = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
            const t = (pos.getZ(i) - minZ) / range;
            const [r, g, b] = antarcticManBandColor(t);
            colors[i * 3]     = r;
            colors[i * 3 + 1] = g;
            colors[i * 3 + 2] = b;
        }
        m.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        m.material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.78,
            metalness: 0.05,
        });
    }).then((g) => {
        if (!g) return;
        // OBJ is Z-up — rotate so the figure stands vertically
        g.rotation.x = -Math.PI / 2;
        const wrap = new THREE.Group();
        wrap.add(g);
        fitToFloor(wrap, 1.9);
        wrap.userData.assetFolder = "Antarctic Man";
        wrap.userData.targetSize = 1.9;
        wrap.position.set(4.5, 0, 5);
        wrap.rotation.y = -Math.PI / 2;
        worldGroup.add(wrap);
        bumpColliders.push({ x: 4.5, z: 5, r: 0.5 });
        antarcticMan = wrap;
    });
})();

// Perspective-measure GLB scan dropped into the world (1.5× previous size).
// Deferred until after the loader screen so the 12 MB download doesn't
// compete with the visible-on-spawn assets and trip Chrome's WebGL killer.
setTimeout(addPerspectiveMeasure, 3500);
function addPerspectiveMeasure() {
    const gltfLoader = new GLTFLoader();
    const url = "/data/perspective-measure-2026-04-29-23-57-59.glb";
    gltfLoader.load(
        url,
        (gltf) => {
            const root = gltf.scene || gltf.scenes?.[0];
            if (!root) return;
            root.traverse((o) => {
                if (o.isMesh) {
                    o.castShadow = true;
                    o.receiveShadow = true;
                }
            });
            const wrap = new THREE.Group();
            wrap.add(root);
            const { size } = fitToFloor(wrap, 9);
            wrap.position.set(22, 0, -10);
            wrap.rotation.y = -0.4;
            worldGroup.add(wrap);
            if (size.x && size.z) {
                const r = Math.max(size.x, size.z) * 0.45;
                bumpColliders.push({ x: 22, z: -10, r });
                mapShadows.push({
                    type: "circle", x: 22, z: -10, r,
                    color: "#7ed957",
                });
            }
        },
        undefined,
        () => {},
    );
}

// Wandering penguin colony
const penguins = [];
(function addPenguinColony() {
    loadOBJ(dataURL("low poly emperor penguin", "models/model_0.obj"), (m) => {
        m.castShadow = true;
        m.receiveShadow = true;
    }).then((proto) => {
        if (!proto) return;
        // ensure it's normalized; we'll clone
        loadTexture(dataURL("low poly emperor penguin", "textures/lambert1_albedo.png"))
            .catch(() => null)
            .then((tex) => {
                const mat = new THREE.MeshStandardMaterial({
                    color: tex ? 0xffffff : 0x303440,
                    map: tex || null,
                    roughness: 0.75,
                });
                proto.traverse((o) => {
                    if (o.isMesh) o.material = mat;
                });
                const wrap = new THREE.Group();
                wrap.add(proto);
                fitToFloor(wrap, 1.2);
                // Tag the prototype so every cloned penguin (clone(true) below)
                // inherits the folder/targetSize and round-trips through the
                // engine schema as `{kind:"asset"}` instead of a raw mesh.
                wrap.userData.assetFolder = "low poly emperor penguin";
                wrap.userData.targetSize = 1.2;

                const spawnPoints = [
                    { x: -16, z: 8 },
                    { x: -10, z: 14 },
                    { x: 14, z: 9 },
                    { x: 18, z: -8 },
                    { x: -18, z: -10 },
                    { x: 6, z: 16 },
                ];
                for (const sp of spawnPoints) {
                    const inst = wrap.clone(true);
                    inst.position.set(sp.x, 0, sp.z);
                    inst.rotation.y = Math.random() * Math.PI * 2;
                    worldGroup.add(inst);
                    const target = new THREE.Vector2(
                        sp.x + (Math.random() - 0.5) * 8,
                        sp.z + (Math.random() - 0.5) * 8,
                    );
                    penguins.push({
                        mesh: inst,
                        target,
                        speed: 0.7 + Math.random() * 0.4,
                        idleUntil: 0,
                        jumpUntil: 0,
                        jumpStart: 0,
                        waddlePhase: Math.random() * Math.PI * 2,
                        lastStepCount: 0,
                    });
                    bumpColliders.push({ x: sp.x, z: sp.z, r: 0.45, _penguin: penguins[penguins.length - 1] });
                }
            });
    });
})();

function updatePenguins(dt, now) {
    // resolve penguin-penguin overlap first so movement doesn't pile them up
    for (let i = 0; i < penguins.length; i++) {
        for (let j = i + 1; j < penguins.length; j++) {
            const a = penguins[i].mesh;
            const b = penguins[j].mesh;
            const dx = b.position.x - a.position.x;
            const dz = b.position.z - a.position.z;
            const dist = Math.hypot(dx, dz);
            const minDist = 1.0;
            if (dist > 0 && dist < minDist) {
                const overlap = (minDist - dist) * 0.5;
                const nx = dx / dist;
                const nz = dz / dist;
                a.position.x -= nx * overlap;
                a.position.z -= nz * overlap;
                b.position.x += nx * overlap;
                b.position.z += nz * overlap;
            }
        }
    }
    for (const p of penguins) {
        const m = p.mesh;
        const tSec = now / 1000;
        // Click reaction: 3 hops in place over (jumpUntil - jumpStart)
        // seconds. Suspends AI walk so the hops aren't superimposed on a
        // travel motion. Three peaks via abs(sin(phase)) with phase in 0..3π.
        if (tSec < p.jumpUntil) {
            const elapsed = tSec - p.jumpStart;
            const dur = p.jumpUntil - p.jumpStart;
            const groundY = snowHeight(m.position.x, m.position.z);
            const phase = (elapsed / dur) * Math.PI * 3;
            m.position.y = groundY + Math.abs(Math.sin(phase)) * 0.45;
            m.rotation.z = 0; // pause the waddle tilt during the hops
            continue;
        }
        if (tSec < p.idleUntil) continue;
        const dx = p.target.x - m.position.x;
        const dz = p.target.y - m.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.3) {
            // pick a new target somewhere in the play area
            p.target.set(
                (Math.random() - 0.5) * 70,
                (Math.random() - 0.5) * 70,
            );
            p.idleUntil = now / 1000 + 1 + Math.random() * 2;
            continue;
        }
        const inv = 1 / dist;
        const nx = dx * inv;
        const nz = dz * inv;
        m.position.x += nx * p.speed * dt;
        m.position.z += nz * p.speed * dt;
        // face direction of travel
        const targetYaw = Math.atan2(nx, nz);
        let dy = targetYaw - m.rotation.y;
        while (dy > Math.PI) dy -= 2 * Math.PI;
        while (dy < -Math.PI) dy += 2 * Math.PI;
        m.rotation.y += dy * Math.min(1, dt * 4);
        // waddle
        p.waddlePhase += dt * 6;
        m.rotation.z = Math.sin(p.waddlePhase) * 0.12;
        // Stand on the actual snow terrain instead of the y=0 plane, then
        // add the waddle bounce on top. Otherwise penguins float across
        // bumpy ground at a fixed height.
        const groundY = snowHeight(m.position.x, m.position.z);
        m.position.y = groundY + Math.abs(Math.sin(p.waddlePhase)) * 0.04;
        // drop a paw print at each foot-down — half-cycle of the waddle phase
        const stepCount = Math.floor(p.waddlePhase / Math.PI);
        if (stepCount > p.lastStepCount) {
            const sideSign = (stepCount % 2 === 0) ? 1 : -1;
            const sx = Math.cos(m.rotation.y) * 0.10 * sideSign;
            const sz = -Math.sin(m.rotation.y) * 0.10 * sideSign;
            dropFootprint(m.position.x + sx, m.position.z + sz, m.rotation.y, "paw");
            p.lastStepCount = stepCount;
        }
        // sync collider position (find this penguin's collider)
        for (const c of bumpColliders) {
            if (c._penguin === p) {
                c.x = m.position.x;
                c.z = m.position.z;
                break;
            }
        }
    }
}

// --- player rig (shared across all pages via controls.js) ---------------
const playerRig = controls.createPlayer();
const player = playerRig.group;
const { body, head, nose, hand: handBacteria } = playerRig;
controls.setPlayer(player);
player.position.copy(SPAWN);
scene.add(player);

// --- audio -------------------------------------------------------------
let audioCtx = null;
function ensureAudio() {
    if (audioCtx) return audioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
    return audioCtx;
}

// Continuous winter-storm ambient — synthesised pink-ish noise pushed
// through a bandpass + lowpass for "wind tone", with a slow LFO on the
// master gain so the wind ebbs and surges over ~50 s. Started once per
// session on the first user interaction (autoplay-policy friendly).
let stormAmbient = null;
function startStormAmbient(ctx) {
    if (stormAmbient) return stormAmbient;
    const len = Math.floor(ctx.sampleRate * 4);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
        // 1-pole low-passed white → pink-ish, smoother than raw white
        last = 0.96 * last + 0.04 * (Math.random() * 2 - 1);
        data[i] = last;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 480;
    bp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1800;
    const master = ctx.createGain();
    master.gain.value = 0;
    src.connect(bp).connect(lp).connect(master).connect(ctx.destination);
    // slow LFO on the gain so the wind breathes
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.06;
    lfo.connect(lfoGain);
    lfoGain.connect(master.gain);
    src.start();
    lfo.start();
    // fade in over a couple seconds so it doesn't punch on
    const t0 = ctx.currentTime;
    master.gain.setValueAtTime(0, t0);
    master.gain.linearRampToValueAtTime(0.18 * params.sfxVolume, t0 + 2.0);
    stormAmbient = { src, master, lfoGain, baseGain: 0.18 };
    return stormAmbient;
}
function ensureStormAmbient() {
    const ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    startStormAmbient(ctx);
}

function playFootstep(heavy = false) {
    const ctx = ensureAudio();
    if (!ctx) return;
    const dur = heavy ? 0.12 : 0.08;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        const env = Math.pow(1 - i / data.length, 2);
        data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = heavy ? 600 : 900;
    const g = ctx.createGain();
    g.gain.value = params.sfxVolume * (heavy ? 0.55 : 0.35);
    src.connect(lp).connect(g).connect(ctx.destination);
    src.start();
}

function playDoorSound() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t = ctx.currentTime;
    // creaky sweep
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
    // wobble for creakiness
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 110;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start(t);
    lfo.stop(t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(params.sfxVolume * 0.45, t + 0.07);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(lp).connect(g).connect(ctx.destination);
    src.start(t);
    src.stop(t + dur);
    // closing thud
    const click = ctx.createOscillator();
    click.type = "square";
    click.frequency.setValueAtTime(220, t + dur);
    click.frequency.exponentialRampToValueAtTime(80, t + dur + 0.1);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(params.sfxVolume * 0.35, t + dur);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
    click.connect(cg).connect(ctx.destination);
    click.start(t + dur);
    click.stop(t + dur + 0.18);
}

function playWindGust(dur = 3.0) {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t = ctx.currentTime;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + dur);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 80;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(params.sfxVolume * 0.55, t + 0.25);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(lp).connect(hp).connect(g).connect(ctx.destination);
    src.start(t);
    src.stop(t + dur + 0.05);
}

function playMiningHit() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t = ctx.currentTime;
    // crunchy thud: filtered noise burst
    const dur = 0.18;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        const env = Math.pow(1 - i / data.length, 2.5);
        data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1200;
    const ng = ctx.createGain();
    ng.gain.value = params.sfxVolume * 0.55;
    src.connect(lp).connect(ng).connect(ctx.destination);
    src.start(t);
    // pitched tonk on top
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.09);
    const og = ctx.createGain();
    og.gain.setValueAtTime(params.sfxVolume * 0.22, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(og).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.14);
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
        g.gain.linearRampToValueAtTime(params.sfxVolume * 0.3, t + delay + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.55);
        o.connect(g).connect(ctx.destination);
        o.start(t + delay);
        o.stop(t + delay + 0.6);
    });
}

// Cartoon "mwah" — a descending pitched pop (the lip-pull) followed by
// a tiny noise click (the lip-release). Plays when the player clicks a
// penguin, alongside the heart particle burst.
function playKiss() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t = ctx.currentTime;
    // pitched smack: triangle slides 720 → 230 Hz over 90 ms,
    // band-passed to ~600 Hz for a "lip" quality.
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(720, t);
    o.frequency.exponentialRampToValueAtTime(230, t + 0.09);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 600;
    bp.Q.value = 2.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(params.sfxVolume * 0.38, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(bp);
    bp.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.18);
    // brief noise click for the "release" tail
    const len = Math.max(1, Math.floor(ctx.sampleRate * 0.04));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const nFilter = ctx.createBiquadFilter();
    nFilter.type = "bandpass";
    nFilter.frequency.value = 2400;
    nFilter.Q.value = 1.4;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0, t + 0.05);
    nGain.gain.linearRampToValueAtTime(params.sfxVolume * 0.2, t + 0.06);
    nGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    src.connect(nFilter);
    nFilter.connect(nGain);
    nGain.connect(ctx.destination);
    src.start(t + 0.05);
    src.stop(t + 0.14);
}

// --- input -------------------------------------------------------------
controls.init(canvas);
controls.setPlayer(player);
controls.cameraState.yaw = Math.PI; // initial: facing the lab from spawn
controls.pause("intro"); // released by exitWelcome() on first user input
const keys = controls.keys;
window.addEventListener("keydown", (e) => {
    if (e.code === "Escape") {
        menu.toggle();
        e.preventDefault();
        return;
    }
    if (menu.isOpen) return;
    // resume audio on first interaction (browser autoplay policy) and
    // kick off the continuous winter-storm ambient
    ensureStormAmbient();

    keys.add(e.code);
    if (e.code === "KeyE") tryInteract();
    if (e.code === "KeyQ") throwSample();
    if (e.code === "KeyV") sessionStorage.setItem("todo-usedFP", "1");
    if (e.code === "Tab") sessionStorage.setItem("todo-usedOrbit", "1");
    // hotbar slot selection: 1..9 → slots 0..8, 0 → slot 9
    const m = e.code.match(/^(?:Digit|Numpad)(\d)$/);
    if (m) {
        const n = parseInt(m[1], 10);
        selectSlot(n === 0 ? 9 : n - 1);
    }
    if (e.code === "Space" && grounded) {
        vy = params.jumpVelocity;
        grounded = false;
        playFootstep(true);
        e.preventDefault();
    }
});
window.addEventListener("keyup", (e) => keys.delete(e.code));

// (cinematic intro auto-completes — input is ignored until exitWelcome
// fires from updateCamera once the orbit lands behind the player.)

canvas.addEventListener("mousedown", (e) => {
    if (menu.isOpen) return;
    ensureStormAmbient();
    if (e.button === 0 && controls.cameraState.mode !== "orbit") {
        // While right is held (fp-temp): penguins still react (clicking
        // one delights it + kiss SFX, even from the FP crosshair), but
        // navigation zones (lab door, container, ice mining, notebook)
        // stay frozen so the user can't accidentally enter while trying
        // to zoom. If no penguin is under the crosshair, fall through
        // to the hold-to-zoom.
        if (controls.cameraState.mode === "fp-temp") {
            const p = raycastPenguin(e.clientX, e.clientY);
            if (p) delightPenguin(p);
            else controls.tryLeftClickZoom();
        } else if (!tryInteract(e)) {
            controls.tryLeftClickZoom();
        }
    }
});
// First-person visibility is handled by controls.syncFP each frame; the
// hand stays hidden in main.js (the outdoor scene doesn't have its own
// "is the held slot filled" check yet — totalFilled() is below).

// --- camera follow -----------------------------------------------------
const cameraTarget = new THREE.Vector3();
// Intro cinematic: the camera flies in from far away high above the lab,
// orbits ~270° around the player, and settles into the standard
// third-person follow pose behind them. Input is paused for the duration.
const INTRO_DURATION = 5.5;
let introElapsed = 0;
let welcomeActive = true;

function exitWelcome() {
    if (!welcomeActive) return;
    welcomeActive = false;
    setPrompt("");
    controls.unpause("intro");
}

// Loader: progress bar + log line, runs on every visit. The world boots
// asynchronously; the loader only fades once every loadOBJ / loadTexture
// has resolved. Watchdog hides it anyway after 18 s so a hung network
// can't trap the user. The sessionStorage `newGameLoading` flag (set by
// triggerNewGame on any page) only controls the headline status text —
// the wait-for-loads behaviour is the same regardless.
const cameFromNewGame = sessionStorage.getItem("newGameLoading") === "1";
sessionStorage.removeItem("newGameLoading");
{
    const loaderEl = document.getElementById("loader");
    const statusEl = document.getElementById("loader-status");
    const fillEl = document.getElementById("loader-bar-fill");
    const logEl = document.getElementById("loader-log");
    loaderEl?.classList.add("with-progress");
    if (statusEl) {
        statusEl.textContent = cameFromNewGame
            ? "Booting a fresh world…"
            : "Loading the world…";
    }
    let watchdog = null;
    let calmTimer = null;
    onLoadProgress(({ started, finished, label }) => {
        const pct = started > 0 ? Math.round((finished / started) * 100) : 0;
        if (fillEl) fillEl.style.width = `${pct}%`;
        if (logEl && label) {
            // strip the long /data/optimized/ prefix; show just folder/file
            const tail = label.replace(/^\/data\/optimized\//, "")
                              .replace(/^\/data\//, "");
            logEl.textContent = (finished < started ? "loading " : "loaded  ") +
                decodeURIComponent(tail);
        }
        // Done = no in-flight loads. Wait 250 ms after the last finish to
        // catch tail-end loaders that queue right after a batch completes
        // (e.g. textures that start fetching once their OBJ resolves).
        if (started > 0 && started === finished) {
            clearTimeout(calmTimer);
            calmTimer = setTimeout(() => {
                if (statusEl) statusEl.textContent = "Ready — click to begin";
                hideLoader();
                clearTimeout(watchdog);
            }, 250);
        } else {
            clearTimeout(calmTimer);
        }
    });
    // Safety net for a hung network. If the boot never reports "ready",
    // the loader still fades after 18 s rather than blocking the player.
    watchdog = setTimeout(() => {
        if (statusEl) statusEl.textContent = "Ready (some assets still loading)";
        hideLoader();
    }, 18000);
    // Edge case: nothing fetched after a few hundred ms (everything
    // already cached, no async work). The progress callback never fires
    // in that case, so we kick the loader closed manually.
    setTimeout(() => {
        const s = getLoadStats();
        if (s.started === 0) {
            if (statusEl) statusEl.textContent = "Ready — click to begin";
            hideLoader();
            clearTimeout(watchdog);
        }
    }, 800);
}

function updateCamera(dt) {
    if (welcomeActive) {
        introElapsed += dt;
        const t = Math.min(1, introElapsed / INTRO_DURATION);
        // ease-out cubic — fast at the start, slow into the landing
        const e = 1 - Math.pow(1 - t, 3);
        // distance arcs from "approaching from afar" to the follow distance
        const distance = 36 - (36 - 8) * e;
        // height drops from a swooping bird's-eye to head-high follow
        const height = 18 - (18 - 5.5) * e;
        // orbit yaw — start ~3π/4 off-axis (camera is ahead-and-to-the-side
        // of the player) and sweep around to π (directly behind a player
        // who's facing -z, matching the follow camera's resting yaw).
        const startYaw = -Math.PI * 0.75;
        const endYaw = Math.PI;
        const yaw = startYaw + (endYaw - startYaw) * e;
        const px = player.position.x;
        const py = player.position.y;
        const pz = player.position.z;
        const ox = Math.sin(yaw) * distance;
        const oz = Math.cos(yaw) * distance;
        camera.position.set(px - ox, py + height, pz - oz);
        cameraTarget.set(px, py + 1.4, pz);
        camera.lookAt(cameraTarget);
        // hand off to the follow camera at the end with a matching yaw so
        // there's no snap when the lerp takes over.
        if (t >= 1) {
            controls.cameraState.yaw = endYaw;
            controls.cameraState.pitch = -0.18;
            exitWelcome();
        }
        return;
    }
    // delegate to the shared controls module — handles follow / orbit / fp
    controls.updateCamera(dt, player, camera, {
        followHeight: 5.5,
        followDist: 8,
        targetOffset: 1.2,
    });
}

// --- movement ----------------------------------------------------------
// moveSpeed/sprintSpeed live in controls.params now (shared across pages).
const params = {
    jumpVelocity: 7.5,
    gravity: 22,
    sfxVolume: 0.5,
    sunBase: 0.25,
    hemiBase: 0.35,
    cloudStrength: 0.55,
};
let windCooldown = 0;
let cloudTime = 0;
let idleTime = 0;
const LAB_EXIT_POS = new THREE.Vector3(0, 0, LAB_D / 2 + 2);

// Field notebook on a wooden crate just outside the lab door — clicking
// near it (or pressing E) opens the Field Manual without entering the
// lab. Visible from spawn so first-time players notice the prompt.
const NOTEBOOK_POS = new THREE.Vector3(3.6, 0, LAB_D / 2 + 1.6);
const NOTEBOOK_RANGE_SQ = 1.8 * 1.8;
(function placeFieldNotebook() {
    const group = new THREE.Group();
    // a small weathered wooden crate as a pedestal
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.85 });
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.7), crateMat);
    crate.position.y = 0.3;
    crate.castShadow = true;
    crate.receiveShadow = true;
    group.add(crate);
    // crate slats — thin dark strips around it for "wood plank" look
    const slatMat = new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 0.9 });
    for (const z of [-0.355, 0.355]) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.06, 0.04), slatMat);
        slat.position.set(0, 0.15, z);
        group.add(slat);
        const slat2 = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.06, 0.04), slatMat);
        slat2.position.set(0, 0.45, z);
        group.add(slat2);
    }
    // the notebook itself: brown leather cover + cream pages
    const book = new THREE.Group();
    const cover = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.05, 0.26),
        new THREE.MeshStandardMaterial({ color: 0x4a2618, roughness: 0.65 }),
    );
    cover.castShadow = true;
    book.add(cover);
    const pages = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.04, 0.24),
        new THREE.MeshStandardMaterial({ color: 0xf4ece0, roughness: 0.95 }),
    );
    pages.position.y = -0.005;
    book.add(pages);
    // a tiny strip of yellow tape / bookmark on the spine
    const bookmark = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.06, 0.16),
        new THREE.MeshStandardMaterial({ color: 0xffe156, emissive: 0x806d2a, emissiveIntensity: 0.5 }),
    );
    bookmark.position.set(0.18, 0.005, -0.05);
    book.add(bookmark);
    book.position.set(0, 0.66, 0);
    book.rotation.y = -0.32;
    group.add(book);
    // soft yellow glow above to draw the eye
    const glow = new THREE.PointLight(0xffe156, 0.7, 4, 1.5);
    glow.position.set(0, 1.1, 0);
    group.add(glow);
    group.position.copy(NOTEBOOK_POS);
    scene.add(group);
})();

function nearFieldNotebook() {
    const dx = player.position.x - NOTEBOOK_POS.x;
    const dz = player.position.z - NOTEBOOK_POS.z;
    return dx * dx + dz * dz < NOTEBOOK_RANGE_SQ;
}
const GROUND_Y = 0;
let walkPhase = 0;
let vy = 0;
let grounded = true;
let lastFootstepStep = 0;

function getInputVector() {
    let f = 0;
    let s = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) f += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) f -= 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) s -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) s += 1;
    return [f, s];
}

function update(dt) {
    if (controls.isPaused()) return;
    if (welcomeActive) return;

    const moveResult = controls.applyMovement(dt, player, { sprint: true });
    const moving = moveResult.moved;
    const sprinting = moveResult.sprinting;

    // walk bob + footstep timing (only on the ground)
    if (moving && grounded) {
        const phaseSpeed = sprinting ? 14 : 9;
        walkPhase += dt * phaseSpeed;
        body.position.y = 0.9 + Math.sin(walkPhase) * 0.06;
        head.position.y = 1.7 + Math.sin(walkPhase) * 0.05;
        const stepCount = Math.floor(walkPhase / Math.PI);
        if (stepCount > lastFootstepStep) {
            playFootstep(sprinting);
            // alternate left / right boot offset 0.16 m perpendicular to facing
            const yaw = player.rotation.y;
            const sideSign = (stepCount % 2 === 0) ? 1 : -1;
            const sideX = Math.cos(yaw) * 0.16 * sideSign;
            const sideZ = -Math.sin(yaw) * 0.16 * sideSign;
            dropFootprint(player.position.x + sideX, player.position.z + sideZ, yaw, "boot");
            lastFootstepStep = stepCount;
        }
    } else {
        walkPhase = 0;
        lastFootstepStep = 0;
        body.position.y += (0.9 - body.position.y) * Math.min(1, dt * 8);
        head.position.y += (1.7 - head.position.y) * Math.min(1, dt * 8);
    }

    // jump + gravity, with terrain following — ground level is the snow
    // height under the player's xz, not a flat 0.
    vy -= params.gravity * dt;
    player.position.y += vy * dt;
    const ground = snowHeight(player.position.x, player.position.z);
    if (player.position.y <= ground) {
        if (!grounded && vy < -1) playFootstep(true); // landing thud
        player.position.y = ground;
        vy = 0;
        grounded = true;
    }

    // resolve collisions against ice blocks and snow bumps
    resolveCollisions();

    // boundary push: at the fog edge, spin player + camera inward and gust wind
    if (windCooldown > 0) windCooldown -= dt;
    const distFromOrigin = Math.hypot(player.position.x, player.position.z);
    if (distFromOrigin > PLAY_RADIUS) {
        flashPrompt("WHOOSH! Pushed back!", 3000);
        const k = (PLAY_RADIUS - 2) / distFromOrigin;
        player.position.x *= k;
        player.position.z *= k;
        // face inward (toward origin) — only forcibly snap the camera if
        // it's auto-following. In orbit / first-person the user owns the
        // camera and we shouldn't yank their view.
        const inward = Math.atan2(-player.position.x, -player.position.z);
        player.rotation.y = inward;
        if (controls.cameraState.mode === "follow") {
            controls.cameraState.yaw = inward;
        }
        if (windCooldown <= 0) {
            playWindGust(3.0);
            windCooldown = 3.0;
        }
        idleTime = 0;
    }

    // idle epic orbit: only when the camera is in follow mode and the user
    // is doing nothing. Skip in orbit / first-person — those are owned by
    // the mouse and any auto-rotation would feel like the camera is fighting.
    if (moving) {
        idleTime = 0;
    } else {
        idleTime += dt;
    }
    if (idleTime > 10 && controls.cameraState.mode === "follow") {
        const t = idleTime - 10;
        const speed = Math.min(0.18, 0.03 + t * 0.04);
        controls.cameraState.yaw += dt * speed;
    }
    // NOTE: yaw → player.rotation.y lerp now lives entirely inside
    // controls.updateCamera() (only fires in follow mode). Doing it here
    // again was double-pulling the camera and fighting mouse-look.
}

const PLAYER_RADIUS = 0.4;

function resolveCollisions() {
    // oriented rectangle colliders (lab + ice + truck + cargo + ship).
    // The block was placed with `wrap.rotation.y = angle`, which uses the
    // three.js Y-rotation matrix [[c, 0, s], [0,1,0], [-s, 0, c]]. So the
    // forward (local→world) map is (lx, lz) → (c·lx + s·lz, -s·lx + c·lz),
    // and the inverse (world→local) is (wx, wz) → (c·wx - s·wz, s·wx + c·wz).
    for (const b of blockColliders) {
        const dx = player.position.x - b.x;
        const dz = player.position.z - b.z;
        // world → local (inverse rotation)
        const lx = dx * b.cos - dz * b.sin;
        const lz = dx * b.sin + dz * b.cos;
        const cx = Math.max(-b.hw, Math.min(b.hw, lx));
        const cz = Math.max(-b.hd, Math.min(b.hd, lz));
        let nx = lx - cx;
        let nz = lz - cz;
        let dist = Math.hypot(nx, nz);
        if (dist >= PLAYER_RADIUS) continue;
        let pushLX, pushLZ;
        if (dist > 0.0001) {
            pushLX = nx / dist;
            pushLZ = nz / dist;
        } else {
            // center inside box: pop out along smallest axis
            const ex = b.hw - Math.abs(lx);
            const ez = b.hd - Math.abs(lz);
            if (ex < ez) {
                pushLX = Math.sign(lx) || 1; pushLZ = 0; dist = -ex;
            } else {
                pushLX = 0; pushLZ = Math.sign(lz) || 1; dist = -ez;
            }
        }
        const overlap = PLAYER_RADIUS - dist;
        // local → world (forward rotation)
        const wx = pushLX * b.cos + pushLZ * b.sin;
        const wz = -pushLX * b.sin + pushLZ * b.cos;
        player.position.x += wx * overlap;
        player.position.z += wz * overlap;
    }
    // snow bumps (circles)
    for (const c of bumpColliders) {
        const dx = player.position.x - c.x;
        const dz = player.position.z - c.z;
        const minDist = PLAYER_RADIUS + c.r;
        const distSq = dx * dx + dz * dz;
        if (distSq >= minDist * minDist || distSq < 1e-8) continue;
        const dist = Math.sqrt(distSq);
        const overlap = minDist - dist;
        player.position.x += (dx / dist) * overlap;
        player.position.z += (dz / dist) * overlap;
    }
}

// 0..1 cloud-shadow noise (sum-of-sines, irrational ratios so it never repeats)
function cloudNoise(t) {
    const v =
        Math.sin(t * 0.27) +
        Math.sin(t * 0.131 + 1.6) +
        Math.sin(t * 0.071 + 0.4);
    return 0.5 + (v / 3) * 0.5;
}

function updateClouds(dt) {
    cloudTime += dt;
    const n = cloudNoise(cloudTime); // 0..1, low when cloud overhead
    sun.intensity = params.sunBase * (1 - params.cloudStrength * (1 - n));
    hemi.intensity = params.hemiBase * (1 - params.cloudStrength * 0.35 * (1 - n));
    // fog colour drifts grey-on-grey using a second, slower noise so the
    // gradient doesn't perfectly track the light dimming
    const m =
        0.5 +
        0.5 *
            ((Math.sin(cloudTime * 0.19 + 0.7) +
                Math.sin(cloudTime * 0.083 + 2.1)) /
                2);
    scene.fog.color.lerpColors(fogColorShadow, fogColorBright, m);
    scene.background.copy(scene.fog.color);
}

function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
}

// --- interaction prompts ----------------------------------------------
const promptEl = document.getElementById("prompt");
const promptInner = document.createElement("span");
promptEl.appendChild(promptInner);
const samplesEl = document.getElementById("samples");
const zoneEl = document.getElementById("zone");
let sampleCount = 0;
let promptTimer = 0;
let nearZone = null; // 'ice' | 'lab' | null

const MINING_DURATION = 3.0;
const MINING_STRIKES = 5;
let mining = false;
let miningElapsed = 0;
let miningStrikesDone = 0;

function setPrompt(text) {
    if (text) {
        if (promptInner.textContent !== text) promptInner.textContent = text;
        promptEl.classList.add("visible");
    } else {
        promptEl.classList.remove("visible");
    }
}

function setPromptHTML(html) {
    promptInner.innerHTML = html;
    promptEl.classList.add("visible");
}

function flashPrompt(text, ms = 1200) {
    setPrompt(text);
    promptTimer = ms / 1000;
}

function flashPromptHTML(html, ms = 1500) {
    setPromptHTML(html);
    promptTimer = ms / 1000;
}

const CULTURE_SVG_MINI = `<svg viewBox="0 0 32 32" width="32" height="32" style="display:block">
  <circle cx="16" cy="16" r="13" fill="#dde6ee" stroke="#1a2230" stroke-width="2"/>
  <ellipse cx="16" cy="16" rx="6.5" ry="4.5" fill="#7ed957" stroke="#0d0d0d" stroke-width="1.4"/>
  <circle cx="13" cy="15" r="0.9" fill="#0d0d0d"/>
  <circle cx="18" cy="17" r="0.8" fill="#0d0d0d"/>
</svg>`;

const BACTERIA_SVG_MINI = `<svg viewBox="0 0 32 32" width="36" height="36" style="display:block">
  <ellipse cx="16" cy="16" rx="11" ry="7" fill="#7ed957" stroke="#0d0d0d" stroke-width="2"/>
  <circle cx="11" cy="14" r="1.6" fill="#0d0d0d"/>
  <circle cx="18" cy="17" r="1.3" fill="#0d0d0d"/>
  <circle cx="20" cy="13" r="1.0" fill="#0d0d0d"/>
  <line x1="6" y1="14" x2="2" y2="11" stroke="#0d0d0d" stroke-width="2" stroke-linecap="round"/>
  <line x1="6" y1="18" x2="3" y2="22" stroke="#0d0d0d" stroke-width="2" stroke-linecap="round"/>
  <line x1="26" y1="13" x2="30" y2="9" stroke="#0d0d0d" stroke-width="2" stroke-linecap="round"/>
  <line x1="26" y1="18" x2="29" y2="22" stroke="#0d0d0d" stroke-width="2" stroke-linecap="round"/>
</svg>`;

const BACTERIA_SVG = `<svg viewBox="0 0 32 32" width="44" height="44" style="vertical-align:middle;margin-left:8px;filter:drop-shadow(0 3px 0 #b33a1a)">
  <ellipse cx="16" cy="16" rx="11" ry="7" fill="#7ed957" stroke="#0d0d0d" stroke-width="2"/>
  <circle cx="11" cy="14" r="1.6" fill="#0d0d0d"/>
  <circle cx="18" cy="17" r="1.3" fill="#0d0d0d"/>
  <circle cx="20" cy="13" r="1.0" fill="#0d0d0d"/>
  <line x1="6" y1="14" x2="2" y2="11" stroke="#0d0d0d" stroke-width="2" stroke-linecap="round"/>
  <line x1="6" y1="18" x2="3" y2="22" stroke="#0d0d0d" stroke-width="2" stroke-linecap="round"/>
  <line x1="26" y1="13" x2="30" y2="9" stroke="#0d0d0d" stroke-width="2" stroke-linecap="round"/>
  <line x1="26" y1="18" x2="29" y2="22" stroke="#0d0d0d" stroke-width="2" stroke-linecap="round"/>
</svg>`;

function updateZones() {
    if (controls.isPaused()) return;
    const dIce = distanceToNearestIceSample();
    const dLab = player.position.distanceTo(labCenter);
    const dShip = Math.hypot(
        player.position.x - shippingContainer.x,
        player.position.z - shippingContainer.z,
    );
    // notebook beats the lab zone when standing right beside it (so the
    // player can read the manual without accidentally entering the lab).
    if (nearFieldNotebook()) {
        nearZone = "notebook";
        zoneEl.textContent = "Zone: field notebook";
        if (promptTimer <= 0) setPrompt("Click or E! Open the field manual!");
    } else if (dLab < 4) {
        nearZone = "lab";
        zoneEl.textContent = "Zone: lab";
        if (promptTimer <= 0) setPrompt("Click! Enter the lab!");
    } else if (dShip < (shippingContainer.r || 4) + 1.5) {
        nearZone = "ship";
        zoneEl.textContent = "Zone: container lab";
        if (promptTimer <= 0) setPrompt("Click! Enter the container!");
    } else if (dIce < 6) {
        nearZone = "ice";
        zoneEl.textContent = "Zone: ice wall";
        if (promptTimer <= 0) setPrompt("Click! Mine the ice!");
    } else {
        nearZone = null;
        zoneEl.textContent = "Zone: snow";
        if (promptTimer <= 0) setPrompt("");
    }
}

function tryInteract(event) {
    if (controls.isPaused()) return false;
    // raycast for a penguin under the cursor (or screen-centre in FP) — only
    // for mouse clicks, not the E key
    if (event) {
        const p = raycastPenguin(event.clientX, event.clientY);
        if (p) {
            delightPenguin(p);
            return true;
        }
    }
    if (nearZone === "notebook") {
        manual.open();
        return true;
    } else if (nearZone === "ice") {
        startMining();
        return true;
    } else if (nearZone === "lab") {
        navigateToLab();
        return true;
    } else if (nearZone === "ship") {
        navigateToLab2();
        return true;
    }
    return false;
}

let labTransitioning = false;
async function navigateToLab() {
    if (labTransitioning) return;
    labTransitioning = true;
    controls.pause("nav");
    sessionStorage.setItem("todo-visitedLab1", "1");
    setPrompt("Opening the lab…");
    playDoorSound();
    await persistInventory();
    setTimeout(() => {
        window.location.href = "lab.html";
    }, 550);
}

async function navigateToLab2() {
    if (labTransitioning) return;
    labTransitioning = true;
    controls.pause("nav");
    sessionStorage.setItem("todo-visitedLab2", "1");
    setPrompt("Opening the container…");
    playDoorSound();
    await persistInventory();
    setTimeout(() => {
        window.location.href = "lab2.html";
    }, 550);
}

// Track which sample the current mining session will consume — picked at
// startMining() time so the visual that disappears is the one closest to
// the player when they began the swing.
let miningTargetSample = null;

function pickClosestSample() {
    let best = null;
    let bestD2 = Infinity;
    for (const s of iceSamples) {
        if (!s.alive) continue;
        const dx = s.x - player.position.x;
        const dz = s.z - player.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) { bestD2 = d2; best = s; }
    }
    return best;
}

// Distance to the nearest still-alive sample — replaces the single-point
// "iceZoneCenter" test so mining works at any block along the wall, not
// just the ones near the centre of the arc.
function distanceToNearestIceSample() {
    let best = Infinity;
    for (const s of iceSamples) {
        if (!s.alive) continue;
        const dx = s.x - player.position.x;
        const dz = s.z - player.position.z;
        const d = Math.hypot(dx, dz);
        if (d < best) best = d;
    }
    return best;
}

function startMining() {
    mining = true;
    miningElapsed = 0;
    miningStrikesDone = 0;
    miningTargetSample = pickClosestSample();
    controls.pause("mining");
}

function updateMining(dt) {
    if (!mining) {
        // ease body upright when not mining
        player.rotation.x += (0 - player.rotation.x) * Math.min(1, dt * 10);
        return;
    }
    miningElapsed += dt;
    // pickaxe-style swing: tilt forward, oscillate
    const strikePeriod = MINING_DURATION / MINING_STRIKES;
    const swing = (miningElapsed % strikePeriod) / strikePeriod; // 0..1 per strike
    player.rotation.x = 0.15 + Math.sin(swing * Math.PI) * 0.45;
    // strike sound on each forward peak
    const expected = Math.floor(miningElapsed / strikePeriod);
    if (expected > miningStrikesDone && miningElapsed < MINING_DURATION) {
        playMiningHit();
        miningStrikesDone = expected;
    }
    // live countdown prompt
    const remaining = Math.max(0, MINING_DURATION - miningElapsed);
    setPrompt(`Mining… ${remaining.toFixed(1)}s`);

    if (miningElapsed >= MINING_DURATION) {
        mining = false;
        controls.unpause("mining");
        player.rotation.x = 0;
        sampleCount += 1;
        updateHotbar();
        persistInventory();
        if (miningTargetSample && miningTargetSample.alive) {
            miningTargetSample.alive = false;
            iceGroup.remove(miningTargetSample.mesh);
            miningTargetSample = null;
        }
        const swarm = BACTERIA_SVG + BACTERIA_SVG + BACTERIA_SVG;
        flashPromptHTML(`Sample! ${swarm}`, 1700);
        playSampleChime();
    }
}

// --- pause menu --------------------------------------------------------
const manual = createManual();
async function doExport(id, name) {
    setPrompt("Exporting scene…");
    const status = await exportScene(scene, { id, name });
    setPrompt(status);
    setTimeout(() => setPrompt(""), 3000);
}

const menu = createMenu({
    title: "Antarctic Sampler",
    subtitle: "Field Camp · Day 1",
    primaryActions: [
        {
            label: "Field Manual",
            primary: true,
            onClick: () => manual.open(),
        },
        {
            label: "Export Scene",
            onClick: () => doExport("main", "Antarctic Base"),
        },
        {
            label: "New Game",
            danger: true,
            onClick: () => triggerNewGame(),
        },
    ],
    sliders: [
        { label: "Move",     min: 1,   max: 12,  step: 0.1,  get: () => controls.params.moveSpeed,       set: (v) => { controls.params.moveSpeed = v; controls.persistPrefs(); } },
        { label: "Sprint",   min: 4,   max: 18,  step: 0.1,  get: () => controls.params.sprintSpeed,     set: (v) => { controls.params.sprintSpeed = v; controls.persistPrefs(); } },
        { label: "Look",     min: 0.2, max: 3,   step: 0.05, get: () => controls.params.lookSensitivity, set: (v) => { controls.params.lookSensitivity = v; controls.persistPrefs(); } },
        { label: "Jump",     min: 3,   max: 14,  step: 0.1,  get: () => params.jumpVelocity,  set: (v) => (params.jumpVelocity = v) },
        { label: "Gravity",  min: 5,   max: 40,  step: 0.5,  get: () => params.gravity,       set: (v) => (params.gravity = v) },
        { label: "SFX",      min: 0,   max: 1,   step: 0.02, get: () => params.sfxVolume,     set: (v) => (params.sfxVolume = v) },
        { label: "Sun",      min: 0,   max: 2,   step: 0.05, get: () => params.sunBase,       set: (v) => (params.sunBase = v) },
        { label: "Hemi",     min: 0,   max: 2,   step: 0.05, get: () => params.hemiBase,      set: (v) => (params.hemiBase = v) },
        { label: "Clouds",   min: 0,   max: 1,   step: 0.02, get: () => params.cloudStrength, set: (v) => (params.cloudStrength = v) },
        { label: "Fog far",  min: 20,  max: 120, step: 1,    get: () => scene.fog.far,        set: (v) => (scene.fog.far = v) },
    ],
});

// --- resize ------------------------------------------------------------
function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// floating head-anchored prompt now shared via controls.updatePromptPosition

// hotbar
let cultureCount = 0;
// --- mission todo list (top-right) ------------------------------------
mountTodoList(
    document.getElementById("todo-list"),
    () => ({ samples: sampleCount, cultures: cultureCount }),
);

const hotbarSlots = document.querySelectorAll("#hotbar .slot");
let selectedSlot = 0;
function totalFilled() {
    return Math.min(10, cultureCount + sampleCount);
}
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
    handBacteria.visible = selectedSlot < totalFilled();
}
let inventoryFrozen = false;
async function persistInventory() {
    if (inventoryFrozen) return;
    await saveInventory({
        samples: sampleCount,
        cultures: cultureCount,
        lastPos: { x: player.position.x, z: player.position.z },
    });
}

// save on tab hide / unload so position survives a refresh
window.addEventListener("pagehide", () => persistInventory());
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistInventory();
});
function selectSlot(i) {
    if (i < 0 || i > 9) return;
    selectedSlot = i;
    updateHotbar();
}

// thrown bacteria projectiles
const thrownBacteria = [];
const _handLocal = new THREE.Vector3();
function throwSample() {
    // Slot layout: cultures occupy slots 0..cultureCount-1, samples follow.
    // The throw consumes whichever inventory the selected slot points at.
    const total = cultureCount + sampleCount;
    if (selectedSlot >= total) return; // empty slot
    const isCulture = selectedSlot < cultureCount;
    sessionStorage.setItem("todo-thrown", "1");
    _handLocal.set(0.45, 1.05, 0.35);
    const handWorld = _handLocal.applyMatrix4(player.matrixWorld);
    let mesh;
    if (isCulture) {
        // a flat petri-dish disc — different visual so the cultured
        // throw doesn't look identical to a raw sample
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
        // Tiny green colony on the upper face so the dish reads as cultured.
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
    const speed = 9;
    thrownBacteria.push({
        mesh,
        vx: Math.sin(yaw) * speed,
        vz: Math.cos(yaw) * speed,
        vy: 5.5,
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
            // gentle floor wobble so the bacterium reads as "alive" / pickupable
            p.mesh.rotation.y += dt * 0.6;
            p.mesh.position.y = 0.13 + Math.sin(p.age * 3) * 0.02;
        }
        // proximity pickup — must be at least 0.5 s old to avoid instant re-grab
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
                playSampleChime();
                flashPromptHTML(`Picked up! ${BACTERIA_SVG}`, 1000);
                continue;
            }
        }
        if (p.age > 30) {
            scene.remove(p.mesh);
            p.mesh.geometry.dispose();
            p.mesh.material.dispose();
            thrownBacteria.splice(i, 1);
        }
    }
}

// minimap
const minimapEl = document.getElementById("minimap");
const minimapCtx = minimapEl ? minimapEl.getContext("2d") : null;
const MAP_SIZE = 200;
const MAP_SCALE = MAP_SIZE / (WORLD_RADIUS * 2 + 8);
// (drawMiniSquareWS / drawMiniDotWS replaced by mapShadows iteration in
// drawMinimap — kept here as a marker in case we re-add ad-hoc helpers.)

// position the headlamp at the player's head and aim it along the camera
// yaw + pitch so light goes wherever you're looking. Falls back to player
// rotation when in third-person idle (no pitch).
function updateHeadlamp() {
    const headY = player.position.y + 1.7;
    headlamp.position.set(player.position.x, headY, player.position.z);
    const yaw = controls.cameraState.yaw;
    const pitch = controls.cameraState.pitch;
    const cy = Math.cos(pitch);
    const reach = 8;
    headlampTarget.position.set(
        player.position.x + Math.sin(yaw) * cy * reach,
        headY + Math.sin(pitch) * reach,
        player.position.z + Math.cos(yaw) * cy * reach,
    );
}

function drawMinimap() {
    if (!minimapCtx) return;
    minimapCtx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
    const cx = MAP_SIZE / 2;
    const cy = MAP_SIZE / 2;

    // optional bg for the disc-clipped map
    minimapCtx.save();
    minimapCtx.beginPath();
    minimapCtx.arc(cx, cy, cx - 2, 0, Math.PI * 2);
    minimapCtx.clip();

    // ===== WORLD-SPACE TRANSFORM =====
    // Compose: T(cx,cy) · R(heading - π) · T(-player.x*scale, -player.z*scale)
    //   - innermost moves player to origin
    //   - rotation aligns the player's facing direction with canvas-up
    //   - outer moves the rotated origin to the canvas centre
    // Result: player sits dead-centre, the world spins beneath them.
    const heading = player.rotation.y;
    minimapCtx.translate(cx, cy);
    minimapCtx.rotate(heading - Math.PI);
    minimapCtx.translate(
        -player.position.x * MAP_SCALE,
        -player.position.z * MAP_SCALE,
    );

    // (ice-zone sector removed — when the player walked off centre it
    // looked like a giant cone competing with the look-cone above.)

    // ground-shadow rectangles + circles for every prop registered above
    for (const s of mapShadows) {
        if (s.type === "rect") {
            minimapCtx.save();
            minimapCtx.translate(s.x * MAP_SCALE, s.z * MAP_SCALE);
            minimapCtx.rotate(s.angle);
            const w = s.hw * 2 * MAP_SCALE;
            const h = s.hd * 2 * MAP_SCALE;
            // soft drop-shadow first so the rect reads as ground footprint
            minimapCtx.fillStyle = "rgba(0, 0, 0, 0.35)";
            minimapCtx.fillRect(-s.hw * MAP_SCALE + 1, -s.hd * MAP_SCALE + 1, w, h);
            minimapCtx.fillStyle = s.color;
            minimapCtx.fillRect(-s.hw * MAP_SCALE, -s.hd * MAP_SCALE, w, h);
            minimapCtx.strokeStyle = "rgba(0,0,0,0.55)";
            minimapCtx.lineWidth = 0.8;
            minimapCtx.strokeRect(-s.hw * MAP_SCALE, -s.hd * MAP_SCALE, w, h);
            minimapCtx.restore();
        } else if (s.type === "circle") {
            const r = s.r * MAP_SCALE;
            minimapCtx.fillStyle = "rgba(0, 0, 0, 0.35)";
            minimapCtx.beginPath();
            minimapCtx.arc(s.x * MAP_SCALE + 1, s.z * MAP_SCALE + 1, r, 0, Math.PI * 2);
            minimapCtx.fill();
            minimapCtx.fillStyle = s.color;
            minimapCtx.beginPath();
            minimapCtx.arc(s.x * MAP_SCALE, s.z * MAP_SCALE, r, 0, Math.PI * 2);
            minimapCtx.fill();
        }
    }

    // penguins — small soft-shadow dots
    for (const p of penguins) {
        const px = p.mesh.position.x * MAP_SCALE;
        const pz = p.mesh.position.z * MAP_SCALE;
        minimapCtx.fillStyle = "rgba(0,0,0,0.4)";
        minimapCtx.beginPath();
        minimapCtx.arc(px + 0.6, pz + 0.6, 2.2, 0, Math.PI * 2);
        minimapCtx.fill();
        minimapCtx.fillStyle = "#ffffff";
        minimapCtx.beginPath();
        minimapCtx.arc(px, pz, 2, 0, Math.PI * 2);
        minimapCtx.fill();
    }

    // look cone — drawn IN the rotated/translated transform so it points
    // along cameraState.yaw in world space. Tip lives at the player's world
    // position; its angle relative to the player's heading gives an honest
    // "where I'm looking vs where I'm walking" cue.
    const camYaw = controls.cameraState.yaw;
    const halfFov = Math.PI / 6;
    const reachW = 14; // world metres
    const r = reachW * MAP_SCALE;
    const px = player.position.x * MAP_SCALE;
    const pz = player.position.z * MAP_SCALE;
    const lx = px + Math.sin(camYaw - halfFov) * r;
    const ly = pz + Math.cos(camYaw - halfFov) * r;
    const rx = px + Math.sin(camYaw + halfFov) * r;
    const ry = pz + Math.cos(camYaw + halfFov) * r;
    minimapCtx.fillStyle = "rgba(255, 225, 86, 0.32)";
    minimapCtx.strokeStyle = "rgba(255, 225, 86, 0.65)";
    minimapCtx.lineWidth = 1;
    minimapCtx.beginPath();
    minimapCtx.moveTo(px, pz);
    minimapCtx.lineTo(lx, ly);
    minimapCtx.lineTo(rx, ry);
    minimapCtx.closePath();
    minimapCtx.fill();
    minimapCtx.stroke();

    minimapCtx.restore();

    // player marker — always dead centre on top of the rotating map
    minimapCtx.fillStyle = "#ff7043";
    minimapCtx.strokeStyle = "rgba(0,0,0,0.7)";
    minimapCtx.lineWidth = 1.2;
    minimapCtx.beginPath();
    minimapCtx.arc(cx, cy, 5, 0, Math.PI * 2);
    minimapCtx.fill();
    minimapCtx.stroke();

    // little "N" tick at the canvas top so the user can tell which way is
    // north as the map rotates beneath them.
    minimapCtx.save();
    minimapCtx.fillStyle = "rgba(255, 255, 255, 0.55)";
    minimapCtx.font = "bold 10px ui-monospace, monospace";
    minimapCtx.textAlign = "center";
    minimapCtx.textBaseline = "top";
    // draw "N" on the rotated north — north is world -z, which is
    // (currently) canvas position offset from centre by rotation(heading-π)·(0,-1)
    // = (sin(heading), -cos(heading)) (after normalising). Snap to ring radius.
    const ringR = cx - 10;
    const nAngle = heading - Math.PI; // rotation applied to (0, -1)
    const nx = cx + Math.sin(nAngle) * ringR;
    const ny = cy - Math.cos(nAngle) * ringR;
    minimapCtx.fillText("N", nx, ny - 6);
    minimapCtx.restore();
}

const loaderEl = document.getElementById("loader");
function hideLoader() {
    if (!loaderEl) return;
    loaderEl.classList.add("fade-out");
    setTimeout(() => loaderEl.remove(), 800);
}

// load persisted inventory + welcome shout (conditional on URL ?from=...)
const fromQuery = new URLSearchParams(window.location.search).get("from");
getInventory().then((inv) => {
    sampleCount = inv.samples || 0;
    cultureCount = inv.cultures || 0;
    updateHotbar();
    // restore last outdoor position when not arriving from another page
    if (!fromQuery && inv.lastPos && Number.isFinite(inv.lastPos.x)) {
        player.position.set(inv.lastPos.x, 0, inv.lastPos.z);
    }
});
if (fromQuery === "lab") {
    player.position.copy(LAB_EXIT_POS);
    controls.cameraState.yaw = 0;
    flashPrompt("Back outside!", 2500);
} else if (fromQuery === "ship") {
    // respawn next to the shipping container
    player.position.set(shippingContainer.x, 0, shippingContainer.z + (shippingContainer.r || 4) + 2);
    controls.cameraState.yaw = Math.PI;
    flashPrompt("Back outside!", 2500);
} else {
    flashPrompt("I should find some sampleee for my paperrr", 5000);
}

async function triggerNewGame() {
    if (!confirm("Start a new game? Everything will be reset.")) return;
    // Stop the pagehide / visibilitychange persist listeners from racing
    // a stale state back into IDB while we're in the middle of wiping it.
    inventoryFrozen = true;
    await resetGame();
    sessionStorage.setItem("newGameLoading", "1");
    window.location.href = "outdoor.html";
}
document.getElementById("new-game").addEventListener("click", (e) => {
    e.preventDefault();
    triggerNewGame();
});

// --- main loop ---------------------------------------------------------
let last = performance.now();
function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    update(dt);
    updateMining(dt);
    controls.syncFP(playerRig, () => selectedSlot < totalFilled());
    updateCamera(dt);
    updateZones();
    updateClouds(dt);
    updateSnow(dt, now);
    updateFootprints(dt);
    updateHearts(dt);
    updateThrown(dt);
    updatePenguins(dt, now);
    updateHeadlamp();
    drawMinimap();
    // sign plaques: pendulum swing around their mount, scaled by wind.
    // The wrapper groups are anchored AT the pole, so rotating in Y swings
    // the plaque toward / away from the wind like a hanging sign. A small
    // Z component gives it a forward / back twist on top.
    const tFlag = now / 1000;
    const wMag = Math.hypot(weatherWindX, weatherWindZ);
    const yawAmp = 0.12 + Math.min(0.4, wMag * 0.4);
    const rollAmp = 0.05 + Math.min(0.10, wMag * 0.10);
    for (let i = 0; i < flagsToSway.length; i++) {
        const f = flagsToSway[i];
        f.rotation.y = Math.sin(tFlag * 1.4 + i * 0.7) * yawAmp;
        f.rotation.z = Math.sin(tFlag * 0.9 + i * 0.5 + 1.0) * rollAmp;
    }
    // cloth flags: per-vertex ripple. Amplitude grows toward the fly end so
    // the hoist (attached to the pole) stays still and the free edge waves.
    // Wind magnitude (set by updateSnow) scales the amplitude so the flag
    // and the snowfall share a single weather state.
    const windMag = Math.hypot(weatherWindX, weatherWindZ);
    const windScale = 0.6 + Math.min(2.0, windMag * 1.2);
    for (const cf of clothFlags) {
        const pos = cf.mesh.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const lx = pos.getX(i);
            const ly = pos.getY(i);
            // fly-end weight: 0 at hoist, 1 at fly end
            const flyT = (lx - cf.hoistLocalX) / (cf.planeWidth);
            const ripple =
                Math.sin(lx * 3.2 + tFlag * 4.5) * 0.10 * flyT * windScale +
                Math.sin(ly * 2.4 + tFlag * 3.1) * 0.04 * flyT * windScale;
            pos.setZ(i, ripple);
        }
        pos.needsUpdate = true;
    }
    if (antarcticMan) antarcticMan.rotation.z = Math.sin(now / 1100) * 0.02;
    // bob + spin the live ice samples so they read as collectibles
    for (let i = 0; i < iceSamples.length; i++) {
        const s = iceSamples[i];
        if (!s.alive) continue;
        s.mesh.position.y = s.sideY + Math.sin(now / 600 + i) * 0.07;
        s.mesh.rotation.y += dt * 1.2;
    }
    controls.updatePromptPosition(player, camera, promptEl, renderer);

    if (promptTimer > 0) {
        promptTimer -= dt;
        if (promptTimer <= 0) setPrompt("");
    }

    // hand bacteria float + spin
    if (handBacteria.visible) {
        const tSec = now / 1000;
        handBacteria.position.y = 1.05 + Math.sin(tSec * 2.4) * 0.05;
        handBacteria.rotation.y += dt * 1.6;
    }

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
