// SPDX-License-Identifier: GPL-3.0-or-later
// Build/development task: minify

import * as esbuild from "https://deno.land/x/esbuild@v0.21.5/mod.js";

const inputJs = await Deno.readTextFile("./public/scripts/stwClient.js");
const result = await esbuild.transform(inputJs, { minify: true, loader: "js" });
await Deno.writeTextFile("./public/scripts/stwClient.min.js", result.code);
esbuild.stop();

console.log("Client-side JS minified successfully!");
