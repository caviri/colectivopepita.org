// Viewport — the 3D editing surface, with single + quad layouts.
//
// Architecture:
//   - one shared THREE.Scene, populated with entity meshes + lights + grid
//   - four "panes" (perspective + front + side + top), each with its own
//     canvas, renderer, camera and OrbitControls
//   - one TransformControls instance, rebuilt when the active pane
//     changes (TC is bound to a single camera/domElement at construction)
//   - layout = "single" shows only the active pane full-size; "quad"
//     shows all four in a 2×2 grid. Each pane has an ⛶ button to expand
//     itself back to single.
//
// Interaction model:
//   - LMB click: select via raycast (does not move camera)
//   - MMB drag: orbit camera (perspective only — orthos pan instead)
//   - RMB drag: pan camera
//   - scroll: zoom
//   - F / Shift+F (handled by editor): fit all / fit selection
//   - G (handled by editor): toggle fly mode on the active pane
//
// Fly mode replaces orbit on the active perspective pane: pointer-lock
// + WASD + mouse-look. Click anywhere or press Esc to exit.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { loadFolder } from "../assets.js";

const PANE_NAMES = ["persp", "front", "side", "top"];
const PANE_LABELS = { persp: "3D", front: "Front", side: "Side", top: "Top" };

export function makeViewport(host) {
    // ── shared scene ──────────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2a2f36);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x444466, 0.6);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(8, 12, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun);

    // Big workspace grid — 200 m square with 1 m cells. Matches the outdoor
    // scene's ground size (100) with comfortable headroom and fits inside
    // any plausible camera frustum without needing dynamic resizing.
    const GRID_SIZE = 200;
    const GRID_DIVS = 200;
    const grid = new THREE.GridHelper(GRID_SIZE, GRID_DIVS, 0x4a525d, 0x33393f);
    scene.add(grid);
    const axes = new THREE.AxesHelper(2);
    scene.add(axes);

    // ── procedural sky dome (env.sky) ────────────────────────────────
    // Inverted sphere shaded with a top→bottom gradient. Lives in scene
    // space so it follows the camera implicitly (no parenting needed).
    let sky = null;
    function buildSky(opts) {
        if (sky) {
            scene.remove(sky);
            sky.geometry.dispose();
            sky.material.dispose();
            sky = null;
        }
        if (!opts) return;
        const top = new THREE.Color(opts.top ?? 0x77aaff);
        const bottom = new THREE.Color(opts.bottom ?? 0xffffff);
        const exponent = opts.exponent ?? 0.6;
        const offset = opts.offset ?? 33;
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                topColor:    { value: top },
                bottomColor: { value: bottom },
                offset:      { value: offset },
                exponent:    { value: exponent },
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
        const geom = new THREE.SphereGeometry(450, 32, 16);
        sky = new THREE.Mesh(geom, mat);
        sky.renderOrder = -1;
        scene.add(sky);
    }

    // mirror scene.env values into the live editor viewport so the user
    // sees the mood they're authoring. Defaults are kept for "no env loaded".
    function applyEnv(env) {
        if (!env) return;
        if (env.background != null) scene.background = new THREE.Color(env.background);
        if (env.fog) {
            scene.fog = new THREE.Fog(env.fog.color, env.fog.near, env.fog.far);
        } else {
            scene.fog = null;
        }
        if (env.ambient) {
            hemi.color.setHex(env.ambient.color);
            hemi.intensity = env.ambient.intensity;
        }
        if (env.sun) {
            sun.color.setHex(env.sun.color);
            sun.intensity = env.sun.intensity;
            sun.position.set(...env.sun.position);
        }
        // gradient sky dome — null/missing removes any prior dome.
        buildSky(env.sky && env.sky.kind === "gradient" ? env.sky : null);
    }

    // material live-update for primitive entities. Looks up the mesh
    // and rewrites material.color/roughness/metalness in place — cheap
    // and avoids an entity rebuild.
    function updateMaterial(entity) {
        const root = meshes.get(entity.id);
        if (!root || !entity.mesh || entity.mesh.kind !== "primitive") return;
        root.traverse((o) => {
            if (!o.isMesh) return;
            const m = o.material;
            if (entity.mesh.color != null) m.color.setHex(entity.mesh.color);
            if (entity.mesh.roughness != null) m.roughness = entity.mesh.roughness;
            if (entity.mesh.metalness != null) m.metalness = entity.mesh.metalness;
        });
    }

    // mesh registry — entityId → root mesh
    const meshes = new Map();

    // selection outline (one, shared across panes via the scene)
    let outline = null;
    function setOutline(target) {
        if (outline) {
            outline.parent?.remove(outline);
            outline.material?.dispose?.();
            outline = null;
        }
        if (!target) return;
        const mat = new THREE.MeshBasicMaterial({
            color: 0xff7043, wireframe: true,
            depthTest: false, transparent: true, opacity: 0.5,
        });
        outline = new THREE.Group();
        target.traverse((o) => {
            if (o.isMesh) {
                const w = new THREE.Mesh(o.geometry, mat);
                w.applyMatrix4(o.matrixWorld);
                outline.add(w);
            }
        });
        outline.renderOrder = 999;
        scene.add(outline);
    }
    function refreshOutline() {
        if (!_attached) return;
        setOutline(_attached);
    }

    // ── panes ─────────────────────────────────────────────────────────
    const panes = PANE_NAMES.map((name) => makePane(name, scene));
    for (const p of panes) host.appendChild(p.wrapper);

    let layout = "single";
    let activeIdx = 0; // perspective by default
    let transform = null; // bound to active pane's (camera, canvas)
    let _attached = null;
    let _gizmoMode = "translate"; // persists across active-pane changes

    function makeTransformFor(pane) {
        if (transform) {
            transform.detach();
            transform.dispose?.();
            scene.remove(transform);
        }
        transform = new TransformControls(pane.camera, pane.canvas);
        transform.setSpace("world");
        scene.add(transform);
        transform.addEventListener("dragging-changed", (e) => {
            // disable orbit on whichever pane is being dragged
            pane.controls.enabled = !e.value;
            _dragging = e.value;
        });
        transform.addEventListener("objectChange", () => {
            refreshOutline();
            for (const cb of _onObjectChange) cb(transform.object);
        });
        transform.addEventListener("mouseDown", () => {
            for (const cb of _onDragBegin) cb(transform.object);
        });
        transform.addEventListener("mouseUp", () => {
            for (const cb of _onDragEnd) cb(transform.object);
        });
        if (_attached) transform.attach(_attached);
        transform.setMode(_gizmoMode);
        if (_snap) applySnap(true);
    }

    const _onObjectChange = [];
    const _onDragBegin = [];
    const _onDragEnd = [];
    let _dragging = false;
    let _snap = false;

    function setActivePane(idx) {
        activeIdx = idx;
        makeTransformFor(panes[idx]);
        // visual indicator
        for (let i = 0; i < panes.length; i++) {
            panes[i].wrapper.classList.toggle("active", i === idx);
        }
    }

    function setLayout(next) {
        layout = next;
        host.classList.toggle("layout-quad", layout === "quad");
        host.classList.toggle("layout-single", layout === "single");
        for (let i = 0; i < panes.length; i++) {
            panes[i].wrapper.style.display =
                layout === "quad" || i === activeIdx ? "" : "none";
        }
        // each pane needs to resize to its new container size
        for (const p of panes) p.resize();
        if (transform) transform.update?.();
    }

    // initial: single, perspective
    setLayout("single");
    setActivePane(0);

    // pane-level expand buttons
    for (let i = 0; i < panes.length; i++) {
        panes[i].expandBtn.addEventListener("click", () => {
            setActivePane(i);
            setLayout("single");
        });
    }

    // ── click selection ───────────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let onSelect = null;

    function pickAt(pane, clientX, clientY) {
        const rect = pane.canvas.getBoundingClientRect();
        ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(ndc, pane.camera);
        const hits = raycaster.intersectObjects([...meshes.values()], true);
        for (const h of hits) {
            let n = h.object;
            while (n && !meshes.has(n.userData.entityId)) n = n.parent;
            if (n) return n.userData.entityId;
        }
        return null;
    }

    for (let i = 0; i < panes.length; i++) {
        const pane = panes[i];
        pane.canvas.addEventListener("click", (e) => {
            if (_dragging) return;
            // make this pane active when clicked
            if (i !== activeIdx) setActivePane(i);
            const id = pickAt(pane, e.clientX, e.clientY);
            onSelect?.(id);
        });
    }

    // ── entity → mesh ────────────────────────────────────────────────
    async function buildMesh(entity) {
        const m = entity.mesh;
        if (!m) return new THREE.Group();
        if (m.kind === "primitive") return buildPrimitive(m);
        if (m.kind === "asset") {
            try {
                const r = await loadFolder(m.folder, { targetSize: m.targetSize });
                return r?.wrap || new THREE.Group();
            } catch { return new THREE.Group(); }
        }
        return new THREE.Group();
    }

    async function addEntity(entity) {
        const mesh = await buildMesh(entity);
        const [px, py, pz] = entity.transform.pos;
        const [rx, ry, rz] = entity.transform.rot;
        const [sx, sy, sz] = entity.transform.scale;
        mesh.position.set(px, py, pz);
        mesh.rotation.set(rx, ry, rz);
        mesh.scale.set(sx, sy, sz);
        mesh.userData.entityId = entity.id;
        mesh.traverse((o) => {
            if (o.isMesh) {
                o.castShadow = true;
                o.receiveShadow = true;
                o.userData.entityId = entity.id;
            }
        });
        scene.add(mesh);
        meshes.set(entity.id, mesh);
        return mesh;
    }

    function removeEntity(id) {
        const m = meshes.get(id);
        if (!m) return;
        if (_attached === m) detach();
        scene.remove(m);
        m.traverse((o) => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) {
                if (Array.isArray(o.material)) o.material.forEach((mm) => mm.dispose());
                else o.material.dispose();
            }
        });
        meshes.delete(id);
    }

    function clearAll() {
        detach();
        for (const id of [...meshes.keys()]) removeEntity(id);
    }

    function getMesh(id) { return meshes.get(id) || null; }

    function attach(mesh) {
        _attached = mesh || null;
        if (mesh) transform?.attach(mesh);
        else transform?.detach();
        setOutline(mesh || null);
    }
    function detach() { attach(null); }

    function setGizmoMode(mode) {
        _gizmoMode = mode;
        transform?.setMode(mode);
    }

    function applySnap(on) {
        _snap = on;
        if (!transform) return;
        if (on) {
            transform.setTranslationSnap(0.5);
            transform.setRotationSnap(Math.PI / 12);
            transform.setScaleSnap(0.1);
        } else {
            transform.setTranslationSnap(null);
            transform.setRotationSnap(null);
            transform.setScaleSnap(null);
        }
    }

    // ── camera helpers ───────────────────────────────────────────────
    function fitTargets(targets) {
        if (!targets?.length) return;
        const box = new THREE.Box3();
        for (const t of targets) box.expandByObject(t);
        if (box.isEmpty()) return;
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;

        for (const pane of panes) {
            pane.controls.target.copy(center);
            if (pane.camera.isPerspectiveCamera) {
                const fov = pane.camera.fov * Math.PI / 180;
                const dist = (maxDim / 2) / Math.tan(fov / 2) * 1.6;
                const dir = new THREE.Vector3()
                    .copy(pane.camera.position)
                    .sub(pane.controls.target)
                    .normalize();
                if (dir.lengthSq() < 0.001) dir.set(0.6, 0.5, 1).normalize();
                pane.camera.position.copy(center).addScaledVector(dir, dist);
            } else {
                // orthographic — set zoom so the box fits the smaller dim
                const w = pane.camera.right - pane.camera.left;
                const h = pane.camera.top - pane.camera.bottom;
                const aspect = w / h;
                const target = pane.orthoAxis === "y"
                    ? Math.max(size.x, size.z * aspect) * 1.2
                    : pane.orthoAxis === "z"
                        ? Math.max(size.x, size.y * aspect) * 1.2
                        : Math.max(size.z, size.y * aspect) * 1.2;
                pane.camera.zoom = (w / target);
                pane.camera.updateProjectionMatrix();
                // re-center camera on target along its viewing axis
                if (pane.orthoAxis === "y") pane.camera.position.set(center.x, center.y + 50, center.z);
                else if (pane.orthoAxis === "z") pane.camera.position.set(center.x, center.y, center.z + 50);
                else pane.camera.position.set(center.x + 50, center.y, center.z);
                pane.camera.lookAt(center);
            }
            pane.controls.update();
        }
    }
    function fitAll() {
        fitTargets([...meshes.values()]);
    }
    function fitSelection() {
        if (!_attached) return fitAll();
        fitTargets([_attached]);
    }

    // ── fly mode (perspective pane only) ─────────────────────────────
    let flyMode = false;
    let flyKeys = new Set();
    let flyYaw = 0, flyPitch = 0;

    function setFlyMode(on) {
        if (on === flyMode) return;
        const pane = panes[0];
        if (!pane.camera.isPerspectiveCamera) return; // active pane must be persp; default 0 is.
        // Force active = perspective when entering fly
        if (on && activeIdx !== 0) setActivePane(0);
        flyMode = on;
        pane.controls.enabled = !on;
        host.classList.toggle("fly-mode", on);
        if (on) {
            // initial yaw/pitch from current camera direction
            const dir = new THREE.Vector3();
            pane.camera.getWorldDirection(dir);
            flyYaw = Math.atan2(dir.x, dir.z);
            flyPitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
            pane.canvas.requestPointerLock?.();
        } else {
            document.exitPointerLock?.();
            flyKeys.clear();
        }
    }

    document.addEventListener("pointerlockchange", () => {
        if (flyMode && document.pointerLockElement !== panes[0].canvas) {
            setFlyMode(false);
        }
    });

    window.addEventListener("keydown", (e) => {
        if (!flyMode) return;
        if (e.code === "Escape") { setFlyMode(false); return; }
        flyKeys.add(e.code);
    });
    window.addEventListener("keyup", (e) => {
        flyKeys.delete(e.code);
    });
    document.addEventListener("mousemove", (e) => {
        if (!flyMode) return;
        flyYaw   -= e.movementX * 0.0025;
        flyPitch -= e.movementY * 0.0025;
        const lim = Math.PI / 2 - 0.05;
        flyPitch = Math.max(-lim, Math.min(lim, flyPitch));
    });

    function flyStep(dt) {
        if (!flyMode) return;
        const cam = panes[0].camera;
        // build view direction
        const cy = Math.cos(flyPitch);
        const fwd = new THREE.Vector3(
            Math.sin(flyYaw) * cy,
            Math.sin(flyPitch),
            Math.cos(flyYaw) * cy,
        );
        const right = new THREE.Vector3(fwd.z, 0, -fwd.x).normalize();
        const speed = (flyKeys.has("ShiftLeft") || flyKeys.has("ShiftRight") ? 24 : 8) * dt;
        if (flyKeys.has("KeyW")) cam.position.addScaledVector(fwd, speed);
        if (flyKeys.has("KeyS")) cam.position.addScaledVector(fwd, -speed);
        if (flyKeys.has("KeyD")) cam.position.addScaledVector(right, speed);
        if (flyKeys.has("KeyA")) cam.position.addScaledVector(right, -speed);
        if (flyKeys.has("Space")) cam.position.y += speed;
        if (flyKeys.has("ControlLeft") || flyKeys.has("ControlRight")) cam.position.y -= speed;
        cam.lookAt(
            cam.position.x + fwd.x,
            cam.position.y + fwd.y,
            cam.position.z + fwd.z,
        );
    }

    // ── render loop ──────────────────────────────────────────────────
    let last = 0;
    function tick(now) {
        const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
        last = now;
        flyStep(dt);
        for (let i = 0; i < panes.length; i++) {
            const p = panes[i];
            if (p.wrapper.style.display === "none") continue;
            // gizmo handles are sized + oriented for ONE camera (the
            // one TC was constructed with). Showing it during inactive
            // pane renders would distort it. Toggle visibility per pane.
            if (transform) transform.visible = (i === activeIdx);
            p.controls.update();
            p.renderer.render(scene, p.camera);
        }
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    // ResizeObserver fires when host or panes change size
    new ResizeObserver(() => {
        for (const p of panes) p.resize();
    }).observe(host);

    return {
        scene,
        get camera() { return panes[activeIdx].camera; },
        get renderer() { return panes[activeIdx].renderer; },
        get transform() { return transform; },
        addEntity,
        removeEntity,
        clear: clearAll,
        getMesh,
        attach,
        detach,
        setGizmoMode,
        setSnap: applySnap,
        refreshOutline,
        setLayout,
        setActivePane,
        get layout() { return layout; },
        get activeIdx() { return activeIdx; },
        fitAll,
        fitSelection,
        setFlyMode,
        get flyMode() { return flyMode; },
        applyEnv,
        updateMaterial,
        set onSelect(fn) { onSelect = fn; },
        set onTransformChange(fn) { _onObjectChange.push(fn); },
        set onDragBegin(fn) { _onDragBegin.push(fn); },
        set onDragEnd(fn) { _onDragEnd.push(fn); },
    };
}

