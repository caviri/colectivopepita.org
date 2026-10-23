// In-memory knowledge graph: properties + rules. Provides lookup,
// traversal, and mutation primitives. Compilation lives in compile.js.

import { makeProperty } from "./property.js";
import { makeRule } from "./rule.js";

export function makeGraph() {
    return {
        properties: new Map(), // id → Property
        rules: new Map(),      // id → Rule
        // populated by compile():
        ancestors: new Map(),    // propId → Set<ancestor propId>  (incl. self)
        descendants: new Map(),  // propId → Set<descendant propId> (incl. self)
        compiled: null,
    };
}

export function addProperty(g, partial) {
    const p = partial.id && g.properties.has(partial.id)
        ? makeProperty({ ...g.properties.get(partial.id), ...partial })
        : makeProperty(partial);
    g.properties.set(p.id, p);
    g.compiled = null;
    return p;
}

export function removeProperty(g, id) {
    g.properties.delete(id);
    // also drop any rules that referenced it
    for (const [rid, r] of g.rules) {
        if (r.lhs === id || r.rhs === id) g.rules.delete(rid);
    }
    g.compiled = null;
}

export function addRule(g, partial) {
    const r = partial.id && g.rules.has(partial.id)
        ? makeRule({ ...g.rules.get(partial.id), ...partial })
        : makeRule(partial);
    g.rules.set(r.id, r);
    g.compiled = null;
    return r;
}

export function removeRule(g, id) {
    g.rules.delete(id);
    g.compiled = null;
}

export function getProperty(g, id) {
    return g.properties.get(id) || null;
}

export function listProperties(g) {
    return [...g.properties.values()];
}

export function listRules(g) {
    return [...g.rules.values()];
}
