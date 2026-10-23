# Colectivo Pepita — Antarctic Sampler

A browser-based 3D game and scene editor set at a Spanish Antarctic research station.
Plain ES modules and Three.js loaded from a CDN, so there is no bundler and no build step.
It is deployed as a password-gated Docker Space on Hugging Face.

Live: <https://colectivopepita.org> · Space: [`katospiegel/colectivo-pepita`](https://huggingface.co/spaces/katospiegel/colectivo-pepita)

## Repository layout

```
src/            the game, the editor (src/editor) and the engine (src/engine)
server/         password-gate + static server used by the Space (stdlib only)
tools/preprocess/  Node pipeline: OBJ -> Meshopt GLB, PNG -> WebP, asset-meta.json
scripts/        deploy_space.py, sync_assets.py
tests/          pytest suite for the gate
docs/           scene authoring and 3D modelling guides
Dockerfile      what Hugging Face builds
```

Heavy assets (~11 GB of source models) are not in git. They live in a private
HF bucket. The Space mounts that bucket read-only at `/data` (Space settings, Volumes),
and the Dockerfile symlinks it to `/app/data`. For local dev, `just assets` downloads only the
runtime subset (`optimized/`, `scenes/`, `videos/`, `photo/` and three JSON files) into `./data`.

## Run locally

Requires Python 3.12, [`just`](https://github.com/casey/just) and the
[`hf` CLI](https://huggingface.co/docs/huggingface_hub/guides/cli).

```bash
cp .env.example .env     # fill in HF_TOKEN
just assets              # bucket -> ./data (runtime subset only)
just dev                 # http://localhost:7860, password: $APP_PASSWORD (default "dev")
```

Entry points: `/src/` (menu), `/src/editor/editor.html` (editor), `/dev.html` (dev navigation).

## Deployment

```
push to main ──> deploy.yml ──> scripts/deploy_space.py ──> HF Space ──> HF rebuilds the image
```

1. `ci.yml` runs on every branch and PR: ruff, `node --check` on all JS, pytest, and a staging dry run.
2. `deploy.yml` runs on push to `main`. It re-runs lint and tests, stages the code
   (`Dockerfile`, `server/`, `src/`, root HTML) and uploads it to the Space.

Assets need no deploy step: the bucket is mounted live, so changing the bucket changes the site.

One-time setup in the GitHub repo:

| Where | Name | Value |
| --- | --- | --- |
| Secret | `HF_TOKEN` | fine-grained token with write access to the Space and read access to the bucket |
| Variable (optional) | `HF_SPACE` | defaults to `katospiegel/colectivo-pepita` |

The `APP_PASSWORD` that gates the site is a **Space secret** set in the HF settings, not a GitHub secret.
Without it the server refuses all logins (fails closed).

## Working with assets

Bucket details (auth, download/upload, mounting on Windows, macOS and Linux): [`docs/bucket.md`](docs/bucket.md).

Models go through `tools/preprocess` (needs Node 22, `cd tools/preprocess && npm ci`):

```bash
node tools/preprocess/run.mjs            # incremental
node tools/preprocess/run.mjs --force    # re-encode everything
```

It reads `data/` and writes `data/optimized/` and `data/asset-meta.json`. Push the result
to the bucket with `hf buckets sync ./data hf://buckets/<id>`; the live site sees it immediately.

## Development

```bash
pip install -e ".[dev]"
just check    # ruff + JS syntax
just test     # pytest
just stage    # build the Space folder into build/space without uploading
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org/).
See [`docs/scene-authoring.md`](docs/scene-authoring.md) for how scenes are structured.

## Working with Claude Code (or any coding agent)

The repo is set up so an agent is useful from the first prompt.

- `AGENTS.md` is the agent onboarding: layout, commands, conventions and the gotchas.
  `CLAUDE.md` just imports it, so Claude Code, Codex and Gemini CLI all read the same file.
- `.claude/settings.json` is shared config:
  - Commit and PR attribution is **off**: no `Co-Authored-By` trailer, no "Generated with" footer.
  - Safe read/check commands (`just check`, `just test`, `git diff`, …) run without prompting.
  - `git push`, `just deploy` and `gh workflow run` always ask first.
  - Reading `.env` and destructive bucket commands are denied.
  - Personal tweaks go in `.claude/settings.local.json` (gitignored).

A first session, end to end:

```bash
git clone https://github.com/caviri/colectivopepita.org && cd colectivopepita.org
cp .env.example .env          # add your HF_TOKEN
just assets                   # fetch the runtime assets (~300 MB)
just dev                      # leave this running, open http://localhost:7860
claude                        # in a second terminal
```

Then try prompts like:

1. *"Explain how `src/assets.js` turns an asset name into a `/data/...` URL."* Read-only, good for orientation.
2. *"Add a cargo-container prop to the outdoor scene following `docs/scene-authoring.md`."*
   The agent edits `src/`, and you refresh the browser tab to check it.
3. *"Run the checks and commit this."* The agent runs `just check` and `just test`, then makes a
   Conventional Commit authored by you alone.

Rules of thumb: ask for one change at a time, look at the result in the browser, and let the
agent commit but push yourself. Pushing to `main` redeploys the live site.

## License

MIT — see [LICENSE](LICENSE).
