#!/usr/bin/env sh
set -eu

# Entry point for the Webspinner Docker image.
# Behavior:
# - If SITE_DOMAIN is set, mark configured and exec the main server.
# - If /app/.configured exists, exec the main server.
# - Otherwise, serve a static configuration info page on PORT and exit when stopped.

PORT=${PORT:-8080}
APP_DIR=/app
INFO_PAGE="$APP_DIR/.config-needed.html"

cat > "$INFO_PAGE" <<'HTML'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Webspinner — Configuration required</title>
  <style>body{font-family:Arial,Helvetica,sans-serif;margin:2rem}</style>
</head>
<body>
  <h1>Webspinner: Configuration required</h1>
  <p>The container detected no <code>SITE_DOMAIN</code> environment variable and the instance is not configured.</p>
  <p>To configure the container, restart it with an environment variable <code>SITE_DOMAIN</code> set to a DNS name pointing to this host. Example (docker-compose):</p>
  <pre>environment:
  - SITE_DOMAIN=example.com
  - PORT=8080
  </pre>
  <p>Future releases will allow interactive configuration via a webbaselet. For now, set the environment and restart.</p>
  <hr>
  <p><small>Webspinner listens on port ${PORT} inside the container.</small></p>
</body>
</html>
HTML

# If SITE_DOMAIN set or already configured, run the main server
if [ -n "${SITE_DOMAIN:-}" ] || [ -f "$APP_DIR/.configured" ]; then
  # create sentinel
  touch "$APP_DIR/.configured" || true
  echo "INFO: Starting Webspinner (SITE_DOMAIN=${SITE_DOMAIN:-<unset>})."
  exec deno run --allow-net --allow-read --allow-env stwSpinner.ts
fi

echo "INFO: No SITE_DOMAIN set and no configuration sentinel found. Serving configuration info page on port $PORT."

# Serve the info page using Deno's built-in server (no remote imports needed)
deno run --allow-net --allow-read --allow-env - <<'DENO'
const port = Number(Deno.env.get('PORT') || '8080');
const body = await Deno.readTextFile('./.config-needed.html');
Deno.serve({ port }, (_req) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
DENO
