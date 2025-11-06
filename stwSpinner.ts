// SPDX-License-Identifier: GPL-3.0-or-later
// Spin the Web module: stwSpinner.ts

import { getCookies } from "@std/http/cookie";
import { STWSession } from "./stwComponents/stwSession.ts";
import { STWSite } from "./stwElements/stwSite.ts";
import { handleHttp } from "./stwComponents/stwHttpHandler.ts";
import { handleWebSocket } from "./stwComponents/stwWebSocket.ts";
import project from "./deno.json" with { type: "json" };
import { STWFactory } from "./stwComponents/stwFactory.ts";
import { envGet, envSet, isDocker } from "./stwComponents/stwConfig.ts";
import { newId } from "./stwComponents/stwIds.ts";

// If a PORTAL_URL is provided (env or .env), fetch it and persist to WEBBASE path before the site loads.
try {
    const portalUrl = envGet("PORTAL_URL");
    if (portalUrl && /^https?:\/\//i.test(portalUrl)) {
        const webbasePath = envGet("WEBBASE") || "./.data/webbase.wbdl";
        console.log(`${new Date().toISOString()}: Fetching portal webbase from ${portalUrl} ...`);
        const res = await fetch(portalUrl);
        if (!res.ok) throw new Error(`Failed to download portal webbase: ${res.status} ${res.statusText}`);
        const json = await res.text(); // keep as text; it's stored and later parsed by STWSite
        // Ensure folder exists
        const dir = webbasePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/") || ".";
        await Deno.mkdir(dir, { recursive: true });
        await Deno.writeTextFile(webbasePath, json);
        console.log(`${new Date().toISOString()}: Portal webbase saved to ${webbasePath}.`);
        // Ensure STWSite reads the same path
        envSet("WEBBASE", webbasePath);
    }
} catch (error) {
    console.error(`PORTAL_URL setup error: ${(error as Error).message}`);
}

/**
 * Deterministically load element / content modules so that base abstractions
 * are evaluated before derived implementations. Modules self-register via
 * registerElement() side-effects. No dummy instantiation needed.
 */
async function loadSTWModules(dir: string, priority: string[] = []) {
	const files: string[] = [];
	for (const entry of Deno.readDirSync(dir)) {
		if (entry.isFile && entry.name.endsWith(".ts")) files.push(entry.name);
	}

	// Priority list first (if present), then the remaining alphabetically.
	const ordered = [
		...priority.filter((p) => files.includes(p)),
		...files.filter((f) => !priority.includes(f)).sort(),
	];

	for (const f of ordered) {
		await import(`${dir}/${f}`);
	}
}

// Load core element hierarchy in a safe order, then all contents.
await loadSTWModules("./stwElements", [
	"stwIndex.ts", // shared registry map (no deps)
	"stwElement.ts", // base
	"stwArea.ts", // derives from STWElement
	"stwSite.ts", // depends on Area for webbaselets
	"stwPage.ts", // page-level element
	"stwContent.ts", // abstract content base
]);
await loadSTWModules("./stwContents");

console.log(`${new Date().toISOString()}: Registered elements: ${Object.keys(STWFactory).length}`);

/**
 * Contains presently active sessions {@linkcode STWSession}
 */
const stwSessions: Map<string, STWSession> = new Map();

/**
 * Spin the Web Spinner
 */
// Declare the variable that will hold the final options.
let serverOptions: Deno.ServeOptions;

// Determine the correct hostname based on the environment.
// In Docker, always listen on 0.0.0.0. Locally, use the .env setting.
const hostname: string = isDocker ? "0.0.0.0" : (envGet("HOST") || "127.0.0.1");

if (envGet("CERTFILE") && envGet("KEYFILE")) {
    serverOptions = {
        hostname: hostname,
        port: parseInt(envGet("PORT") || "443"),
        cert: await Deno.readTextFile(envGet("CERTFILE")!),
        key: await Deno.readTextFile(envGet("KEYFILE")!),
        onListen: () => {
            console.log(
                `${new Date().toISOString()}: Spin the Web v${project.version} listening on https://${envGet("HOST") || "localhost"}:${envGet("PORT") || "443"}`,
            );
        },
    } as Deno.ServeOptions;
} else {
    serverOptions = {
        hostname: hostname,
        port: parseInt(envGet("PORT") || "8000"),
        onListen: () => {
            console.log(
                `${new Date().toISOString()}: Spin the Web v${project.version} listening on http://${envGet("HOST") || "localhost"}:${envGet("PORT") || "8000"}`,
            );
        },
    } as Deno.ServeOptions;
}

Deno.serve(serverOptions, async (request: Request, info: Deno.ServeHandlerInfo): Promise<Response> => {
	let sessionId: string = getCookies(request.headers).sessionId;
	if (!sessionId) {
		sessionId = newId();
	}

	let session = stwSessions.get(sessionId);

	if (
		!session ||
		(session.remoteAddr as Deno.NetAddr).hostname !== (info.remoteAddr as Deno.NetAddr).hostname
	) {
		if (session) {
			console.log(
				`${
					new Date().toISOString()
				}: IP address changed for session [${sessionId}]. A new session will be created.`,
			);
		}
		session = new STWSession(sessionId, info.remoteAddr, STWSite.instance);
		stwSessions.set(sessionId, session);
	}

	session.setPlaceholders(request);

	if (request.headers.get("upgrade") === "websocket") {
		return handleWebSocket(request, session, stwSessions);
	} else {
		return await handleHttp(request, session, sessionId);
	}
});
