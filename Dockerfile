FROM node:lts-trixie-slim AS base
ARG USER_UID=1000
ARG USER_GID=1000
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git gosu wget ripgrep python3 \
  && mkdir -p -m 755 /etc/apt/keyrings \
  && wget -nv -O/etc/apt/keyrings/githubcli-archive-keyring.gpg https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  && echo "20e0125d6f6e077a9ad46f03371bc26d90b04939fb95170f5a1905099cc6bcc0  /etc/apt/keyrings/githubcli-archive-keyring.gpg" | sha256sum -c - \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && mkdir -p -m 755 /etc/apt/sources.list.d \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

# Modify the existing node user/group to have the specified UID/GID to match host user
RUN usermod -u $USER_UID --non-unique node \
  && groupmod -g $USER_GID --non-unique node \
  && usermod -g $USER_GID -d /paperclip node

# --- Install global CLI tools in a separate stage (cached independently) ---
FROM base AS cli-tools
RUN npm install --global --omit=dev \
  @anthropic-ai/claude-code@latest \
  @openai/codex@latest \
  opencode-ai

# --- Install dependencies (only re-runs when package.json/lockfile change) ---
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY cli/package.json cli/
COPY server/package.json server/
COPY ui/package.json ui/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/adapter-utils/package.json packages/adapter-utils/
COPY packages/adapters/claude-local/package.json packages/adapters/claude-local/
COPY packages/adapters/codex-local/package.json packages/adapters/codex-local/
COPY packages/adapters/cursor-local/package.json packages/adapters/cursor-local/
COPY packages/adapters/gemini-local/package.json packages/adapters/gemini-local/
COPY packages/adapters/openclaw-gateway/package.json packages/adapters/openclaw-gateway/
COPY packages/adapters/opencode-local/package.json packages/adapters/opencode-local/
COPY packages/adapters/pi-local/package.json packages/adapters/pi-local/
COPY packages/plugins/sdk/package.json packages/plugins/sdk/
COPY patches/ patches/

RUN pnpm install --frozen-lockfile

# --- Build: copy source per package to maximize cache hits ---
FROM base AS build
WORKDIR /app
COPY --from=deps /app /app

# Root tsconfigs needed by all packages that extend them
COPY tsconfig.json tsconfig.base.json ./

# Copy all packages (UI and server both depend on shared, adapters, etc.)
COPY packages/ packages/

# Build shared first, then plugin-sdk (which depends on shared's dist/)
RUN pnpm --filter @paperclipai/shared build
RUN pnpm --filter @paperclipai/plugin-sdk build

# Copy and build UI
COPY ui/ ui/
RUN pnpm --filter @paperclipai/ui build

# Copy and build server
COPY server/ server/
COPY cli/ cli/
COPY skills/ skills/
COPY scripts/ scripts/
RUN pnpm --filter @paperclipai/server build
RUN test -f server/dist/index.js || (echo "ERROR: server build output missing" && exit 1)

# --- Prune devDependencies for smaller production image ---
FROM base AS pruned
WORKDIR /app
COPY --from=build /app /app
RUN pnpm prune --prod --no-optional

# --- Production ---
FROM base AS production
ARG USER_UID=1000
ARG USER_GID=1000
WORKDIR /app
COPY --chown=node:node --from=pruned /app /app
COPY --from=cli-tools /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=cli-tools /usr/local/bin /usr/local/bin

RUN mkdir -p /paperclip && chown node:node /paperclip

COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production \
  HOME=/paperclip \
  HOST=0.0.0.0 \
  PORT=3100 \
  SERVE_UI=true \
  PAPERCLIP_HOME=/paperclip \
  PAPERCLIP_INSTANCE_ID=default \
  USER_UID=${USER_UID} \
  USER_GID=${USER_GID} \
  PAPERCLIP_CONFIG=/paperclip/instances/default/config.json \
  PAPERCLIP_DEPLOYMENT_MODE=authenticated \
  PAPERCLIP_DEPLOYMENT_EXPOSURE=private \
  OPENCODE_ALLOW_ALL_MODELS=true

VOLUME ["/paperclip"]
EXPOSE 3100

# Entrypoint drops from root→node if platform overrides USER (e.g., Zeabur)
ENTRYPOINT ["docker-entrypoint.sh"]
USER node
CMD ["node", "--import", "./server/node_modules/tsx/dist/loader.mjs", "server/dist/index.js"]
