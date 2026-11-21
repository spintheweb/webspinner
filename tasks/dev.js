/**
 * @fileoverview Starts local development tasks for Webspinner.
 *
 * Launches file watchers for CSS merging and syncing the WBOL schema.
 * Usage: `node tasks/dev.js`
 *
 * @author Giancarlo Trevisan
 * @version 1.0.0
 * @module tasks/dev
 * @note Copilot-assisted
 * @license Apache-2.0
 */
import { watch } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
// Import the merge-css watcher as a promise
import "./merge-css.js";

const schemaSource = fileURLToPath(new URL("../../schemas/wbol.xsd", import.meta.url));
const schemaTarget = fileURLToPath(new URL("../public/schemas/wbol.xsd", import.meta.url));
const schemaSourceDirectory = dirname(schemaSource);
let schemaCopyTimer;

async function copyWbolSchema() {
	await mkdir(dirname(schemaTarget), { recursive: true });
	await copyFile(schemaSource, schemaTarget);
	console.log(`Copied WBOL schema to ${schemaTarget}`);
}

await copyWbolSchema();
watch(schemaSourceDirectory, (_event, filename) => {
	if (filename?.toString() !== "wbol.xsd") return;
	if (schemaCopyTimer) clearTimeout(schemaCopyTimer);
	schemaCopyTimer = setTimeout(() => {
		schemaCopyTimer = undefined;
		void copyWbolSchema().catch((error) => console.error("WBOL schema copy failed:", error));
	}, 200);
});
console.log(`Watching ${schemaSource} for changes...`);

console.log("Development tasks started. Watching for changes...");
