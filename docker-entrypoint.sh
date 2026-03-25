#!/bin/sh
# If running as root (UID 0), drop to the 'node' user
if [ "$(id -u)" = "0" ]; then
  # Ensure /paperclip is owned by node
  chown -R node:node /paperclip 2>/dev/null || true
  exec gosu node "$@"
fi

# Already running as non-root, just exec
exec "$@"
