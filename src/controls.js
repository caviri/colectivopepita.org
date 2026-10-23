import * as THREE from "three";

// Shared input state used by every page (main, lab, lab2). Exporting plain
// objects so the runtime can mutate values directly — page code reads
// `cameraState.yaw` etc. each frame to decide where the camera sits and
// which way "forward" points.
//
// Mode is a five-state enum, single source of truth for the camera:
//   "follow"        – third-person, camera tracks behind player
//   "orbit"         – third-person, mouse-drag / Q-E rotates around player
//   "isometric"     – third-person, fixed top-down-45° view, Q/E rotate scene
//   "fp-temp"       – first-person while right mouse button is held
//   "fp-persistent" – first-person locked in via V; right-click → zoom
// Transitions:
//   Tab           : follow → orbit → isometric → follow
//   V             : 3p ↔ fp-persistent (preserves which 3p mode)
//   right-down    : 3p → fp-temp   (or zoom in fp-persistent)
//   right-up      : fp-temp → previous 3p mode (or zoom out in fp-persistent)
export const keys = new Set();
export const cameraState = {
    mode: "follow",
    yaw: 0,
    pitch: -0.18,
    followHeight: 5.5,
    followDist: 8,
    targetOffset: 1.2,
    zoom: 1, // 1 = normal, < 1 = zoomed in (smaller FOV)
    baseFov: 60,
};

// Isometric camera config. Pitch is locked, distance is wider than
// follow so the player doesn't fill the frame in the steeper angle.
const ISO = {
    pitch: -Math.PI / 4,    // 45° down
    dist: 16,
    height: 1.5,
};

const ROTATE_SPEED = 1.8; // rad/sec for held-Q / held-E in 3p modes

export function isFP() {
    return cameraState.mode === "fp-temp" || cameraState.mode === "fp-persistent";
}
export function isThirdPerson() {
    return cameraState.mode === "follow"
        || cameraState.mode === "orbit"
        || cameraState.mode === "isometric";
}
export function isIsometric() {
    return cameraState.mode === "isometric";
}

let canvasEl = null;
let pointerLocked = false;
let orbitDragging = false;
let middleDragging = false; // middle-mouse temporary orbit
let prevModeBeforeMiddle = "follow"; // 3p mode to restore on middle release
let prevTPmode = "follow"; // remembered when leaving 3p, restored on return
let lastClient = null; // fallback for mouse delta when pointer lock isn't active
let initialized = false;
let playerRef = null;   // pages register a player ref via setPlayer()


const _desired = new THREE.Vector3();
const _target = new THREE.Vector3();

// Pages call this once after creating their player rig. It lets the
// controls module rotate the player's heading to match the camera yaw
// when leaving any first-person mode — so the third-person camera lands
// looking the same direction the player was looking, rather than
// snapping back behind the player.
export function setPlayer(player) {
    playerRef = player;
}
function alignPlayerToCameraYaw() {
    if (playerRef && playerRef.rotation) {
        playerRef.rotation.y = cameraState.yaw;
    }
}

function wrapAngle(d) {
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
}

// Cycle the 3p modes. follow → orbit → isometric → follow. No-op while
// in any FP mode. Switching INTO isometric snaps yaw to a tidy diagonal
// so the first frame doesn't catch the player at a weird offset.
function cycleThirdPerson() {
    if (cameraState.mode === "follow") cameraState.mode = "orbit";
    else if (cameraState.mode === "orbit") {
        cameraState.mode = "isometric";
        cameraState.pitch = ISO.pitch;
    } else if (cameraState.mode === "isometric") {
        cameraState.mode = "follow";
    }
}

// V key — toggle persistent first-person, preserving which 3p mode to
// return to.
function togglePersistentFP() {
    if (cameraState.mode === "fp-persistent") {
        // Leaving FP: align the player heading with the current camera
        // yaw so 3p starts looking the same direction the user was
        // looking in FP, not snapped back behind the player.
        alignPlayerToCameraYaw();
        cameraState.mode = prevTPmode;
        cameraState.zoom = 1;
        document.body.classList.remove("fp-zoom");
        document.exitPointerLock?.();
    } else {
        if (isThirdPerson()) prevTPmode = cameraState.mode;
        cameraState.mode = "fp-persistent";
        canvasEl?.requestPointerLock?.();
    }
}

