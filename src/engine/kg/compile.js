// Compile pass — turns a knowledge graph into a runtime dispatch table
// that already accounts for inheritance and inference.
//
// Steps:
//   1. Closure: for each property compute its ancestor set (transitive
//      parents incl. self) and descendant set (transitive children).
//   2. Rule expansion: a rule that names property P fires on every
//      descendant of P. We *don't* duplicate the rule object; we just
//      key it under each descendant id, sharing the underlying rule.
//   3. Indexing: build per-when dispatch tables.
//        collide → Map<sortedKey, Rule[]>
//        tick    → Map<propId,    Rule[]>
//        use     → Map<propId,    Rule[]>
//        spawn   → Map<propId,    Rule[]>
//
// Entity-side closure (expanding props by ancestors + applying infer
// rules to fixed point) lives in expandEntityProps below. Compile is
// pure on the graph; entity expansion happens at scene mount time.

import { collideKey } from "./rule.js";

export function compile(g) {
    closeAncestors(g);
    closeDescendants(g);

    const tables = {
        collide: new Map(),
        tick: new Map(),
        use: new Map(),
        spawn: new Map(),
    };

    for (const r of g.rules.values()) {
        const lhsSet = g.descendants.get(r.lhs) || new Set([r.lhs]);
        if (r.when === "collide") {
            const rhsSet = r.rhs
                ? (g.descendants.get(r.rhs) || new Set([r.rhs]))
                : null;
            if (rhsSet) {
                for (const a of lhsSet) {
                    for (const b of rhsSet) {
                        push(tables.collide, collideKey(a, b), r);
                    }
                }
            } else {
                // single-sided collide: any collision involving lhs
                for (const a of lhsSet) {
                    push(tables.collide, `${a}|*`, r);
                }
            }
        } else {
            for (const a of lhsSet) push(tables[r.when], a, r);
        }
    }

    g.compiled = tables;
    return tables;
}

function push(map, key, value) {
    let arr = map.get(key);
    if (!arr) {
        arr = [];
        map.set(key, arr);
    }
    arr.push(value);
}

function closeAncestors(g) {
    g.ancestors = new Map();
    for (const p of g.properties.values()) {
        const seen = new Set([p.id]);
        const stack = [p.id];
        while (stack.length) {
            const cur = stack.pop();
            const parents = g.properties.get(cur)?.parents || [];
            for (const par of parents) {
                if (!seen.has(par)) {
                    seen.add(par);
                    stack.push(par);
                }
            }
        }
        g.ancestors.set(p.id, seen);
    }
}

function closeDescendants(g) {
    g.descendants = new Map();
    for (const id of g.properties.keys()) {
        g.descendants.set(id, new Set([id]));
    }
    // Each ancestor relation gives us a descendant relation in reverse.
    for (const [id, ancestors] of g.ancestors) {
        for (const a of ancestors) {
            if (a !== id) g.descendants.get(a).add(id);
        }
    }
}

// Expand an entity's property set by:
//   (a) adding all transitive ancestors of each declared property
//   (b) applying every property's `infer` rules iteratively until no
//       new properties are added (fixed point, cycle-safe via Set).
// Returns a new Set<propId> — does not mutate the entity.
export function expandEntityProps(entity, g) {
    if (!g.compiled) compile(g);
    const result = new Set();
    for (const propId of Object.keys(entity.properties)) {
        const anc = g.ancestors.get(propId);
        if (anc) for (const a of anc) result.add(a);
        else result.add(propId); // unknown property — keep as-is
    }
    // Iterate inference rules to fixed point. We scan every property's
    // infer rules (not just those already in `result`) — a rule on
    // `frozen` declares the conditions under which `frozen` gets added,
    // so we have to evaluate it regardless of whether `frozen` is yet
    // present.
    let changed = true;
    while (changed) {
        changed = false;
        for (const p of g.properties.values()) {
            if (!p.infer?.length) continue;
            for (const rule of p.infer) {
                if (!rule.if.every((req) => result.has(req))) continue;
                for (const add of rule.add) {
                    if (result.has(add)) continue;
                    const anc = g.ancestors.get(add);
                    if (anc) for (const a of anc) result.add(a);
                    else result.add(add);
                    changed = true;
                }
            }
        }
    }
    return result;
}
