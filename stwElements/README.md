# Spin the Web elements

This folder defines the core classes that define the base elements of WBOL (Webbase Ontology Language), the structural foundation of Spin the Web. These elements form a hierarchical tree structure, enabling the modeling of a site, areas, pages, and content blocks.

A **Webbase** is the description of a web application, composed of these elements. The `STWSite` element is a singleton—there can be only one `STWSite` in a webbase. If a structure does not include an `STWSite`, it is referred to as a **Webbaselet**.

## Core WBOL Base Element

**STWElement**: The abstract base class for all WBOL elements, providing the core properties and methods below.  
All WBOL elements derive from `STWElement` share a common set of properties:

| Property     | Type             | Description                                                                 |
|--------------|------------------|-----------------------------------------------------------------------------|
| `_id`        | `string`         | Unique identifier for the element.                                          |
| `type`       | `string`         | The type of the element (e.g., "Site", "Area", "Page", "Content").          |
| `name`       | `string`         | Human-readable name of the element.                                         |
| `slug`       | `string`         | Union of slugs from the root element makes up the URL of the element        |
| `children`   | `STWElement[]`   | Array of child elements (all types except `STWSite`).                       |
| `localize()` | `(session, key) => string` | Returns a localized string for the given key and session.         |


## Derived Elements

`STWSite`, `STWArea`, `STWPage`, and `STWContent` represent the main structural nodes of a WBOL document.
These elemets can contain children, allowing for nested site structures (e.g., a site contains areas, which contain pages, which contain contents). Children can include all types of elements except `STWSite`.

- **STWSite**: Represents the root of a WBOL site, containing metadata and top-level structure. Only one instance is allowed per webbase. Inherits from `STWArea`.
- **STWArea**: Groups related sub-areas, pages and contents.
- **STWPage**: Represents an individual page and its contents.
- **STWContent**: Abstract base for reusable content blocks or widgets, with concrete implementations in the `stwContents` folder.  
  The purpose of a content, i.e., a class derived from the abstract class `STWContent`, is to interact with data. Each content has a fundamental nature, for example, representing data as a table, list, calendar, tabs, graph, tree, text, map, even an API. The content connects to a datasource, send a command, and displays the returned data as HTML without requiring further configuration or exposes an API, for example by calling a stored procedure or providing an endpoint for integration.

  **Examples:**
  - An `STWTabs` content includes as children other contents, each representing a page within the tabbed interface.
  - An `STWMenus` content includes as children pages that can be navigated to, but also contents that would make it a megamenu, and even areas—in this case, the area's mainpage would be the destination.
  - A `STWCalendar` or other `STWContent` can also host contents such as `STWForm` in each day, hour, or month cell, depending on the calendar or schedule view.

## Usage

These classes are used throughout the Spin the Web platform for:
- Parsing and generating WBOL files
- Building and manipulating the in-memory site tree
- Rendering and exporting site structures
- Providing a type-safe API for extensions and tools

---

This folder is essential for the definition and manipulation of all WBOL-based site structures in Spin the Web.