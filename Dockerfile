# syntax=docker/dockerfile:1

FROM node:22-bookworm AS build

WORKDIR /app

# Native dependencies are needed to build better-sqlite3 for the image platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential curl patch python3 unzip \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts \
  && npm rebuild better-sqlite3

COPY . .
RUN npm run prepare

FROM node:22-bookworm-slim AS runtime

ARG CODEX_CLI_VERSION=0.157.1

ENV HOME=/home/codex \
    CODEX_HOME=/home/codex/.codex \
    CODEX_CLI_PATH=/usr/local/bin/codex \
    NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global "@openai/codex@${CODEX_CLI_VERSION}" \
  && rm -rf "$HOME" \
  && groupmod --new-name codex node \
  && usermod --login codex --home /home/codex --move-home --shell /bin/bash node \
  && mkdir -p /workspace "$CODEX_HOME" \
  && chown -R codex:codex /workspace "$HOME"

WORKDIR /opt/codex-web
COPY --from=build --chown=codex:codex /app /opt/codex-web

USER codex
WORKDIR /workspace

EXPOSE 8214

# Mount projects at /workspace and Codex settings at /home/codex/.codex.
CMD ["node", "/opt/codex-web/src/server/main.js", "--host", "0.0.0.0", "--port", "8214"]
