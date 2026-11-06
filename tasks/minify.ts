// SPDX-License-Identifier: GPL-3.0-or-later
// Build/development task: minify

import { readFile, writeFile } from "node:fs/promises";
import { transform } from "esbuild";

const inputJs = await readFile("./public/scripts/stwClient.js", "utf8");
const result = await transform(inputJs, { minify: true, loader: "js" });
await writeFile("./public/scripts/stwClient.min.js", result.code);

console.log("Client-side JS minified successfully!");