export function setMode(mode) {
    cameraState.mode = mode;
}

export function getMode() {
    return cameraState.mode;
}

// User preferences persisted to localStorage so settings stick across page
// reloads + page-to-page navigation. Tiny payload, sync read at startup —
// no need for the IndexedDB pipeline.
const PREF_KEY = "antarctic-sampler-prefs";
let prefsLoaded = false;
function loadPrefs() {
    try {
        const raw = localStorage.getItem(PREF_KEY);
        if (!raw) return;
        const p = JSON.parse(raw);
        if (typeof p.moveSpeed === "number") params.moveSpeed = p.moveSpeed;
        if (typeof p.sprintSpeed === "number") params.sprintSpeed = p.sprintSpeed;
        if (typeof p.lookSensitivity === "number") {
            params.lookSensitivity = p.lookSensitivity;
        }
        // only persistent FP is worth restoring; transient modes (fp-temp,
        // orbit) reset on each session.
        if (p.mode === "fp-persistent") cameraState.mode = "fp-persistent";
    } catch { /* corrupt prefs — ignore */ }
}
export function persistPrefs() {
    try {
        localStorage.setItem(PREF_KEY, JSON.stringify({
            moveSpeed: params.moveSpeed,
            sprintSpeed: params.sprintSpeed,
            lookSensitivity: params.lookSensitivity,
            mode: cameraState.mode === "fp-persistent" ? "fp-persistent" : "follow",
        }));
    } catch { /* quota exceeded / private mode — silent */ }
}

// Pause registry. Multiple sources can pause input concurrently (debug
// panel + petri modal + nav transition…) and each unpauses with the same
// reason key. Pages call `controls.pause("debug")` / `controls.unpause("debug")`
// so we don't end up with stale flags.
const pauseReasons = new Set();
export function pause(reason) { pauseReasons.add(reason); }
export function unpause(reason) { pauseReasons.delete(reason); }
export function isPaused() { return pauseReasons.size > 0; }
export function pauseReasonsList() { return [...pauseReasons]; }

