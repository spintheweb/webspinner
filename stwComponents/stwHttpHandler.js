/**
 * @fileoverview Handles incoming HTTP requests for the Webspinner runtime.
 *
 * Routes WBOL API requests, static files, portal elements, and signed server
 * actions, enforcing session state and RBV visibility rules.
 *
 * @author Giancarlo Trevisan
 * @version 1.0.0
 * @module stwHttpHandler
 * @note Copilot-assisted
 * @license Apache-2.0
 */
import { getCookies, serveFile, setCookie } from "./stwNode.js";
import { STWPortal } from "../stwElements/stwPortal.js";
import { STWIndex } from "../stwElements/stwIndex.js";
import { STWContent } from "../stwElements/stwContent.js";
import { secureResponse } from "./stwResponse.js";
import { envGet } from "./stwConfig.js";
import { actionRouter } from "./stwActions.js";
import { handleWbolApi } from "./stwWBOLApi.js";
import { verifyAction } from "./stwActionToken.js";

async function handleHttp(request, session, sessionId, rotateSession) {
	const pathname = new URL(request.url).pathname;

	const languageMatch = pathname.match(/^\/stw\/language\/([A-Za-z0-9_-]+)$/);
	if (languageMatch) {
		const language = languageMatch[1];
		const supported = STWPortal.instance.langs.includes(language);
		const defaultLanguage = session.placeholders.get("@@stwdefaultlanguage") || "en";
		const referer = request.headers.get("referer");
		let destination = "/";
		let url, page;
		if (referer && URL.canParse(referer)) {
			url = new URL(referer);
			if (url.origin === new URL(request.url).origin) {
				destination = url.href;
				if (url.pathname !== "/") page = STWPortal.instance.find(session, url.pathname);
			}
		}
		session.setLanguage(supported ? language : defaultLanguage, true);
		if (page && ["Page", "Area"].includes(page.type)) {
			url.pathname = page.pathname(session);
			destination = url.href;
		}
		return secureResponse(null, {
			status: 303,
			headers: { Location: destination }
		});
	}

	if (pathname === "/wbol" || pathname.startsWith("/wbol/")) {
		return await handleWbolApi(request, session);
	}
	const element = STWPortal.instance.find(session, pathname);
	let response = secureResponse(null, { status: 204 });
	if (request.method === "GET" && !new URL(request.url).searchParams.has("stwActionToken")) {
		if (!element && !pathname.includes("/."))
			response = await serveFile(request, `./public${pathname}`);
		else if (element?.type === "Page" || element?.type === "Area" || element?.type === "Portal")
			response = await element.serve(request, session);
		else if (element?.type && session.sockets.size > 0) {
			let res;
			try {
				res = await element.serve(request, session);
			} catch (error) {
				res = await element.errorResponse(error, session);
			}
			if (res.status === 200) {
				const text = await res.text();
				for (const ws of session.sockets.values()) {
					try {
						ws.send(text);
					} catch (_e) {
					}
				}
			}
		}
		if (!getCookies(request.headers).sessionId) {
			const headers = new Headers(response.headers);
			const isSecure = new URL(request.url).protocol === "https:";
			setCookie(headers, { name: "sessionId", value: sessionId, httpOnly: true, secure: isSecure, sameSite: "Lax" });
			headers.set("contents", response.headers.get("contents") || "");
			return secureResponse(response.body, { headers, status: response.status });
		}
		return response;
	} else if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) || request.method === "GET" && new URL(request.url).searchParams.has("stwActionToken")) {
		try {
			const maxupload = parseInt(envGet("MAX_UPLOADSIZE") || "2") * 1024 * 1024;
			const formData = request.method === "GET"
				? new FormData()
				: await request.formData();
			if (request.method === "GET") {
				new URL(request.url).searchParams.forEach((value, key) => formData.append(key, value));
			}
			const fieldMap = {};
			for (const [key, value] of formData.entries()) {
				if (!fieldMap[key]) fieldMap[key] = [];
				if (value instanceof File) {
					fieldMap[key].push({
						name: value.name,
						type: value.type,
						size: value.size,
						content: value.size < maxupload ? await value.text() : null
					});
				} else {
					fieldMap[key].push(value);
				}
			}
			const numRows = Math.max(...Object.values(fieldMap).map((arr) => arr.length), 1);
			const rows = [];
			for (let i = 0; i < numRows; i++) {
				const row = {};
				for (const key in fieldMap) {
					row[key] = fieldMap[key].length === 1 ? fieldMap[key][0] : fieldMap[key][i] ?? fieldMap[key][fieldMap[key].length - 1];
				}
				rows.push(row);
			}
			if (rows.length > 1) rows.shift();
			const fields = Object.keys(fieldMap).filter((name) => !name.startsWith("stw")).map((name) => ({ name }));
			const stwOrigin = rows[0]?.stwOrigin;
			const stwAction = rows[0]?.stwAction;
			for (const row of rows)
				for (const name of Object.keys(row))
					if (name.startsWith("stw")) delete row[name];
			const records = {
				fields,
				rows,
				affectedRows: rows.length,
				stwOrigin,
				stwAction
			};
			if (formData.has("stwAction")) {
				const actionValue = formData.get("stwAction").toString();
				const token = formData.get("stwActionToken")?.toString();
				const payload = verifyAction(token, sessionId);
				if (!payload || payload.action !== actionValue || !Array.isArray(payload.args)) {
					return secureResponse("Invalid action token", { status: 400 });
				}
				const method = payload.action === "stwsearch" || payload.action === "stwfilter" ? "GET" :
					payload.action === "stwinsert" ? "PUT" :
						payload.action === "stwupdate" ? "PATCH" :
							payload.action === "stwdelete" ? "DELETE" : "POST";
				if (method !== request.method) {
					return secureResponse("Action method does not match the button", { status: 405 });
				}
				const originId = payload?.origin || records.stwOrigin || "";
				if (payload?.origin && formData.get("stwOrigin")?.toString() !== payload.origin) {
					return secureResponse("Action origin does not match the button", { status: 400 });
				}
				const actionContent = STWIndex.get(originId);
				if (!(actionContent instanceof STWContent) || !(actionContent.isVisible(session) & 1)) {
					return secureResponse("Action content is unavailable", { status: 403 });
				}
				const redirect = new URL(
					formData.get("stwRedirect")?.toString() || payload?.redirect || request.url,
					request.url
				);
				if (redirect.origin !== new URL(request.url).origin) {
					return secureResponse("Redirect must remain on this site", { status: 400 });
				}
				const ctx = {
					req: request,
					session,
					content: actionContent,
					formData,
					action: payload?.action || actionValue,
					args: payload?.args || [],
					url: redirect.href
				};
				const result = await actionRouter.execute(ctx);
				if (!result.ok && result.error) {
					session.placeholders.set("error", result.error.message);
					if (["stwinsert", "stwupdate", "stwdelete"].includes(ctx.action) ||
						ctx.action === "stwsubmit" && ctx.args?.length > 0) {
						console.error(`Action ${ctx.action} failed:`, result.error.message);
						return secureResponse(result.error.message, { status: 400 });
					}
				}
				if (result.data) {
					session.placeholders.set("result", JSON.stringify(result.data));
				}
				let replacementSession;
				if (result.rotateSession) {
					if (typeof rotateSession !== "function") throw new TypeError("Session rotation is unavailable");
					replacementSession = rotateSession(session, result.preserveIdentity);
				}
				if (result.redirect || payload) {
					const destination = new URL(result.redirect || redirect.href, request.url);
					if (destination.origin !== new URL(request.url).origin) {
						return secureResponse("Redirect must remain on this site", { status: 400 });
					}
					const headers = new Headers({ Location: destination.href });
					if (replacementSession) {
						const isSecure = new URL(request.url).protocol === "https:";
						setCookie(headers, {
							name: "sessionId",
							value: replacementSession.sessionId,
							httpOnly: true,
							secure: isSecure,
							sameSite: "Lax"
						});
					}
					return new Response(null, { status: 303, headers });
				}
			}
			return secureResponse(null, { status: 204 });
		} catch (error) {
			console.error("Error processing form action:", error);
			return secureResponse("Error processing form data", { status: 400 });
		}
	}
	return response;
}
export {
	handleHttp
};
