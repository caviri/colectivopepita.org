# Colectivo Pepita — agent guide

Read this first. It applies to every coding agent (Claude Code, Codex, Gemini CLI, …).

## What this is

A browser 3D game ("Antarctic Sampler") plus a scene editor, written as plain ES modules
with Three.js loaded from a CDN via an import map. **There is no bundler and no build step:**
the files in `src/` are exactly what the browser runs. It is served by a small stdlib Python
server (`server/server.py`) behind a password gate and deployed as a Hugging Face Docker Space.

## Layout

```
src/                 game entry pages and modules (index, lab, lab2, outdoor, play, menu, ...)
src/engine/          engine: core/ (scene, export), runtime/, systems/, kg/, db.js
src/editor/          scene editor (editor.html, viewport.js, panels/)
server/              server.py (gate + static) and landing.html (login page)
tools/preprocess/    Node pipeline: OBJ -> Meshopt GLB, PNG -> WebP, asset-meta.json
scripts/             deploy_space.py, sync_assets.py
tests/               pytest suite for the gate
docs/                scene-authoring.md, 3dmodelingguide.md
Dockerfile           what Hugging Face builds (copies server/, src/, data/)
.github/workflows/   ci.yml, deploy.yml (push to main -> Space), sync-assets.yml (manual)
data/                runtime assets. GITIGNORED, fetched from the HF bucket (`just assets`)
```

## Commands

Everything goes through `just`:

| Command | Does |
| --- | --- |
| `just assets` | download the runtime asset subset from the HF bucket into `./data` |
| `just dev` | serve at http://localhost:7860 behind the gate (`APP_PASSWORD`, default `dev`) |
| `just check` | `ruff check .` + `node --check` on every JS file in `src/` |
| `just test` | pytest |
| `just stage` | build the Space upload folder into `build/space` without uploading |
| `just deploy` | upload to the Space (CI normally does this; needs `HF_TOKEN`) |

Run `just check` and `just test` before you call a change done. For anything visual, run
`just dev` and look at it in a browser; a passing syntax check says nothing about rendering.

## Conventions

- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `ci:`).
  One logical change per commit.
- **No attribution trailers.** Never add `Co-Authored-By:` lines, "Generated with …" footers,
  or any agent/tool credit to commit messages or PR descriptions. Commits are authored by the
  user alone.
- **Formatting:** LF line endings, 4-space indent (2 for YAML/JSON), see `.editorconfig`.
- **JS:** native ES modules, relative imports with the `.js` extension, no npm runtime
  dependencies in `src/` (libraries come from the import map in each HTML page).
- **Python:** stdlib only in `server/`; keep it that way, the image installs nothing.
- Match the style of the file you are editing.

## Things that will bite you

- **Absolute asset URLs.** The game fetches assets from `/data/...` (built by `dataURL()` in
  `src/assets.js`, which rewrites `.obj`->`.glb` and `.png`->`.webp` and serves from
  `/data/optimized/`). Don't introduce relative or CDN asset paths.
- **Everything is gated.** The server redirects any unauthenticated request to `/`. A 303 to `/`
  in a test means "not logged in", not "file missing".
- **`data/` is not in git** and must never be committed. Only `optimized/`, `scenes/`, `videos/`,
  `photo/` and three JSON files are used at runtime; the bucket holds ~11 GB more.
- **Deploying is outward-facing.** Pushing to `main` redeploys the live site
  (colectivopepita.org). Don't push to `main` or run `just deploy` / `sync-assets` unless asked.
- The first deploy prunes legacy template files from the Space (`LEGACY` in
  `scripts/deploy_space.py`).

## Do not touch

- `.env` and anything holding tokens. Never print, commit or upload secrets.
- `data/` contents and the HF bucket, unless the task is explicitly about assets.
- `APP_PASSWORD` is a Space secret, not a repo secret; don't try to read or log it.

## Where to read more

`README.md` (setup and deploy walkthrough), `docs/scene-authoring.md` (scene format),
`docs/3dmodelingguide.md` (asset requirements).
