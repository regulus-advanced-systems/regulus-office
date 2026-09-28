# office-server image (docs/SPEC.md §4.2 Packaging, §4.4). Build from the repo root:
#   docker build -f deploy/office.Dockerfile .
# Stage 1 builds the web client; stage 2 carries the server sources, production
# dependencies and apps/web/dist, and runs as the unprivileged `bun` user.
ARG BUN_VERSION=1

FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app
# Manifests first so the dependency layer is cached across source edits.
COPY package.json bun.lock tsconfig.base.json tsconfig.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/agent-adapters/package.json packages/agent-adapters/
COPY packages/assets/package.json packages/assets/
COPY packages/floor-layout/package.json packages/floor-layout/
COPY packages/protocol/package.json packages/protocol/
RUN bun install --frozen-lockfile
COPY apps ./apps
COPY packages ./packages
RUN bun run --filter '@regulus/web' build

FROM oven/bun:${BUN_VERSION}-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    OFFICE_HOST=0.0.0.0 \
    OFFICE_PORT=4600 \
    OFFICE_DATA_DIR=/data \
    OFFICE_WEB_DIST=/app/apps/web/dist
COPY package.json bun.lock tsconfig.base.json tsconfig.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/agent-adapters/package.json packages/agent-adapters/
COPY packages/assets/package.json packages/assets/
COPY packages/floor-layout/package.json packages/floor-layout/
COPY packages/protocol/package.json packages/protocol/
# Only the server's runtime dependency graph; the web client ships prebuilt.
RUN bun install --frozen-lockfile --production --filter '@regulus/server' \
    && rm -rf /root/.bun/install/cache
COPY apps/server ./apps/server
COPY packages/agent-adapters ./packages/agent-adapters
COPY packages/floor-layout ./packages/floor-layout
COPY packages/protocol ./packages/protocol
COPY --from=build /app/apps/web/dist ./apps/web/dist
# /data is the SQLite + blob volume; owned by `bun` so a fresh named volume inherits it.
RUN mkdir -p /data /srv/office/projects && chown -R bun:bun /data /srv/office
USER bun
VOLUME ["/data"]
EXPOSE 4600
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:4600/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["bun", "apps/server/src/index.ts"]
