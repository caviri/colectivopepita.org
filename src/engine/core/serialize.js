// Scene serialization. Versioned so we can migrate forward without
// breaking older saved scenes.

import { makeScene } from "./scene.js";
import { makeEntity } from "./entity.js";

export const SCENE_VERSION = 1;

export function toJSON(scene) {
    return JSON.stringify(
        {
            version: SCENE_VERSION,
            id: scene.id,
            name: scene.name,
            entities: scene.entities,
            env: scene.env,
            camera: scene.camera,
            meta: scene.meta,
        },
        null,
        2,
    );
}

export function fromJSON(text) {
    const raw = typeof text === "string" ? JSON.parse(text) : text;
    if (!raw || typeof raw !== "object") {
        throw new Error("scene JSON: expected an object");
    }
    const v = raw.version || 1;
    const migrated = migrate(raw, v);
    return makeScene({
        ...migrated,
        entities: (migrated.entities || []).map((e) => makeEntity(e)),
    });
}

// Future migrations land here. Today everything is v1.
function migrate(raw, v) {
    if (v === SCENE_VERSION) return raw;
    throw new Error(`scene JSON: unsupported version ${v}`);
}
