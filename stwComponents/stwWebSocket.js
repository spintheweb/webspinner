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
 * @note Copilot-assisted
 * @license Apache-2.0
 */
import { STWPortal } from "../stwElements/stwPortal.js";
import { STWArea } from "../stwElements/stwArea.js";
import { STWPage } from "../stwElements/stwPage.js";
import { newId } from "./stwIds.js";
import { debugLog } from "./stwConfig.js";
import { PlaceholderMap } from "./stwWBPL.js";
import { WebSocket } from "ws";
import { registerStudioConnection } from "./stwStudioEvents.js";
import { negotiateLanguage } from "./stwLocalization.js";

const SESSION_CLEANUP_GRACE_PERIOD_MS = 3e4;

function handleWebSocket(request, socket, session, stwSessions) {
	const url = new URL(request.url);
	const tabId = url.searchParams.get("tab") || newId();
	const prev = session.sockets.get(tabId);
	session.sockets.set(tabId, socket);
	const unregisterStudioConnection = registerStudioConnection(socket, session);

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
		const requestSession = data.method === "HEAD"
			? session
			: Object.assign(Object.create(Object.getPrototypeOf(session)), session);
		if (requestSession !== session) requestSession.placeholders = new PlaceholderMap(session.placeholders);
		requestSession.setPlaceholders(syntheticRequest);
		if (data.method === "HEAD") {
			const preferred = Array.isArray(data.options.langs) && data.options.langs.length
				? data.options.langs
				: data.options.lang ? [data.options.lang] : [];
			session.langs = preferred.length ? preferred : ["en"];
			if (!session.languageExplicit) {
				const language = negotiateLanguage(session.portal.langs, preferred, session.placeholders.get("@@stwdefaultlanguage"));
				session.setLanguage(language, false);
			}
			session.tz = data.options.tz || "UTC";
		}
		let resourcesToProcess = [];
		let element = STWPortal.instance.find(requestSession, data.resource);
		if (element instanceof STWArea) {
			if (!(element.isVisible(requestSession) & 1)) {
				socket.send(JSON.stringify({ method: "REDIRECT", url: "/" }));
				return;
			}
			element = STWPortal.index.get(element.mainpage);
		}
		if (element instanceof STWPage && !(element.isVisible(requestSession) & 1)) {
			socket.send(JSON.stringify({ method: "REDIRECT", url: "/" }));
			return;
		}
		if (data.method === "PATCH") {
			if (element instanceof STWPage) {
				resourcesToProcess = element.contents(requestSession, typeof data.options.recurse == "undefined" ? true : data.options.recurse) || [];
			} else if (element) {
				resourcesToProcess = [data.resource];
			}
		} else if (data.method === "HEAD") {
			socket.send(JSON.stringify({
				method: "AUTH",
				canStudio: session.roles.some((role) => ["leaddeveloper", "developer", "seo"].includes(role))
			}));
			resourcesToProcess = element instanceof STWPage ? element.contents(session) : [];
		}
		if (resourcesToProcess.length === 0) {
			if (typeof data.options?.studioBlockToken === "string")
				socket.send(JSON.stringify({ method: "STW_EDITOR_ERROR", studioBlockToken: data.options.studioBlockToken }));
			return;
		}
		const finalData = [];
		for (const resource of resourcesToProcess) {
			const found = STWPortal.instance.find(requestSession, resource);
			if (!found) {
				finalData.push({ method: "DELETE", id: resource });
			} else {
				const content = found;
				try {
					const response = await content.serve(
						syntheticRequest,
						requestSession,
						data.method === "PATCH" && data.options.sections?.includes(content.section) ? content : void 0
					);
					if (response.status === 200) {
						const result = await response.json();
						finalData.push(result);
					} else {
						finalData.push({ method: "DELETE", id: content.uuid });
					}
				} catch (error) {
					const result = await (await content.errorResponse(error, requestSession)).json();
					finalData.push(result);
				}
			}
		}
		send(finalData, data.options);
		function send(payload, options) {
			payload.sort((a, b) => {
				if (a.section === b.section) {
					return a.sequence < b.sequence ? -1 : 1;
				}
				return 0;
			});
			payload.forEach((content) => {
				content.placeholder = options.placeholder;
				if (typeof options.studioBlockToken === "string")
					content.studioBlockToken = options.studioBlockToken;
				socket.send(JSON.stringify(content));
			});
		}
	});
	socket.on("error", (error) => {
		console.error(error);
	});
	socket.on("close", () => {
		unregisterStudioConnection();
		if (session.sockets.get(tabId) === socket) {
			session.sockets.delete(tabId);
			setTimeout(() => {
				if (session.sockets.size === 0) {
					stwSessions.delete(session.sessionId);
					debugLog(`${(new Date()).toISOString()}: Session timed out and removed: [${session.sessionId}]`);
				}
			}, SESSION_CLEANUP_GRACE_PERIOD_MS);
		}
	});
}
export {
	handleWebSocket
};