// ── pane factory ────────────────────────────────────────────────────────
function makePane(name, scene) {
    const wrapper = document.createElement("div");
    wrapper.className = `pane pane-${name}`;
    wrapper.dataset.pane = name;
    const label = document.createElement("div");
    label.className = "pane-label";
    label.textContent = PANE_LABELS[name];
    const expandBtn = document.createElement("button");
    expandBtn.className = "pane-expand";
    expandBtn.title = "Expand to single view";
    expandBtn.textContent = "⛶";
    const canvas = document.createElement("canvas");
    canvas.className = "pane-canvas";
    wrapper.append(canvas, label, expandBtn);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    let camera;
    let orthoAxis = null;
    if (name === "persp") {
        camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000);
        camera.position.set(8, 8, 12);
    } else if (name === "front") {
        // front view: looking down +Z toward origin (camera at +Z)
        camera = new THREE.OrthographicCamera(-10, 10, 10, -10, -100, 1000);
        camera.position.set(0, 0, 50);
        camera.lookAt(0, 0, 0);
        orthoAxis = "z";
    } else if (name === "side") {
        // side view: from +X
        camera = new THREE.OrthographicCamera(-10, 10, 10, -10, -100, 1000);
        camera.position.set(50, 0, 0);
        camera.lookAt(0, 0, 0);
        orthoAxis = "x";
    } else if (name === "top") {
        // top view: looking down -Y
        camera = new THREE.OrthographicCamera(-10, 10, 10, -10, -100, 1000);
        camera.position.set(0, 50, 0);
        camera.up.set(0, 0, -1); // so "front" stays up in the top view
        camera.lookAt(0, 0, 0);
        orthoAxis = "y";
    }

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 1, 0);
    // MMB orbits, RMB pans, scroll zooms; LMB free for selection clicks
    controls.mouseButtons = {
        LEFT: null,
        MIDDLE: THREE.MOUSE.ROTATE,
        RIGHT: THREE.MOUSE.PAN,
    };
    if (orthoAxis) {
        // ortho cameras shouldn't rotate — would tilt the view off-axis
        controls.enableRotate = false;
    }

    function resize() {
        const r = wrapper.getBoundingClientRect();
        const w = Math.max(1, r.width);
        const h = Math.max(1, r.height);
        renderer.setSize(w, h, false);
        if (camera.isPerspectiveCamera) {
            camera.aspect = w / h;
        } else {
            // ortho — preserve world height, derive width from aspect
            const halfH = (camera.top - camera.bottom) / 2;
            const aspect = w / h;
            camera.left = -halfH * aspect;
            camera.right = halfH * aspect;
        }
        camera.updateProjectionMatrix();
    }
    requestAnimationFrame(resize);

    return { name, wrapper, canvas, renderer, camera, controls, orthoAxis,
             expandBtn, label, resize };
}

function buildPrimitive(m) {
    const color = m.color ?? 0xcccccc;
    const size = m.size ?? [1, 1, 1];
    const mat = new THREE.MeshStandardMaterial({
        color, roughness: m.roughness ?? 0.6, metalness: m.metalness ?? 0.1,
    });
    let geom;
    switch (m.shape) {
        case "sphere":
            geom = new THREE.SphereGeometry(size[0] / 2, 24, 18); break;
        case "cylinder":
            geom = new THREE.CylinderGeometry(size[0] / 2, size[0] / 2, size[1] ?? 1, 16); break;
        case "plane":
            geom = new THREE.PlaneGeometry(size[0], size[1] ?? size[0]); break;
        case "box":
        default:
            geom = new THREE.BoxGeometry(...size);
    }
    return new THREE.Mesh(geom, mat);
}
