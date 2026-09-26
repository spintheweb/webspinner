# stwContents Folder Overview

This folder contains content modules. Each file defines a specific type of content that can be rendered or managed in the system. Most modules query a datasource and render one or more records, providing interactive or visual representations of the underlying data. The name of each content module suggests how the queried data will be rendered (e.g., as a tree, chart, or table). The precise details of presentation and arrangement are described in the layout using WBLL (Webbase Layout Language).

---

## stwAccordion.ts

Implements the `STWAccordion` content type. Displays localized, expandable sections that load referenced content when opened, with optional links and parameters.

---

## stwBreadcrumbs.ts

Implements the `STWBreadcrumbs` content type. Displays breadcrumb navigation based on the current element’s position in the hierarchy, helping users understand and navigate their location.

---

## stwCalendar.ts

Implements the `STWCalendar` content type. Shows events or records in a calendar view (month, week, or day), with navigation and localization support.

---

## stwChart.ts

Implements the `STWChart` content type. Visualizes data as charts using Chart.js, supporting various chart types and interactive features.

---

## stwForm.ts

Implements the `STWForm` content type. Renders dynamic HTML forms for data input, submission, and validation.

---

## stwGeomap.ts

Implements the `STWGeomap` content type. Displays interactive maps and geospatial data using OpenLayers.

---

## stwGraph.ts

Implements the `STWGraph` content type. Renders graph visualizations to display relationships or network data.

---

## stwImagemap.ts

Implements the `STWImagemap` content type. Shows images with interactive, clickable regions.

---

## stwLanguages.ts

Implements the `STWLanguages` content type. Displays a language selection bar for switching the interface language.

---

## stwList.ts

Implements the `STWList` content type. Renders lists of items from data sources with customizable layouts.

---

## stwMenus.ts

Implements the `STWMenus` content type. Displays navigation menus, supporting nested and dynamic menu structures.

---

## stwPivot.ts

Implements the `STWPivot` content type. Renders pivot tables for interactive data analysis and aggregation.

---

## stwShortcut.ts

Implements the `STWShortcut` content type. Provides shortcuts for quick navigation or linking to other content or elements.

---

## stwTable.ts

Implements the `STWTable` content type. Displays tabular data with dynamic rows and columns.

---

## stwTabs.ts

Implements the `STWTabs` content type. Organizes content into tabbed interfaces for easy switching between sections.

---

## stwText.ts

Implements the `STWText` content type. Renders plain or formatted text, supporting localization and dynamic placeholders.

---

## stwTree.ts

Implements the `STWTree` content type. Renders hierarchical data as an interactive HTML tree, allowing users to expand and collapse branches and view nested structures.

