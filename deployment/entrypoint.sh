#!/usr/bin/env sh
set -eu

# An existing data volume may predate Docker configuration persistence.
if [ ! -e /app/.data/.env.docker ]; then
  cp /app/deployment/docker.env /app/.data/.env.docker
fi

exec node stwSpinner.js
