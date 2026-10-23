// Engine bootstrap — turns a scene + KG into a running game.
//
//   mount({ canvas, scene, graph }) → { start, stop, three, player }
//
// Responsibilities:
//   1. Build a Three.js scene from the scene data (env, entities → meshes).
//   2. Load asset-folder meshes via src/assets.js.
//   3. Wire physics colliders from entities flagged as Collidable
//      (or any descendant of it).
//   4. Spawn the player rig from controls.js.
//   5. Start the loop: input → movement → physics → systems → render.
//   6. Dispatch collision / use / tick events through the compiled rule
//      table, applying registered effects.
//
// Keeps the scene's data model untouched — meshes are stashed on a
// non-enumerable `_mesh` reference so systems can reach them without
// polluting JSON.

import * as THREE from "three";
import * as controls from "../../controls.js";
import * as sc from "../../scene-controls.js";
import { loadFolder } from "../../assets.js";
import { compile, expandEntityProps } from "../kg/compile.js";
import { getEffect } from "../kg/effects.js";
import { makePhysics } from "../systems/physics.js";
import { makeAudio } from "../systems/audio.js";
import { makeVisual } from "../systems/visual.js";
import { makeInteraction } from "../systems/interaction.js";
import { makeUI } from "../systems/ui.js";
import { makeLoop } from "./loop.js";
import { makeBus } from "./events.js";

