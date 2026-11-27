import { WebSocket } from "ws";
import { STWPortal } from "../stwElements/stwPortal.js";
import { canDevelopElement } from "./stwWebbaselets.js";

const connections = new Set();

function registerStudioConnection(socket, session) {
	const connection = { socket, session };
	connections.add(connection);
	return () => connections.delete(connection);
}

function broadcastElementBlock(element) {
	for (const { socket, session } of connections) {
		if (socket.readyState !== WebSocket.OPEN) continue;
		const canRead = canDevelopElement(session, element) ||
			(element instanceof STWPortal && session.roles.includes("developer") &&
				(session.roles.includes("leaddeveloper") || session.roles.includes("root"))) ||
			(session.roles.includes("seo") && Boolean(element.isVisible(session, "seo") & 1));
		if (!canRead) continue;
		const message = JSON.stringify({
			method: "STW_BLOCK", id: element.uuid, blocked: Boolean(element.blocked),
			own: Boolean(element.blocked) && element.blocked === session.user
		});
		try {
			socket.send(message, error => {
				if (error) console.error("Could not broadcast Studio block:", error);
			});
		} catch (error) {
			console.error("Could not broadcast Studio block:", error);
		}
	}
}

export { registerStudioConnection, broadcastElementBlock };
