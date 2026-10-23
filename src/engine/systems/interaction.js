// Interaction system — turns the player's E-key / click input into
// "use" events on the nearest interactable entity. An entity is
// interactable if it has the "Pickup" property or any descendant of it.
//
// Proximity is a simple xz distance check; the closest qualifying entity
// within `range` is highlighted via a pluggable `onHover` callback.

import * as THREE from "three";

const _v = new THREE.Vector3();

export function makeInteraction(opts = {}) {
    const range = opts.range ?? 2.6;

    function nearest(player, candidates) {
        let best = null;
        let bestD = range * range;
        for (const e of candidates) {
            if (!e._mesh) continue;
            const dx = e._mesh.position.x - player.position.x;
            const dz = e._mesh.position.z - player.position.z;
            const d = dx * dx + dz * dz;
            if (d < bestD) {
                bestD = d;
                best = e;
            }
        }
        return best;
    }

    return { nearest };
}
