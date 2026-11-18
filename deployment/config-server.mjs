/**
 * @fileoverview Fallback HTTP server displayed when container configuration is missing.
 *
 * Serves `/app/.config-needed.html` on the configured `PORT` and `HOST` when
 * Webspinner has not yet been configured in a Docker deployment.
 *
 * @author Giancarlo Trevisan
 * @version 1.0.0
 * @module deployment/config-server
 * @note Copilot-assisted
 * @license Apache-2.0
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const port = Number(process.env.PORT || 8080);
const body = await readFile("/app/.config-needed.html");

createServer((_request, response) => {
	response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
	response.end(body);
}).listen(port, process.env.HOST || "0.0.0.0");
