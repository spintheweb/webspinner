import { randomUUID } from "node:crypto";
import { envGet } from "./stwConfig.js";
import { handleWbolApi } from "./stwWBOLApi.js";
import { STWIndex } from "../stwElements/stwIndex.js";
import { applyPersistentChanges, captureRevision, validateChanges } from "./stwAssistantPersistence.js";

const proposalKey = "stwAssistantProposal";
const historyKey = "stwAssistantHistory";

function history(session) {
	let state = session.states.get(historyKey);
	if (!state) session.states.set(historyKey, state = { uuid: "", messages: [] });
	return state;
}

function visibleElement(session, uuid) {
	const element = STWIndex.get(uuid);
	if (!element || !(element.isVisible(session, "developer") & 1)) throw new Error("Element is unavailable");
	return element;
}

async function chat(session, fields, fetchImpl) {
	if (fields.consent !== "yes") throw new TypeError("Confirm local context sharing first");
	const uuid = String(fields.uuid ?? "").trim();
	const message = String(fields.message ?? "").trim();
	if (uuid.length > 128 || !message || message.length > 12000) throw new TypeError("Invalid assistant request");
	const token = envGet("STW_ASSISTANT_TOKEN");
	if (!token || token.length < 32) throw new Error("STW_ASSISTANT_TOKEN is not configured");
	const port = Number(envGet("STW_ASSISTANT_PORT") || 11435);
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid assistant port");

	const state = history(session);
	if (state.uuid !== uuid) state.messages = [];
	let context = null;
	let revision;
	let sourceError;
	let element;
	if (uuid) {
		const response = await handleWbolApi(new Request(`http://wbol.internal/wbol/${encodeURIComponent(uuid)}`), session);
		if (!response.ok) throw new Error("Selected element is unavailable");
		const data = await response.json();
		element = visibleElement(session, uuid);
		context = Object.fromEntries(["uuid", "type", "subtype", "name", "slug", "keywords", "description", "layout", "query", "connector"]
			.filter((key) => data[key] !== undefined).map((key) => [key, data[key]]));
		context.locale = session.lang;
		try {
			revision = captureRevision(element);
		} catch (error) {
			sourceError = error.message;
		}
	}
	session.states.delete(proposalKey);
	const pending = [...state.messages, { role: "user", content: message }].slice(-19);
	const response = await fetchImpl(`http://127.0.0.1:${port}/chat`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
		body: JSON.stringify({ messages: pending, element: context }),
		signal: AbortSignal.timeout(185000)
	});
	if (!response.ok) throw new Error(`Assistant service error: ${(await response.text()).slice(0, 1000)}`);
	const result = await response.json();
	if (!result || typeof result.answer !== "string" || !result.changes || typeof result.changes !== "object" || Array.isArray(result.changes)) {
		throw new Error("Assistant service returned an invalid response");
	}
	let answer = result.answer;
	if (Object.keys(result.changes).length) {
		if (!element) throw new TypeError("Proposal requires an element");
		validateChanges(element, session.lang, result.changes);
		if (revision) {
			session.states.set(proposalKey, { id: randomUUID(), uuid: element.uuid, locale: session.lang, changes: result.changes, current: context, revision, expires: Date.now() + 600000 });
		} else {
			answer += `\n(Cannot save this element: ${sourceError})`;
		}
	}
	state.uuid = uuid;
	state.messages = [...pending, { role: "assistant", content: answer }];
}

function apply(session) {
	const proposal = session.states.get(proposalKey);
	if (!proposal || Date.now() > proposal.expires) throw new Error("Proposal expired or not found");
	const element = visibleElement(session, proposal.uuid);
	if (session.lang !== proposal.locale) 	throw new Error("Language changed; request a new proposal");
		if (!session.portal.langs.includes(proposal.locale)) throw new Error("Language is no longer available");
	applyPersistentChanges(element, proposal.locale, proposal.changes, proposal.revision);
	session.states.delete(proposalKey);
	const message = "Changes saved to the WBOL source and applied to the running Webbase. Reload the portal to refresh the preview.";
	history(session).messages.push({ role: "assistant", content: message });
}

/**
 * Serves the reserved `assistant` connector. Resources: GET /state, GET /history, GET /proposal,
 * POST /chat (uuid, message, consent) and POST /apply. State lives in the session.
 *
 * @returns {Promise<object[]>} Rows for the requested resource.
 */
async function executeAssistant(session, resource, method, fields = {}, fetchImpl = fetch) {
	if (!session.roles.includes("developer")) throw new Error("Developer access required");
	const route = `${method} ${resource}`;
	if (route === "GET /state") return [{ uuid: history(session).uuid }];
	if (route === "GET /history") {
		return history(session).messages.map(({ role, content }) => ({ role: role === "user" ? "You" : "Assistant", message: content }));
	}
	if (route === "GET /proposal") {
		const proposal = session.states.get(proposalKey);
		if (!proposal || Date.now() > proposal.expires) return [];
		return Object.entries(proposal.changes).map(([field, proposed]) => ({ field, current: String(proposal.current?.[field] ?? ""), proposed: String(proposed) }));
	}
	if (route === "POST /chat") {
		await chat(session, fields, fetchImpl);
		return [];
	}
	if (route === "POST /apply") {
		apply(session);
		return [];
	}
	throw new TypeError(`Unsupported assistant resource: ${route}`);
}

export { executeAssistant };
