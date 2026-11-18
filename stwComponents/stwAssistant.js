import { randomUUID } from "node:crypto";
import { envGet } from "./stwConfig.js";
import { secureResponse } from "./stwResponse.js";
import { handleWbolApi } from "./stwWBOLApi.js";
import { STWIndex } from "../stwElements/stwIndex.js";
import { applyPersistentChanges, AssistantConflictError, captureRevision, validateChanges } from "./stwAssistantPersistence.js";

const proposalKey = "stwAssistantProposal";

function json(data, status = 200) {
	return secureResponse(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

async function handleAssistant(request, session, fetchImpl = fetch) {
	if (!session.roles.includes("developer")) return json({ error: "Developer access required" }, 403);
	if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
	if (request.headers.get("origin") !== new URL(request.url).origin ||
		!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
		return json({ error: "Same-origin JSON requests are required" }, 403);
	}
	const token = envGet("STW_ASSISTANT_TOKEN");
	if (!token || token.length < 32) return json({ error: "STW_ASSISTANT_TOKEN is not configured" }, 503);
	const port = Number(envGet("STW_ASSISTANT_PORT") || 11435);
	if (!Number.isInteger(port) || port < 1 || port > 65535) return json({ error: "Invalid assistant port" }, 503);
	try {
		const text = await request.text();
		if (Buffer.byteLength(text) > 65536) return json({ error: "Request too large" }, 413);
		const body = JSON.parse(text);
		if (!body || typeof body !== "object" || Array.isArray(body)) throw new TypeError("Expected an object");
		const path = new URL(request.url).pathname;
		if (path === "/studio-assistant/apply") {
			const proposal = session.states.get(proposalKey);
			if (!proposal || body.id !== proposal.id || Date.now() > proposal.expires) return json({ error: "Proposal expired or not found" }, 409);
			const element = STWIndex.get(proposal.uuid);
			if (!element || !(element.isVisible(session, "developer") & 1)) return json({ error: "Element is unavailable" }, 403);
			if (session.lang !== proposal.locale) return json({ error: "Language changed; request a new proposal" }, 409);
			if (!session.portal.langs.includes(proposal.locale)) return json({ error: "Language is no longer available" }, 409);
			applyPersistentChanges(element, proposal.locale, proposal.changes, proposal.revision);
			session.states.delete(proposalKey);
			return json({ message: "Changes saved to the WBOL source and applied to the running Webbase." });
		}
		if (!["/studio-assistant/chat", "/studio-assistant/context"].includes(path)) return json({ error: "Not found" }, 404);
		if (typeof body.uuid !== "string" || body.uuid.length > 128 ||
			path === "/studio-assistant/chat" && (body.consent !== true || !Array.isArray(body.messages))) {
			throw new TypeError("Invalid assistant request");
		}
		let context = null;
		let revision;
		let sourceError;
		let element;
		if (body.uuid) {
			const response = await handleWbolApi(new Request(`${new URL(request.url).origin}/wbol/${encodeURIComponent(body.uuid)}`), session);
			if (!response.ok) return json({ error: "Selected element is unavailable" }, response.status);
			const data = await response.json();
			element = STWIndex.get(body.uuid);
			if (!element || !(element.isVisible(session, "developer") & 1)) return json({ error: "Element is unavailable" }, 403);
			context = Object.fromEntries(["uuid", "type", "subtype", "name", "slug", "keywords", "description", "layout", "query", "connector"]
				.filter((key) => data[key] !== undefined).map((key) => [key, data[key]]));
			context.locale = session.lang;
			if (path === "/studio-assistant/chat") {
				try {
					revision = captureRevision(element);
				} catch (error) {
					sourceError = error.message;
				}
			}
		}
		if (path === "/studio-assistant/context") return json({ context });
		session.states.delete(proposalKey);
		const response = await fetchImpl(`http://127.0.0.1:${port}/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
			body: JSON.stringify({ messages: body.messages, element: context }),
			signal: AbortSignal.timeout(185000)
		});
		if (!response.ok) return json({ error: `Assistant service error: ${(await response.text()).slice(0, 1000)}` }, 502);
		const result = await response.json();
		if (!result || typeof result.answer !== "string" || !result.changes || typeof result.changes !== "object" || Array.isArray(result.changes)) {
			throw new Error("Assistant service returned an invalid response");
		}
		let proposal;
		if (Object.keys(result.changes).length) {
			if (!element) throw new TypeError("Proposal requires an element");
			validateChanges(element, session.lang, result.changes);
			if (revision) {
				proposal = { id: randomUUID(), uuid: element.uuid, locale: session.lang, changes: result.changes, revision, expires: Date.now() + 600000 };
				session.states.set(proposalKey, proposal);
			}
		}
		return json({ answer: result.answer, changes: result.changes, proposalId: proposal?.id || null, sourceError: sourceError || null, context });
	} catch (error) {
		console.error("Studio assistant request failed:", error.message);
		return json({ error: error.message }, error instanceof AssistantConflictError ? 409 :
			error instanceof SyntaxError || error instanceof TypeError ? 400 : 500);
	}
}

export { handleAssistant };
