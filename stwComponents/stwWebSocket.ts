// SPDX-License-Identifier: GPL-3.0-or-later
// Spin the Web component: stwWebSocket

// deno-lint-ignore-file no-empty

import { STWSite } from "../stwElements/stwSite.ts";
import { STWPage } from "../stwElements/stwPage.ts";
import { STWContent } from "../stwElements/stwContent.ts";
import { STWSession } from "./stwSession.ts";
import { newId } from "./stwIds.ts";

const SESSION_CLEANUP_GRACE_PERIOD_MS = 30000; // 30 seconds

export function handleWebSocket(request: Request, session: STWSession, stwSessions: Map<string, STWSession>): Response {
    const { socket, response } = Deno.upgradeWebSocket(request);

    const url = new URL(request.url);
    const tabId = url.searchParams.get("tab") || newId();

    // One socket per tab; replace previous if any
    const prev = session.sockets.get(tabId);
    session.sockets.set(tabId, socket);

    if (prev && prev !== socket && prev.readyState === WebSocket.OPEN) {
        try { prev.close(1000, "superseded"); } catch {}
    }

    socket.onmessage = async event => {
        // deno-lint-ignore no-explicit-any
        const data: { method: string, resource: string, options: any } = JSON.parse(event.data);

        // Create a synthetic request for this message to establish the correct URL context.
        const syntheticRequest = new Request(new URL(data.resource, request.url), {
            headers: request.headers // Preserve original headers to maintain cookies.
        });

        // Update the session's placeholders with the context of this specific message.
        session.setPlaceholders(syntheticRequest);

        let resourcesToProcess: string[] = [];

        if (data.method === "PATCH") {
            const element = STWSite.instance.find(session, data.resource);
            if (element instanceof STWPage) {
                resourcesToProcess = element.contents(session, typeof (data.options.recurse) == "undefined" ? true : data.options.recurse) || [];
            } else if (element) {
                resourcesToProcess = [data.resource];
            }
        } else if (data.method === "HEAD") {
            session.langs = data.options.langs || ["en"];
            session.lang = STWSite.instance.langs.includes(data.options.lang)
                ? data.options.lang
                : session.langs.find(lang => STWSite.instance.langs.includes(lang.substring(0, 2)))?.substring(0, 2) || "en";
            session.tz = data.options.tz || "UTC";

            resourcesToProcess = (STWSite.instance.find(session, data.resource) as STWPage)?.contents(session) || [];
        }

        if (resourcesToProcess.length === 0) return;

        const finalData: any[] = [];
        let processCount = resourcesToProcess.length;

        for (const resource of resourcesToProcess) {
            const found = STWSite.instance.find(session, resource);
            if (!found) {
                finalData.push({ method: "DELETE", id: resource });
            } else {
                const content = found as STWContent;
                const response = await content.serve(syntheticRequest, session, data.method === "PATCH" ? content : undefined);
                if (response.status === 200) {
                    finalData.push(await response.json());
                } else {
                    finalData.push({ method: "DELETE", id: content._id });
                }
            }

            // When all async operations are done, send the collected data.
            if (!--processCount) {
                send(finalData, data.options);
            }
        }

        function send(payload: any[], options: any): void {
            payload.sort((a: any, b: any) => {
                if (a.section === b.section) {
                    return a.sequence < b.sequence ? -1 : 1;
                }
                return 0; // Keep original order if sections differ
            });
            payload.forEach((content: any) => {
                content.placeholder = options.placeholder;
                socket.send(JSON.stringify(content));
            });
        }
    };
    socket.onerror = error => {
        console.error(error);
    };
    socket.onclose = () => {
        console.log(`${new Date().toISOString()}: WebSocket closed for session: [${session.sessionId}] tab=[${tabId}]`);

        // Only remove if this is still the current socket for the tab
        if (session.sockets.get(tabId) === socket) {
            session.sockets.delete(tabId);

            // If no sockets remain, schedule session cleanup
            setTimeout(() => {
                if (session.sockets.size === 0) {
                    stwSessions.delete(session.sessionId);
                    console.log(`${new Date().toISOString()}: Session timed out and removed: [${session.sessionId}]`);
                }
            }, SESSION_CLEANUP_GRACE_PERIOD_MS);
        }
    };

    return response;
}