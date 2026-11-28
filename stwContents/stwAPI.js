/**
 * @fileoverview Serves connector results as HTTP API resources.
 *
 * @module stwAPI
 * @license Apache-2.0
 */
import { MIMEType } from "node:util";
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWConnectors } from "../stwComponents/stwConnectors.js";
import { secureResponse } from "../stwComponents/stwResponse.js";
import { STWContent } from "../stwElements/stwContent.js";
import { STWIndex } from "../stwElements/stwIndex.js";
import { STWShortcut } from "./stwShortcut.js";

class STWAPI extends STWContent {
	async serve(_request, session, ref) {
		if (!(this.isVisible(session) & 1) || (ref && !(ref.isVisible(session) & 1)))
			return secureResponse("Forbidden", { status: 403 });
		if (!this.connector)
			throw new Error("API content requires a connector");

		const { rows } = await STWConnectors.command(session, this);
		if (!Array.isArray(rows))
			throw new TypeError("API connector must return a recordset");
		if (!rows.length)
			return secureResponse(null, { status: 200 });
		if (rows.length !== 1)
			throw new Error("API connector must return at most one record");

		const record = rows[0];
		if (!record || typeof record !== "object" || Array.isArray(record))
			throw new TypeError("API connector must return a record");
		if (typeof record.mime !== "string" || !record.mime.trim())
			throw new TypeError("API record requires a MIME type");
		let mime;
		try {
			mime = new MIMEType(record.mime).toString();
		} catch (error) {
			throw new TypeError("API record contains an invalid MIME type", { cause: error });
		}
		if (typeof record.content !== "string")
			throw new TypeError("API record content must be a string");

		const encoding = record.encoding === undefined ? "utf8" : record.encoding;
		let body;
		if (encoding === "utf8") {
			body = record.content;
		} else if (encoding === "base64") {
			if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(record.content))
				throw new TypeError("API record contains invalid Base64 content");
			body = Buffer.from(record.content, "base64");
			if (body.toString("base64") !== record.content)
				throw new TypeError("API record contains invalid Base64 content");
		} else {
			throw new TypeError(`Unsupported API content encoding: ${encoding}`);
		}
		return secureResponse(body, { status: 200, headers: { "Content-Type": mime } });
	}
}

function resolveAPIContent(content) {
	if (content instanceof STWAPI) return content;
	if (content instanceof STWShortcut) {
		const target = STWIndex.get(content.ref);
		if (target instanceof STWAPI) return target;
	}
	return null;
}

registerElement("Api", STWAPI);

export { STWAPI, resolveAPIContent };
