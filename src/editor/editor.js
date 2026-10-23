// Editor bootstrap. Wires panels + viewport + store into a single app.
//
// Lifecycle:
//   - load KG pool (built-in properties + rules + user overlays)
//   - mount viewport
//   - mount panels (level manager, hierarchy, inspector, asset picker)
//   - on level select → load scene → rebuild viewport + panels
//   - on entity changes (inspector / gizmo / spawn / delete) → mark dirty
//   - on Save → serialize + write to IndexedDB

import { makeScene, addEntity, removeEntity } from "../engine/core/scene.js";
import { makeEntity } from "../engine/core/entity.js";
import { fromJSON, toJSON } from "../engine/core/serialize.js";
import { loadPool } from "../engine/kg/pool.js";
import { makeViewport } from "./viewport.js";
import * as store from "./store.js";
import { makeLevelManager } from "./panels/level-manager.js";
import { makeHierarchy } from "./panels/hierarchy.js";
import { makeInspector } from "./panels/inspector.js";
import { makeAssetPicker } from "./panels/asset-picker.js";
import { makePoolBrowser } from "./panels/pool-browser.js";
import { makeRuleEditor } from "./panels/rule-editor.js";
import { makeEnvEditor } from "./panels/env-editor.js";
import { openMatrix } from "./panels/matrix.js";
import { openGraphView } from "./panels/graph-view.js";
import {
    makeHistory,
    cmdAddEntity,
    cmdRemoveEntity,
    cmdSetTransform,
    cmdToggleProperty,
    snapshotTransform,
} from "./history.js";

const errorEl = document.getElementById("error");
function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = "block";
}
function clearError() {
    errorEl.style.display = "none";
}
window.addEventListener("error", (e) => showError(`error: ${e.message}\n${e.error?.stack || ""}`));
window.addEventListener("unhandledrejection", (e) =>
    showError(`unhandled: ${e.reason?.message || e.reason}\n${e.reason?.stack || ""}`),
);

// ── state ───────────────────────────────────────────────────────────────
let scene = null;
let graph = null;
let selectedId = null;
let dirty = false;
let viewport;
const history = makeHistory();
let dragBefore = null;

const sceneNameEl = document.getElementById("scene-name");
const btnSave = document.getElementById("btn-save");
const btnPlay = document.getElementById("btn-play");
const viewportHost = document.getElementById("viewport-wrap");

(async () => {
    graph = await loadPool();
    viewport = makeViewport(viewportHost);
    inspector.setGraph(graph);
    poolBrowser.setGraph(graph);
    ruleEditor.setGraph(graph);
    viewport.onSelect = onSelectFromViewport;
    viewport.onTransformChange = (mesh) => {
        // sync transform values into the entity model + inspector while
        // dragging (so numeric inputs update live), but DON'T push undo —
        // we capture one command on mouseUp instead.
        const entity = scene?.entities.find((e) => e.id === mesh?.userData.entityId);
        if (entity && mesh) {
            entity.transform.pos = [mesh.position.x, mesh.position.y, mesh.position.z];
            entity.transform.rot = [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z];
            entity.transform.scale = [mesh.scale.x, mesh.scale.y, mesh.scale.z];
        }
        inspector.syncFromMesh(mesh);
        markDirty();
    };
    viewport.onDragBegin = () => {
        const entity = currentEntity();
        if (entity) dragBefore = snapshotTransform(entity);
    };
    viewport.onDragEnd = () => {
        const entity = currentEntity();
        if (!entity || !dragBefore) return;
        const after = snapshotTransform(entity);
        history.push(cmdSetTransform({ entity, viewport, before: dragBefore, after }));
        dragBefore = null;
    };

    levelManager = makeLevelManager({
        onLoad: loadSceneById,
        onNew: newScene,
        onDuplicate: duplicateScene,
        onDeleted: clearScene,
        onExport: exportScene,
        onImport: importScene,
    });
    levelManager.refresh();

    // start with the seeded smoke scene so the user sees something
    await loadSceneById("_test", "builtin");
})();

// ── panels ──────────────────────────────────────────────────────────────
const hierarchy = makeHierarchy({
    onSelect: selectEntity,
    onDelete: deleteEntity,
});
const inspector = makeInspector({
    onChange: onInspectorChange,
    envEditor: () => envEditorBuild(),
});

