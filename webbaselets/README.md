# Webbaselets

Webbaselets are modular web applications designed to be embedded within a webbase. Unlike traditional webbases, they do
not include a root portal element, allowing them to integrate seamlessly as components or features within larger webbase
projects.

## Spin the Web Commons (stwCommon.wbol)

Webbaselet that provides reusable, cross‑portal building blocks such as authentication (sign‑in / sign‑out, password reset), user and role management, notification/message boxes, common UI fragments, and localization helpers.

Key points
- These common capabilities are packaged as a webbaselet so they can be embedded into any portal webbase.
- A portal webbase and the webbaselets it uses evolve independently: a portal webbase has its own lifecycle and each webbaselet has its own versioning and updates.
- Embedding a webbaselet into a portal augments the portal with the webbaselet’s functionality, assets, and configuration. Manage compatibility and update strategy to ensure smooth integration.

Typical features
- Authentication: sign in, sign out, password recovery, session handling
- User & role management: create/update users, assign roles, audit events
- Messaging: modal/message boxes, toast notifications, system alerts
- Common UI & utilities: shared components, localization helpers, validation routines
- Data contracts: standard schemas and endpoints for consistent integration
- Configuration: options to enable/disable features per portal and to persist settings in the portal’s data store

## Spin the Web Studio

Spin the Web Studio (`stwStudio.wbol`) is a project-managed webbaselet that
provides browser-based tools for working with a running portal. It includes a
Webbase tree and explorer, editors for portal elements, connector and role
management, preview and interactive controls, and an optional local AI
assistant.

Open or close Studio with `Alt+F12` when developer access is enabled. Studio
uses the `/wbol` API to edit the active in-memory Webbase; those edits are not
automatically written back to WBOL source files. The optional assistant has a
separate proposal workflow for supported source edits.

Studio requires `ALLOW_DEV=true`. In deployed mode (`DEPLOYED=true`), the
project-managed Studio webbaselet is hidden and project-managed webbaselets are
read-only. Use `DEPLOYED=false` only for local development; updates can
overwrite these webbaselets. See the [deployment guide](../deployment/README.md)
for configuration and API details.
