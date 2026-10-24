ARG NODE_IMAGE=node:24.12.0-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --global corepack
COPY . .
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN corepack pnpm install --frozen-lockfile --filter @pkm/server... --filter @pkm/web...
RUN corepack pnpm --filter @pkm/server... --filter @pkm/web... build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production PKM_SERVER_HOST=0.0.0.0 PKM_SERVER_PORT=3210 PKM_VAULT_ROOT=/var/syncthing/vault
USER node
EXPOSE 3210
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3210/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"
CMD ["node", "apps/server/dist/server-main.js"]
