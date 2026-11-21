# Webspinner

Webspinner is the runtime that reads a Webbase (a WBOL model) and renders a working web portal from it.

- It interprets WBOL (Webbase Ontology Language) to build pages, navigation, layout, and behaviors at runtime.
- It maps connectors (databases, APIs, services) to UI elements (forms, tables, trees, calendars, etc.) to deliver a consistent UX across heterogeneous backends.
- It supports modular extensions called Webbaselets—self-contained features (e.g., mail, ERP, BPMS) that plug into a Webbase.
- In short: you describe the portal declaratively in WBOL, and Webspinner “spins” it into a live application.


*Figure 1*: Webspinner driven portal with Spin the Web Studio enabled.

![Webspinner Studio screenshot](./public/media/stwStudio.png)

## What is a Webbase?
A Webbase is a declarative WBOL model that defines a portal’s structure, navigation, layout, components, data bindings, and behaviors. It maps connectors (databases, APIs, services) to UI elements (forms, tables, text, menus, trees, calendars, etc.), enabling the runtime to render a consistent user experience across heterogeneous backends. Webbases can be extended modularly with Webbaselets.

A Webbaselet is a standalone module that describes a functionality—e.g., a webmail client (POP3/SMTP), an ERP client, or a BPMS client—that can be linked to a Webbase. Each integrates with its backend while presenting a uniform UX within the portal.

## Database connectors and data actions

Database connector types are adapters, not the connector model itself. The runtime supports MySQL (`mysql`), PostgreSQL (`postgres`), SQL Server (`mssql`), and MongoDB (`mongodb`), alongside API and Node connectors. The `stwinsert`, `stwupdate`, and `stwdelete` actions use the same CRUD action contract for these database connectors; SQL adapters handle their dialect-specific identifier quoting and parameter binding.

SQL content uses native SQL. For MongoDB, content queries use JSON Extended JSON with a collection name and optional query options, for example:

```json
{"collection":"customers","filter":{"status":"active"},"projection":{"name":1},"limit":50}
```

MongoDB CRUD actions use the query's `collection` and optional `filter`, plus submitted form fields. Update and delete actions target the configured key field (default `_id`); updates apply submitted fields with `$set`. A 24-character hexadecimal `_id` submitted by a form is treated as an ObjectId.

Users with the `root` or `leaddeveloper` role can force a full connector reload and reconnect all configured databases with `POST /wbol/connectors/reconnect`. This reconnects every configured database connector, not only failed ones; failures are returned in the response.

## Run Webspinner

Webspinner requires Node.js 22.18 or later. From this repository:

```bash
npm ci
npm start
```

The server listens on port 8000 by default. Set `PORT`, `HOST`, and optionally `CERTFILE` and `KEYFILE` in the environment or `.env` file to configure the listener.

For local development, run `npm run dev:tasks` to watch and merge styles and
sync `../schemas/wbol.xsd` to `public/schemas/wbol.xsd`.

Set `ALLOW_DEV=true` to enable developer access and `ALLOW_ROOT=true` to enable root access. Both default to `false`; disabled roles are removed from authenticated sessions. `ALLOW_DEV=false` removes the `developer`, `leaddeveloper`, and `seo` roles and prevents Studio from loading. `ALLOW_AI` also defaults to `false`; set it to `true` to enable Studio assistant requests and proposal application.

`DEPLOYED` defaults to `true`. In deployed installations, the Studio webbaselet is hidden from the webbase tree and the Common webbaselet is visible but read-only. Both project-managed webbaselets are protected from editing because updates overwrite them. Set `DEPLOYED=false` for local development to view and edit both webbaselets; Studio still requires `ALLOW_DEV=true`. Restart after changing these settings.

With `DEPLOYED=false`, Node connector scripts run directly with Webspinner's OS permissions and environment, without a launcher or timeout. They can access Webspinner's credentials and files; use this mode only in a trusted development environment. Deployed installations require a restricted launcher.

When Studio is enabled, its controls stay in the top-level page while the live
portal preview runs in a same-origin iframe. This separates their DOM and styles;
it is not a security boundary.

Root can read and update the active environment file through `GET /wbol/configuration` and `PATCH /wbol/configuration` (a JSON object of environment names and string values). The configuration page edits `HOST` and `ALLOW_DEV`. Changes require a restart; existing process environment variables take precedence over the file. Docker uses `.env.docker`, which must be persisted separately.

## Local Studio assistant

The optional Spin the Web Assistant runs separately on the same host and uses a
local Ollama model. Set a shared random `STW_ASSISTANT_TOKEN` of at least 32
characters in both services; `STW_ASSISTANT_PORT` defaults to 11435. Set
`ALLOW_AI=true` and enable developer access to use the AI Assistant tab in the
sidebar. The assistant UI is ordinary Studio content (see
`webbaselets/stwStudio.wbol`) backed by the reserved in-process `assistant`
connector, so the token never reaches the browser.
Enter an element UUID, confirm local context sharing, and send a question or edit request.
The conversation is stored in the session and shown by the Conversation content.
Review the Proposed changes content before selecting **Apply proposal**.

The first
version edits one existing element's name or slug, a page's keywords or
description, or a content's query or localized layout. It writes only a uniquely identified element in the
configured local Webbase, Common or Studio WBOL sources; remote, downloaded
and ambiguous sources cannot be saved. If the running element or source changed since the
proposal, request a new proposal. Queries are never executed by the assistant,
but a saved query or layout can execute when the portal renders. Generated WBOL,
layouts and queries require careful developer review. Saving checks WBOL
round-tripping and uses Webspinner's layout parser; it does not perform full
XSD validation. This version does not create, delete or move elements.

## Learn more
Explore WBOL and the Webspinner architecture:

- Book: https://github.com/spintheweb/book
- Wiki: https://github.com/spintheweb/webspinner/wiki
- Schemas: https://github.com/spintheweb/schemas
