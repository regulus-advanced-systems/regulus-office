# office-server image (docs/SPEC.md §4.4). Placeholder until M0 wires the real build.
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
RUN bun install --frozen-lockfile
EXPOSE 4600
CMD ["bun", "run", "apps/server/src/index.ts"]
