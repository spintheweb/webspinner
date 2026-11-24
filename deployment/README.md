# Spin the Web — Deployment

This folder contains Docker and native server tooling for deploying the Webspinner runtime.

## Quick start (Docker — local only)

Build the image locally (no registry push) and run it:

```bash
# 1) Build locally and load into your Docker engine
bash deployment/build-docker.sh

# 2) Run the local image with persistent data
docker run --rm \
	-p 127.0.0.1:8080:8080 \
	-e ALLOW_ROOT=true \
	-v webspinner-data:/app/.data \
	ghcr.io/spintheweb/webspinner:latest
```

Notes:
- Images are tagged locally as `ghcr.io/spintheweb/webspinner:latest` by default but are not pushed anywhere unless you explicitly use `--push`.
- Open `http://localhost:8080` and sign in as `root` with the example password `password` to use `/stwc/configuration`.
- A new empty volume receives the example webbase, connector configuration, users and Docker settings. Existing volume files are not replaced.
- Docker settings are stored in `/app/.data/.env.docker` and survive container recreation. Changes require a restart; explicitly supplied environment variables take precedence.
- The example users have a publicly known password. Change or remove them before exposing the service, and disable root access when it is no longer needed. Loopback port binding does not restrict access from other Docker containers.
- Environment variables supported include `PORT`, `PORTAL_ROOT`, `WEBBASE`, `COMMON_WEBBASELET` and `ALLOW_ROOT`.

## Developer WBOL API

`DEPLOYED=true` (the default) hides the project-managed Studio webbaselet from the webbase tree and makes both Studio and Common read-only. Common remains visible in the tree. Set `DEPLOYED=false` only in development to view and edit both; installed project webbaselets are overwritten on updates. `ALLOW_DEV=false` prevents Studio from loading regardless of `DEPLOYED`. Changes require a restart.

Authenticated sessions with the `developer` role can manage elements in the in-memory webbase at `/wbol` when their effective `developer` RBV is true. Portal visibility is granted only to `root`; LeadDeveloper and root can nevertheless read and edit the portal through the API. Developer users can access elements explicitly granted to them below the portal.

- `GET /wbol` returns the accessible portal tree. Each element includes `blocked` (the editing user, or an empty string), numeric effective `visibility` (0 hidden, 1 visible, 2 hidden by inheritance, 3 visible by inheritance), and, for content, `section`. Use `?roles=foo+fee` to evaluate visibility for those roles; omitted or empty roles use the session roles. The selected roles do not change access to the tree. Explicit role settings remain available through the visibility route. `GET /wbol/<uuid>` returns one element and its children.
- `POST /wbol/<uuid>/block` acquires an in-memory editor block for the authenticated user and returns `{ blocked, token }`. If another user owns the block, or the element is read-only, `token` is null. Each successful acquisition must be released with `DELETE /wbol/<uuid>/block?token=<token>`; a user's block remains until all their tokens are released. WBOL writes to elements blocked by another user return 409. If a release request cannot reach the server, the block remains until release or server restart.
- `POST /wbol` creates an element. The JSON body contains `parentId` and an `element` definition accepted by the registered element constructor. Set visibility separately through the visibility route.
- `PATCH /wbol/<uuid>` updates an element through its runtime update method. Include `parentId` to move it, with optional `position` for its new child index. Localized string values update only `?locale=<portal-locale>`; without it, the Developer's session language is used. Localized maps merge locale entries rather than replacing the other locales.
- `DELETE /wbol/<uuid>` removes an element and its descendants.
- `GET /wbol/<uuid>/visibility` reads explicit role visibility for LeadDeveloper or for developers with effective developer visibility. Only LeadDeveloper or root may change it: `PUT` replaces the manageable entries while preserving `root` and `administrator`; `PATCH` merges entries, and a `null` value removes that role's override. Neither role can assign `root` or `administrator`. Element creation and updates cannot set visibility directly.
- `GET /wbol/<uuid>/options` reads options for content types that define them (for example menus, tabs, and accordions); `PUT` replaces the complete options array. `PATCH` with `?locale=<portal-locale>` and `{"path":[0],"name":"Label"}` updates one option name at its array-index path, preserving its other locale values. The session language is the default.
- `GET /wbol/<portal-uuid>/connectors` reads the portal's connector values; `PUT` replaces the name-to-value map. Both require `leaddeveloper` or `root`.
- `GET /wbol/<portal-uuid>/roles` lists all known roles for LeadDeveloper, root, or developers with effective developer visibility on the portal; `POST` with `{"role":"editors"}` creates a role for LeadDeveloper or root.
- SEO sessions with effective `seo` visibility can read filtered element metadata and `PATCH` only `name`, `slug`, `keywords`, and `description`. Supply locale-to-string maps to update any supported portal locale; SEO access does not permit other element edits.

Root or administrator sessions can manage accounts; root or LeadDeveloper can manage custom roles. The `administrator` role cannot assign `root`, `developer`, `leaddeveloper`, or `seo`. LeadDeveloper users can assign `developer` and `seo`; root can manage any role. Connector configuration routes require `leaddeveloper` or `root`, except that only root can configure Node connectors:

- `GET /wbol/users` lists accounts without password hashes. `POST` creates an account; `PATCH /wbol/users/<user>` changes its name, email, password, or role assignments; `DELETE` removes it. `GET/PATCH /wbol/users/<user>/developer` and `/wbol/users/<user>/seo` read or toggle those assignments with `{"enabled":true|false}`. LeadDeveloper users can manage these two roles; root can manage any role.
- `GET /wbol/roles` lists custom roles for LeadDeveloper and root, excluding predefined roles. `POST` with `{"role":"editors"}` creates one; `PATCH /wbol/roles/<role>` with `{"role":"new-name"}` renames it; `DELETE` removes it from accounts and in-memory visibility rules. Predefined roles cannot be renamed or deleted. `GET /wbol/roles/visibility` lists all known roles, including predefined roles, for developers, LeadDeveloper and root.
- `GET /wbol/connectors/names` lists available connector IDs and display names for developers and root. Root and LeadDeveloper can use `GET /wbol/connectors` to list definitions with credentials redacted, `POST` to create one, `PATCH /wbol/connectors/<id>` to update it, and `DELETE` to remove it when no content references it. IDs are unique and immutable; display names can be changed and default to the ID on creation. Only root can create, modify, or remove Node connectors. Updated definitions are written to the configured `CONNECTORS` file and reloaded. Root or LeadDeveloper can use `POST /wbol/connectors/reconnect` to reconnect configured connectors.

With `DEPLOYED=false`, Node connector scripts run directly as Webspinner with its full environment and no timeout; a configured launcher is ignored. This exposes Webspinner's permissions and credentials to those scripts and is suitable only for trusted development. With `DEPLOYED=true`, an administrator-provisioned restricted launcher is required and the connector uses a minimal environment and a 30-second timeout.

Responses are JSON. Account-role changes affect new authentications; existing sessions keep their current roles until re-authenticated. Webbase edits through these routes are in memory only and are not persisted to WBOL files. Connector passwords may be supplied when creating or updating a connector, but are never returned by the connector API.
- For TLS and reverse proxy, place this behind nginx/Traefik/Caddy.

## Mail connector setup

The Common WBOL mail page uses connector IDs `imapApi` and `smtpApi`, with connector types `imap` and `smtp`. Configure both in the JSON array at `CONNECTORS` (default: `.data/connectors.json`). Supply credentials through environment variables using `passwordEnv` rather than storing passwords in the connector file:

```json
[
  {
    "id": "imapApi",
    "name": "imapApi",
    "type": "imap",
    "host": "imap.example.com",
    "user": "mailbox@example.com",
    "passwordEnv": "MAIL_PASSWORD"
  },
  {
    "id": "smtpApi",
    "name": "smtpApi",
    "type": "smtp",
    "host": "smtp.example.com",
    "port": 587,
    "secure": false,
    "user": "mailbox@example.com",
    "passwordEnv": "MAIL_PASSWORD",
    "from": "mailbox@example.com"
  }
]
```

IMAP connections always require verified TLS. SMTP uses verified TLS and requires STARTTLS when `secure` is `false`; port 465 defaults to implicit TLS. The mail page currently accesses a shared mailbox and is visible only to `root` and `leaddeveloper`.

## Quick start (docker-compose)

Use the provided compose file in the repo root:

```bash
docker compose -f docker-compose.yml up --build
```

Compose binds port 8080 to localhost and enables root for initial setup. It uses
the same example accounts and persistent data volume described above.

In VS Code, you can also run the tasks:
- "Docker: Compose Up" to start
- "Docker: Compose Down" to stop and remove volumes

The compose file builds using `deployment/Dockerfile` and accepts a `NODE_VERSION` build argument (defaults to Node.js 26). You can set an environment variable to override.

## Native Linux server (optional)

For a non-containerized install:

```bash
bash deployment/build-server.sh
sudo bash deployment/release/server.sh
```

`build-server.sh` produces a self-extracting installer in the `release/` directory.
The installer creates a PostgreSQL database and a `postgres` connector, and asks
for an initial root password. Fresh installs set `ALLOW_DEV=true` and
`ALLOW_ROOT=false`; enable root access in the installed `.env` if needed.
The installer refuses to reuse an existing `webspinner` database or role.
The installer includes example user accounts whose password is `password`.
Change their passwords or remove the accounts before exposing the server; the
root account instead uses the password entered during installation. Administrators
and root can manage example users from the Users page.
If a fresh installation fails after files have been copied, the installer marks
it as incomplete and refuses to treat it as an upgrade. Inspect the installation
and PostgreSQL resources before removing the incomplete installation and
resolving any database or role conflicts for a retry.

## Maintainers: build (and optionally push) the Docker image

Use `deployment/build-docker.sh` to build locally or build-and-push to GHCR. It:
- Uses Node.js 26 by default; `--node` selects another major version
- Builds multi-arch images (linux/amd64, linux/arm64) using Buildx
- Tags with the current git tag (if present) and `latest`; or `--tag` may be provided explicitly

Examples:

```bash
# Build locally (loads into your Docker engine; no push)
bash deployment/build-docker.sh

# Build and push to GHCR (requires auth; optional, for later when publishing)
bash deployment/build-docker.sh --push

# Specify tag and Node.js major version explicitly
bash deployment/build-docker.sh --tag v2.0.0 --node 26
```

Buildx is required. Docker Desktop includes Buildx; otherwise install and create a builder.

## Build the server release (maintainers)

Build the installer and its SHA-256 checksum:

```bash
npm run release -- --no-bump
```

Output: `deployment/release/server.sh` and `server.sh.sha256`. Use
`--output-dir <path>` to build elsewhere. The installer embeds only the
seed data in `deployment/seed`, not the local `.data` directory.
`--dry-run` prints the planned steps without building or publishing.

## Repository links

- Repo: https://github.com/spintheweb/webspinner
- Releases: https://github.com/spintheweb/webspinner/releases
