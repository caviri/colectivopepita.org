// Entry point: run mesh + texture compression, then rebuild asset-meta.json.
//
//   node src/preprocess/run.mjs              # incremental (skip up-to-date)
//   node src/preprocess/run.mjs --force      # re-encode everything
//   node src/preprocess/run.mjs --meshes     # meshes only
//   node src/preprocess/run.mjs --textures   # textures only
//   node src/preprocess/run.mjs --meta       # rebuild asset-meta.json only
import { compressMeshes } from "./compress-meshes.mjs";
import { compressTextures } from "./compress-textures.mjs";
import { buildMeta } from "./build-meta.mjs";
import { fmtBytes } from "./lib.mjs";

const args = new Set(process.argv.slice(2));
const force = args.has("--force");
const onlyMeshes = args.has("--meshes");
const onlyTextures = args.has("--textures");
const onlyMeta = args.has("--meta");
const anyOnly = onlyMeshes || onlyTextures || onlyMeta;
const runMeshes = !anyOnly || onlyMeshes;
const runTextures = !anyOnly || onlyTextures;
const runMeta = !anyOnly || onlyMeta;

const t0 = Date.now();
let m = null, t = null;

if (runMeshes) {
    console.log("=== meshes ===");
    m = compressMeshes({ force });
    console.log(
        `→ ${m.done} converted, ${m.skipped} up-to-date, ${m.failed} failed | ${fmtBytes(m.totalIn)} → ${fmtBytes(m.totalOut)}\n`,
    );
}
if (runTextures) {
    console.log("=== textures ===");
    t = await compressTextures({ force });
    console.log(
        `→ ${t.done} converted, ${t.skipped} up-to-date, ${t.failed} failed | ${fmtBytes(t.totalIn)} → ${fmtBytes(t.totalOut)}\n`,
    );
}
if (runMeta) {
    console.log("=== asset-meta.json ===");
    await buildMeta();
    console.log("");
}

const inTot = (m?.totalIn || 0) + (t?.totalIn || 0);
const outTot = (m?.totalOut || 0) + (t?.totalOut || 0);
const ratio = inTot ? (inTot / Math.max(outTot, 1)).toFixed(1) : "?";
console.log(
    `=== total: ${fmtBytes(inTot)} → ${fmtBytes(outTot)} (${ratio}×) in ${((Date.now() - t0) / 1000).toFixed(1)}s ===`,
);
