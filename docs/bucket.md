# The asset bucket

All heavy 3D assets live in a private Hugging Face **Storage Bucket**, not in git and not in the Space repo.

| | |
| --- | --- |
| Bucket | `hf://buckets/katospiegel/colectivo-pepita` (private, ~11 GB, ~1300 files) |
| Production | The Space mounts it **read-only** at `/data` (Space settings, Volumes); the Dockerfile symlinks `/data` to `/app/data` |
| Source of truth | The bucket. Changing it changes the live site immediately, with no deploy |

`hf buckets info` also answers to `katospiegel/colectivopepita` (no hyphen), which is the name shown in the
Space's Volumes panel. It is the same bucket.

## What is in it

```
optimized/   Meshopt GLB + WebP textures (what the game loads)    <- runtime
scenes/      scene JSON                                           <- runtime
videos/      video meshes                                         <- runtime
photo/       photos                                               <- runtime
asset-meta.json  properties.json  rules.json                      <- runtime
<model folders>/  assets/  _blueprints/  _previews/               raw sources, not served
```

Only the "runtime" entries are requested by the game (as `/data/...`). The rest is source material
for `tools/preprocess`.

## Authentication

Create a **fine-grained** token at <https://huggingface.co/settings/tokens> with read access to the bucket
(write access if you will upload). Then:

```bash
hf auth login                 # interactive, stores the token
# or, for scripts and CI:
export HF_TOKEN=hf_xxx        # PowerShell: $env:HF_TOKEN = "hf_xxx"
```

`.env` is read by `just`, never commit it. Install the CLI with `pip install -U "huggingface_hub>=1.0"`.

## Download and upload (Windows, macOS, Linux)

`hf buckets` works the same on every OS and is the supported way to move files. Run from the repo root.

```bash
hf buckets ls hf://buckets/katospiegel/colectivo-pepita            # top level
hf buckets ls -R hf://buckets/katospiegel/colectivo-pepita/scenes  # recursive

just assets                                                        # runtime subset -> ./data (~300 MB)

# One file
hf buckets cp hf://buckets/katospiegel/colectivo-pepita/rules.json data/rules.json   # download
hf buckets cp data/rules.json hf://buckets/katospiegel/colectivo-pepita/rules.json   # upload

# A folder: always look at the plan first
hf buckets sync ./data/scenes hf://buckets/katospiegel/colectivo-pepita/scenes --dry-run
hf buckets sync ./data/scenes hf://buckets/katospiegel/colectivo-pepita/scenes
```

Notes:

- `sync` never deletes on the destination unless you pass `--delete`. Don't, unless you have read the `--dry-run` output.
- Sync a **sub-folder to the matching sub-folder** (as above). `sync ./data hf://buckets/.../` pushes everything in `data/`.
- `--include` / `--exclude` filter by pattern; `--plan plan.jsonl` then `--apply plan.jsonl` lets someone else review a big sync.
- Anything uploaded is live immediately in production. Test locally first (`just dev`).

### Typical workflow: add or change a model

```bash
just assets                              # once
# put the raw model under data/<Model Name>/
node tools/preprocess/run.mjs            # writes data/optimized/ and data/asset-meta.json
just dev                                 # check it in the game
hf buckets sync ./data/optimized hf://buckets/katospiegel/colectivo-pepita/optimized --dry-run
hf buckets sync ./data/optimized hf://buckets/katospiegel/colectivo-pepita/optimized
hf buckets cp data/asset-meta.json hf://buckets/katospiegel/colectivo-pepita/asset-meta.json
```

## Mounting the bucket as a folder

Instead of copying, Hugging Face's [`hf-mount`](https://github.com/huggingface/hf-mount) exposes a bucket as a local
directory, fetching files lazily on first read. Useful for browsing the 11 GB without downloading it.

### macOS and Linux

```bash
brew install hf-mount                     # macOS: NFS backend only; also works with Homebrew on Linux
# or download a binary from https://github.com/huggingface/hf-mount/releases
#   (Linux x86_64 / aarch64, macOS Apple Silicon)

export HF_TOKEN=hf_xxx
mkdir -p ~/pepita-data
hf-mount start --read-only bucket katospiegel/colectivo-pepita ~/pepita-data
hf-mount status
ls ~/pepita-data/scenes
hf-mount stop ~/pepita-data
```

- `--read-only` is the safe default for browsing. Leave it off to write.
- Default write mode is **streaming**: append-only, uploaded on `close()`, a crash before close loses the
  file, and editors that save by delete-and-recreate (vim, nano, emacs) fail with `EPERM`. Add
  `--advanced-writes` to allow random writes (needs local disk for each open file).
- A single sub-folder: `bucket katospiegel/colectivo-pepita/scenes`.
- Changes made elsewhere can take ~10 s to show up.
- Linux FUSE alternative: `sudo apt-get install fuse3`, then `hf-mount start --fuse ...`. Unmount with `fusermount -u <dir>`.

### Windows

`hf-mount` does not ship Windows binaries (its releases list Linux and macOS only). Two options:

1. **WSL2 (closest to a mount).** Install Ubuntu in WSL2, follow the Linux steps above inside it, and reach the
   files from Windows at `\\wsl$\<distro>\home\<you>\pepita-data`. Keep the repo and `data/` on the Linux side too, or
   file access across the boundary will be slow.
2. **No mount.** Use `hf buckets sync` / `just assets` as above. This is what most of the workflow needs anyway.

Check the `hf-mount` README for current Windows status before relying on either; it is a young tool.

### Mounting into the Space (already done)

The same idea is what production uses: Space settings, **Volumes**, bucket `katospiegel/colectivo-pepita` at
`/data`, read-only. If `/data` is empty on the live site, check that volume first, then the symlink in the Dockerfile.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `401` / `403` from `hf buckets` | token missing, or fine-grained token lacks access to the bucket |
| 3D models missing on the live site, scene renders empty | the Volumes entry was removed, or the file isn't under `optimized/` |
| Model fine locally, 404 in prod | you didn't upload `data/optimized/<file>` or `asset-meta.json` |
| `hf buckets info` shows size 0 | the size lags; verify with `hf buckets ls -R` |
| `hf-mount` write fails with `EPERM` | an editor is saving by delete+create; use `--advanced-writes` or edit locally and `cp` |
