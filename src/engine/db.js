// Shared opener for the engine's IndexedDB database.
//
// Three modules (play, editor/store, kg/pool) need persistence in the
// same DB. If each one opens v1 with only its own store, whichever
// opens first wins and the others fail with NotFoundError on transaction.
//
// We centralise the schema here at a single bumped version so every
// caller agrees on which stores must exist. Existing data in older
// versions is preserved by guarding `createObjectStore` with `contains`.

const DB_NAME = "antarctic-engine";
const DB_VERSION = 2;
const STORES = ["scenes", "scenes-meta", "kg"];

let _promise = null;

export function openEngineDB() {
    if (_promise) return _promise;
    _promise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            for (const name of STORES) {
                if (!db.objectStoreNames.contains(name)) {
                    db.createObjectStore(name);
                }
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => {
            // another tab has the old version open. Don't crash —
            // resolve once that tab releases the upgrade transaction.
            console.warn("[db] upgrade blocked by another tab");
        };
    });
    return _promise;
}

export const ENGINE_STORES = STORES;
