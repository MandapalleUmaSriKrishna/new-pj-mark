# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Krishna Digital Certificate - API image (NestJS)
#
#   docker build -f docker/api.Dockerfile -t kdc-api .
#
# Build context is the MONOREPO ROOT (docker compose sets this automatically).
# Four stages: base -> deps -> build -> runtime. Native modules (argon2) are
# compiled in `deps` and the toolchain is left behind, so the runtime image
# carries only production dependencies and compiled JavaScript.
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS base
WORKDIR /repo
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# --- dependencies -----------------------------------------------------------
# Everything needed to resolve the workspace lockfile. Build tools are installed
# here (not in base) because argon2 may need to compile when no prebuilt binary
# matches the platform.
FROM base AS deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Native-binding guard (see scripts/ensure-native.mjs). Copied before the install
# so it can run immediately after npm ci.
COPY scripts/ensure-native.mjs scripts/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# --workspace limits the install to what this image needs; the web workspace's
# package.json is still copied because `npm ci` validates the whole lockfile.
RUN npm ci --workspace @kdc/shared --workspace @kdc/api --include=dev \
    # npm cannot distinguish glibc from musl for prebuilt native addons, and
    # argon2 is what hashes every password: fail the build here with a clear
    # message instead of at first login.
    && node scripts/ensure-native.mjs

# --- build ------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build --workspace @kdc/shared \
    && npm run build --workspace @kdc/api \
    # Drop devDependencies now that TypeScript has emitted JavaScript.
    && npm prune --omit=dev

# --- runtime ----------------------------------------------------------------
FROM base AS runtime
# Run as an unprivileged user; the app binds an unprivileged port and writes
# only inside its own data directory.
RUN groupadd --system --gid 1001 kdc \
    && useradd --system --uid 1001 --gid kdc --home-dir /repo --shell /usr/sbin/nologin kdc

# node_modules/@kdc/shared is a workspace symlink to ../../packages/shared, so
# the shared package must land at the same relative path.
COPY --from=build --chown=kdc:kdc /repo/node_modules ./node_modules
COPY --from=build --chown=kdc:kdc /repo/package.json ./package.json
COPY --from=build --chown=kdc:kdc /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=kdc:kdc /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=kdc:kdc /repo/apps/api/dist ./apps/api/dist
COPY --chown=kdc:kdc apps/api/package.json ./apps/api/package.json

# Runtime data: generated PDFs (STORAGE_DRIVER=local) and the mail log driver's
# .eml files. Mount a volume here or the data dies with the container.
RUN mkdir -p /repo/apps/api/data/storage /repo/apps/api/data/mail \
    && chown -R kdc:kdc /repo/apps/api/data

USER kdc
ENV HOST=0.0.0.0 \
    PORT=4000 \
    API_PREFIX=api/v1 \
    STORAGE_LOCAL_DIR=/repo/apps/api/data/storage \
    MAIL_LOG_DIR=/repo/apps/api/data/mail \
    TRUST_PROXY=true
EXPOSE 4000
VOLUME ["/repo/apps/api/data"]

# No curl in the slim image, so the probe uses the Node that is already there.
# /health/live is the liveness endpoint: it answers from the process, not from
# its dependencies, so a restarted container is not killed for a slow database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||4000) +'/'+ (process.env.API_PREFIX||'api/v1') +'/health/live').then(function(r){process.exit(r.ok?0:1)}).catch(function(){process.exit(1)})"

CMD ["node", "apps/api/dist/main.js"]
