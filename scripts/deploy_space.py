#!/usr/bin/env python3
"""Stage the deployable code and upload it to the Hugging Face Space.

Only code is uploaded. The heavy runtime assets come from the HF bucket that the
Space mounts at /data, so they are not part of this upload.

    python scripts/deploy_space.py            # stage + upload
    python scripts/deploy_space.py --dry-run  # stage only, into build/space

Env: HF_TOKEN (write access), HF_SPACE (default katospiegel/colectivo-pepita).
"""
import argparse
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STAGE = ROOT / "build" / "space"

# Paths copied into the Space repo, relative to the repo root.
CODE = ["Dockerfile", "landing", "server", "src"]

# Space-side prefixes this deploy owns. Anything under them that is not in the
# staged tree is deleted, so removed source files disappear from the Space too.
# data/ is deliberately absent (it is a bucket mount, not repo content). The legacy entries prune files left over from
# the pre-clean-repo template deploy.
OWNED = ["src/**", "server/**", "landing/**", "Dockerfile", "index.html", "dev.html"]
LEGACY = [
    ".devcontainer/**", ".github/**", ".claude/**", "docs/**", "scripts/**", "tests/**",
    "landing.html", "server.py", "justfile", "AGENTS.md", "CLAUDE.md", "CHANGELOG.md",
    "CONTRIBUTING.md", "HOW_TO_USE_THIS_TEMPLATE.md", "SECURITY.md", "LICENSE", "cliff.toml",
    ".dockerignore", ".editorconfig", ".env.example", ".gitattributes", ".gitignore",
    ".pre-commit-config.yaml",
]

SPACE_README = """---
title: Colectivo Pepita
emoji: 🐧
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# Antarctic Sampler — Colectivo Pepita

Browser game and scene editor, served behind a password gate.
Source: this Space is deployed from the project's GitHub repository; edit it there.
"""


def stage() -> Path:
    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir(parents=True)
    for name in CODE:
        src = ROOT / name
        dst = STAGE / name
        if src.is_dir():
            shutil.copytree(src, dst, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        else:
            shutil.copy2(src, dst)
    (STAGE / "README.md").write_text(SPACE_README, encoding="utf-8", newline="\n")
    return STAGE


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dry-run", action="store_true", help="stage only, do not upload")
    ap.add_argument("--no-prune-legacy", action="store_true", help="keep old template files")
    args = ap.parse_args()

    staged = stage()
    count = sum(1 for p in staged.rglob("*") if p.is_file())
    print(f"staged {count} files in {staged}")
    if args.dry_run:
        return 0

    token = os.environ.get("HF_TOKEN")
    if not token:
        print("HF_TOKEN is not set", file=sys.stderr)
        return 1
    space = os.environ.get("HF_SPACE", "katospiegel/colectivo-pepita")

    from huggingface_hub import HfApi

    delete = OWNED + ([] if args.no_prune_legacy else LEGACY)
    info = HfApi(token=token).upload_folder(
        repo_id=space,
        repo_type="space",
        folder_path=str(staged),
        delete_patterns=delete,
        commit_message=os.environ.get("DEPLOY_MESSAGE", "deploy: sync from GitHub"),
    )
    print(f"uploaded -> {info}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
