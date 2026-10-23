// Convert every OBJ under data/ to a Meshopt-compressed GLB under
// data/optimized/, mirroring folder structure. gltfpack handles OBJ input
// natively, deduplicates vertices, quantizes attributes, and (with -cc)
// applies the higher-ratio meshopt codec. Typical mesh size reduction: 5–20×.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR, OUT_DIR, walk, mirrorPath, ensureDir, isUpToDate, fmtBytes, size } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GLTFPACK = path.join(HERE, "node_modules", ".bin", "gltfpack");

export function compressMeshes({ force = false, log = console.log } = {}) {
    const files = walk(DATA_DIR, [".obj"]);
    let totalIn = 0, totalOut = 0, done = 0, skipped = 0, failed = 0;
    for (const src of files) {
        const dst = mirrorPath(src, ".glb");
        if (!force && isUpToDate(src, dst)) {
            skipped++;
            totalIn += size(src);
            totalOut += size(dst);
            continue;
        }
        ensureDir(dst);
        // -cc:  high-ratio meshopt geometry compression
        // -tr:  keep original texture references (we compress textures separately)
        // -kv:  keep source vertex attributes (TEXCOORD_0, etc.) even if no
        //       material in the OBJ uses them — the runtime assigns materials
        //       with texture maps at load time and needs UVs to sample against.
        // -vtf: float (not quantized) UVs. With -kv and no source material,
        //       the integer UV-quantization bounds collapse to [0,0] and UVs
        //       come out all-zero. -vtf bypasses that. Meshopt still
        //       compresses the float UVs efficiently, so the size cost is
        //       small (a few hundred KB across the whole dataset).
        // -noq is intentionally NOT set — position quantization is the main win.
        const res = spawnSync(GLTFPACK, ["-i", src, "-o", dst, "-cc", "-tr", "-kv", "-vtf"], {
            stdio: ["ignore", "pipe", "pipe"],
        });
        if (res.status !== 0) {
            failed++;
            log(`  FAIL ${path.relative(DATA_DIR, src)}\n${res.stderr?.toString() || ""}`);
            continue;
        }
        const sIn = size(src), sOut = size(dst);
        totalIn += sIn;
        totalOut += sOut;
        done++;
        const ratio = sIn > 0 ? (sIn / Math.max(sOut, 1)).toFixed(1) : "?";
        log(`  ${path.relative(DATA_DIR, src)}: ${fmtBytes(sIn)} → ${fmtBytes(sOut)} (${ratio}×)`);
    }
    return { totalIn, totalOut, done, skipped, failed, count: files.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const force = process.argv.includes("--force");
    console.log(`compress-meshes: scanning ${DATA_DIR} → ${OUT_DIR}`);
    const r = compressMeshes({ force });
    console.log(
        `\nmeshes: ${r.done} converted, ${r.skipped} up-to-date, ${r.failed} failed`,
    );
    console.log(
        `total: ${fmtBytes(r.totalIn)} → ${fmtBytes(r.totalOut)} (${r.totalIn ? (r.totalIn / Math.max(r.totalOut, 1)).toFixed(1) : "?"}×)`,
    );
}
