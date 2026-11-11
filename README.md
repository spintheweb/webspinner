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

Database connector types are adapters, not the connector model itself. The runtime supports MySQL (`mysql`), PostgreSQL (`postgres`), SQL Server (`mssql`), and MongoDB (`mongodb`), alongside API and shell connectors. The `stwinsert`, `stwupdate`, and `stwdelete` actions use the same CRUD action contract for these database connectors; SQL adapters handle their dialect-specific identifier quoting and parameter binding.

SQL content uses native SQL. For MongoDB, content queries use JSON Extended JSON with a collection name and optional query options, for example:

```json
{"collection":"customers","filter":{"status":"active"},"projection":{"name":1},"limit":50}
```

MongoDB CRUD actions use the query's `collection` and optional `filter`, plus submitted form fields. Update and delete actions target the configured key field (default `_id`); updates apply submitted fields with `$set`. A 24-character hexadecimal `_id` submitted by a form is treated as an ObjectId.

Administrators can force a full connector reload and reconnect all configured databases with `POST /wbol/connectors/reconnect`. This reconnects every configured database connector, not only failed ones; failures are returned in the response.

## Run Webspinner

Webspinner requires Node.js 22.18 or later. From this repository:

```bash
npm ci
npm start
```

The server listens on port 8000 by default. Set `PORT`, `HOST`, and optionally `CERTFILE` and `KEYFILE` in the environment or `.env` file to configure the listener.

## Learn more
Explore WBOL and the Webspinner architecture:

- Book: https://github.com/spintheweb/book
- Wiki: https://github.com/spintheweb/webspinner/wiki
- Schemas: https://github.com/spintheweb/schemas
