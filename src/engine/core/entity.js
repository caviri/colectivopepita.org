// Entity: one placed thing in a scene. Carries a transform, an optional
// mesh reference (asset id), and a property bag. Properties are the
// edges into the knowledge graph — keys are property ids defined in
// the pool; values are per-instance data overrides.
//
// Transform uses Euler rotation (xyz radians) to stay JSON-friendly.
// Three.js conversion happens in the runtime layer, not here.

let _idSeq = 0;
function genId(prefix = "e") {
    return `${prefix}_${Date.now().toString(36)}_${(_idSeq++).toString(36)}`;
}

export function makeEntity(partial = {}) {
    return {
        id: partial.id || genId("e"),
        name: partial.name || "Entity",
        transform: {
            pos: partial.transform?.pos
                ? [...partial.transform.pos]
                : [0, 0, 0],
            rot: partial.transform?.rot
                ? [...partial.transform.rot]
                : [0, 0, 0],
            scale: partial.transform?.scale
                ? [...partial.transform.scale]
                : [1, 1, 1],
        },
        // mesh: { kind: "primitive"|"asset", ... }
        //   primitive: { kind: "primitive", shape: "box"|"sphere"|"plane",
        //                size: [..], color: 0xRRGGBB }
        //   asset:     { kind: "asset", folder: "...", targetSize: number }
        mesh: partial.mesh ? { ...partial.mesh } : null,
        // properties: { [propId]: dataOverride|true }
        properties: { ...(partial.properties || {}) },
    };
}

export function setProperty(entity, propId, data = true) {
    entity.properties[propId] = data;
}

export function clearProperty(entity, propId) {
    delete entity.properties[propId];
}

export function hasProperty(entity, propId) {
    return Object.prototype.hasOwnProperty.call(entity.properties, propId);
}
