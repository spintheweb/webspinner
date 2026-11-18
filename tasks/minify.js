/**
 * @fileoverview Minifies the browser client script into `stwClient.min.js`.
 *
 * Uses esbuild to bundle/minify `./public/scripts/stwClient.js`.
 *
 * @author Giancarlo Trevisan
 * @version 1.0.0
 * @module tasks/minify
 * @note Copilot-assisted
 * @license Apache-2.0
 */
import { readFile, writeFile } from "node:fs/promises";
import { transform } from "esbuild";
const inputJs = await readFile("./public/scripts/stwClient.js", "utf8");
const result = await transform(inputJs, { minify: true, loader: "js" });
await writeFile("./public/scripts/stwClient.min.js", result.code);
console.log("Client-side JS minified successfully!");
