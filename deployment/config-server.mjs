import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const port = Number(process.env.PORT || 8080);
const body = await readFile("/app/.config-needed.html");

createServer((_request, response) => {
	response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
	response.end(body);
}).listen(port, process.env.HOST || "0.0.0.0");
