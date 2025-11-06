// SPDX-License-Identifier: GPL-3.0-or-later
// Build/development task: merge-css

// Watches stwStyles, merges and minifies all .css files into stwStyle.css on change
// Usage: deno run --allow-read --allow-write tasks/merge-css.ts

const folder = "./stwStyles";
const output = "./public/styles/stwStyle.css";

function minifyCSS(css: string): string {
	return css
		.replace(/\/\*[\s\S]*?\*\//g, "") // Remove comments
		.replace(/\s{2,}/g, " ")          // Collapse whitespace
		.replace(/\s*([{}:;,])\s*/g, "$1")// Remove space around symbols
		.replace(/;}/g, "}");             // Remove unnecessary semicolons
}

async function mergeAndMinify() {
	const files = Array.from(Deno.readDirSync(folder))
		.filter(f => f.isFile && f.name.endsWith(".css") && f.name !== "stwStyle.css")
		.map(f => `${folder}/${f.name}`);

	let merged = "";
	for (const file of files) {
		merged += await Deno.readTextFile(file) + "\n";
	}

	const minified = minifyCSS(merged);
	await Deno.writeTextFile(output, minified);
	console.log(`[${new Date().toLocaleTimeString()}] Merged & minified ${files.length} CSS files into ${output}`);
}

await mergeAndMinify();

const watcher = Deno.watchFs(folder);
console.log(`Watching ${folder} for CSS changes...`);
let debounceTimer: number | undefined;

for await (const event of watcher) {
    if (event.paths.some(p => p.endsWith(".css") && !p.endsWith("stwStyle.css"))) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            mergeAndMinify();
            debounceTimer = undefined;
        }, 200); // 200ms debounce window
    }
}