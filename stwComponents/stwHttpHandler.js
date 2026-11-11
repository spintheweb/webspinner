import { getCookies, serveFile, setCookie } from "./stwNode.js";
import { STWPortal } from "../stwElements/stwPortal.js";
import { STWIndex } from "../stwElements/stwIndex.js";
import { STWContent } from "../stwElements/stwContent.js";
import { secureResponse } from "./stwResponse.js";
import { envGet } from "./stwConfig.js";
import { actionRouter } from "./stwActions.js";
import { handleWbolApi } from "./stwWBOLApi.js";
import { verifyAction } from "./stwActionToken.js";

async function handleHttp(request, session, sessionId) {
	const pathname = new URL(request.url).pathname;
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
			const res = await element.serve(request, session);
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
				const payload = verifyAction(token);
				if (token && (!payload || payload.action !== actionValue || !Array.isArray(payload.args))) {
					return secureResponse("Invalid action token", { status: 400 });
				}
				if (payload && actionMethod(payload.action) !== request.method) {
					return secureResponse("Action method does not match the button", { status: 405 });
				}
				const originId = payload?.origin || records.stwOrigin || "";
				if (payload?.origin && formData.get("stwOrigin")?.toString() !== payload.origin) {
					return secureResponse("Action origin does not match the button", { status: 400 });
				}
				const actionContent = STWIndex.get(originId);
				if (!(actionContent instanceof STWContent) || !(actionContent.isVisible(session, false) & 1)) {
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
					session.placeholders.set("ERROR", result.error.message);
				}
				if (result.data) {
					session.placeholders.set("RESULT", JSON.stringify(result.data));
				}
				if (result.redirect || payload) {
					const destination = new URL(result.redirect || redirect.href, request.url);
					if (destination.origin !== new URL(request.url).origin) {
						return secureResponse("Redirect must remain on this site", { status: 400 });
					}
					return Response.redirect(destination.href, 303);
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
function actionMethod(action) {
	switch (action) {
		case "stwsearch":
		case "stwfilter":
			return "GET";
		case "stwinsert":
			return "PUT";
		case "stwupdate":
			return "PATCH";
		case "stwdelete":
			return "DELETE";
		default:
			return "POST";
	}
}
export {
	handleHttp
};