const envEditorBuild = makeEnvEditor({
    getScene: () => scene,
    onChange: () => {
        if (viewport && scene) viewport.applyEnv(scene.env);
        markDirty();
    },
});
const assetPicker = makeAssetPicker({
    onSpawn: spawnEntity,
});
const poolBrowser = makePoolBrowser({
    onGraphChange: onGraphChange,
});
const ruleEditor = makeRuleEditor({
    onGraphChange: onGraphChange,
});
let levelManager; // initialised after pool loads

function onGraphChange() {
    // a property or rule changed — every panel that depends on the
    // graph needs a refresh.
    if (poolBrowser) poolBrowser.render();
    if (ruleEditor) ruleEditor.render();
    if (inspector) inspector.rerender();
    window.dispatchEvent(new CustomEvent("graph-change"));
}

// ── scene lifecycle ─────────────────────────────────────────────────────

async function loadSceneById(id, source) {
    clearError();
    let text = null;
    if (source === "builtin") {
        text = await store.loadBuiltin(id);
    } else {
        text = await store.loadScene(id);
        if (!text) text = await store.loadBuiltin(id);
    }
    if (!text) {
        showError(`scene "${id}" not found`);
        return;
    }
    scene = fromJSON(text);
    selectedId = null;
    dirty = false;
    history.clear();
    sceneNameEl.textContent = `— ${scene.name}`;
    viewport.clear();
    viewport.applyEnv(scene.env);
    for (const e of scene.entities) await viewport.addEntity(e);
    hierarchy.setScene(scene);
    inspector.clear();
    levelManager.setActive(scene.id);
    updatePlayHref();
    syncFogBtn();
}

function newScene() {
    const name = prompt("New scene name?", "Untitled");
    if (!name) return;
    const id = store.slugify(name);
    scene = makeScene({ id, name });
    selectedId = null;
    history.clear();
    sceneNameEl.textContent = `— ${name} (unsaved)`;
    viewport.clear();
    viewport.applyEnv(scene.env);
    hierarchy.setScene(scene);
    inspector.clear();
    levelManager.setActive(id);
    markDirty(true);
    syncFogBtn();
}

async function duplicateScene(id) {
    if (!scene) return;
    const name = prompt("Duplicate as?", `${scene.name} copy`);
    if (!name) return;
    const newId = store.slugify(name);
    scene = fromJSON(toJSON(scene));
    scene.id = newId;
    scene.name = name;
    sceneNameEl.textContent = `— ${name} (unsaved)`;
    levelManager.setActive(newId);
    markDirty(true);
}

function clearScene() {
    scene = null;
    selectedId = null;
    sceneNameEl.textContent = "— no scene loaded —";
    viewport.clear();
    hierarchy.setScene(null);
    inspector.clear();
    updatePlayHref();
}

async function saveScene() {
    if (!scene) return;
    const json = toJSON(scene);
    await store.saveScene(scene.id, scene.name, json);
    dirty = false;
    sceneNameEl.textContent = `— ${scene.name}`;
    levelManager.refresh();
    // notify any open /play.html tab so it can hot-reload the same scene
    try {
        const ch = new BroadcastChannel("engine");
        ch.postMessage({ type: "scene-saved", id: scene.id, json });
        ch.close();
    } catch { /* BroadcastChannel unsupported — silent */ }
}

