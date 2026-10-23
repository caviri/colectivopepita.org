import fs from "node:fs";
import path from "node:path";

export const REPO_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "../..");
export const DATA_DIR = path.join(REPO_ROOT, "data");
export const OUT_DIR = path.join(DATA_DIR, "optimized");

export function walk(dir, exts) {
    const out = [];
    const skip = path.resolve(OUT_DIR);
    const stack = [dir];
    while (stack.length) {
        const cur = stack.pop();
        if (path.resolve(cur) === skip) continue;
        for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
            const full = path.join(cur, e.name);
            if (e.isDirectory()) stack.push(full);
            else if (exts.some((x) => e.name.toLowerCase().endsWith(x))) out.push(full);
        }
    }
    return out;
}

export function mirrorPath(srcAbs, newExt) {
    const rel = path.relative(DATA_DIR, srcAbs);
    const swapped = newExt
        ? rel.replace(/\.[^.]+$/, newExt)
        : rel;
    return path.join(OUT_DIR, swapped);
}

export function ensureDir(p) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
}

export function isUpToDate(src, dst) {
    if (!fs.existsSync(dst)) return false;
    return fs.statSync(dst).mtimeMs >= fs.statSync(src).mtimeMs;
}

export function fmtBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function size(p) {
    try { return fs.statSync(p).size; } catch { return 0; }
}
