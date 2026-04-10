# Webspinner

Webspinner is the runtime that reads a Webbase (a WBOL model) and renders a working web portal from it.

- It interprets WBOL (Webbase Ontology Language) to build pages, navigation, layout, and behaviors at runtime.
- It maps data sources (databases, APIs, services) to UI elements (forms, tables, trees, calendars, etc.) to deliver a consistent UX across heterogeneous backends.
- It supports modular extensions called Webbaselets—self-contained features (e.g., mail, ERP, BPMS) that plug into a Webbase.
- In short: you describe the portal declaratively in WBOL, and Webspinner “spins” it into a live application.


*Figure 1*: Webspinner driven portal with Spin the Web Studio enabled.

![Webspinner Studio screenshot](./public/media/stwStudio.png)

## What is a Webbase?
A Webbase is a declarative WBOL model that defines a portal’s structure, navigation, layout, components, data bindings, and behaviors. It maps data sources (databases, APIs, services) to UI elements (forms, tables, text, menus, trees, calendars, etc.), enabling the runtime to render a consistent user experience across heterogeneous backends. Webbases can be extended modularly with Webbaselets.

A Webbaselet is a standalone module that describes a functionality—e.g., a webmail client (POP3/SMTP), an ERP client, or a BPMS client—that can be linked to a Webbase. Each integrates with its backend while presenting a uniform UX within the portal.

## Learn more
Explore WBOL and the Webspinner architecture:

- Book: https://github.com/spintheweb/book
- Wiki: https://github.com/spintheweb/webspinner/wiki
- Schemas: https://github.com/spintheweb/schemas
