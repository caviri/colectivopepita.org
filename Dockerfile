# Hugging Face Docker Space — Colectivo Pepita (Antarctic Sampler).
# Built by HF from the repo that scripts/deploy_space.py uploads; not meant
# to be run from a plain checkout.
FROM python:3.12-slim

WORKDIR /app
COPY server/ /app/server/
COPY index.html dev.html /app/
COPY src/ /app/src/
# The Space mounts the HF bucket read-only at /data (Space settings > Volumes);
# the game requests assets via absolute /data/... URLs, so expose it under the doc root.
RUN ln -s /data /app/data

ENV APP_ROOT=/app PORT=7860
EXPOSE 7860
# APP_PASSWORD is a Space secret read at runtime; the gate fails closed without it.
CMD ["python", "server/server.py"]
