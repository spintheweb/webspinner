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
	async render(_request, session, records) {
		const layout = this.getLayout(session, "l\\tf\\r".repeat(records.fields.length));
		
		let body = "";
		let hasEmbeddedContent = false;
		let hasFormFields = false;
		const placeholders = new Map(session.placeholders);
		for (const row of records.rows) {
			records.fields.forEach((field) => {
				const value = row[field];
				placeholders.set(`@@${field.toLowerCase()}`, value === 0 ? "0" : value || "");
			});
			placeholders.set("@@stworigin", this.uuid);
			const rendered = await layout.render(records.fields, placeholders, session, "", this.uuid);
			body += rendered.HTML;
			hasEmbeddedContent ||= rendered.hasEmbeddedContent;
			hasFormFields ||= rendered.formFields > 0;
		}
		if (body === "")
			return "";
		if (hasEmbeddedContent && !hasFormFields)
			return body;
		return `<form${this.section === "modal" ? ` method="dialog"` : ""}>${body}<input type="hidden" name="stwOrigin" value="${this.uuid}"></form>`;
	}
}

registerElement("Form", STWForm);

export {
	STWForm
};
