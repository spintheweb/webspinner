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

Studio is no longer embedded as a webbaselet. Developer tools should use the developer-authorized `/wbol` API documented
in the deployment guide.
