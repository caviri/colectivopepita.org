// Scene exporter. Walks a built THREE.Scene and emits two formats:
//
//   sceneToEngineJSON(scene, opts) → string
//     The engine's own scene schema (see entity.js / serialize.js). Best-effort:
//     primitives map cleanly, asset-loaded groups are recognised by
//     `userData.assetFolder` (set in assets.js#loadFolder), and anything else
//     degrades to its bounding box with a warning so the editor at least gets
//     a placeholder.
//
//   sceneToGLB(scene) → Promise<Blob>
//     Universal interchange format. Use this to import the scene into Blender,
//     Unity, Godot, online viewers, etc. The browser runs three's GLTFExporter.
//
// Both ignore objects tagged `userData.exportSkip = true` (helpers, debug
// gizmos, the player rig — anything that's runtime-only).

import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

// ---------------- engine JSON ----------------

export function sceneToEngineJSON(scene, opts = {}) {
    const {
        id = "exported",
        name = "Exported scene",
        env = null,
        camera = null,
    } = opts;

    const entities = [];
    const warnings = [];
    let counter = 0;

    function nextId(hint) {
        counter += 1;
        const safe = (hint || "entity").toString().toLowerCase()
            .replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "")
            .slice(0, 32) || "entity";
        return `${safe}_${counter}`;
    }

    // We can't use scene.traverse directly because we need to *prune* — when
    // we hit an asset wrapper we emit one entity and skip its descendants.
    // So a manual recursive walk it is.
    const walk = (obj) => {
        if (!obj || obj.userData?.exportSkip) return;
        // hidden objects: keep them in the export (they may be toggled at
        // runtime), but skip purely-internal helpers (Three's AxesHelper etc.)
        if (obj.isLight || obj.isCamera) return;
        if (obj.type && /Helper$/.test(obj.type)) return;

        // asset-loaded model? emit one entity, don't descend
        if (obj.userData?.assetFolder) {
            entities.push(makeAssetEntity(obj, nextId(obj.name || obj.userData.assetFolder)));
            return;
        }

        if (obj.isMesh) {
            const ent = makePrimitiveEntity(obj, nextId(obj.name || obj.geometry?.type));
            if (ent) entities.push(ent);
            else warnings.push(`skipped mesh "${obj.name || obj.uuid}" (unsupported geometry: ${obj.geometry?.type})`);
            // meshes don't have meaningful exportable children for our schema
            return;
        }

        // Group / Object3D: recurse
        for (const child of obj.children) walk(child);
    };

    for (const child of scene.children) walk(child);

    const out = {
        version: 1,
        id,
        name,
        env: env ?? sniffEnv(scene),
        camera: camera ?? { spawn: [0, 0, 6], yaw: 0 },
        entities,
    };
    if (warnings.length) out.meta = { exportWarnings: warnings };
    return JSON.stringify(out, null, 2);
}

function makeAssetEntity(obj, id) {
    obj.updateWorldMatrix(true, false);
    obj.matrixWorld.decompose(_v, _q, _s);
    _e.setFromQuaternion(_q, "XYZ");
    return {
        id,
        name: obj.name || obj.userData.assetFolder,
        transform: {
            pos: round3([_v.x, _v.y, _v.z]),
            rot: round3([_e.x, _e.y, _e.z]),
            scale: round3([_s.x, _s.y, _s.z]),
        },
        mesh: {
            kind: "asset",
            folder: obj.userData.assetFolder,
            ...(obj.userData.targetSize != null && { targetSize: obj.userData.targetSize }),
        },
        properties: {},
    };
}

