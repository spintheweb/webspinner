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
import { ACTIONS, STWLayout, isTruthy } from "../stwComponents/stwWBLL.ts";
import { ISTWRecords } from "../stwComponents/stwDBAdapters/adapter.ts";

export class STWForm extends STWContent {
	public constructor(content: ISTWContent) {
		super(content);
	}

	// deno-lint-ignore require-await
	public override async render(request: Request, session: STWSession, records: ISTWRecords): Promise<string> {
		let layout = this.getLayout(session);

		const fields = records.fields.map(f => f.name) || Object.keys(records.rows[0] || {});
		if (!layout.hasTokens) {
			this.layout.set(session.lang, new STWLayout(layout.wbll + "l\\tf\\r".repeat(fields.length)));
			layout = this.getLayout(session);
		}

		let body = "";

		const placeholders = new Map(session.placeholders);
		if (records.rows?.length)
			for (const [name, value] of Object.entries(records.rows[0]))
				placeholders.set(`@@${name}`, String(value));

		body += this.layout.get(session.lang)?.render(request, session, fields, placeholders, layout.acts(ACTIONS.stwany) && !isTruthy(layout.settings.get("disabled")));

		// If the form is modal, method="dialog"
		return `<form method="${this.section === "stwShowModal" ? "dialog" : "post"}">
			<input type="hidden" name="stwOrigin" value="${this.uuid}">
			${body}
		</form>`;
	}
}

registerElement("Form", STWForm);