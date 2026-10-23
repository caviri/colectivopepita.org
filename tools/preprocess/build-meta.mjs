// Walk data/optimized/ for every GLB, decode geometry (Meshopt), compute
// per-part bbox + vertex/face counts, aggregate per folder, and emit
// data/asset-meta.json — the runtime loader uses suggestedUp to decide
// rotation.x = -π/2 (z-up → y-up) and targetSize to pick a sensible scale.
//
// This is the post-OBJ replacement for the old scripts/build-asset-meta.mjs:
// it reads the optimized GLBs we ship, so original OBJs no longer need to
// stay on disk after preprocessing.
import fs from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { DATA_DIR, OUT_DIR } from "./lib.mjs";

const META_OUT = path.join(DATA_DIR, "asset-meta.json");

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);

const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
        "meshopt.decoder": MeshoptDecoder,
        "meshopt.encoder": MeshoptEncoder,
    });

// classify expected real-world target size in metres based on folder name
function guessTargetSize(folder) {
    const k = folder.toLowerCase();
    if (k.includes("truck")) return 5.5;
    if (k.includes("container")) return 6.5;
    if (k.includes("man") || k.includes("penguin chick")) return 1.85;
    if (k.includes("penguin")) return 1.0;
    if (k.includes("flag")) return 1.4;
    if (k.includes("logo")) return 2.4;
    if (k.includes("petridish") || k.includes("petri")) return 0.18;
    if (k.includes("bench")) return 2.6;
    if (k.includes("cabinet")) return 1.5;
    if (k.includes("equipment")) return 0.55;
    if (k.includes("laboratory") || k.includes("virtueel") || k.includes("lab "))
        return 16;
    return null;
}

// Multiply a 4x4 column-major matrix into a Vec3 (treating the vec as a point).
function transformPoint(m, x, y, z) {
    return [
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
    ];
}

async function partStats(glbPath) {
    const doc = await io.read(glbPath);
    const root = doc.getRoot();
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let vCount = 0;
    let fCount = 0;
    for (const scene of root.listScenes()) {
        scene.traverse((node) => {
            const mesh = node.getMesh();
            if (!mesh) return;
            const m = node.getWorldMatrix();
            for (const prim of mesh.listPrimitives()) {
                const pos = prim.getAttribute("POSITION");
                if (!pos) continue;
                const arr = pos.getArray();
                const stride = pos.getElementSize();
                vCount += arr.length / stride;
                for (let i = 0; i < arr.length; i += stride) {
                    const [x, y, z] = transformPoint(m, arr[i], arr[i + 1], arr[i + 2]);
                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (z < minZ) minZ = z;
                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
                    if (z > maxZ) maxZ = z;
                }
                const idx = prim.getIndices();
                if (idx) fCount += idx.getCount() / 3;
                else fCount += (arr.length / stride) / 3;
            }
        });
    }
    if (!Number.isFinite(minX)) return null;
    return {
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
        size: [maxX - minX, maxY - minY, maxZ - minZ],
        center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
        vertexCount: vCount,
        faceCount: Math.round(fCount),
    };
}

function suggestUp(aggMin, aggMax) {
    // Up-axis heuristic. Order of checks:
    //  1. Flat plaque check (one axis is much thinner than the others) —
    //     thin Z = X-Y face plane = Y-up; thin Y = X-Z face plane = Z-up.
    //  2. Floor-alignment: an axis whose min is near 0 with a positive
    //     extent looks like the model sitting on a floor.
    //  3. Size dominance: tallest axis wins.
    //  4. Default Y-up.
    const [sx, sy, sz] = [aggMax[0] - aggMin[0], aggMax[1] - aggMin[1], aggMax[2] - aggMin[2]];
    const yFloorRatio = Math.abs(aggMin[1]) / Math.max(sy, 1e-6);
    const zFloorRatio = Math.abs(aggMin[2]) / Math.max(sz, 1e-6);
    const horizMaxXZ = Math.max(sx, sz);
    const horizMaxXY = Math.max(sx, sy);
    const zIsThin = sz < sx * 0.2 && sz < sy * 0.2;
    const yIsThin = sy < sx * 0.2 && sy < sz * 0.2;
    if (zIsThin) return "y";
    if (yIsThin) return "z";
    if (zFloorRatio + 0.15 < yFloorRatio) return "z";
    if (yFloorRatio + 0.15 < zFloorRatio) return "y";
    if (horizMaxXZ / sy > 2 && sz >= horizMaxXZ * 0.7) return "z";
    if (horizMaxXY / sz > 2 && sy >= horizMaxXY * 0.7) return "y";
    return "y";
}

export async function buildMeta({ log = console.log } = {}) {
    if (!fs.existsSync(OUT_DIR)) {
        log(`build-meta: ${OUT_DIR} does not exist — run mesh compression first`);
        return { folders: 0, parts: 0 };
    }
    const folders = fs.readdirSync(OUT_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();

    const out = {};
    let totalParts = 0;
    for (const folder of folders) {
        const modelsDir = path.join(OUT_DIR, folder, "models");
        if (!fs.existsSync(modelsDir)) continue;
        const glbs = fs.readdirSync(modelsDir)
            .filter((f) => f.toLowerCase().endsWith(".glb"))
            .sort();
        if (!glbs.length) continue;

        const items = [];
        for (const f of glbs) {
            const stats = await partStats(path.join(modelsDir, f));
            if (!stats) continue;
            items.push({ file: `models/${f}`, ...stats });
        }
        if (!items.length) continue;

        const aggMin = [Infinity, Infinity, Infinity];
        const aggMax = [-Infinity, -Infinity, -Infinity];
        let totalV = 0, totalF = 0;
        for (const it of items) {
            for (let i = 0; i < 3; i++) {
                if (it.min[i] < aggMin[i]) aggMin[i] = it.min[i];
                if (it.max[i] > aggMax[i]) aggMax[i] = it.max[i];
            }
            totalV += it.vertexCount;
            totalF += it.faceCount;
        }
        out[folder] = {
            partCount: items.length,
            vertexCount: totalV,
            faceCount: totalF,
            bbox: {
                min: aggMin,
                max: aggMax,
                size: [aggMax[0] - aggMin[0], aggMax[1] - aggMin[1], aggMax[2] - aggMin[2]],
            },
            center: [
                (aggMin[0] + aggMax[0]) / 2,
                (aggMin[1] + aggMax[1]) / 2,
                (aggMin[2] + aggMax[2]) / 2,
            ],
            suggestedUp: suggestUp(aggMin, aggMax),
            targetSize: guessTargetSize(folder),
            parts: items,
        };
        totalParts += items.length;
        log(`  ${folder}: ${items.length} parts, ${totalV} verts, ${totalF} tris`);
    }

    fs.writeFileSync(META_OUT, JSON.stringify(out, null, 2));
    log(`wrote ${META_OUT}: ${Object.keys(out).length} folders, ${totalParts} parts`);
    return { folders: Object.keys(out).length, parts: totalParts };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    console.log(`build-meta: scanning ${OUT_DIR} → ${META_OUT}`);
    await buildMeta();
}
