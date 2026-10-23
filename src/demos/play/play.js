// /play.html?scene=<id> — engine runner. Loads a scene from
// data/scenes/<id>.json (or, in Phase 1+, from IndexedDB), boots the
// engine, and runs the scene with the existing controls/player.

import { fromJSON } from "../../engine/core/serialize.js";
import { loadPool } from "../../engine/kg/pool.js";
import { mount } from "../../engine/runtime/play.js";
import { openEngineDB } from "../../engine/db.js";

const errorEl = document.getElementById("engine-error");
function showError(msg) {
    if (!errorEl) return alert(msg);
    errorEl.textContent = msg;
    errorEl.style.display = "block";
}
window.addEventListener("error", (e) => showError(`error: ${e.message}\n${e.error?.stack || ""}`));
window.addEventListener("unhandledrejection", (e) =>
    showError(`unhandled: ${e.reason?.message || e.reason}\n${e.reason?.stack || ""}`),
);

const params = new URLSearchParams(location.search);
const sceneId = params.get("scene") || "_test";

(async () => {
    const canvas = document.getElementById("game");
    document.getElementById("hud-scene").textContent = `Scene: ${sceneId}`;

    let sceneText = null;
    // 1) try IndexedDB-saved scenes (editor-authored)
    try {
        sceneText = await loadFromIDB(sceneId);
    } catch { /* fall through */ }
    // 2) fall back to bundled JSON
    if (!sceneText) {
        const resp = await fetch(`/data/scenes/${encodeURIComponent(sceneId)}.json`);
        if (!resp.ok) {
            showError(`scene "${sceneId}" not found (HTTP ${resp.status})`);
            return;
        }
        sceneText = await resp.text();
    }

    const scene = fromJSON(sceneText);
    const graph = await loadPool();
    const engine = await mount({ canvas, scene, graph });

    document.getElementById("hud-scene").textContent =
        `${scene.name} — ${scene.entities.length} entities`;
    const propCount = graph.properties.size;
    const ruleCount = graph.rules.size;
    document.getElementById("hud-counts").textContent =
        `${propCount} properties · ${ruleCount} rules`;

    engine.start();
    window.engine = engine; // dev convenience
    window.scene = scene;
    window.graph = graph;

    // hot reload: editor saves the same scene → reload the page so the
    // fresh entities + properties + rules take effect. Cheap & total.
    try {
        const ch = new BroadcastChannel("engine");
        ch.addEventListener("message", (e) => {
            if (e.data?.type !== "scene-saved") return;
            if (e.data.id !== sceneId) return;
            clearTimeout(window._reloadTimer);
            window._reloadTimer = setTimeout(() => location.reload(), 150);
        });
    } catch { /* BroadcastChannel unsupported — silent */ }
})();

const STORE = "scenes";
async function loadFromIDB(id) {
    const db = await openEngineDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const r = tx.objectStore(STORE).get(id);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => reject(r.error);
    });
}