export function init(canvas) {
    if (initialized) {
        // page navigated to a new instance — reattach to fresh canvas
        canvasEl = canvas;
        return;
    }
    initialized = true;
    canvasEl = canvas;
    if (!prefsLoaded) {
        loadPrefs();
        prefsLoaded = true;
        // persistent-FP restored from prefs needs a pointer-lock when the
        // user clicks (browsers refuse pointer-lock without a user gesture).
        if (cameraState.mode === "fp-persistent") {
            const grab = () => {
                canvasEl?.requestPointerLock?.();
                canvas.removeEventListener("click", grab);
            };
            canvas.addEventListener("click", grab);
        }
    }

    window.addEventListener("keydown", (e) => {
        keys.add(e.code);
        if (e.code === "Tab") {
            e.preventDefault();
            cycleThirdPerson();
        }
        if (e.code === "KeyV") {
            togglePersistentFP();
            persistPrefs();
        }
        // First Q/E tap from follow flips into orbit so the rotation
        // sticks (follow auto-tracks player facing every frame and
        // would overwrite our delta). The actual rotation runs
        // continuously in updateCamera while keys are held — that path
        // is smooth at any framerate, no keyboard auto-repeat delay.
        if ((e.code === "KeyQ" || e.code === "KeyE")
            && cameraState.mode === "follow") {
            cameraState.mode = "orbit";
        }
    });
    window.addEventListener("keyup", (e) => keys.delete(e.code));

    document.addEventListener("pointerlockchange", () => {
        pointerLocked = document.pointerLockElement === canvasEl;
        // Browser jumps the cursor to centre on lock, and back to its
        // pre-lock position on unlock. Either jump would produce a huge
        // bogus delta on the next mousemove — clearing lastClient makes
        // the first post-transition event a 0-delta seed instead.
        lastClient = null;
    });

    // mouse delta — when pointer-lock is active we get e.movementX directly,
    // otherwise we fall back to client-position deltas so first-person still
    // works if pointer-lock fails (browser denies, embedded iframes, etc.).
    document.addEventListener("mousemove", (e) => {
        // Belt-and-suspenders: if we somehow missed the right-button
        // release (rare, but happens when focus shifts away mid-drag,
        // when a context-menu intercept eats the up event, etc.) drop
        // out of fp-temp the moment we see a mousemove without button 2
        // held. e.buttons is a bitfield: bit 1 = LMB, bit 2 = RMB.
        if (cameraState.mode === "fp-temp" && (e.buttons & 2) === 0) {
            alignPlayerToCameraYaw();
            clearLeftZoom();
            cameraState.mode = prevTPmode;
            document.exitPointerLock?.();
            lastClient = null;
            return; // skip this event so we don't apply a stale delta
        }
        let dx, dy;
        if (pointerLocked) {
            dx = e.movementX;
            dy = e.movementY;
        } else {
            if (lastClient) {
                dx = e.clientX - lastClient.x;
                dy = e.clientY - lastClient.y;
            } else {
                dx = dy = 0;
            }
            lastClient = { x: e.clientX, y: e.clientY };
        }
        // Reject obviously bogus deltas. We deliberately *drop* the event
        // (dx = dy = 0) rather than clamp it, because clamping a 1000-pixel
        // edge-clamp jump down to e.g. ±200 still applies a real yaw step
        // — and if several artifacts fire back-to-back, those clamped steps
        // sum into the "whip-spin" feel. Throwing them out costs us at most
        // one missed legitimate flick (rare; user feels nothing) and stops
        // the spin completely.
        //
        // Pointer-locked mode is more trustworthy (the browser hides the
        // cursor and reports motion deltas free of edge clamping), so the
        // threshold is generous. Unlocked mode is paranoid: any single
        // event >80 px on a 60-fps mouse is almost certainly artificial.
        const reject = pointerLocked ? 400 : 80;
        if (Math.abs(dx) > reject || Math.abs(dy) > reject) {
            dx = 0;
            dy = 0;
        }
        const sens = params.lookSensitivity;
        if (isFP()) {
            cameraState.yaw -= dx * 0.005 * sens;
            cameraState.pitch -= dy * 0.005 * sens;
        } else if (cameraState.mode === "orbit" &&
                   (orbitDragging || middleDragging)) {
            cameraState.yaw -= dx * 0.006 * sens;
            cameraState.pitch -= dy * 0.006 * sens;
        }
        const lim = Math.PI / 2 - 0.05;
        cameraState.pitch = Math.max(-lim, Math.min(lim, cameraState.pitch));
    });

    canvas.addEventListener("mousedown", (e) => {
        if (e.button === 2) {
            if (cameraState.mode === "fp-persistent") {
                // already locked-in FP — right-click is just zoom
                cameraState.zoom = 0.45;
                document.body.classList.add("fp-zoom");
            } else if (isThirdPerson()) {
                // remember 3p side so right-up restores it
                prevTPmode = cameraState.mode;
                cameraState.mode = "fp-temp";
                orbitDragging = false;
                lastClient = null;
                canvas.requestPointerLock?.();
            }
        } else if (e.button === 1 && isThirdPerson()) {
            // Middle button — temporary orbit. Hold and drag to rotate
            // around the player; release returns to whichever 3p mode
            // we were in (typically follow). The button-release reverts
            // cameraState.mode, so this is non-destructive: user keeps
            // their preferred default 3p behaviour.
            e.preventDefault();
            prevModeBeforeMiddle = cameraState.mode;
            cameraState.mode = "orbit";
            middleDragging = true;
            lastClient = null;
        } else if (e.button === 0 && cameraState.mode === "orbit") {
            orbitDragging = true;
            lastClient = null;
        }
    });
    // mouseup on WINDOW, not canvas — so releasing the right button while
    // the cursor is outside the canvas (or even outside the page) still
    // ends fp-temp cleanly. With this on canvas, an off-canvas release
    // left mode stuck in fp-temp and every subsequent mousemove kept
    // applying yaw, producing the "spin on cursor re-entry" bug.
    window.addEventListener("mouseup", (e) => {
        if (e.button === 2) {
            if (cameraState.mode === "fp-persistent") {
                cameraState.zoom = 1;
                document.body.classList.remove("fp-zoom");
            } else if (cameraState.mode === "fp-temp") {
                // Align the player heading with the FP camera yaw before
                // snapping back to 3p — preserves the orientation the
                // user was looking at instead of rotating the camera back
                // to behind a stale-facing player.
                alignPlayerToCameraYaw();
                clearLeftZoom();
                cameraState.mode = prevTPmode;
                document.exitPointerLock?.();
            }
        }
        if (e.button === 1 && middleDragging) {
            middleDragging = false;
            cameraState.mode = prevModeBeforeMiddle;
        }
        if (e.button === 0) {
            // Releasing left ONLY clears the optional left-click zoom; we
            // never touch cameraState.mode here. So if the user is in
            // fp-temp (right held) and let-go of left, they smoothly fall
            // back from "zoomed detail" to plain first-person — pointer
            // lock stays put, mode stays fp-temp, only the FOV resets.
            orbitDragging = false;
            clearLeftZoom();
        }
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
}

// "Press right + then press left while there's nothing to interact with
// → zoom in." Pages call tryLeftClickZoom() from their left-click
// handler when no interaction was consumed; controls.js will only
// engage if the camera is currently in fp-temp (right held in 3p).
let leftZoomActive = false;
export function tryLeftClickZoom() {
    if (leftZoomActive) return;
    if (cameraState.mode !== "fp-temp") return;
    leftZoomActive = true;
    // Aggressive target — 0.32 ≈ 3.1× magnification so the held detail
    // really fills the screen. The slow FOV lerp in updateCamera turns
    // this into a smooth pequeño→detalle ramp.
    cameraState.zoom = 0.32;
    document.body.classList.add("fp-zoom");
}
function clearLeftZoom() {
    if (!leftZoomActive) return;
    leftZoomActive = false;
    cameraState.zoom = 1;
    document.body.classList.remove("fp-zoom");
}

// Position the camera each frame. Page code passes the player Group and
// the desired follow distances/heights; the function chooses behaviour
// based on cameraState.mode.
export function updateCamera(dt, player, camera, opts = {}) {
    const followHeight = opts.followHeight ?? cameraState.followHeight;
    const followDist = opts.followDist ?? cameraState.followDist;
    const targetOffset = opts.targetOffset ?? cameraState.targetOffset;

    // Continuous Q/E rotation in any 3p mode. Per-frame so it's smooth
    // and has no keyboard-repeat delay. follow gets converted to orbit
    // by the keydown handler above; isometric keeps its locked pitch.
    if (isThirdPerson() && !isPaused()) {
        let yawDelta = 0;
        if (keys.has("KeyQ")) yawDelta += ROTATE_SPEED * dt;
        if (keys.has("KeyE")) yawDelta -= ROTATE_SPEED * dt;
        if (yawDelta) cameraState.yaw += yawDelta;
    }

    // smooth FOV toward zoom target — slower lerp so the hold-to-zoom
    // reads as a clear cinematic ramp rather than an instant snap. ~300 ms
    // for a full zoom-in / zoom-out at 60 fps.
    const targetFov = cameraState.baseFov * cameraState.zoom;
    const fovDelta = targetFov - camera.fov;
    if (Math.abs(fovDelta) > 0.05) {
        camera.fov += fovDelta * Math.min(1, dt * 5);
        camera.updateProjectionMatrix();
    }

    // follow mode: smoothly lerp yaw toward the player's facing direction,
    // and ease pitch back to a relaxed slight-down angle.
    if (cameraState.mode === "follow") {
        const dy = wrapAngle(player.rotation.y - cameraState.yaw);
        cameraState.yaw += dy * Math.min(1, dt * 2.5);
        cameraState.pitch += (-0.18 - cameraState.pitch) * Math.min(1, dt * 3);
    }
    // isometric: pitch locked at -45°, fixed distance. Yaw is freely
    // controllable by Q/E or middle-mouse drag.
    if (cameraState.mode === "isometric") {
        cameraState.pitch = ISO.pitch;
    }

    if (isFP()) {
        camera.position.set(
            player.position.x,
            player.position.y + 1.7,
            player.position.z,
        );
        const cy = Math.cos(cameraState.pitch);
        const fx = Math.sin(cameraState.yaw) * cy;
        const fy = Math.sin(cameraState.pitch);
        const fz = Math.cos(cameraState.yaw) * cy;
        camera.lookAt(
            camera.position.x + fx,
            camera.position.y + fy,
            camera.position.z + fz,
        );
        return;
    }

    // follow / orbit / isometric — same third-person formula. Iso uses
    // its own distance + a smaller height offset so the angle reads as
    // top-down, not chase-cam.
    const isoActive = cameraState.mode === "isometric";
    const dist = isoActive ? ISO.dist : followDist;
    const height = isoActive ? ISO.height : followHeight;
    const cy = Math.cos(cameraState.pitch);
    const ox = Math.sin(cameraState.yaw) * dist * cy;
    const oy = -Math.sin(cameraState.pitch) * dist;
    const oz = Math.cos(cameraState.yaw) * dist * cy;
    _desired.set(
        player.position.x - ox,
        player.position.y + height + oy,
        player.position.z - oz,
    );
    // Iso snaps tighter (no chase-cam lag) so the world rotates cleanly
    // around the player while keys are held; follow/orbit keep the
    // smooth lerp that gives the camera its weight.
    camera.position.lerp(_desired, Math.min(1, dt * (isoActive ? 14 : 6)));
    _target.set(
        player.position.x,
        player.position.y + targetOffset,
        player.position.z,
    );
    camera.lookAt(_target);
}

// Build the player rig (capsule body + head + nose + held bacterium) shared
// across every scene. Returns an object with named refs so callers don't
// have to re-traverse to find specific parts.
export function createPlayer() {
    const group = new THREE.Group();

    const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.35, 0.9, 6, 12),
        new THREE.MeshStandardMaterial({ color: 0xff7043, roughness: 0.7 }),
    );
    body.position.y = 0.9;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 16, 12),
        new THREE.MeshStandardMaterial({ color: 0xf2c79b, roughness: 0.8 }),
    );
    head.position.y = 1.7;
    head.castShadow = true;
    group.add(head);

    const nose = new THREE.Mesh(
        new THREE.ConeGeometry(0.08, 0.18, 8),
        new THREE.MeshStandardMaterial({ color: 0x222222 }),
    );
    nose.position.set(0, 1.7, 0.28);
    nose.rotation.x = Math.PI / 2;
    group.add(nose);

    const hand = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 14, 10),
        new THREE.MeshStandardMaterial({
            color: 0x7ed957,
            emissive: 0x2c5c1d,
            emissiveIntensity: 0.55,
            roughness: 0.5,
        }),
    );
    hand.scale.set(1.5, 0.95, 1.5);
    hand.position.set(0.45, 1.05, 0.35);
    hand.visible = false;
    hand.castShadow = true;
    group.add(hand);

    return { group, body, head, nose, hand };
}