export async function mount({ canvas, scene: sceneData, graph }) {
    if (!graph.compiled) compile(graph);

    // ── three.js scene ────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const three = new THREE.Scene();
    three.background = new THREE.Color(sceneData.env.background ?? 0x87a8c4);
    if (sceneData.env.fog) {
        three.fog = new THREE.Fog(
            sceneData.env.fog.color,
            sceneData.env.fog.near,
            sceneData.env.fog.far,
        );
    }
    // optional gradient skydome (env.sky.kind === "gradient")
    if (sceneData.env.sky && sceneData.env.sky.kind === "gradient") {
        three.add(buildGradientSky(sceneData.env.sky));
    }

    // lights
    const ambient = new THREE.AmbientLight(
        sceneData.env.ambient.color,
        sceneData.env.ambient.intensity,
    );
    three.add(ambient);
    const sun = new THREE.DirectionalLight(
        sceneData.env.sun.color,
        sceneData.env.sun.intensity,
    );
    sun.position.set(...sceneData.env.sun.position);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -40;
    sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    three.add(sun);

    // ground
    if (sceneData.env.ground) {
        const g = new THREE.Mesh(
            new THREE.PlaneGeometry(
                sceneData.env.ground.size,
                sceneData.env.ground.size,
            ),
            new THREE.MeshStandardMaterial({
                color: sceneData.env.ground.color,
                roughness: 0.95,
            }),
        );
        g.rotation.x = -Math.PI / 2;
        g.receiveShadow = true;
        three.add(g);
    }

    // camera
    const camera = new THREE.PerspectiveCamera(
        controls.cameraState.baseFov,
        canvas.clientWidth / canvas.clientHeight,
        0.1,
        500,
    );
    function resize() {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener("resize", resize);

    // ── entity → mesh ─────────────────────────────────────────────────
    for (const entity of sceneData.entities) {
        const mesh = await buildMesh(entity);
        if (!mesh) continue;
        const [px, py, pz] = entity.transform.pos;
        const [rx, ry, rz] = entity.transform.rot;
        const [sx, sy, sz] = entity.transform.scale;
        mesh.position.set(px, py, pz);
        mesh.rotation.set(rx, ry, rz);
        mesh.scale.set(sx, sy, sz);
        mesh.traverse((o) => {
            if (o.isMesh) {
                o.castShadow = true;
                o.receiveShadow = true;
            }
        });
        three.add(mesh);
        Object.defineProperty(entity, "_mesh", { value: mesh, enumerable: false });
        // pre-compute expanded property set for fast rule dispatch
        Object.defineProperty(entity, "_props", {
            value: expandEntityProps(entity, graph),
            enumerable: false,
            writable: true,
        });
    }

    // ── systems ───────────────────────────────────────────────────────
    const audio = makeAudio();
    const visual = makeVisual(three);
    const interaction = makeInteraction();
    const physics = makePhysics();
    const bus = makeBus();
    const ui = makeUI({
        onPause: () => controls.pause("kiosk"),
        onResume: () => controls.unpause("kiosk"),
    });

    // collidable entities → physics colliders. We treat the descendant
    // closure of the "collidable" property as the gate (any property
    // that *inherits* from collidable counts).
    const collidableSet = graph.descendants?.get("collidable") || new Set(["collidable"]);
    for (const e of sceneData.entities) {
        if (!e._mesh || !e._props) continue;
        let isCollidable = false;
        for (const id of e._props) {
            if (collidableSet.has(id)) { isCollidable = true; break; }
        }
        if (isCollidable) physics.addCollider(e, e._mesh);
    }

    // player + scene-level controls (movement, jump, camera, FP sync,
    // walk-bob, hand-bob, click → zoom). Single attach call replaces
    // the scattered controls.* calls a scene driver used to need.
    const sceneCtl = sc.attach(canvas, three, camera, {
        spawn: sceneData.camera.spawn,
        // No inventory yet in engine scenes; hand stays hidden in 3p
        // until something declares it useful. Override this from a
        // scene if you wire one up later.
        handVisible: () => false,
    });
    const playerRig = sceneCtl.rig;
    const player = sceneCtl.player;
    sceneCtl.wireClicks();
    if (sceneData.camera.yaw != null) {
        controls.cameraState.yaw = sceneData.camera.yaw;
        player.rotation.y = sceneData.camera.yaw;
    }

    // Resume audio + unmute videos on user gestures. Listeners stay
    // attached until at least one video has actually started playing —
    // a single missed gesture (e.g., focus elsewhere when the page
    // loaded) would otherwise leave audio dead until reload. We remove
    // them once the audio context is running AND every videoEl is
    // playing unmuted, which is the steady state we want.
    let unmuteListenersActive = true;
    const resumeAudio = () => {
        audio.resume();
        let allReady = audio.ctx?.state === "running";
        for (const e of sceneData.entities) {
            const v = e._mesh?.userData?.videoEl;
            if (!v) continue;
            if (v.muted) v.muted = false;
            if (v.paused) v.play().catch(() => {});
            if (v.paused || v.muted) allReady = false;
        }
        if (allReady && unmuteListenersActive) {
            unmuteListenersActive = false;
            window.removeEventListener("keydown", resumeAudio, true);
            window.removeEventListener("pointerdown", resumeAudio, true);
        }
    };
    window.addEventListener("keydown", resumeAudio, true);
    window.addEventListener("pointerdown", resumeAudio, true);

    // ── rule dispatch ─────────────────────────────────────────────────
    // Runtime entity-property mutations are transient — the editor owns
    // scene authoring + persistence. The markDirty stub satisfies the
    // effect API without trying to write back to disk.
    const ctx = {
        audio,
        visual,
        ui,
        scene: { markDirty() {} },
        three,
        log: (...a) => console.log("[rule]", ...a),
    };

    // Both dispatchers walk an entity's expanded property set (which
    // includes ancestor chains — e.g. a metal entity has {metal, solid,
    // collidable}). A single rule on an ancestor shows up in the dispatch
    // table under *every* descendant, so without dedup the same rule would
    // fire once per matching property — three times for a solid-rule on a
    // metal entity. The `seen` set keeps each rule firing at most once per
    // event.
    function dispatchCollide(entity, payload) {
        if (!entity._props) return;
        const table = graph.compiled.collide;
        const seen = new Set();
        for (const a of entity._props) {
            const wild = table.get(`${a}|*`);
            if (!wild) continue;
            for (const r of wild) {
                if (seen.has(r)) continue;
                seen.add(r);
                fire(r, { kind: "collide", a: entity, ...payload });
            }
        }
        // pairwise rules: not yet — entity-vs-entity collisions appear in
        // Phase 2 once we have multi-entity physics. Today everything is
        // player-vs-entity.
    }

    function dispatchTick(dt) {
        const table = graph.compiled.tick;
        if (!table.size) return;
        const seen = new Set();
        for (const e of sceneData.entities) {
            if (!e._props) continue;
            seen.clear();
            for (const a of e._props) {
                const rules = table.get(a);
                if (!rules) continue;
                for (const r of rules) {
                    if (seen.has(r)) continue;
                    seen.add(r);
                    fire(r, { kind: "tick", a: e, dt });
                }
            }
        }
    }

    // Use events: deliberate interaction (E key). Walks the same property
    // closure as the other dispatchers so a rule on `pickup` fires for any
    // descendant. Uses the seen-set dedup so rules keyed under multiple
    // ancestors only run once.
    function dispatchUse(entity) {
        if (!entity?._props) return;
        const table = graph.compiled.use;
        if (!table.size) return;
        const seen = new Set();
        for (const a of entity._props) {
            const rules = table.get(a);
            if (!rules) continue;
            for (const r of rules) {
                if (seen.has(r)) continue;
                seen.add(r);
                fire(r, { kind: "use", a: entity });
            }
        }
    }

    // F-key handler: find the nearest entity with `pickup` (or descendant)
    // within interaction range and dispatch a use event. Single-fire per
    // keypress — repeats are filtered so holding F doesn't spam rules.
    const pickupSet = graph.descendants?.get("pickup") || new Set(["pickup"]);
    function isInteractable(e) {
        if (!e._props) return false;
        for (const id of e._props) if (pickupSet.has(id)) return true;
        return false;
    }
    function tryUse() {
        const candidates = sceneData.entities.filter(isInteractable);
        const target = interaction.nearest(player, candidates);
        if (target) dispatchUse(target);
    }
    window.addEventListener("keydown", (e) => {
        if (e.code === "KeyF" && !e.repeat) tryUse();
    });

    function fire(rule, event) {
        const handler = getEffect(rule.effect.kind);
        if (!handler) return;
        handler(ctx, { recipe: rule.effect.recipe, ...rule.effect.params }, event);
    }

    // Per-frame audio falloff + stereo panning for video meshes.
    //
    //   distance  → gain   (linear, minDistance..maxDistance)
    //   direction → pan    (dot with camera-right, range -1..+1)
    //
    // Web Audio graph (MediaElementSource → StereoPanner → Gain →
    // destination) is built lazily once the audio context is running.
    // Until then we fall back to the element's own volume so muted
    // autoplay still gets distance attenuation. After wiring,
    // video.volume is bypassed and gain takes over.
    //
    // The camera (not the player rig) is the listener, so 3rd-person
    // panning still feels right relative to where you're looking.
    const _fwd = new THREE.Vector3();
    function ensureVideoGraph(ud) {
        if (ud.audioGraph !== undefined) return ud.audioGraph;
        const actx = audio.ctx;
        if (!actx || actx.state !== "running") return null;
        try {
            const src = actx.createMediaElementSource(ud.videoEl);
            const panner = actx.createStereoPanner();
            const gain = actx.createGain();
            gain.gain.value = 0;
            src.connect(panner).connect(gain).connect(actx.destination);
            ud.videoEl.volume = 1;
            ud.audioGraph = { src, panner, gain };
        } catch (e) {
            console.warn("[video] stereo wiring failed:", e.message);
            ud.audioGraph = null;
        }
        return ud.audioGraph;
    }
    function updateVideoAudio() {
        camera.getWorldDirection(_fwd);
        _fwd.y = 0;
        const fLen = Math.hypot(_fwd.x, _fwd.z);
        if (fLen > 0.0001) { _fwd.x /= fLen; _fwd.z /= fLen; }
        // right = (-fwd.z, 0, fwd.x) — three.js right-handed, up=+Y
        const rightX = -_fwd.z;
        const rightZ = _fwd.x;

        for (const e of sceneData.entities) {
            const ud = e._mesh?.userData;
            if (!ud?.videoEl) continue;
            const cfg = ud.videoAudio;
            const dx = e._mesh.position.x - camera.position.x;
            const dz = e._mesh.position.z - camera.position.z;
            const d = Math.hypot(dx, dz);
            let g;
            if (d <= cfg.minDistance) g = cfg.volume;
            else if (d >= cfg.maxDistance) g = 0;
            else {
                const t = 1 - (d - cfg.minDistance) /
                              (cfg.maxDistance - cfg.minDistance);
                g = cfg.volume * t;
            }
            const graph = ensureVideoGraph(ud);
            if (graph) {
                const inv = d > 0.0001 ? 1 / d : 0;
                const pan = (dx * rightX + dz * rightZ) * inv;
                const tNow = audio.ctx.currentTime;
                graph.panner.pan.setTargetAtTime(
                    Math.max(-1, Math.min(1, pan)), tNow, 0.04,
                );
                graph.gain.gain.setTargetAtTime(g, tNow, 0.04);
            } else {
                ud.videoEl.volume = Math.max(0, Math.min(1, g));
            }
        }
    }

    // ── loop ──────────────────────────────────────────────────────────
    const loop = makeLoop((dt) => {
        sceneCtl.update(dt);
        physics.step(player, dispatchCollide);
        dispatchTick(dt);
        updateVideoAudio();
        visual.update(dt);
        renderer.render(three, camera);
    });

    return {
        start: () => loop.start(),
        stop: () => loop.stop(),
        three,
        renderer,
        camera,
        player,
        audio,
        bus,
    };
}

// Build a Three.js Object3D for an entity's mesh descriptor.
async function buildMesh(entity) {
    const m = entity.mesh;
    if (!m) {
        // empty entity — represent as an invisible group so it still has
        // a transform handle in the editor.
        return new THREE.Group();
    }
    if (m.kind === "primitive") {
        return buildPrimitive(m);
    }
    if (m.kind === "asset") {
        try {
            const r = await loadFolder(m.folder, { targetSize: m.targetSize });
            return r?.wrap || new THREE.Group();
        } catch (e) {
            console.warn(`[mesh] failed to load asset "${m.folder}"`, e);
            return new THREE.Group();
        }
    }
    if (m.kind === "video") {
        return buildVideo(m);
    }
    return new THREE.Group();
}

// Video mesh: HTML5 <video> → VideoTexture → unlit plane. Audio rides
// the element's native audio track; the runtime modulates element.volume
// per frame based on player distance, so no Web Audio plumbing needed.
//
// Browsers block autoplay-with-sound until a user gesture, so we start
// muted and unmute on the first keydown/pointerdown (handled in mount()
// alongside the audio context resume).
function buildVideo(m) {
    const el = document.createElement("video");
    el.src = m.src;
    el.loop = m.loop !== false;
    el.muted = true;
    el.autoplay = true;
    el.playsInline = true;
    el.crossOrigin = "anonymous";
    el.style.display = "none";
    el.addEventListener("error", () =>
        console.warn(`[mesh] video failed to load: ${m.src}`),
    );
    document.body.appendChild(el);
    el.play().catch(() => { /* will retry on first user gesture */ });

    const tex = new THREE.VideoTexture(el);
    if ("SRGBColorSpace" in THREE) tex.colorSpace = THREE.SRGBColorSpace;
    const [w, h] = m.size || [4, 2.25];
    const mat = new THREE.MeshBasicMaterial({
        map: tex,
        side: THREE.DoubleSide,
        toneMapped: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.userData.videoEl = el;
    mesh.userData.videoAudio = m.audio || {
        minDistance: 2,
        maxDistance: 12,
        volume: 1.0,
    };
    return mesh;
}

function buildPrimitive(m) {
    const color = m.color ?? 0xcccccc;
    const size = m.size ?? [1, 1, 1];
    const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: m.roughness ?? 0.6,
        metalness: m.metalness ?? 0.1,
        emissive: m.emissive ?? 0x000000,
        emissiveIntensity: m.emissiveIntensity ?? 0,
        transparent: m.transparent ?? (m.opacity != null && m.opacity < 1),
        opacity: m.opacity ?? 1,
        side: m.side === "double" ? THREE.DoubleSide
            : m.side === "back" ? THREE.BackSide
            : THREE.FrontSide,
    });
    let geom;
    switch (m.shape) {
        case "sphere":
            geom = new THREE.SphereGeometry(size[0] / 2, 24, 18);
            break;
        case "cylinder":
            geom = new THREE.CylinderGeometry(
                size[0] / 2, size[0] / 2, size[1] ?? 1, 16,
            );
            break;
        case "plane":
            geom = new THREE.PlaneGeometry(size[0], size[1] ?? size[0]);
            break;
        case "box":
        default:
            geom = new THREE.BoxGeometry(...size);
    }
    return new THREE.Mesh(geom, mat);
}

// Procedural gradient skydome — top↔bottom mix sampled by world-space Y on
// an inverted sphere. Cheap (single shader, no textures) and round-trips
// through the engine schema as `env.sky = { kind: "gradient", top, bottom,
// exponent, offset }`.
function buildGradientSky(opts) {
    const top = new THREE.Color(opts.top ?? 0x77aaff);
    const bottom = new THREE.Color(opts.bottom ?? 0xffffff);
    const mat = new THREE.ShaderMaterial({
        uniforms: {
            topColor:    { value: top },
            bottomColor: { value: bottom },
            offset:      { value: opts.offset ?? 33 },
            exponent:    { value: opts.exponent ?? 0.6 },
        },
        vertexShader: `
            varying vec3 vWorldPos;
            void main() {
                vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
        fragmentShader: `
            uniform vec3 topColor;
            uniform vec3 bottomColor;
            uniform float offset;
            uniform float exponent;
            varying vec3 vWorldPos;
            void main() {
                float h = normalize(vWorldPos + vec3(0.0, offset, 0.0)).y;
                gl_FragColor = vec4(
                    mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)),
                    1.0
                );
            }`,
        side: THREE.BackSide,
        depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), mat);
    mesh.renderOrder = -1;
    return mesh;
}
