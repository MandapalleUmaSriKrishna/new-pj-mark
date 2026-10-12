# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Krishna Digital Certificate - web image (Next.js, standalone output)
#
#   docker build -f docker/web.Dockerfile \
#     --build-arg API_INTERNAL_URL=http://api:4000 -t kdc-web .
#
# Build context is the MONOREPO ROOT.
#
# IMPORTANT - API_INTERNAL_URL IS A BUILD ARG, NOT A RUNTIME ENV VAR.
# next.config.ts turns it into the destination of the /api/v1 rewrite, and
# Next.js bakes rewrites into the routes manifest at BUILD time. Changing the
# env var on a running container does nothing; rebuild with a new --build-arg.
# The browser only ever calls relative /api/v1 URLs, so nothing else needs to
# know where the API lives.
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS base
WORKDIR /repo
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NEXT_TELEMETRY_DISABLED=1

# --- dependencies -----------------------------------------------------------
FROM base AS deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Native-binding guard (see scripts/ensure-native.mjs).
COPY scripts/ensure-native.mjs scripts/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @kdc/shared --workspace @kdc/web --include=dev \
    # Tailwind v4 compiles CSS through lightningcss, whose prebuild packages
    # carry no `libc` field in the lockfile - npm can install the musl build on
    # a glibc image, which makes EVERY page 500 at runtime. Repair it here,
    # where the failure is loud and cheap, rather than in production.
    && node scripts/ensure-native.mjs

# --- build ------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web

# `output: 'standalone'` is enabled by NEXT_STANDALONE=true in next.config.ts.
# It emits a traced, self-contained server instead of shipping node_modules.
ENV NEXT_STANDALONE=true
ARG API_INTERNAL_URL=http://api:4000
ARG APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_API_BASE_URL=
ENV API_INTERNAL_URL=$API_INTERNAL_URL \
    APP_URL=$APP_URL \
    NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
RUN npm run build --workspace @kdc/shared \
    && npm run build --workspace @kdc/web

# --- runtime ----------------------------------------------------------------
FROM base AS runtime
RUN groupadd --system --gid 1001 kdc \
    && useradd --system --uid 1001 --gid kdc --home-dir /repo --shell /usr/sbin/nologin kdc

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1

# In a workspace the standalone output mirrors the monorepo layout, so the
# server entrypoint ends up at /repo/apps/web/server.js.
COPY --from=build --chown=kdc:kdc /repo/apps/web/.next/standalone ./
COPY --from=build --chown=kdc:kdc /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=kdc:kdc /repo/apps/web/public ./apps/web/public

USER kdc
WORKDIR /repo/apps/web
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(function(r){process.exit(r.ok?0:1)}).catch(function(){process.exit(1)})"

CMD ["node", "server.js"]
