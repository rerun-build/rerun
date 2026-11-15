FROM node:26-trixie-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN npm install -g corepack@0.36.0 && corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN --mount=type=cache,id=rerun-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store --filter rerun-engine...
RUN pnpm --filter @rerun/contracts build && pnpm --filter rerun-engine build
RUN pnpm --filter rerun-engine deploy --prod /out

FROM base AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git jq tini xvfb openbox x11vnc xdotool thunar xfce4-terminal adwaita-icon-theme tint2 hsetroot maim \
    && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --shell /bin/bash rerun && mkdir -p /data && chown rerun:rerun /data
COPY --from=build --chown=rerun:rerun /out /app
COPY --chmod=755 apps/engine/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY --chmod=755 apps/engine/scripts/ /opt/entrypoint-selftest/
RUN ["/usr/bin/env", "RERUN_API_KEY=dummy", "/usr/local/bin/docker-entrypoint.sh", "/opt/entrypoint-selftest/entrypoint-selftest.sh"]
RUN npx --yes patchright@1.63.0 install-deps chromium && rm -rf /var/lib/apt/lists/*
RUN npm install -g "@openai/codex@0.166.0"
USER rerun
RUN cd /app && npx patchright install --no-shell chromium
ENV PATH="/home/rerun/.local/bin:${PATH}" \
    NODE_ENV=production \
    RERUN_DATA_DIR=/data \
    RERUN_HOST=0.0.0.0 \
    RERUN_PORT=3000 \
    RERUN_CODEX_PATH=/usr/local/bin/codex
VOLUME /data
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/cli/bin.js", "run"]
