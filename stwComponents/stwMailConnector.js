import { convert } from "html-to-text";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { envGet } from "./stwConfig.js";
import { WBPL } from "./stwWBPL.js";

const MAX_LIST_LIMIT = 50;
const MAX_MESSAGE_SIZE = 1024 * 1024;
const MAX_MESSAGE_TEXT = 64 * 1024;

async function executeImapQuery(session, configuration, query, { createClient = (options) => new ImapFlow(options) } = {}) {
	const command = parseImapCommand(query, session.placeholders);
	if (configuration.secure === false) throw new TypeError("IMAP connections require TLS");
	const client = createClient({
		host: configuration.host,
		port: configuration.port ?? 993,
		secure: true,
		auth: {
			user: configuration.user,
			pass: connectorPassword(configuration)
		},
		logger: false,
		connectionTimeout: 10_000,
		greetingTimeout: 10_000,
		socketTimeout: 20_000,
		tls: { rejectUnauthorized: true }
	});
	let primaryError;
	try {
		await client.connect();
		const lock = await client.getMailboxLock(command.mailbox);
		let rows;
		try {
			rows = command.action === "list"
				? await listMessages(client, command.limit)
				: await readMessage(client, command.uid);
		} finally {
			lock.release();
		}
		return records(rows);
	} catch (error) {
		primaryError = error;
		throw error;
	} finally {
		try {
			if (client.usable) await client.logout();
			else client.close();
		} catch (error) {
			if (primaryError) console.warn(`IMAP connection cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
			else throw error;
		}
	}
}

async function executeSmtpAction(configuration, command, fields, { createTransport = (options) => nodemailer.createTransport(options) } = {}) {
	if (command !== "send") throw new TypeError(`Unsupported SMTP action: ${command}`);
	const to = requireEmail(fields.to, "to");
	const subject = requireHeader(fields.subject, "subject", 200);
	const text = requireText(fields.text, "text");
	const from = requireEmail(configuration.from, "configured from");
	const secure = configuration.secure ?? (configuration.port ?? 465) === 465;
	const transporter = createTransport({
		host: configuration.host,
		port: configuration.port ?? (secure ? 465 : 587),
		secure,
		requireTLS: true,
		auth: {
			user: configuration.user,
			pass: connectorPassword(configuration)
		},
		connectionTimeout: 10_000,
		greetingTimeout: 10_000,
		socketTimeout: 20_000,
		tls: { rejectUnauthorized: true }
	});
	try {
		const result = await transporter.sendMail({ from, to, subject, text });
		const row = { messageId: escapeHtml(result.messageId || ""), status: "sent" };
		return { affectedRows: 1, fields: Object.keys(row), rows: [row] };
	} finally {
		transporter.close();
	}
}

function parseImapCommand(query, placeholders = new Map()) {
	let command;
	try {
		command = JSON.parse(query);
	} catch (error) {
		throw new TypeError("IMAP query must be a JSON command", { cause: error });
	}
	if (!command || typeof command !== "object" || Array.isArray(command)) {
		throw new TypeError("IMAP query must be a JSON object");
	}
	for (const [key, value] of Object.entries(command)) {
		if (typeof value === "string") command[key] = WBPL(value, placeholders);
	}
	const mailbox = command.mailbox ?? "INBOX";
	if (typeof mailbox !== "string" || !mailbox.trim() || mailbox.length > 255 || /[\u0000-\u001f\u007f]/.test(mailbox)) {
		throw new TypeError("mailbox must be a non-empty mailbox name");
	}
	if (command.action === "list") {
		const limit = command.limit ?? 25;
		if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
			throw new TypeError(`limit must be an integer from 1 to ${MAX_LIST_LIMIT}`);
		}
		return { action: command.action, mailbox, limit };
	}
	if (command.action === "get") {
		if (!(typeof command.uid === "string" || typeof command.uid === "number") || !/^[1-9]\d{0,14}$/.test(String(command.uid))) {
			throw new TypeError("uid must be a positive IMAP UID");
		}
		return { action: command.action, mailbox, uid: Number(command.uid) };
	}
	throw new TypeError("IMAP action must be 'list' or 'get'");
}

async function listMessages(client, limit) {
	const total = client.mailbox?.exists || 0;
	if (!total) return [];
	const start = Math.max(1, total - limit + 1);
	const rows = [];
	for await (const message of client.fetch(`${start}:*`, {
		uid: true,
		envelope: true,
		flags: true,
		internalDate: true,
		size: true
	})) {
		const row = {
			uid: String(message.uid),
			from: escapeHtml(formatAddresses(message.envelope?.from)),
			subject: escapeHtml(message.envelope?.subject || "(no subject)"),
			date: escapeHtml(formatDate(message.envelope?.date || message.internalDate)),
			size: message.size || 0,
			flags: escapeHtml([...(message.flags || [])].join(" "))
		};
		rows.push(row);
	}
	return rows.reverse();
}

async function readMessage(client, uid) {
	const metadata = await client.fetchOne(uid, { uid: true, size: true }, { uid: true });
	if (!metadata) throw new Error("Message not found");
	if (metadata.size > MAX_MESSAGE_SIZE) {
		throw new RangeError(`Message exceeds the ${MAX_MESSAGE_SIZE}-byte read limit`);
	}
	const message = await client.fetchOne(uid, {
		uid: true,
		envelope: true,
		flags: true,
		internalDate: true,
		source: true
	}, { uid: true });
	if (!message?.source) throw new Error("Message source is unavailable");
	const parsed = await simpleParser(message.source);
	const body = parsed.text || convert(parsed.html || "", { wordwrap: false });
	const row = {
		from: escapeHtml(formatAddresses(parsed.from?.value)),
		to: escapeHtml(formatAddresses(parsed.to?.value)),
		date: escapeHtml(formatDate(parsed.date || message.internalDate)),
		text: escapeHtml(body.slice(0, MAX_MESSAGE_TEXT)),
		subject: escapeHtml(parsed.subject || message.envelope?.subject || "(no subject)"),
		truncated: body.length > MAX_MESSAGE_TEXT,
		flags: escapeHtml([...(message.flags || [])].join(" "))
	};
	return [row];
}

function records(rows) {
	return {
		affectedRows: rows.length,
		fields: rows.length ? Object.keys(rows[0]) : [],
		rows
	};
}

function connectorPassword(configuration) {
	const password = configuration.passwordEnv ? envGet(configuration.passwordEnv) : configuration.password;
	if (typeof password !== "string" || !password) {
		throw new TypeError(configuration.passwordEnv
			? `Environment variable ${configuration.passwordEnv} is not set`
			: "Connector password is required");
	}
	return password;
}

function requireEmail(value, name) {
	if (typeof value !== "string" || value.length > 254 || /[\r\n,;]/.test(value) ||
		!/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(value)) {
		throw new TypeError(`${name} must be a single valid email address`);
	}
	return value;
}

function requireHeader(value, name, maxLength) {
	if (typeof value !== "string" || !value.trim() || value.length > maxLength || /[\r\n]/.test(value)) {
		throw new TypeError(`${name} must be non-empty, at most ${maxLength} characters, and contain no line breaks`);
	}
	return value.trim();
}

function requireText(value, name) {
	if (typeof value !== "string" || !value.trim() || value.length > MAX_MESSAGE_TEXT) {
		throw new TypeError(`${name} must be non-empty and at most ${MAX_MESSAGE_TEXT} characters`);
	}
	return value;
}

function formatAddresses(addresses = []) {
	return addresses.map(({ name, address }) => name ? `${name} <${address}>` : address).join(", ");
}

function formatDate(value) {
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function escapeHtml(value) {
	return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export {
	executeImapQuery,
	executeSmtpAction,
	parseImapCommand
};
