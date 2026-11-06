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

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";
import { getCookies } from "./stwComponents/stwNode.ts";
import { STWSession } from "./stwComponents/stwSession.ts";
import { STWPortal } from "./stwElements/stwPortal.ts";
import { handleHttp } from "./stwComponents/stwHttpHandler.ts";
import { handleWebSocket } from "./stwComponents/stwWebSocket.ts";
import project from "./package.json" with { type: "json" };
import { envGet, envSet, isDocker } from "./stwComponents/stwConfig.ts";
import { newId } from "./stwComponents/stwIds.ts";

const moduleRoot = dirname(fileURLToPath(import.meta.url));

// If a PORTAL_URL is provided (env or .env), fetch it and persist to WEBBASE path before the portal loads.
try {
	const portalUrl = envGet("PORTAL_URL");
	if (portalUrl && /^https?:\/\//i.test(portalUrl)) {
		const webbasePath = envGet("WEBBASE") || "./.data/webbase.wbol";
		console.log(`${new Date().toISOString()}: Fetching portal webbase from ${portalUrl} ...`);
		const res = await fetch(portalUrl);
		if (!res.ok) throw new Error(`Failed to download portal webbase: ${res.status} ${res.statusText}`);
		const json = await res.text(); // keep as text; it's stored and later parsed by STWPortal
		// Ensure folder exists
		const dir = webbasePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/") || ".";
		mkdirSync(dir, { recursive: true });
		writeFileSync(webbasePath, json);
		console.log(`${new Date().toISOString()}: Portal webbase saved to ${webbasePath}.`);
		// Ensure STWPortal reads the same path
		envSet("WEBBASE", webbasePath);
	}
} catch (error) {
	console.error(`PORTAL_URL setup error: ${(error as Error).message}`);
}

/**
 * Load element / content modules so that base abstractions
 * are evaluated before derived implementations. Modules self-register via
 * registerElement() side-effects.
 */
async function loadSTWModules(dir: string, priority: string[] = []) {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isFile() && entry.name.endsWith(".ts")) files.push(entry.name);
	}

	// Priority list first (if present), then the remaining alphabetically.
	const ordered = [
		...priority.filter((p) => files.includes(p)),
		...files.filter((f) => !priority.includes(f)).sort(),
	];

	for (const f of ordered) {
		await import(pathToFileURL(resolve(dir, f)).href);
	}
}

// Load core element hierarchy in a safe order.
await loadSTWModules(resolve(moduleRoot, "stwElements"), [
	"stwIndex.ts", // shared registry map (no deps)
	"stwElement.ts", // base
	"stwArea.ts", // derives from STWElement
	"stwPortal.ts", // depends on Area for webbaselets
	"stwPage.ts", // page-level element
	"stwContent.ts", // abstract content base
]);
await loadSTWModules(resolve(moduleRoot, "stwContents"));

// console.log(`${new Date().toISOString()}: Registered elements: ${Object.keys(STWFactory).length}`);

/**
 * Contains presently active sessions {@linkcode STWSession}
 */
/**
 * Spin the Web Spinner
 */
// Determine the correct hostname based on the environment.
// In Docker, always listen on 0.0.0.0. Locally, use the .env setting.
const hostname: string = isDocker ? "0.0.0.0" : (envGet("HOST") || "127.0.0.1");
const port = Number.parseInt(envGet("PORT") || (envGet("CERTFILE") && envGet("KEYFILE") ? "443" : "8000"), 10);
const secure = Boolean(envGet("CERTFILE") && envGet("KEYFILE"));
const server = secure
	? createHttpsServer({
		cert: readFileSync(envGet("CERTFILE")!),
		key: readFileSync(envGet("KEYFILE")!),
	})
	: createHttpServer();
const websocketServer = new WebSocketServer({ noServer: true });
const stwSessions: Map<string, STWSession> = new Map();

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
		websocketServer.handleUpgrade(incoming, socket, head, webSocket => {
			handleWebSocket(request, webSocket, session, stwSessions);
		});
	} catch (error) {
		console.error("WebSocket upgrade failed:", error);
		socket.destroy();
	}
});

server.listen(port, hostname, () => {
	console.log(
		`${new Date().toISOString()}: Spin the Web v${project.version} listening on ${secure ? "https" : "http"}://${envGet("HOST") || "localhost"}:${port}`,
	);
});

async function dispatchHttp(incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> {
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
	Readable.fromWeb(response.body as import("node:stream/web").ReadableStream).pipe(outgoing);
}

function getSession(
	request: Request,
	incoming: IncomingMessage,
	sessionId = getCookies(request.headers).sessionId || newId(),
): STWSession {
	const remoteAddr = {
		hostname: incoming.socket.remoteAddress || "",
		port: incoming.socket.remotePort || 0,
	};
	let session = stwSessions.get(sessionId);

	if (
		!session ||
		session.remoteAddr.hostname !== remoteAddr.hostname
	) {
		if (session) {
			console.log(
				`${new Date().toISOString()
				}: IP address changed for session [${sessionId}]. A new session will be created.`,
			);
		}
		session = new STWSession(sessionId, remoteAddr, STWPortal.instance);
		stwSessions.set(sessionId, session);
	}

	return session;
}

async function toRequest(incoming: IncomingMessage): Promise<Request> {
	const headers = new Headers();
	for (const [name, value] of Object.entries(incoming.headers)) {
		if (Array.isArray(value)) value.forEach(item => headers.append(name, item));
		else if (value !== undefined) headers.set(name, value);
	}
	const host = headers.get("host") || "localhost";
	const protocol = secure ? "https" : "http";
	const url = new URL(incoming.url || "/", `${protocol}://${host}`);
	const method = incoming.method || "GET";
	const body = method === "GET" || method === "HEAD" ? undefined : Readable.toWeb(incoming) as ReadableStream;
	return new Request(url, { method, headers, body, ...(body ? { duplex: "half" } : {}) } as RequestInit);
}

function responseHeaders(response: Response): Record<string, string | string[]> {
	const headers: Record<string, string | string[]> = {};
	response.headers.forEach((value, name) => {
		if (name.toLowerCase() !== "set-cookie") headers[name] = value;
	});
	const cookies = response.headers.getSetCookie();
	if (cookies.length) headers["set-cookie"] = cookies;
	return headers;
}
