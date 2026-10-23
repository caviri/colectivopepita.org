// Property: a node in the knowledge graph. Properties have parents
// (inheritance — a Metal is-a Solid), per-property `data` (defaults that
// entities can override), and optional `infer` rules that add other
// properties when a precondition is met.

export function makeProperty(partial) {
    if (!partial?.id) throw new Error("Property: id required");
    return {
        id: partial.id,
        label: partial.label || partial.id,
        category: partial.category || "misc",
        parents: Array.isArray(partial.parents) ? [...partial.parents] : [],
        data: { ...(partial.data || {}) },
        // infer: [{ if: [propId, ...], add: [propId, ...] }]
        infer: Array.isArray(partial.infer)
            ? partial.infer.map((r) => ({
                if: [...(r.if || [])],
                add: [...(r.add || [])],
            }))
            : [],
        builtin: !!partial.builtin,
    };
}
