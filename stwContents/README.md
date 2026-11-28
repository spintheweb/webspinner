# stwContents Folder Overview

This folder contains content modules. Each file defines a specific type of content that can be rendered or managed in the system. Most modules query a connector and render one or more records, providing interactive or visual representations of the underlying data. The name of each content module suggests how the queried data will be rendered (e.g., as a tree, chart, or table). The precise details of presentation and arrangement are described in the layout using WBLL (Webbase Layout Language).

---

## stwAPI.js

Implements the `STWAPI` content type. A GET request executes its connector and returns the resource directly over HTTP, subject to content visibility. The connector must return no records (an empty 200 response) or one record with string fields `mime` and `content`. The optional `encoding` field is `utf8` (default) or `base64`; Base64 must use standard padded encoding. Invalid records and connector errors return 500 and are logged. Other HTTP methods return 405. API content is not rendered through WebSockets.

For example, a Node connector command can return text:

```js
console.log(JSON.stringify({ mime: "text/plain; charset=utf-8", content: "Hello" }));
```

For binary resources, return the bytes encoded as Base64, for example `{ "mime": "application/pdf", "content": "...", "encoding": "base64" }`. Include a charset in `mime` when clients need to know the text encoding. A shortcut to an API is also served directly, provided both the shortcut and target are visible.

---

## stwAccordion.js

Implements the `STWAccordion` content type. Displays localized, expandable sections that load referenced content when opened, with optional links and parameters.

---

## stwBreadcrumbs.js

Implements the `STWBreadcrumbs` content type. Displays breadcrumb navigation based on the current element’s position in the hierarchy, helping users understand and navigate their location.

---

## stwCalendar.js

Implements the `STWCalendar` content type. Shows events or records in a calendar view (month, week, or day), with navigation and localization support.

---

## stwChart.js

Implements the `STWChart` content type. Visualizes data as charts using Chart.js, supporting various chart types and interactive features.

---

## stwForm.js

Implements the `STWForm` content type. Renders dynamic HTML forms for data input, submission, and validation.

---

## stwGeomap.js

Implements the `STWGeomap` content type. Displays an interactive OpenStreetMap using Leaflet. The `.stwGeomapCanvas` container defaults to a height of `20rem`.

The WBLL setting `\s('mode="topographic" ')` fixes the map style to `standard`, `topographic` (OpenTopoMap), or `humanitarian` (OpenStreetMap France). Without a `mode`, the map starts with `standard` and provides a layer selector. Tile providers have their own usage policies and attribution requirements.

The expand control fills the browser window; use it again or press Escape to restore the map.

For connector records, set `key` to the coordinate field, e.g. `\s('key="latlng" ')`. Each value must be a `latitude, longitude` string; the remaining layout is rendered for each marker's popup using that record's placeholders. Missing fields or invalid coordinates produce a content error. The map fits the markers, or retains its default view when there are no records.

---

## stwGraph.js

Implements the `STWGraph` content type. Renders graph visualizations to display relationships or network data.

---

## stwImagemap.js

Implements the `STWImagemap` content type. Shows images with interactive, clickable regions.

---

## stwLanguages.js

Implements the `STWLanguages` content type. Displays a language selection bar for switching the interface language.

---

## stwList.js

Implements the `STWList` content type. Renders lists of items from connector with customizable layouts.

---

## stwMenus.js

Implements the `STWMenus` content type. Displays navigation menus, supporting nested and dynamic menu structures.

---

## stwPivot.js

Implements the `STWPivot` content type. Renders pivot tables for interactive data analysis and aggregation.

---

## stwShortcut.js

Implements the `STWShortcut` content type. Provides shortcuts for quick navigation or linking to other content or elements.

---

## stwTable.js

Implements the `STWTable` content type. Displays tabular data with dynamic rows and columns.

---

## stwTabs.js

Implements the `STWTabs` content type. Organizes content into tabbed interfaces for easy switching between sections.

---

## stwText.js

Implements the `STWText` content type. Renders plain or formatted text, supporting localization and dynamic placeholders.

---

## stwTree.js

Implements the `STWTree` content type. Renders hierarchical data as an interactive HTML tree, allowing users to expand and collapse branches and view nested structures.
