// Scene: the top-level authored unit. A list of entities plus
// environment, camera, and metadata. Designed to round-trip through
// JSON without loss.

let _idSeq = 0;
function genId() {
    return `scene_${Date.now().toString(36)}_${(_idSeq++).toString(36)}`;
}

export function makeScene(partial = {}) {
    return {
        id: partial.id || genId(),
        name: partial.name || "Untitled Scene",
        version: 1,
        entities: partial.entities ? [...partial.entities] : [],
        env: {
            background: partial.env?.background ?? 0x87a8c4,
            fog: partial.env?.fog ?? null, // { color, near, far }
            ambient: partial.env?.ambient ?? { color: 0xffffff, intensity: 0.6 },
            sun: partial.env?.sun ?? {
                color: 0xffffff,
                intensity: 1.1,
                position: [40, 60, 20],
            },
            ground: partial.env?.ground ?? {
                color: 0xe6edf2,
                size: 80,
            },
            // optional procedural skydome — { kind: "gradient", top,
            // bottom, exponent, offset }. null hides it; the engine and
            // editor viewport both support live toggling.
            sky: partial.env?.sky ?? null,
        },
        camera: partial.camera || {
            spawn: [0, 0, 8],
            yaw: 0,
        },
        meta: { ...(partial.meta || {}) },
    };
}

export function addEntity(scene, entity) {
    scene.entities.push(entity);
    return entity;
}

export function removeEntity(scene, id) {
    const i = scene.entities.findIndex((e) => e.id === id);
    if (i >= 0) scene.entities.splice(i, 1);
}

export function findEntity(scene, id) {
    return scene.entities.find((e) => e.id === id) || null;
}
