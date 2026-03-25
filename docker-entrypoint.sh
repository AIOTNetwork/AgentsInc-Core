#!/bin/sh
# Startup diagnostics
echo "[entrypoint] Running as: $(whoami) (UID $(id -u))"
echo "[entrypoint] ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:+set (${#ANTHROPIC_API_KEY} chars)}${ANTHROPIC_API_KEY:-NOT SET}"
echo "[entrypoint] ANTHROPIC_AUTH_TOKEN: ${ANTHROPIC_AUTH_TOKEN:+set (${#ANTHROPIC_AUTH_TOKEN} chars)}${ANTHROPIC_AUTH_TOKEN:-NOT SET}"
echo "[entrypoint] PAPERCLIP_DEPLOYMENT_MODE: ${PAPERCLIP_DEPLOYMENT_MODE:-not set}"

# If running as root (UID 0), drop to the 'node' user
if [ "$(id -u)" = "0" ]; then
  # Ensure /paperclip is owned by node
  chown -R node:node /paperclip 2>/dev/null || true
  exec gosu node "$@"
fi

# Already running as non-root, just exec
exec "$@"
