// SPDX-License-Identifier: GPL-3.0-or-later
// Spin the Web component: stwHttpHandler

import { serveFile } from "@std/http/file-server";
import { getCookies, setCookie } from "@std/http/cookie";
import { STWSite } from "../stwElements/stwSite.ts";
import { STWIndex } from "../stwElements/stwIndex.ts";
import { STWSession } from "./stwSession.ts";
import { STWContent } from "../stwElements/stwContent.ts";
import { ISTWRecords } from "./stwDBAdapters/adapter.ts";
import { secureResponse } from "./stwResponse.ts";
import { envGet } from "./stwConfig.ts";
import { actionRouter, ActionContext } from "./stwActions.ts";

export async function handleHttp(request: Request, session: STWSession, sessionId: string): Promise<Response> {
	const pathname = new URL(request.url).pathname;
	const element = STWSite.instance.find(session, pathname);

	let response: Response = secureResponse(null, { status: 204 }); // Default: 204 No content

	if (request.method === "GET") {
		if (!element && !pathname.includes("/."))
			response = await serveFile(request, `./public${pathname}`);
		else if (element?.type === "Page" || element?.type === "Area" || element?.type === "Site")
			response = await element.serve(request, session);
		else if (element?.type && session.sockets.size > 0) {
            const res = await element.serve(request, session);
            if (res.status === 200) {
                const text = await res.text();
					for (const ws of session.sockets.values()) {
					try { ws.send(text); } catch (_e) { /* noop */ }
				}
            }
        }

		// Set session cookie if not present
		if (!getCookies(request.headers).sessionId) {
			// IMPORTANT: clone the ORIGINAL RESPONSE headers (not request headers) so we retain Content-Type
			const headers = new Headers(response.headers);
			// Only mark cookie Secure when using HTTPS
			const isSecure = new URL(request.url).protocol === "https:";
			setCookie(headers, { name: "sessionId", value: sessionId, httpOnly: true, secure: isSecure, sameSite: "Lax" });
			// Preserve any existing custom 'contents' header
			headers.set("contents", response.headers.get("contents") || "");
			// Return a new response preserving status and headers so nosniff does not block rendering
			return secureResponse(response.body, { headers, status: response.status });
		}
		return response;

	} else if (request.method === "POST") {
        try {
            // Interpret MAX_UPLOADSIZE as MB
            const maxupload = parseInt(envGet("MAX_UPLOADSIZE") || "2") * 1024 * 1024;
			const formData = await request.formData();

			// Collect all values for each key
			const fieldMap: Record<string, any[]> = {};
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

			// Determine the number of rows (max array length)
			const numRows = Math.max(...Object.values(fieldMap).map(arr => arr.length), 1);

			// Build rows
			const rows: Record<string, any>[] = [];
			for (let i = 0; i < numRows; i++) {
				const row: Record<string, any> = {};
				for (const key in fieldMap) {
					row[key] = fieldMap[key].length === 1 ? fieldMap[key][0] : (fieldMap[key][i] ?? fieldMap[key][fieldMap[key].length - 1]);
				}
				rows.push(row);
			}

			// Remove the first row if present
			if (rows.length > 1) rows.shift();

			const fields = Object.keys(fieldMap)
				.filter(name => name !== "stwOrigin" && name !== "stwAction")
				.map(name => ({ name }));
			const stwOrigin = rows[0]?.stwOrigin;
			const stwAction = rows[0]?.stwAction;

			// Remove from each row
			for (const row of rows) {
				delete row.stwOrigin;
				delete row.stwAction;
			}

			const records: ISTWRecords = {
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
					for (const s of targets) { try { s.send(msg); } catch (_e) { /* ignore send errors */ } }
                } catch (error: any) {
                    const msg = JSON.stringify({ method: "PUT", section: "stwShowModal", body: `<label>Error</label><pre>${error.message}</pre>` });
                    const targets = Array.from(session.sockets.values());
                    for (const s of targets) { try { s.send(msg); } catch (_e) { /* ignore send errors */ } }
                }
            }

			// Handle form actions
			if (formData.has("stwAction")) {
				const actionValue = formData.get("stwAction")!.toString();
				
				const ctx: ActionContext = {
					req: request,
					session,
					content: origin as STWContent,
					formData,
					action: actionValue,
					url: formData.get("stwRedirect")?.toString(),
				};
				
				const result = await actionRouter.execute(ctx);
				
				if (result.redirect) {
					return Response.redirect(result.redirect, 303);
				}
				
				if (!result.ok && result.error) {
					// Handle error (show error page, flash message, etc.)
					session.placeholders.set("ERROR", result.error.message);
				}
				
				if (result.data) {
					// Store result data in session for next render
					session.placeholders.set("RESULT", JSON.stringify(result.data));
				}
			}

			// Always return a response
			return secureResponse(null, { status: 204 });
		} catch (_error) {
			return secureResponse("Error processing form data", { status: 400 });
		}
	}

	return response;
}