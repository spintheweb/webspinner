import { getCookies, serveFile, setCookie } from "./stwNode.js";
import { STWPortal } from "../stwElements/stwPortal.js";
import { STWIndex } from "../stwElements/stwIndex.js";
import { STWContent } from "../stwElements/stwContent.js";
import { secureResponse } from "./stwResponse.js";
import { envGet } from "./stwConfig.js";
import { actionRouter } from "./stwActions.js";
import { handleWbolApi } from "./stwWBOLApi.js";
async function handleHttp(request, session, sessionId) {
	const pathname = new URL(request.url).pathname;
	if (pathname === "/wbol" || pathname.startsWith("/wbol/")) {
		return await handleWbolApi(request, session);
	}
	const element = STWPortal.instance.find(session, pathname);
	let response = secureResponse(null, { status: 204 });
	if (request.method === "GET") {
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
	} else if (request.method === "POST") {
		try {
			const maxupload = parseInt(envGet("MAX_UPLOADSIZE") || "2") * 1024 * 1024;
			const formData = await request.formData();
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
			const fields = Object.keys(fieldMap).filter((name) => name !== "stwOrigin" && name !== "stwAction").map((name) => ({ name }));
			const stwOrigin = rows[0]?.stwOrigin;
			const stwAction = rows[0]?.stwAction;
			for (const row of rows) {
				delete row.stwOrigin;
				delete row.stwAction;
			}
			const records = {
				fields,
				rows,
				affectedRows: rows.length,
				stwOrigin,
				stwAction
			};
			const origin = STWIndex.get(records.stwOrigin || "");
			if (origin instanceof STWContent && origin?.isVisible(session, false)) {
				try {
					const _result = origin.getLayout(session).handleAction(stwAction);
					const msg = JSON.stringify({ method: "PUT", section: "stwShowModal", body: `<label>Form data ${stwAction}</label><pre>${JSON.stringify(records, null, 4)}</pre>` });
					const targets = Array.from(session.sockets.values());
					for (const s of targets) {
						try {
							s.send(msg);
						} catch (_e) {
						}
					}
				} catch (error) {
					const msg = JSON.stringify({ method: "PUT", section: "stwShowModal", body: `<label>Error</label><pre>${error.message}</pre>` });
					const targets = Array.from(session.sockets.values());
					for (const s of targets) {
						try {
							s.send(msg);
						} catch (_e) {
						}
					}
				}
			}
			if (formData.has("stwAction")) {
				const actionValue = formData.get("stwAction").toString();
				const ctx = {
					req: request,
					session,
					content: origin,
					formData,
					action: actionValue,
					url: formData.get("stwRedirect")?.toString()
				};
				const result = await actionRouter.execute(ctx);
				if (result.redirect) {
					return Response.redirect(result.redirect, 303);
				}
				if (!result.ok && result.error) {
					session.placeholders.set("ERROR", result.error.message);
				}
				if (result.data) {
					session.placeholders.set("RESULT", JSON.stringify(result.data));
				}
			}
			return secureResponse(null, { status: 204 });
		} catch (_error) {
			return secureResponse("Error processing form data", { status: 400 });
		}
	}
	return response;
}
export {
	handleHttp
};
