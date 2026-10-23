# Colectivo Pepita — Antarctic Sampler

A browser-based 3D game and scene editor set at a Spanish Antarctic research station.
Plain ES modules and Three.js loaded from a CDN, so there is no bundler and no build step.
It is deployed as a password-gated Docker Space on Hugging Face.

Live: <https://colectivopepita.org> · Space: [`katospiegel/colectivo-pepita`](https://huggingface.co/spaces/katospiegel/colectivo-pepita)

## Repository layout

```
landing/          THE LANDING PAGE: the branded password page shown at "/" (landing/index.html)
src/              the application, served behind the login under /src/
  index.html        game hub / main menu (/src/)
  demos/            the playable demos, one folder each (see below)
  editor/           scene editor
  engine/           shared engine used by play + editor
  *.js, style.css   modules shared by the demos (assets, controls, inventory, menu, ...)
  dev.html          developer navigation page listing every demo and scene
server/           server.py: password gate + static file server (stdlib only)
tools/preprocess/ Node pipeline: OBJ -> Meshopt GLB, PNG -> WebP, asset-meta.json
scripts/          deploy_space.py, sync_assets.py
tests/            pytest: the gate, and that every relative link/import resolves
docs/             scene authoring, 3D modelling guide, the asset bucket
.devcontainer/    dev container that mounts the asset bucket at /data
Dockerfile        what Hugging Face builds
```

### Landing page vs demos

| What | Where | URL | Notes |
| --- | --- | --- | --- |
| **Landing page** | `landing/index.html` | `/` | Public login form. Everything else redirects here until you log in. Rendered by `server/server.py`. |
| Game hub | `src/index.html` | `/src/` | First page after login: New Game, Editor. |
| Outdoor demo ("Day 1") | `src/demos/outdoor/outdoor.html` (+ `main.js`) | `/src/demos/outdoor/outdoor.html` | The main hand-built scene. |
| Lab demo | `src/demos/lab/lab.html` | `/src/demos/lab/lab.html` | |
| Container lab demo | `src/demos/lab2/lab2.html` | `/src/demos/lab2/lab2.html` | |
| Scene player | `src/demos/play/play.html` | `/src/demos/play/play.html?scene=<id>` | Plays scenes from `/data/scenes/<id>.json` (`main`, `lab1`, `lab2`, `museum`, `_test`). |
| Scene editor | `src/editor/editor.html` | `/src/editor/editor.html` | Authors scenes; "Play" opens the player. |
| Dev index | `src/dev.html` | `/src/dev.html` | Links to everything above. |

To add a demo: create `src/demos/<name>/<name>.html` plus its JS, import shared modules with
`../../` (e.g. `../../assets.js`), and link it from `src/index.html` and `src/dev.html`.
`pytest` fails if any link or import does not resolve.

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

Entry points: `/` (landing and login), `/src/` (menu), `/src/dev.html` (index of every demo). See the table above.

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

## Dev container

`.devcontainer/` gives a ready environment (Python 3.12, Node 22, `just`, `hf`, `hf-mount`) that mounts the
asset bucket read-only at `/data` and links `./data` to it, so you never run `just assets`.

1. On the host, export the token **before** opening VS Code: `export HF_TOKEN=hf_xxx`
   (PowerShell: `$env:HF_TOKEN = "hf_xxx"`, or set it as a user environment variable and restart VS Code).
2. VS Code: *Dev Containers: Reopen in Container*. The mount happens on every start (`.devcontainer/mount-bucket.sh`).
3. `just dev`, then open the forwarded port 7860 (password `dev`).

Without a token, or if FUSE is unavailable, the container still opens and tells you to use `just assets`.
FUSE needs `--cap-add=SYS_ADMIN --device=/dev/fuse`, set in `devcontainer.json`; this weakens container
isolation slightly. See [`docs/bucket.md`](docs/bucket.md) for the details.

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
