/**
 * @fileoverview Defines the form content element.
 *
 * Renders connector fields through the WBLL layout system and produces
 * regular or modal HTML forms according to the content section.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwForm
 * @note Copilot-assisted
 * @license Apache-2.0
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";

class STWForm extends STWContent {
	constructor(content) {
		super(content);
	}

	async render(_request, session, records) {
		const layout = this.getLayout(session, "l\\tf\\r".repeat(records.fields.length));
		
		let body = "";
		const placeholders = new Map(session.placeholders);
		for (const row of records.rows) {
			records.fields.forEach((field) => placeholders.set(`@@${field}`, row[field] || ""));
			placeholders.set("@@stwOrigin", this.uuid);
			body += (await layout.render(records.fields, placeholders, session, "", this.uuid)).HTML;
		}
		if (body === "")
			return "";
		return `<form${this.section === "stwOpenModal" ? ` method="dialog"` : ""}>${body}<input type="hidden" name="stwOrigin" value="${this.uuid}"></form>`;
	}
}

registerElement("Form", STWForm);

export {
	STWForm
};
