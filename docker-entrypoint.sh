#!/bin/sh
set -e

# Wait for database and Redis to be healthy before starting
if [ "$SKIP_SERVICE_WAIT" != "true" ]; then
  echo "[Entrypoint] Waiting for database and Redis services..."
  node dist/db/wait.js
fi

# Run migrations if enabled
if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "[Entrypoint] Running database migrations..."
  node dist/db/migrate.js
fi

# Start the main command (e.g. node dist/index.js)
echo "[Entrypoint] Starting application: $@"
exec "$@"
