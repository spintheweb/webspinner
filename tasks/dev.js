/**
 * @fileoverview Starts local development tasks for Webspinner.
 *
 * Launches file watchers and development helpers such as CSS merging.
 * Usage: `node tasks/dev.js`
 *
 * @author Giancarlo Trevisan
 * @version 1.0.0
 * @module tasks/dev
 * @note Copilot-assisted
 * @license Apache-2.0
 */
// Import the merge-css watcher as a promise
import "./merge-css.js";
// You can import or spawn other tasks here as needed
// Example: import "../tasks/another-task.js";
console.log("Development tasks started. Watching for changes...");
