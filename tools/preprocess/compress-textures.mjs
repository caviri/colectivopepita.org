// Convert PNG/JPG textures under data/ to WebP under data/optimized/, capping
// the longest edge at MAX_DIM so monstrous 4K normal maps don't ship to the
// browser. WebP at q80 typically lands 5–15× smaller than PNG with no
// perceptible loss for albedo/normal/roughness inputs.
import sharp from "sharp";
import path from "node:path";
import { DATA_DIR, OUT_DIR, walk, mirrorPath, ensureDir, isUpToDate, fmtBytes, size } from "./lib.mjs";

const MAX_DIM = 2048;
const QUALITY = 80;
// Folders we deliberately skip — raw working material that the runtime
// never fetches (200+ MB of video frames). Everything else under data/ gets
// compressed so dataURL() rewrites resolve consistently.
const SKIP_DIRS = ["_source"];

export async function compressTextures({ force = false, log = console.log } = {}) {
    const files = walk(DATA_DIR, [".png", ".jpg", ".jpeg"]).filter(
        (f) => !SKIP_DIRS.some((d) => f.includes(`/${d}/`)),
    );
    let totalIn = 0, totalOut = 0, done = 0, skipped = 0, failed = 0;
    for (const src of files) {
        const dst = mirrorPath(src, ".webp");
        if (!force && isUpToDate(src, dst)) {
            skipped++;
            totalIn += size(src);
            totalOut += size(dst);
            continue;
        }
        ensureDir(dst);
        try {
            const img = sharp(src, { failOn: "none" });
            const meta = await img.metadata();
            const w = meta.width || 0, h = meta.height || 0;
            const long = Math.max(w, h);
            const pipeline = long > MAX_DIM
                ? img.resize({
                      width: w >= h ? MAX_DIM : undefined,
                      height: h > w ? MAX_DIM : undefined,
                      withoutEnlargement: true,
                  })
                : img;
            await pipeline.webp({ quality: QUALITY, effort: 4 }).toFile(dst);
            const sIn = size(src), sOut = size(dst);
            totalIn += sIn;
            totalOut += sOut;
            done++;
            const ratio = sIn > 0 ? (sIn / Math.max(sOut, 1)).toFixed(1) : "?";
            log(`  ${path.relative(DATA_DIR, src)}: ${fmtBytes(sIn)} → ${fmtBytes(sOut)} (${ratio}×)`);
        } catch (e) {
            failed++;
            log(`  FAIL ${path.relative(DATA_DIR, src)}: ${e.message}`);
        }
    }
    return { totalIn, totalOut, done, skipped, failed, count: files.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const force = process.argv.includes("--force");
    console.log(`compress-textures: scanning ${DATA_DIR} → ${OUT_DIR}`);
    const r = await compressTextures({ force });
    console.log(
        `\ntextures: ${r.done} converted, ${r.skipped} up-to-date, ${r.failed} failed`,
    );
    console.log(
        `total: ${fmtBytes(r.totalIn)} → ${fmtBytes(r.totalOut)} (${r.totalIn ? (r.totalIn / Math.max(r.totalOut, 1)).toFixed(1) : "?"}×)`,
    );
}
