# Hugging Face Docker Space — Colectivo Pepita (Antarctic Sampler).
# Built by HF from the repo that scripts/deploy_space.py uploads; not meant
# to be run from a plain checkout (data/ is only present in the Space repo).
FROM python:3.12-slim

WORKDIR /app
COPY server/ /app/server/
COPY index.html dev.html /app/
COPY src/ /app/src/
# Runtime 3D assets (optimized/, scenes/, videos/, photo/ + json metadata),
# synced from the HF bucket by the "sync-assets" workflow.
COPY data/ /app/data/

ENV APP_ROOT=/app PORT=7860
EXPOSE 7860
# APP_PASSWORD is a Space secret read at runtime; the gate fails closed without it.
CMD ["python", "server/server.py"]