function exportScene(id) {
    if (!scene) return;
    const blob = new Blob([toJSON(scene)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importScene(text) {
    try {
        const imported = fromJSON(text);
        // give it a new id if there's already a scene with this id
        const existing = await store.loadScene(imported.id);
        if (existing) imported.id = `${imported.id}-${Date.now().toString(36)}`;
        await store.saveScene(imported.id, imported.name, toJSON(imported));
        await loadSceneById(imported.id);
    } catch (e) {
        showError(`import failed: ${e.message}`);
    }
}

// ── selection / inspection ──────────────────────────────────────────────

function selectEntity(id) {
    selectedId = id;
    const entity = scene?.entities.find((e) => e.id === id) || null;
    const mesh = entity ? viewport.getMesh(id) : null;
    viewport.attach(mesh);
    inspector.setEntity(entity);
    hierarchy.setSelected(id);
}

function onSelectFromViewport(id) {
    selectEntity(id || null);
}

function deleteEntity(id) {
    if (!scene) return;
    const entity = scene.entities.find((e) => e.id === id);
    if (!entity) return;
    history.apply(cmdRemoveEntity({ scene, viewport, hierarchy, entity }));
    if (selectedId === id) selectEntity(null);
    markDirty();
}

async function spawnEntity(partial) {
    if (!scene) {
        showError("Create or load a scene first.");
        return;
    }
    const e = makeEntity({
        ...partial,
        transform: { pos: [0, 0.5, 0], rot: [0, 0, 0], scale: [1, 1, 1] },
    });
    // mesh build is async, so don't go through the command stack's
    // synchronous .do() path — just add directly and push a command
    // that already-knows the mesh exists.
    scene.entities.push(e);
    await viewport.addEntity(e);
    hierarchy.render();
    selectEntity(e.id);
    history.push(cmdAddEntity({ scene, viewport, hierarchy, entity: e }));
    markDirty();
}

function duplicateSelected() {
    if (!selectedId) return;
    const src = scene?.entities.find((e) => e.id === selectedId);
    if (!src) return;
    const clone = makeEntity({
        ...JSON.parse(JSON.stringify(src)),
        id: undefined, // makeEntity will generate a fresh one
        name: `${src.name} copy`,
        transform: {
            pos: [src.transform.pos[0] + 1, src.transform.pos[1], src.transform.pos[2]],
            rot: [...src.transform.rot],
            scale: [...src.transform.scale],
        },
    });
    scene.entities.push(clone);
    viewport.addEntity(clone).then(() => {
        hierarchy.render();
        selectEntity(clone.id);
        history.push(cmdAddEntity({ scene, viewport, hierarchy, entity: clone }));
        markDirty();
    });
}

function currentEntity() {
    if (!selectedId || !scene) return null;
    return scene.entities.find((e) => e.id === selectedId) || null;
}

function onInspectorChange(entity, change) {
    // material edits → live mesh update (no transform change)
    if (change?.kind === "material") {
        viewport.updateMaterial(entity);
        markDirty();
        return;
    }
    // sync mesh transform from entity model
    const mesh = viewport.getMesh(entity.id);
    if (mesh) {
        mesh.position.set(...entity.transform.pos);
        mesh.rotation.set(...entity.transform.rot);
        mesh.scale.set(...entity.transform.scale);
        viewport.refreshOutline();
    }
    hierarchy.render();
    hierarchy.setSelected(selectedId);
    if (change) {
        if (change.kind === "property") {
            history.push(cmdToggleProperty({ entity, ...change }));
        }
        // (transform via inspector is intentionally not undoable —
        // typing into an input is too granular; gizmo drag is what
        // gets the undo command.)
    }
    markDirty();
}

function markDirty(force = false) {
    if (!scene) return;
    dirty = true;
    if (force || sceneNameEl.textContent.indexOf("(unsaved)") < 0) {
        sceneNameEl.textContent = `— ${scene.name} (unsaved)`;
    }
    updatePlayHref();
}

// ── topbar buttons ──────────────────────────────────────────────────────

btnSave.addEventListener("click", saveScene);
btnPlay.addEventListener("click", async () => {
    if (!scene) return;
    if (dirty) await saveScene();
    window.open(`/src/play.html?scene=${encodeURIComponent(scene.id)}`, "_blank");
});

const btnMatrix = document.getElementById("btn-matrix");
btnMatrix.addEventListener("click", () => {
    if (!graph) return;
    openMatrix({ graph, ruleEditor, onGraphChange });
});

const btnGraph = document.getElementById("btn-graph");
btnGraph.addEventListener("click", () => {
    if (!graph) return;
    openGraphView({ graph });
});

// ── right-sidebar tabs ──────────────────────────────────────────────────
const tabBtns = document.querySelectorAll("#right-tabs .tab");
tabBtns.forEach((b) => {
    b.addEventListener("click", () => {
        const tab = b.dataset.tab;
        tabBtns.forEach((x) => x.classList.toggle("active", x === b));
        document.querySelectorAll(".tab-pane").forEach((p) => {
            p.classList.toggle("active", p.id === `tab-${tab}`);
        });
    });
});

function updatePlayHref() {
    btnPlay.disabled = !scene;
}

// ── gizmo mode toolbar ──────────────────────────────────────────────────

const gizmoBtns = document.querySelectorAll("#gizmo-toolbar button[data-mode]");
gizmoBtns.forEach((b) => {
    b.addEventListener("click", () => {
        gizmoBtns.forEach((x) => x.classList.toggle("active", x === b));
        viewport.setGizmoMode(b.dataset.mode);
    });
});

let snapOn = false;
const btnSnap = document.getElementById("btn-snap");
function toggleSnap(on = !snapOn) {
    snapOn = on;
    viewport.setSnap(snapOn);
    btnSnap.classList.toggle("active", snapOn);
}
btnSnap.addEventListener("click", () => toggleSnap());

// camera helpers
document.getElementById("btn-fit").addEventListener("click", () => viewport.fitAll());
document.getElementById("btn-fit-sel").addEventListener("click", () => viewport.fitSelection());

// fly mode
const btnFly = document.getElementById("btn-fly");
btnFly.addEventListener("click", () => {
    viewport.setFlyMode(!viewport.flyMode);
    btnFly.classList.toggle("active", viewport.flyMode);
});

// fog toggle — keep the most-recent fog config in memory so re-enabling
// restores the player's tuning instead of resetting to a generic gray.
const btnFog = document.getElementById("btn-fog");
let _fogStash = null;
function syncFogBtn() {
    btnFog.classList.toggle("active", !!scene?.env?.fog);
}
function toggleFog() {
    if (!scene?.env) return;
    if (scene.env.fog) {
        _fogStash = { ...scene.env.fog };
        scene.env.fog = null;
    } else {
        scene.env.fog = _fogStash || { color: 0x808080, near: 30, far: 80 };
    }
    viewport.applyEnv(scene.env);
    inspector.rerender();
    syncFogBtn();
    markDirty();
}
btnFog.addEventListener("click", toggleFog);

// quad layout toggle
const btnQuad = document.getElementById("btn-quad");
btnQuad.addEventListener("click", () => {
    const next = viewport.layout === "single" ? "quad" : "single";
    viewport.setLayout(next);
    btnQuad.classList.toggle("active", next === "quad");
});

// keyboard shortcuts
window.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    // also exclude SELECT — typing a letter inside an open select
    // (e.g. when picking a property in the rule editor) was also firing
    // the gizmo shortcut, so R would set rotate-mode AND filter the list.
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (document.activeElement?.isContentEditable) return;
    if (e.code === "KeyZ" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
        // commands mutate the scene; rerender panels that depend on it
        hierarchy.render();
        if (selectedId) inspector.setEntity(currentEntity());
        markDirty();
        return;
    }
    if (e.code === "KeyY" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        history.redo();
        hierarchy.render();
        if (selectedId) inspector.setEntity(currentEntity());
        markDirty();
        return;
    }
    if (e.code === "KeyD" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        duplicateSelected();
        return;
    }
    if (e.code === "KeyS" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveScene();
        return;
    }
    if (e.code === "KeyX") {
        toggleSnap();
        return;
    }
    if (e.code === "KeyF") {
        if (e.shiftKey) viewport.fitSelection();
        else viewport.fitAll();
        return;
    }
    if (e.code === "KeyG") {
        viewport.setFlyMode(!viewport.flyMode);
        btnFly.classList.toggle("active", viewport.flyMode);
        return;
    }
    if (e.code === "KeyQ") {
        const next = viewport.layout === "single" ? "quad" : "single";
        viewport.setLayout(next);
        btnQuad.classList.toggle("active", next === "quad");
        return;
    }
    // single-letter gizmo shortcuts — ignore when a modifier is held so
    // browser chords like Cmd+R / Cmd+T aren't double-handled (the gizmo
    // mode would change AND the browser would refresh / open a tab).
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    let mode = null;
    if (e.code === "KeyT") mode = "translate";
    else if (e.code === "KeyR") mode = "rotate";
    else if (e.code === "KeyS") mode = "scale";
    if (mode) {
        viewport.setGizmoMode(mode);
        gizmoBtns.forEach((x) => x.classList.toggle("active", x.dataset.mode === mode));
    }
});

// dev convenience
window.editor = {
    get scene() { return scene; },
    get graph() { return graph; },
    save: saveScene,
};
