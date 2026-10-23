// Property + rule pool: thin façade over the graph that loads built-ins
// from data/properties.json + data/rules.json and merges any user-defined
// extensions persisted in IndexedDB.

import { addProperty, addRule, makeGraph } from "./graph.js";
import { compile } from "./compile.js";
import { openEngineDB } from "../db.js";

const STORE = "kg";
const KEY_PROPS = "user-properties";
const KEY_RULES = "user-rules";

const openDB = openEngineDB;

async function readKey(key) {
    try {
        const db = await openDB();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, "readonly");
            const r = tx.objectStore(STORE).get(key);
            r.onsuccess = () => resolve(r.result || []);
            r.onerror = () => reject(r.error);
        });
    } catch {
        return [];
    }
}

async function writeKey(key, value) {
    try {
        const db = await openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, "readwrite");
            tx.objectStore(STORE).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch { /* best effort */ }
}

export async function loadPool(opts = {}) {
    const baseUrl = opts.baseUrl ?? "/data";
    const g = makeGraph();
    // built-ins
    const [propsResp, rulesResp] = await Promise.all([
        fetch(`${baseUrl}/properties.json`).catch(() => null),
        fetch(`${baseUrl}/rules.json`).catch(() => null),
    ]);
    const builtinProps = propsResp && propsResp.ok ? await propsResp.json() : [];
    const builtinRules = rulesResp && rulesResp.ok ? await rulesResp.json() : [];
    for (const p of builtinProps) addProperty(g, { ...p, builtin: true });
    for (const r of builtinRules) addRule(g, { ...r, builtin: true });
    // user overlays
    const [userProps, userRules] = await Promise.all([
        readKey(KEY_PROPS),
        readKey(KEY_RULES),
    ]);
    for (const p of userProps) addProperty(g, p);
    for (const r of userRules) addRule(g, r);
    compile(g);
    return g;
}

export async function saveUserProperty(prop) {
    const props = await readKey(KEY_PROPS);
    const i = props.findIndex((p) => p.id === prop.id);
    if (i >= 0) props[i] = prop;
    else props.push(prop);
    await writeKey(KEY_PROPS, props);
}

export async function saveUserRule(rule) {
    const rules = await readKey(KEY_RULES);
    const i = rules.findIndex((r) => r.id === rule.id);
    if (i >= 0) rules[i] = rule;
    else rules.push(rule);
    await writeKey(KEY_RULES, rules);
}

export async function deleteUserProperty(id) {
    const props = await readKey(KEY_PROPS);
    await writeKey(KEY_PROPS, props.filter((p) => p.id !== id));
}

export async function deleteUserRule(id) {
    const rules = await readKey(KEY_RULES);
    await writeKey(KEY_RULES, rules.filter((r) => r.id !== id));
}
