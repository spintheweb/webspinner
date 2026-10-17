/**
 * @fileoverview Defines the table content element.
 *
 * Renders datasource fields and rows as a layout-driven HTML table with
 * localized labels, placeholders, and configured actions.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwTable
 * @license GPL-3.0-or-later
 */

import type { STWSession } from "../stwComponents/stwSession.ts";
import { registerElement } from "../stwComponents/stwFactory.ts";
import { STWContent, ISTWContent } from "../stwElements/stwContent.ts";
import { ISTWRecords } from "../stwComponents/stwDBAdapters/adapter.ts";

export class STWTable extends STWContent {
	public constructor(content: ISTWContent) {
		super(content);
	}

	public override async render(_request: Request, session: STWSession, records: ISTWRecords): Promise<string> {
		if (!records.fields.length || !records.rows.length)
			return "";

		const placeholders = new Map(session.placeholders);
		records.fields.forEach(field => placeholders.set(`@@${field}`, records.rows[0]?.[field] || ""));

		const layout = this.getLayout(session, "lf".repeat(records.fields.length));
		let { settings, HTML: body } = await layout.render(records.fields, placeholders, session, "thead");

		let row = 0;
		body = `<thead>${body}</thead><tbody>`;
		while (true) {
			body += (await layout.render(records.fields, placeholders, session, "tbody")).HTML;
			if (++row >= records.rows.length || row >= Number(settings.get("rows") || 25))
				break;
			records.fields.forEach(field => placeholders.set(`@@${field}`, records.rows[row]?.[field] || ""));
		}
		body += `</tbody><tfoot>${(await layout.render(records.fields, placeholders, session, "tfoot")).HTML}</tfoot>`;

		return `<div style="overflow:auto"><table>${body}</table></div>`;
	}
}

registerElement("Table", STWTable);