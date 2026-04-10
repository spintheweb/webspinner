# Webbaselets

Webbaselets are modular web applications designed to be embedded within a webbase. Unlike traditional webbases, they do
not include a root site element, allowing them to integrate seamlessly as components or features within larger webbase
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

## Spin the Web Studio (stwStudio.wbol)

Spin the Web Studio is a webbaselet designed for building and managing Spin the Web applications. It offers an intuitive
interface that integrates directly with your project, enabling developers and administrators to organize application
structure, manage content, configure data sources, and set up authorizations—all while previewing changes in real time.

### Key Features

- **Webbase Structure Management:**\
  Visualize the entire webbase (site, areas, pages, contents) as a tree. Edit elements in memory and persist changes to
  `./.data/webbase.wbol`.

- **Search:**\
  Quickly find any element within the webbase structure.

- **User & Role Management:**\
  Manage users and roles via `./.data/users.json`.

- **Datasource Management:**\
  Configure and manage datasources via `./.data/datasources.json`.

- **Public Folder Interaction:**\
  Browse, edit, and manage files in the `./public` folder, including HTML, CSS, and JavaScript assets.

- **Debugging Tools:**\
  Access debugging features to inspect and troubleshoot the application.

- **Live Preview:**\
  Instantly see how changes affect the site, with support for multiple languages and user roles.

- **Layout Designer:**\
  Edit and preview WBLL (Webbase Layout Language) templates, manage placeholders, and control responsive layouts.

- **Tree and Navigation Management:**\
  Organize site structure.

- **Localization Tools:**\
  Easily manage translations and localized content for multilingual sites.

### Who Is It For?

- **Developers:**\
  Rapidly prototype and extend site features with code and visual tools.
- **Site Administrators:**\
  Oversee structure, permissions, and localization from a central dashboard.

> **Note:**\
> Edits are performed in memory and must be explicitly saved to persist changes to disk. Access to management features
> should be restricted to authorized users.
