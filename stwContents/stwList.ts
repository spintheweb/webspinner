/**
 * @fileoverview Defines the list content element.
 *
 * Renders datasource records as a localized, layout-driven HTML list with
 * placeholder substitution and no-data handling.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwList
 * @license GPL-3.0-or-later
 */

import type { STWSession } from "../stwComponents/stwSession.ts";
import { registerElement } from "../stwComponents/stwFactory.ts";
import { STWContent, ISTWContent } from "../stwElements/stwContent.ts";
import { ISTWRecords } from "../stwComponents/stwDBAdapters/adapter.ts";

export class STWList extends STWContent {
	public constructor(content: ISTWContent) {
		super(content);
	}

	public override async render(_request: Request, session: STWSession, records: ISTWRecords): Promise<string> {
		if (!records.fields.length || !records.rows.length)
			return "";

		const placeholders = new Map(session.placeholders);
		records.fields.forEach(field => placeholders.set(`@@${field}`, records.rows[0]?.[field] || ""));

		const layout = this.getLayout(session, "f".repeat(records.fields.length));
		let { settings, HTML: body } = await layout.render(records.fields, placeholders, session, "li");

		let row = 0, rows = Number(settings.get("rows"));
		rows = rows > 0 ? rows : 25;

		while (true) {
			if (++row >= records.rows.length || row >= rows)
				break;
			records.fields.forEach(field => placeholders.set(`@@${field}`, records.rows[row]?.[field] || ""));
			body += (await layout.render(records.fields, placeholders, session, "li")).HTML;
		}
		return `<ul>${body}</ul>`; // Ordered list
	}
}

registerElement("List", STWList);