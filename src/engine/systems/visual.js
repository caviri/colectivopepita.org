// Visual system — flash + particle effects for rule outcomes. Kept
// minimal: enough to make rule firings visible during the engine MVP.

import * as THREE from "three";

export function makeVisual(scene) {
    const flashes = []; // { mesh, original, until }
    const particles = []; // { mesh, vy, life, max }

    function flash(entity, opts = {}) {
        const mesh = entity?._mesh;
        if (!mesh) return;
        // record originals once; we restore on expiry
        const ms = opts.ms ?? 200;
        const color = opts.color ?? 0xffffff;
        mesh.traverse((o) => {
            if (!o.isMesh || !o.material) return;
            const mat = o.material;
            if (!mat._flashOriginal) {
                mat._flashOriginal = {
                    emissive: mat.emissive ? mat.emissive.clone() : null,
                    emissiveIntensity: mat.emissiveIntensity ?? 1,
                };
            }
            if (mat.emissive) {
                mat.emissive.set(color);
                mat.emissiveIntensity = 0.9;
            }
        });
        flashes.push({ mesh, until: performance.now() + ms });
    }

    function particlesAt(point, opts = {}) {
        if (!point) return;
        const count = opts.count ?? 12;
        const color = opts.color ?? 0xffffff;
        const spread = opts.spread ?? 0.6;
        const life = opts.life ?? 600;
        const geom = new THREE.SphereGeometry(0.04, 6, 4);
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
        for (let i = 0; i < count; i++) {
            const m = new THREE.Mesh(geom, mat.clone());
            m.position.set(
                point.x + (Math.random() - 0.5) * spread,
                point.y + Math.random() * spread,
                point.z + (Math.random() - 0.5) * spread,
            );
            scene.add(m);
            particles.push({
                mesh: m,
                vy: 1.5 + Math.random() * 1.5,
                vx: (Math.random() - 0.5) * 1.5,
                vz: (Math.random() - 0.5) * 1.5,
                life: 0,
                max: life,
            });
        }
    }

    function update(dt) {
        const now = performance.now();
        // expire flashes
        for (let i = flashes.length - 1; i >= 0; i--) {
            const f = flashes[i];
            if (now >= f.until) {
                f.mesh.traverse((o) => {
                    if (!o.isMesh || !o.material?._flashOriginal) return;
                    const orig = o.material._flashOriginal;
                    if (orig.emissive && o.material.emissive) {
                        o.material.emissive.copy(orig.emissive);
                    }
                    o.material.emissiveIntensity = orig.emissiveIntensity;
                });
                flashes.splice(i, 1);
            }
        }
        // step particles
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.life += dt * 1000;
            p.mesh.position.y += p.vy * dt;
            p.mesh.position.x += p.vx * dt;
            p.mesh.position.z += p.vz * dt;
            p.vy -= 4 * dt;
            const t = 1 - p.life / p.max;
            p.mesh.material.opacity = Math.max(0, t);
            if (p.life >= p.max) {
                scene.remove(p.mesh);
                p.mesh.material.dispose();
                particles.splice(i, 1);
            }
        }
    }

    return { flash, particles: particlesAt, update };
}