// Hide body / head / nose / hand whenever we're inside the player's eyes,
// so they don't see the inside of their own meshes. `handVisibleFn` is an
// optional predicate the page uses to decide when the held item should
// show in third-person (e.g., "selected slot is filled").
export function syncFP(rig, handVisibleFn) {
    const fp = isFP();
    rig.body.visible = !fp;
    rig.head.visible = !fp;
    rig.nose.visible = !fp;
    if (fp) rig.hand.visible = false;
    else if (handVisibleFn) rig.hand.visible = !!handVisibleFn();
}

// Movement / look parameters shared across pages. Debug-panel sliders in
// main.js mutate these and call `persistPrefs()`; lab pages just consume.
export const params = {
    moveSpeed: 5.5,
    sprintSpeed: 9,
    lookSensitivity: 1.0, // multiplier on mouse-look deltas (FP + orbit)
};

const _move = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _result = { moved: false, sprinting: false, f: 0, s: 0 };

// Read WASD/arrows, build camera-relative move vector, advance the player
// and rotate them toward the heading. Returns a recyclable object so the
// caller can drive walk-bob / footsteps based on `moved` and `sprinting`.
// `opts.sprint = false` disables the Shift-sprint multiplier.
export function applyMovement(dt, player, opts = {}) {
    _result.moved = false;
    _result.sprinting = false;
    _result.f = 0;
    _result.s = 0;
    if (isPaused()) return _result;
    let f = 0, s = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) f += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) f -= 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) s -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) s += 1;
    _result.f = f;
    _result.s = s;
    if (!f && !s) return _result;

    const sprintAllowed = opts.sprint !== false;
    const sprinting =
        sprintAllowed && (keys.has("ShiftLeft") || keys.has("ShiftRight"));
    const speed = sprinting ? params.sprintSpeed : params.moveSpeed;

    _fwd.set(Math.sin(cameraState.yaw), 0, Math.cos(cameraState.yaw));
    _right.set(-_fwd.z, 0, _fwd.x);
    _move
        .set(0, 0, 0)
        .addScaledVector(_fwd, f)
        .addScaledVector(_right, s);
    if (_move.lengthSq() === 0) return _result;

    _move.normalize().multiplyScalar(speed * dt);
    player.position.add(_move);

    const targetYaw = Math.atan2(_move.x, _move.z);
    let dy = targetYaw - player.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    player.rotation.y += dy * Math.min(1, dt * 10);

    _result.moved = true;
    _result.sprinting = sprinting;
    return _result;
}

