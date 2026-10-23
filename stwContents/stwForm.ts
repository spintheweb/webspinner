/**
 * @fileoverview Defines the form content element.
 *
 * Renders datasource fields through the WBLL layout system and produces
 * regular or modal HTML forms according to the content section.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwForm
 * @license GPL-3.0-or-later
 */

import type { STWSession } from "../stwComponents/stwSession.ts";
import { registerElement } from "../stwComponents/stwFactory.ts";
import { STWContent, ISTWContent } from "../stwElements/stwContent.ts";
import { ISTWRecords } from "../stwComponents/stwDBAdapters/adapter.ts";

export class STWForm extends STWContent {
	public constructor(content: ISTWContent) {
		super(content);
	}

	public override async render(_request: Request, session: STWSession, records: ISTWRecords): Promise<string> {
		const layout = this.getLayout(session, "l\\tf\\r".repeat(records.fields.length));

		let body = "";

		const placeholders = new Map(session.placeholders);
		for (const row of records.rows) {
			records.fields.forEach(field => { if (!field.startsWith("stw")) placeholders.set(`@@${field}`, row[field] || "") });
			body += (await layout.render(records.fields, placeholders, session)).HTML;
		}

		if (body === "")
			return "";
		
		return `<form method="${this.section === "stwShowModal" ? "dialog" : "post"}">
			${body.indexOf('formmethod="GET"') == -1 ? `<input type="hidden" name="stwOrigin" value="${this.uuid}">` : ''}
			${body}
			</form>`;
	}
}

registerElement("Form", STWForm);