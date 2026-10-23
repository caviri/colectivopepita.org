#!/usr/bin/env python3
"""Download the runtime 3D assets from the HF bucket into a local folder (for local dev).

The bucket holds ~11 GB (raw models, blueprints, …) but the game only fetches a
small subset, listed in RUNTIME_DIRS / RUNTIME_FILES. Only that subset is copied.
In production the Space mounts the bucket at /data, so nothing is copied there.

    python scripts/sync_assets.py --to data

Env: HF_TOKEN, HF_BUCKET (default katospiegel/colectivo-pepita).
"""
import argparse
import os
import subprocess
import sys
from pathlib import Path

RUNTIME_DIRS = ["optimized", "scenes", "videos", "photo"]
RUNTIME_FILES = ["asset-meta.json", "properties.json", "rules.json"]


def pull(bucket: str, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    for d in RUNTIME_DIRS:
        subprocess.run(
            ["hf", "buckets", "sync", f"hf://buckets/{bucket}/{d}", str(dest / d)], check=True
        )
    for f in RUNTIME_FILES:
        subprocess.run(
            ["hf", "buckets", "cp", f"hf://buckets/{bucket}/{f}", str(dest / f)], check=True
        )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--to", type=Path, required=True, help="download into this folder")
    args = ap.parse_args()

    bucket = os.environ.get("HF_BUCKET", "katospiegel/colectivo-pepita")
    pull(bucket, args.to)
    return 0


if __name__ == "__main__":
    sys.exit(main())