// Per-page jump physics — pages keep their own vy/grounded state but
// the gravity integration + Space-key wiring + ground-snap is shared.
// Caller passes a `state` object holding `{ vy, grounded }` and an
// optional `groundFn(x, z)` for terrain-following ground level.
export const jumpParams = {
    velocity: 6.5,
    gravity: 22,
};

export function applyJump(dt, player, state, opts = {}) {
    if (isPaused()) return state;
    state.vy -= jumpParams.gravity * dt;
    player.position.y += state.vy * dt;
    const groundY = opts.groundFn
        ? opts.groundFn(player.position.x, player.position.z)
        : 0;
    if (player.position.y <= groundY) {
        const wasFalling = !state.grounded && state.vy < -1;
        player.position.y = groundY;
        state.vy = 0;
        state.grounded = true;
        if (wasFalling && opts.onLand) opts.onLand();
    }
    return state;
}

export function tryJump(state, opts = {}) {
    if (!state.grounded) return false;
    state.vy = jumpParams.velocity;
    state.grounded = false;
    if (opts.onJump) opts.onJump();
    return true;
}

// Project the player's head into screen space and pin a DOM element
// (the floating prompt) on top of it. Returns true if visible.
const _hw = new THREE.Vector3();
const _hn = new THREE.Vector3();
export function updatePromptPosition(player, camera, promptEl, renderer) {
    if (!promptEl) return false;
    _hw.set(player.position.x, player.position.y + 2.6, player.position.z);
    _hn.copy(_hw).project(camera);
    if (_hn.z > 1) {
        promptEl.style.visibility = "hidden";
        return false;
    }
    promptEl.style.visibility = "";
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    promptEl.style.left = `${(_hn.x * 0.5 + 0.5) * w}px`;
    promptEl.style.top = `${(-_hn.y * 0.5 + 0.5) * h}px`;
    return true;
}

// Forward and right vectors in world space, ignoring pitch — page code
// uses these to translate WASD into camera-relative movement.
export function getForward() {
    return {
        x: Math.sin(cameraState.yaw),
        z: Math.cos(cameraState.yaw),
    };
}
export function getRight() {
    return {
        x: -Math.cos(cameraState.yaw),
        z: Math.sin(cameraState.yaw),
    };
}
