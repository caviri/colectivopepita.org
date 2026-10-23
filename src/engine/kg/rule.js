// Rule: an edge in the knowledge graph. Single-property LHS / optional
// RHS. The grammar is intentionally narrow at v1 — boolean expressions
// are modeled as inferred composite properties instead.
//
// when:    "collide" | "tick" | "use" | "spawn"
// lhs/rhs: property id strings
// effect:  { kind, recipe?, params? }   (see kg/effects.js)
//
// For "collide", lhs and rhs are unordered; the compiler keys them in
// sorted order so a rule defined as (metal, wood) fires when wood hits
// metal too.

let _idSeq = 0;
function genId() {
    return `r_${Date.now().toString(36)}_${(_idSeq++).toString(36)}`;
}

export const RULE_WHEN = ["collide", "tick", "use", "spawn"];

export function makeRule(partial) {
    if (!partial?.lhs) throw new Error("Rule: lhs required");
    if (!partial?.effect) throw new Error("Rule: effect required");
    const when = partial.when || "collide";
    if (!RULE_WHEN.includes(when)) {
        throw new Error(`Rule: unknown when "${when}"`);
    }
    return {
        id: partial.id || genId(),
        when,
        lhs: partial.lhs,
        rhs: partial.rhs || null,
        effect: {
            kind: partial.effect.kind,
            recipe: partial.effect.recipe || null,
            params: { ...(partial.effect.params || {}) },
        },
        builtin: !!partial.builtin,
    };
}

export function collideKey(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}
