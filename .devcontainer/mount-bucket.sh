#!/usr/bin/env bash
# Mount the asset bucket read-only at /data and link it to ./data, so `just dev`
# sees the same files as production. Never fails the container: without a token
# or FUSE it prints a hint and exits 0.
set -u

BUCKET="${HF_BUCKET:-katospiegel/colectivo-pepita}"
MOUNT=/data
REPO="$(cd "$(dirname "$0")/.." && pwd)"

token="${HF_TOKEN:-}"
[ -z "$token" ] && [ -r "$HOME/.cache/huggingface/token" ] && token="$(cat "$HOME/.cache/huggingface/token")"

if [ -z "$token" ]; then
    echo "[bucket] no HF_TOKEN (set it on the host before opening the container, or run 'hf auth login')."
    echo "[bucket] not mounted. Fallback: 'just assets' downloads the runtime subset into ./data."
    exit 0
fi
if [ ! -e /dev/fuse ]; then
    echo "[bucket] /dev/fuse missing (container needs --device=/dev/fuse). Fallback: 'just assets'."
    exit 0
fi
if mountpoint -q "$MOUNT"; then
    echo "[bucket] $MOUNT already mounted."
else
    sudo mkdir -p "$MOUNT" && sudo chown "$(id -u):$(id -g)" "$MOUNT"
    # Token goes via the environment, not argv: hf-mount echoes its argv on errors.
    if ! HF_TOKEN="$token" hf-mount start --fuse --read-only bucket "$BUCKET" "$MOUNT" >/dev/null; then
        echo "[bucket] mount failed. Fallback: 'just assets'."
        exit 0
    fi
    echo "[bucket] mounted $BUCKET at $MOUNT (read-only)."
fi

# ./data is gitignored; point it at the mount unless it already holds a real folder.
if [ ! -e "$REPO/data" ] || [ -L "$REPO/data" ]; then
    ln -sfn "$MOUNT" "$REPO/data"
    echo "[bucket] $REPO/data -> $MOUNT"
fi
