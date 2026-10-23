set shell := ["bash", "-cu"]

# List available commands
default:
    @just --list

# Serve the game locally behind the password gate (needs ./data, see `just assets`)
dev:
    APP_ROOT=. APP_PASSWORD="${APP_PASSWORD:-dev}" PORT=7860 python server/server.py

# Download the runtime asset subset from the HF bucket into ./data
assets:
    python scripts/sync_assets.py --to data

# Lint Python and syntax-check every JS module
check:
    ruff check .
    find src -name '*.js' -print0 | xargs -0 -n1 node --check

# Run tests
test:
    pytest

# Build the Space staging folder without uploading
stage:
    python scripts/deploy_space.py --dry-run

# Upload code to the HF Space (CI does this on every push to main)
deploy:
    python scripts/deploy_space.py
