/**
 * @fileoverview Handles Spin the Web WebSocket connections.
 *
 * Upgrades requests, tracks one socket per session tab, processes page and
 * content refresh messages, sends serialized content updates, and removes
 * sessions after their final socket closes and the grace period expires.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwWebSocket
 * @requires ../stwElements/stwPortal.js
 * @requires ../stwElements/stwPage.js
 * @requires ../stwElements/stwContent.js
 * @requires ./stwSession.js
 * @requires ./stwIds.js
 * @license GPL-3.0-or-later
 */
import { STWPortal } from "../stwElements/stwPortal.js";
import { STWPage } from "../stwElements/stwPage.js";
import { newId } from "./stwIds.js";
import { WebSocket } from "ws";
const SESSION_CLEANUP_GRACE_PERIOD_MS = 3e4;

function handleWebSocket(request, socket, session, stwSessions) {
	const url = new URL(request.url);
	const tabId = url.searchParams.get("tab") || newId();
	const prev = session.sockets.get(tabId);
	session.sockets.set(tabId, socket);
	if (prev && prev !== socket && prev.readyState === WebSocket.OPEN) {
		try {
			prev.close(1e3, "superseded");
		} catch {
		}
	}
	socket.on("message", async (message) => {
		const data = JSON.parse(message.toString());
		const url2 = new URL(data.resource, request.url);
		for (const [key, value] of new URLSearchParams(data.search)) {
			url2.searchParams.set(key, value);
		}
		const syntheticRequest = new Request(url2, { headers: request.headers });
		session.setPlaceholders(syntheticRequest);
		let resourcesToProcess = [];
		if (data.method === "PATCH") {
			const element = STWPortal.instance.find(session, data.resource);
			if (element instanceof STWPage) {
				resourcesToProcess = element.contents(session, typeof data.options.recurse == "undefined" ? true : data.options.recurse) || [];
			} else if (element) {
				resourcesToProcess = [data.resource];
			}
		} else if (data.method === "HEAD") {
			session.langs = data.options.langs || ["en"];
			session.lang = STWPortal.instance.langs.includes(data.options.lang) ? data.options.lang : session.langs.find((lang) => STWPortal.instance.langs.includes(lang.substring(0, 2)))?.substring(0, 2) || "en";
			session.tz = data.options.tz || "UTC";
			resourcesToProcess = STWPortal.instance.find(session, data.resource)?.contents(session) || [];
		}
		if (resourcesToProcess.length === 0) return;
		const finalData = [];
		let processCount = resourcesToProcess.length;
		for (const resource of resourcesToProcess) {
			const found = STWPortal.instance.find(session, resource);
			if (!found) {
				finalData.push({ method: "DELETE", id: resource });
			} else {
				const content = found;
				const response = await content.serve(
					syntheticRequest,
					session,
					data.method === "PATCH" && data.options.sections?.includes(content.section) ? content : void 0
				);
				if (response.status === 200) {
					finalData.push(await response.json());
				} else {
					finalData.push({ method: "DELETE", id: content.uuid });
				}
			}
			if (!--processCount) {
				send(finalData, data.options);
			}
		}
		function send(payload, options) {
			payload.sort((a, b) => {
				if (a.section === b.section) {
					return a.sequence < b.sequence ? -1 : 1;
				}
				return 0;
			});
			payload.forEach((content) => {
				content.placeholder = options.placeholder;
				socket.send(JSON.stringify(content));
			});
		}
	});
	socket.on("error", (error) => {
		console.error(error);
	});
	socket.on("close", () => {
		if (session.sockets.get(tabId) === socket) {
			session.sockets.delete(tabId);
			setTimeout(() => {
				if (session.sockets.size === 0) {
					stwSessions.delete(session.sessionId);
					console.log(`${(new Date()).toISOString()}: Session timed out and removed: [${session.sessionId}]`);
				}
			}, SESSION_CLEANUP_GRACE_PERIOD_MS);
		}
	});
}
export {
	handleWebSocket
};
