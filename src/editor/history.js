// Undo/redo command stack.
//
// Commands are plain { do, undo } pairs. The editor pushes a command
// after each mutation; gizmo drags are batched into a single command
// (capture transform on mouseDown, push on mouseUp).
//
// Stack is bounded to MAX_DEPTH so a long session doesn't accumulate
// forever. Both stacks clear when a fresh scene loads.

const MAX_DEPTH = 200;

export function makeHistory() {
    const past = [];
    const future = [];

    function push(cmd) {
        // skip no-op commands
        if (cmd._skip) return;
        past.push(cmd);
        if (past.length > MAX_DEPTH) past.shift();
        future.length = 0;
    }

    // Apply (do) and push. Use this for actions originated by the user.
    function apply(cmd) {
        cmd.do();
        push(cmd);
    }

    function undo() {
        const cmd = past.pop();
        if (!cmd) return null;
        cmd.undo();
        future.push(cmd);
        return cmd;
    }
    function redo() {
        const cmd = future.pop();
        if (!cmd) return null;
        cmd.do();
        past.push(cmd);
        return cmd;
    }

    function clear() {
        past.length = 0;
        future.length = 0;
    }

    return {
        apply, push, undo, redo, clear,
        get canUndo() { return past.length > 0; },
        get canRedo() { return future.length > 0; },
        get sizes() { return { past: past.length, future: future.length }; },
    };
}

// ── command factories ──────────────────────────────────────────────────

export function cmdAddEntity({ scene, viewport, hierarchy, entity }) {
    return {
        do() {
            scene.entities.push(entity);
            viewport.addEntity(entity);
            hierarchy.render();
        },
        undo() {
            const i = scene.entities.findIndex((e) => e.id === entity.id);
            if (i >= 0) scene.entities.splice(i, 1);
            viewport.removeEntity(entity.id);
            hierarchy.render();
        },
    };
}

export function cmdRemoveEntity({ scene, viewport, hierarchy, entity }) {
    const idx = scene.entities.findIndex((e) => e.id === entity.id);
    return {
        do() {
            const i = scene.entities.findIndex((e) => e.id === entity.id);
            if (i >= 0) scene.entities.splice(i, 1);
            viewport.removeEntity(entity.id);
            hierarchy.render();
        },
        undo() {
            scene.entities.splice(Math.min(idx, scene.entities.length), 0, entity);
            viewport.addEntity(entity);
            hierarchy.render();
        },
    };
}

export function cmdSetTransform({ entity, viewport, before, after }) {
    // skip if equal (drag without movement)
    const eq = (a, b) => a.every((v, i) => v === b[i]);
    const noChange =
        eq(before.pos, after.pos) &&
        eq(before.rot, after.rot) &&
        eq(before.scale, after.scale);
    return {
        _skip: noChange,
        do() {
            entity.transform.pos = [...after.pos];
            entity.transform.rot = [...after.rot];
            entity.transform.scale = [...after.scale];
            applyToMesh(entity, viewport);
        },
        undo() {
            entity.transform.pos = [...before.pos];
            entity.transform.rot = [...before.rot];
            entity.transform.scale = [...before.scale];
            applyToMesh(entity, viewport);
        },
    };
}

export function cmdToggleProperty({ entity, propId, before, after }) {
    return {
        do() {
            if (after) entity.properties[propId] = true;
            else delete entity.properties[propId];
        },
        undo() {
            if (before) entity.properties[propId] = true;
            else delete entity.properties[propId];
        },
    };
}

export function cmdRename({ entity, before, after }) {
    return {
        _skip: before === after,
        do() { entity.name = after; },
        undo() { entity.name = before; },
    };
}

function applyToMesh(entity, viewport) {
    const mesh = viewport.getMesh(entity.id);
    if (!mesh) return;
    mesh.position.set(...entity.transform.pos);
    mesh.rotation.set(...entity.transform.rot);
    mesh.scale.set(...entity.transform.scale);
    viewport.refreshOutline();
}

export function snapshotTransform(entity) {
    return {
        pos: [...entity.transform.pos],
        rot: [...entity.transform.rot],
        scale: [...entity.transform.scale],
    };
}
