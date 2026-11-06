// SPDX-License-Identifier: GPL-3.0-or-later
// Build/development task: merge-css
import { readdir, readFile, writeFile } from "node:fs/promises";
import { watch } from "node:fs";
// Watches stwStyles, merges and minifies all .css files into stwStyle.css on change
// Usage: node tasks/merge-css.js
const folder = "./stwStyles";
const output = "./public/styles/stwStyle.css";
function minifyCSS(css) {
		return css
				.replace(/\/\*[\s\S]*?\*\//g, "") // Remove comments
				.replace(/\s{2,}/g, " ") // Collapse whitespace
				.replace(/\s*([{}:;,])\s*/g, "$1") // Remove space around symbols
				.replace(/;}/g, "}"); // Remove unnecessary semicolons
}
async function mergeAndMinify() {
		const files = (await readdir(folder, { withFileTypes: true }))
				.filter(f => f.isFile() && f.name.endsWith(".css") && f.name !== "stwStyle.css")
				.map(f => `${folder}/${f.name}`);
		let merged = "";
		for (const file of files) {
				merged += await readFile(file, "utf8") + "\n";
		}
		const minified = minifyCSS(merged);
		await writeFile(output, minified);
		console.log(`[${new Date().toLocaleTimeString()}] Merged & minified ${files.length} CSS files into ${output}`);
}
await mergeAndMinify();
const watcher = watch(folder, (_event, filename) => {
		if (!filename || !filename.toString().endsWith(".css") || filename.toString() === "stwStyle.css")
				return;
		if (debounceTimer)
				clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
				void mergeAndMinify().catch(error => console.error("CSS merge failed:", error));
				debounceTimer = undefined;
		}, 200);
});
console.log(`Watching ${folder} for CSS changes...`);
let debounceTimer;