function makePrimitiveEntity(mesh, id) {
    const shape = detectShape(mesh.geometry);
    if (!shape) return null;

    mesh.updateWorldMatrix(true, false);
    mesh.matrixWorld.decompose(_v, _q, _s);
    _e.setFromQuaternion(_q, "XYZ");

    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const meshDef = { kind: "primitive", ...shape };
    if (mat) {
        if (mat.color) meshDef.color = mat.color.getHex();
        if (typeof mat.roughness === "number") meshDef.roughness = round(mat.roughness);
        if (typeof mat.metalness === "number") meshDef.metalness = round(mat.metalness);
        if (mat.emissive && mat.emissive.getHex() !== 0) {
            meshDef.emissive = mat.emissive.getHex();
            if (typeof mat.emissiveIntensity === "number") {
                meshDef.emissiveIntensity = round(mat.emissiveIntensity);
            }
        }
        if (mat.transparent) meshDef.transparent = true;
        if (typeof mat.opacity === "number" && mat.opacity < 1) meshDef.opacity = round(mat.opacity);
        // DoubleSide / BackSide come back as numbers; only emit when not Front.
        if (mat.side === 2) meshDef.side = "double";
        else if (mat.side === 1) meshDef.side = "back";
    }
    if (mesh.visible === false) meshDef.visible = false;

    return {
        id,
        name: mesh.name || shape.shape,
        transform: {
            pos: round3([_v.x, _v.y, _v.z]),
            rot: round3([_e.x, _e.y, _e.z]),
            scale: round3([_s.x, _s.y, _s.z]),
        },
        mesh: meshDef,
        properties: {},
    };
}

// Map a THREE geometry to our engine's primitive schema. Returns `null` for
// anything we can't represent at all — caller emits a warning. For shapes the
// engine doesn't natively support (cone, capsule, torus, custom buffer geom)
// we degrade to the closest engine primitive that preserves silhouette.
function detectShape(geom) {
    if (!geom) return null;
    const p = geom.parameters || {};
    switch (geom.type) {
        case "BoxGeometry":
            return { shape: "box", size: round3([p.width ?? 1, p.height ?? 1, p.depth ?? 1]) };
        case "PlaneGeometry":
            return { shape: "plane", size: round3([p.width ?? 1, p.height ?? 1]) };
        case "SphereGeometry":
            return { shape: "sphere", size: [round((p.radius ?? 0.5) * 2)] };
        case "CylinderGeometry": {
            const r = Math.max(p.radiusTop ?? 0.5, p.radiusBottom ?? 0.5);
            return { shape: "cylinder", size: [round(r * 2), round(p.height ?? 1)] };
        }
        // --- engine doesn't have these — fall back to nearest neighbour ---
        case "ConeGeometry":
            return { shape: "cylinder", size: [round((p.radius ?? 0.5) * 2), round(p.height ?? 1)] };
        case "CapsuleGeometry": {
            const len = (p.length ?? 0) + (p.radius ?? 0.5) * 2;
            return { shape: "cylinder", size: [round((p.radius ?? 0.5) * 2), round(len)] };
        }
        case "TorusGeometry": {
            // total outer extent. A flat box gives the right footprint.
            const outer = ((p.radius ?? 1) + (p.tube ?? 0.4)) * 2;
            return { shape: "box", size: [round(outer), round((p.tube ?? 0.4) * 2), round(outer)] };
        }
        case "RingGeometry":
            return { shape: "plane", size: [round((p.outerRadius ?? 1) * 2), round((p.outerRadius ?? 1) * 2)] };
        default: {
            // Last-resort fallback: approximate with the geometry's bounding
            // box. Loses curvature but at least the editor sees the entity at
            // roughly the right size & position.
            try {
                if (!geom.boundingBox) geom.computeBoundingBox();
                const bb = geom.boundingBox;
                if (!bb) return null;
                const w = bb.max.x - bb.min.x;
                const h = bb.max.y - bb.min.y;
                const d = bb.max.z - bb.min.z;
                if (!Number.isFinite(w) || !Number.isFinite(h) || !Number.isFinite(d)) return null;
                return { shape: "box", size: round3([Math.max(w, 0.01), Math.max(h, 0.01), Math.max(d, 0.01)]), approx: true };
            } catch {
                return null;
            }
        }
    }
}

