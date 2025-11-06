// SPDX-License-Identifier: GPL-3.0-or-later
// Build/development task: dev

// Runs all development tasks in parallel (e.g., CSS watcher, etc.)
// Usage: $ deno run --allow-read --allow-write tasks/dev.ts

// Import the merge-css watcher as a promise
import "./merge-css.ts";

// You can import or spawn other tasks here as needed
// Example: import "../tasks/another-task.ts";

console.log("Development tasks started. Watching for changes...");