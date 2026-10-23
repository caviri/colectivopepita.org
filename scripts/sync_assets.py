#!/usr/bin/env python3
"""Sync the runtime 3D assets between the HF bucket and a local folder or the Space.

The bucket holds ~11 GB (raw models, blueprints, …) but the game only fetches a
small subset, listed in RUNTIME below. Only that subset is ever copied.

    python scripts/sync_assets.py --to data           # bucket -> ./data (local dev)
    python scripts/sync_assets.py --to-space          # bucket -> Space repo data/

Env: HF_TOKEN, HF_BUCKET and HF_SPACE (both default katospiegel/colectivo-pepita).
"""
import argparse
import os
import subprocess
import sys
import tempfile
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
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--to", type=Path, help="download into this folder")
    group.add_argument("--to-space", action="store_true", help="publish into the Space repo")
    args = ap.parse_args()

    bucket = os.environ.get("HF_BUCKET", "katospiegel/colectivo-pepita")
    if args.to:
        pull(bucket, args.to)
        return 0

    space = os.environ.get("HF_SPACE", "katospiegel/colectivo-pepita")
    with tempfile.TemporaryDirectory() as tmp:
        stage = Path(tmp) / "data"
        pull(bucket, stage)
        from huggingface_hub import HfApi

        # Mirror semantics: data/ in the Space becomes exactly the runtime subset.
        HfApi().upload_folder(
            repo_id=space,
            repo_type="space",
            folder_path=str(stage),
            path_in_repo="data",
            delete_patterns=["data/**"],
            commit_message="assets: sync runtime subset from bucket",
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
