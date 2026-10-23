// Physics system — broadphase + collision events.
//
// We don't simulate dynamics (no impulses, no gravity for entities). The
// player rig keeps its own gravity in controls.js; everything else is
// authored static or animated by other systems. What we *do* care about
// is: when does the player overlap with an entity, and is this a fresh
// collision (so the rule fires once on entry) vs a sustained one.
//
// Each entity that has the "Collidable" property (or a descendant of it)
// gets an oriented AABB collider built from its mesh. The algorithm is
// extracted from src/main.js#resolveCollisions — local-space rectangle
// resolution that handles Y-rotated boxes.

import * as THREE from "three";

const PLAYER_RADIUS = 0.45;

export function makePhysics(opts = {}) {
    const playerRadius = opts.playerRadius ?? PLAYER_RADIUS;
    const colliders = []; // { entity, mesh, x, z, hw, hd, cos, sin }
    const overlapping = new Set();

    function addCollider(entity, mesh, sizeOverride) {
        const box = new THREE.Box3().setFromObject(mesh);
        if (box.isEmpty()) return null;
        const size = new THREE.Vector3();
        box.getSize(size);
        const hw = (sizeOverride?.[0] ?? size.x) / 2;
        const hd = (sizeOverride?.[2] ?? size.z) / 2;
        const yaw = mesh.rotation.y || 0;
        const c = {
            entity,
            mesh,
            x: mesh.position.x,
            z: mesh.position.z,
            hw,
            hd,
            cos: Math.cos(yaw),
            sin: Math.sin(yaw),
        };
        colliders.push(c);
        return c;
    }

    function clear() {
        colliders.length = 0;
        overlapping.clear();
    }

    function syncFromMesh(c) {
        c.x = c.mesh.position.x;
        c.z = c.mesh.position.z;
        const yaw = c.mesh.rotation.y || 0;
        c.cos = Math.cos(yaw);
        c.sin = Math.sin(yaw);
    }

    // Resolve player overlap against all colliders. Calls onCollide(entity)
    // when a fresh overlap is detected (player wasn't overlapping last
    // tick) — drives "collide" rules. Sustained overlaps are silent.
    function step(player, onCollide) {
        const seen = new Set();
        for (const b of colliders) {
            syncFromMesh(b);
            const dx = player.position.x - b.x;
            const dz = player.position.z - b.z;
            const lx = dx * b.cos - dz * b.sin;
            const lz = dx * b.sin + dz * b.cos;
            const cx = Math.max(-b.hw, Math.min(b.hw, lx));
            const cz = Math.max(-b.hd, Math.min(b.hd, lz));
            let nx = lx - cx;
            let nz = lz - cz;
            let dist = Math.hypot(nx, nz);
            if (dist >= playerRadius) continue;
            // overlap: push player out
            let pushLX, pushLZ;
            if (dist > 0.0001) {
                pushLX = nx / dist;
                pushLZ = nz / dist;
            } else {
                const ex = b.hw - Math.abs(lx);
                const ez = b.hd - Math.abs(lz);
                if (ex < ez) {
                    pushLX = Math.sign(lx) || 1;
                    pushLZ = 0;
                    dist = -ex;
                } else {
                    pushLX = 0;
                    pushLZ = Math.sign(lz) || 1;
                    dist = -ez;
                }
            }
            const overlap = playerRadius - dist;
            const wx = pushLX * b.cos + pushLZ * b.sin;
            const wz = -pushLX * b.sin + pushLZ * b.cos;
            player.position.x += wx * overlap;
            player.position.z += wz * overlap;
            seen.add(b.entity.id);
            if (!overlapping.has(b.entity.id)) {
                onCollide?.(b.entity, {
                    point: new THREE.Vector3(b.x, player.position.y + 0.5, b.z),
                });
            }
        }
        overlapping.clear();
        for (const id of seen) overlapping.add(id);
    }

    return { addCollider, clear, step, colliders };
}