// Best-effort scrape of scene-level lighting / fog / background so the
// emitted JSON looks identical when round-tripped through the engine.
//
// Pages that animate background / fog / sun.intensity at runtime can stash
// their first-frame values in `scene.userData.initialEnv` and
// `light.userData.initialIntensity` — we prefer those over the live values
// so the exported JSON captures the player's initial view, not whatever
// state the runtime drifted to between page-load and export.
function sniffEnv(scene) {
    const env = {};
    const initial = scene.userData?.initialEnv || {};
    if (initial.background != null) {
        env.background = initial.background;
    } else if (scene.background?.isColor) {
        env.background = scene.background.getHex();
    }
    if (initial.fog !== undefined) {
        env.fog = initial.fog;
    } else if (scene.fog) {
        env.fog = {
            color: scene.fog.color.getHex(),
            near: scene.fog.near ?? 1,
            far: scene.fog.far ?? 1000,
        };
    } else {
        env.fog = null;
    }
    let amb = null;
    let sun = null;
    scene.traverse((o) => {
        if (o.isAmbientLight && !amb) amb = o;
        if (o.isDirectionalLight && !sun) sun = o;
    });
    if (amb) {
        const intensity = amb.userData?.initialIntensity ?? amb.intensity;
        env.ambient = { color: amb.color.getHex(), intensity: round(intensity) };
    }
    if (sun) {
        const intensity = sun.userData?.initialIntensity ?? sun.intensity;
        env.sun = {
            color: sun.color.getHex(),
            intensity: round(intensity),
            position: round3([sun.position.x, sun.position.y, sun.position.z]),
        };
    }
    return env;
}

// ---------------- glTF / glb ----------------

// Returns a Blob containing a binary .glb. Works with the standard Blender
// File → Import → glTF 2.0 (.glb / .gltf) flow.
export function sceneToGLB(scene) {
    const exporter = new GLTFExporter();
    return new Promise((resolve, reject) => {
        // Build a clean copy that omits objects flagged as runtime-only.
        // Cloning is cheap and avoids mutating the live scene.
        const cloned = stripUnexportable(scene);
        exporter.parse(
            cloned,
            (result) => {
                if (result instanceof ArrayBuffer) {
                    resolve(new Blob([result], { type: "model/gltf-binary" }));
                } else {
                    // GLTFExporter falls back to JSON glTF when binary:false;
                    // we always pass binary:true so this branch is defensive.
                    resolve(new Blob([JSON.stringify(result)], { type: "model/gltf+json" }));
                }
            },
            (err) => reject(err),
            { binary: true, embedImages: true, onlyVisible: false },
        );
    });
}

function stripUnexportable(scene) {
    const root = scene.clone(false);
    root.position.copy(scene.position);
    root.rotation.copy(scene.rotation);
    root.scale.copy(scene.scale);
    const visit = (src, dst) => {
        for (const child of src.children) {
            if (child.userData?.exportSkip) continue;
            if (child.type && /Helper$/.test(child.type)) continue;
            const cloned = child.clone(false);
            dst.add(cloned);
            visit(child, cloned);
        }
    };
    visit(scene, root);
    return root;
}

// ---------------- download helpers ----------------

export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadString(text, filename, mime = "application/json") {
    downloadBlob(new Blob([text], { type: mime }), filename);
}

// One-shot helper used by the pause-menu "Export scene" buttons. Triggers two
// downloads: <id>.json (engine-format) and <id>.glb (universal). Returns a
// status string the caller can show in a toast.
export async function exportScene(scene, opts = {}) {
    const id = opts.id || "scene";
    const name = opts.name || id;
    let json = null;
    let glb = null;
    try {
        json = sceneToEngineJSON(scene, { id, name, ...opts.engineOpts });
    } catch (e) {
        console.error("[export] engine JSON failed", e);
    }
    try {
        glb = await sceneToGLB(scene);
    } catch (e) {
        console.error("[export] glb failed", e);
    }
    if (json) downloadString(json, `${id}.json`);
    if (glb) downloadBlob(glb, `${id}.glb`);
    if (!json && !glb) return "Export failed — check console";
    if (!glb) return "Engine JSON downloaded; glTF failed";
    if (!json) return "glTF downloaded; engine JSON failed";
    return `Downloaded ${id}.json + ${id}.glb`;
}

// ---------------- numeric tidying ----------------

function round(n, digits = 4) {
    if (typeof n !== "number" || !Number.isFinite(n)) return n;
    const k = 10 ** digits;
    return Math.round(n * k) / k;
}
function round3(arr, digits = 4) {
    return arr.map((v) => round(v, digits));
}
