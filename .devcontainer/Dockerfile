FROM mcr.microsoft.com/devcontainers/python:3.12-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends fuse3 curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# just (command runner)
RUN curl -fsSL https://just.systems/install.sh | bash -s -- --to /usr/local/bin

# hf-mount: mounts HF buckets as a local folder (FUSE backend, plus the launcher)
ARG HF_MOUNT_VERSION=v0.13.1
RUN arch="$(uname -m)" \
    && for bin in hf-mount hf-mount-fuse hf-mount-nfs; do \
         curl -fsSL -o "/usr/local/bin/$bin" \
           "https://github.com/huggingface/hf-mount/releases/download/${HF_MOUNT_VERSION}/${bin}-${arch}-linux" \
         && chmod +x "/usr/local/bin/$bin"; \
       done

# Let a non-root user mount FUSE filesystems
RUN echo user_allow_other >> /etc/fuse.conf

RUN pip install --no-cache-dir "huggingface_hub>=1.0"
