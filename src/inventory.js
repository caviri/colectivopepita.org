const DB_NAME = "antarctic-sampler";
const STORE = "state";
const KEY = "inventory";
const DEFAULT = {
    samples: 0,
    cultures: 0,
    culturedDishes: [], // dish indexes that have already been cultured in lab1
    lastPos: null, // { x, z } — last known outdoor player position
};

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            req.result.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function getInventory() {
    try {
        const db = await openDB();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, "readonly");
            const r = tx.objectStore(STORE).get(KEY);
            r.onsuccess = () => {
                const v = r.result || {};
                resolve({
                    samples: v.samples ?? 0,
                    cultures: v.cultures ?? 0,
                    culturedDishes: Array.isArray(v.culturedDishes)
                        ? v.culturedDishes
                        : [],
                    lastPos: v.lastPos ?? null,
                });
            };
            r.onerror = () => reject(r.error);
        });
    } catch {
        return { ...DEFAULT };
    }
}

// Wipe everything tied to a single playthrough — IDB record + the session
// flags driving the mission todo list. Each page calls this from its
// "New Game" handler before navigating back to outdoor.html.
const TODO_KEYS = [
    "todo-thrown",
    "todo-usedFP",
    "todo-usedOrbit",
    "todo-visitedLab1",
    "todo-visitedLab2",
    "todo-readManual",
];
export async function resetGame() {
    for (const k of TODO_KEYS) sessionStorage.removeItem(k);
    await saveInventory({ ...DEFAULT });
    // Also reset the saved camera-mode preference so a brand-new game
    // always starts in third-person, regardless of whether the previous
    // run had locked-in first-person via V.
    try {
        const raw = localStorage.getItem("antarctic-sampler-prefs");
        if (raw) {
            const p = JSON.parse(raw);
            p.mode = "follow";
            localStorage.setItem("antarctic-sampler-prefs", JSON.stringify(p));
        }
    } catch { /* private mode etc. — silent */ }
}

export async function saveInventory(inv) {
    try {
        const db = await openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, "readwrite");
            tx.objectStore(STORE).put(inv, KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        // best effort; don't crash the game on storage failure
    }
}
