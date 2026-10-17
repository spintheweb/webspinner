# Spin the Web — Deployment

This folder contains Docker and native server tooling for deploying the Webspinner runtime.

## Quick start (Docker — local only)

Build the image locally (no registry push) and run it:

```bash
# 1) Build locally and load into your Docker engine
bash deployment/build-docker.sh

# 2) Run the local image
docker run --rm \
	-p 8080:8080 \
	-e PORTAL_DOMAIN=example.com \
	-v "$PWD/webspinner-data:/app/.data" \
	ghcr.io/spintheweb/webspinner:latest
```

Notes:
- Images are tagged locally as `ghcr.io/spintheweb/webspinner:latest` by default but are not pushed anywhere unless you explicitly use `--push`.
- First run: if `PORTAL_DOMAIN` is not set and no sentinel is present, the container serves an info/setup page on port 8080. Set `PORTAL_DOMAIN` to proceed.
- Persistent data: `./webspinner-data` on host is mounted to `/app/.data` in the container.
- Environment variables supported include `PORT`, `PORTAL_ROOT`, `WEBBASE`, `COMMON_WEBBASE`, `PORTAL_DOMAIN`, and `STW_DEBUG`.
- Set `STW_DEBUG=true` to enable request-level page and content trace logs; tracing is disabled by default.

## Developer WBOL API

Authenticated sessions with the `developers` role can manage the in-memory webbase at `/wbol`:

- `GET /wbol` returns the portal tree; `GET /wbol/<uuid>` returns one element and its children.
- `POST /wbol` creates an element. The JSON body contains `parentId` and an `element` definition accepted by the registered element constructor.
- `PATCH /wbol/<uuid>` updates an element through its runtime update method. Include `parentId` to move it, with optional `position` for its new child index.
- `DELETE /wbol/<uuid>` removes an element and its descendants.

Root or administrator sessions can also manage accounts and configuration:

- `GET /wbol/users` lists accounts without password hashes. `POST` creates an account; `PATCH /wbol/users/<user>` changes its name, email, password, or role assignments; `DELETE` removes it.
- `GET /wbol/roles` lists known roles. `POST` with `{"role":"editors"}` creates one; `PATCH /wbol/roles/<role>` with `{"role":"new-name"}` renames it; `DELETE` removes it from accounts and in-memory visibility rules. Mandatory roles cannot be renamed or deleted.
- `GET /wbol/datasources` lists datasource definitions with credentials redacted. `POST` creates one; `PATCH /wbol/datasources/<name>` updates it; `DELETE` removes it only when no content references it. Updated definitions are written to the configured `DATASOURCES` file and reloaded.

Responses are JSON. Account-role changes affect new authentications; existing sessions keep their current roles until re-authenticated. Webbase edits are in memory only and are not persisted to WBOL files. Datasource passwords may be supplied when creating or updating a datasource, but are never returned by the API. The `developers` role is sufficient for webbase edits; account, role, and datasource management requires `root` or `administrators`.
- For TLS and reverse proxy, place this behind nginx/Traefik/Caddy.

## Quick start (docker-compose)

Use the provided compose file in the repo root:

```bash
docker compose -f docker-compose.yml up --build
```

In VS Code, you can also run the tasks:
- "Docker: Compose Up" to start
- "Docker: Compose Down" to stop and remove volumes

The compose file builds using `deployment/Dockerfile` and will accept a `DENO_VERSION` build arg (defaults to a sensible version). You can set an environment variable to override.

## Native Linux server (optional)

For a non-containerized install:

```bash
sudo bash deployment/server.sh
```

`build-server.sh` is a maintainer tool that produces a self-extracting installer into the `release/` directory.

## Maintainers: build (and optionally push) the Docker image

Use `deployment/build-docker.sh` to build locally or build-and-push to GHCR. It:
- Reads the Deno version from `deployment/.deno-version` (fallback to root `.deno-version` or `2.3.0`)
- Builds multi-arch images (linux/amd64, linux/arm64) using Buildx
- Tags with the current git tag (if present) and `latest`; or `--tag` may be provided explicitly

Examples:

```bash
# Build locally (loads into your Docker engine; no push)
bash deployment/build-docker.sh

# Build and push to GHCR (requires auth; optional, for later when publishing)
bash deployment/build-docker.sh --push

# Specify tag and Deno version explicitly
bash deployment/build-docker.sh --tag v2.0.0 --deno 2.5.6
```

Buildx is required. Docker Desktop includes Buildx; otherwise install and create a builder.

## Build the release bundle (maintainers)

Create a single-stack ZIP bundle:

```bash
deno task release
```

Output: `deployment/release/webspinner-stack-<version>.zip` (+ `.sha256`)

Bundle contents:
- `deployment/Dockerfile`, `docker-compose.yml`
- `deployment/server.sh` (and built installer if generated)
- `deployment/build-docker.sh` (and wrapper `deployment/docker.sh`)

## Repository links

- Repo: https://github.com/spintheweb/webspinner
- Releases: https://github.com/spintheweb/webspinner/releases
