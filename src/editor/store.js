// IndexedDB-backed scene store. Schema lives in src/engine/db.js so
// the editor, the play runner, and the KG pool all agree on which
// stores must exist (one DB shared, no schema race).

import { openEngineDB } from "../engine/db.js";

const STORE = "scenes";
const STORE_LIST = "scenes-meta";

const openDB = openEngineDB;

export async function listScenes() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_LIST, "readonly");
        const store = tx.objectStore(STORE_LIST);
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result || []).sort(
            (a, b) => (b.savedAt || 0) - (a.savedAt || 0),
        ));
        req.onerror = () => reject(req.error);
    });
}

export async function loadScene(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const r = tx.objectStore(STORE).get(id);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => reject(r.error);
    });
}

export async function saveScene(id, name, jsonText) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE, STORE_LIST], "readwrite");
        tx.objectStore(STORE).put(jsonText, id);
        tx.objectStore(STORE_LIST).put(
            { id, name, savedAt: Date.now() },
            id,
        );
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function deleteScene(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE, STORE_LIST], "readwrite");
        tx.objectStore(STORE).delete(id);
        tx.objectStore(STORE_LIST).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// Bundled scenes shipped under data/scenes/. We discover them at runtime
// by trying a small known list — there's no directory-listing in static
// hosting. Editor-authored scenes (in IDB) are layered on top.
const BUILTIN_IDS = ["_test", "main", "lab1", "lab2"];

export async function listBuiltinScenes() {
    const out = [];
    for (const id of BUILTIN_IDS) {
        try {
            const r = await fetch(`/data/scenes/${id}.json`);
            if (!r.ok) continue;
            const j = await r.json();
            out.push({ id, name: j.name || id, builtin: true });
        } catch { /* missing — skip */ }
    }
    return out;
}

export async function loadBuiltin(id) {
    const r = await fetch(`/data/scenes/${id}.json`);
    if (!r.ok) return null;
    return await r.text();
}

export function slugify(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40) || `scene-${Date.now().toString(36)}`;
}
