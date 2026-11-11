# stwContents Folder Overview

This folder contains content modules. Each file defines a specific type of content that can be rendered or managed in the system. Most modules query a connector and render one or more records, providing interactive or visual representations of the underlying data. The name of each content module suggests how the queried data will be rendered (e.g., as a tree, chart, or table). The precise details of presentation and arrangement are described in the layout using WBLL (Webbase Layout Language).

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

Implements the `STWGeomap` content type. Displays interactive maps and geospatial data using OpenLayers.

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
