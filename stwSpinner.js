/**
 * @fileoverview Starts the Spin the Web HTTP/WebSocket server.
 *
 * Boots the application runtime by loading registered content and element
 * modules, initializing the shared portal and session environment, and serving
 * requests while maintaining per-client session state.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwSpinner
 * @license GPL-3.0-or-later
 */
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";
import { getCookies } from "./stwComponents/stwNode.js";
import { STWSession } from "./stwComponents/stwSession.js";
import { STWPortal } from "./stwElements/stwPortal.js";
import { handleHttp } from "./stwComponents/stwHttpHandler.js";
import { handleWebSocket } from "./stwComponents/stwWebSocket.js";
const project = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
import { envGet, envSet, isDocker } from "./stwComponents/stwConfig.js";
import { newId } from "./stwComponents/stwIds.js";
const moduleRoot = dirname(fileURLToPath(import.meta.url));
try {
	const portalUrl = envGet("PORTAL_URL");
	if (portalUrl && /^https?:\/\//i.test(portalUrl)) {
		const webbasePath = envGet("WEBBASE") || "./.data/webbase.wbol";
		console.log(`${(/* @__PURE__ */ new Date()).toISOString()}: Fetching portal webbase from ${portalUrl} ...`);
		const res = await fetch(portalUrl);
		if (!res.ok) throw new Error(`Failed to download portal webbase: ${res.status} ${res.statusText}`);
		const json = await res.text();
		const dir = webbasePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/") || ".";
		mkdirSync(dir, { recursive: true });
		writeFileSync(webbasePath, json);
		console.log(`${(/* @__PURE__ */ new Date()).toISOString()}: Portal webbase saved to ${webbasePath}.`);
		envSet("WEBBASE", webbasePath);
	}
} catch (error) {
	console.error(`PORTAL_URL setup error: ${error.message}`);
}
async function loadSTWModules(dir, priority = []) {
	const files = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isFile() && entry.name.endsWith(".js")) files.push(entry.name);
	}
	const ordered = [
		...priority.filter((p) => files.includes(p)),
		...files.filter((f) => !priority.includes(f)).sort()
	];
	for (const f of ordered) {
		await import(pathToFileURL(resolve(dir, f)).href);
	}
}
await loadSTWModules(resolve(moduleRoot, "stwElements"), [
	"stwIndex.js",
	// shared registry map (no deps)
	"stwElement.js",
	// base
	"stwArea.js",
	// derives from STWElement
	"stwPortal.js",
	// depends on Area for webbaselets
	"stwPage.js",
	// page-level element
	"stwContent.js"
	// abstract content base
]);
await loadSTWModules(resolve(moduleRoot, "stwContents"));
const hostname = isDocker ? "0.0.0.0" : envGet("HOST") || "127.0.0.1";
const port = Number.parseInt(envGet("PORT") || (envGet("CERTFILE") && envGet("KEYFILE") ? "443" : "8000"), 10);
const secure = Boolean(envGet("CERTFILE") && envGet("KEYFILE"));
const server = secure ? createHttpsServer({
	cert: readFileSync(envGet("CERTFILE")),
	key: readFileSync(envGet("KEYFILE"))
}) : createHttpServer();
const websocketServer = new WebSocketServer({ noServer: true });
const stwSessions = /* @__PURE__ */ new Map();
server.on("request", async (incoming, outgoing) => {
	try {
		await dispatchHttp(incoming, outgoing);
	} catch (error) {
		console.error("Unhandled request error:", error);
		if (!outgoing.headersSent) outgoing.writeHead(500);
		outgoing.end("Internal Server Error");
	}
});
server.on("upgrade", async (incoming, socket, head) => {
	try {
		const request = await toRequest(incoming);
		const session = getSession(request, incoming);
		session.setPlaceholders(request);
		websocketServer.handleUpgrade(incoming, socket, head, (webSocket) => {
			handleWebSocket(request, webSocket, session, stwSessions);
		});
	} catch (error) {
		console.error("WebSocket upgrade failed:", error);
		socket.destroy();
	}
});
server.listen(port, hostname, () => {
	console.log(
		`${(/* @__PURE__ */ new Date()).toISOString()}: Spin the Web v${project.version} listening on ${secure ? "https" : "http"}://${envGet("HOST") || "localhost"}:${port}`
	);
});
async function dispatchHttp(incoming, outgoing) {
	const request = await toRequest(incoming);
	const sessionId = getCookies(request.headers).sessionId || newId();
	const session = getSession(request, incoming, sessionId);
	session.setPlaceholders(request);
	const response = await handleHttp(request, session, sessionId);
	outgoing.writeHead(response.status, response.statusText, responseHeaders(response));
	if (request.method === "HEAD" || !response.body) {
		outgoing.end();
		return;
	}
	Readable.fromWeb(response.body).pipe(outgoing);
}
function getSession(request, incoming, sessionId = getCookies(request.headers).sessionId || newId()) {
	const remoteAddr = {
		hostname: incoming.socket.remoteAddress || "",
		port: incoming.socket.remotePort || 0
	};
	let session = stwSessions.get(sessionId);
	if (!session || session.remoteAddr.hostname !== remoteAddr.hostname) {
		if (session) {
			console.log(
				`${(/* @__PURE__ */ new Date()).toISOString()}: IP address changed for session [${sessionId}]. A new session will be created.`
			);
		}
		session = new STWSession(sessionId, remoteAddr, STWPortal.instance);
		stwSessions.set(sessionId, session);
	}
	return session;
}
async function toRequest(incoming) {
	const headers = new Headers();
	for (const [name, value] of Object.entries(incoming.headers)) {
		if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
		else if (value !== void 0) headers.set(name, value);
	}
	const host = headers.get("host") || "localhost";
	const protocol = secure ? "https" : "http";
	const url = new URL(incoming.url || "/", `${protocol}://${host}`);
	const method = incoming.method || "GET";
	const body = method === "GET" || method === "HEAD" ? void 0 : Readable.toWeb(incoming);
	return new Request(url, { method, headers, body, ...body ? { duplex: "half" } : {} });
}
function responseHeaders(response) {
	const headers = {};
	response.headers.forEach((value, name) => {
		if (name.toLowerCase() !== "set-cookie") headers[name] = value;
	});
	const cookies = response.headers.getSetCookie();
	if (cookies.length) headers["set-cookie"] = cookies;
	return headers;
}
