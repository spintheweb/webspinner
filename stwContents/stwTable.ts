// SPDX-License-Identifier: GPL-3.0-or-later
// Spin the Web module: stwContents/stwTable.ts

import type { STWSession } from "../stwComponents/stwSession.ts";
import { registerElement } from "../stwComponents/stwFactory.ts";
import { STWContent, ISTWContent } from "../stwElements/stwContent.ts";
import { STWLayout, ACTIONS, isTruthy } from "../stwComponents/stwWBLL.ts";
import { ISTWRecords } from "../stwComponents/stwDBAdapters/adapter.ts";
import { wbpl } from "../stwComponents/stwWBPL.ts";

export class STWTable extends STWContent {
	public constructor(content: ISTWContent) {
		super(content);
	}

	// deno-lint-ignore require-await
	public override async render(request: Request, session: STWSession, records: ISTWRecords): Promise<string> {
		let layout = this.getLayout(session);

		if (!records.fields?.length || !records.rows?.length)
			return layout.settings.get("nodata") || "";

		const fields = records.fields.map(f => f.name) || Object.keys(records.rows[0] || {});
		if (!layout.hasTokens) {
			this.layout.set(session.lang, new STWLayout(layout.wbll + "lf".repeat(fields.length)));
			layout = this.getLayout(session);
		}

		const placeholders = new Map(session.placeholders);

		let body = "<table><thead><tr>";
		let tr = layout.render(request, session, fields, placeholders, layout.acts(ACTIONS.stwany) && !isTruthy(layout.settings.get("disabled")));
		tr.matchAll(/(<label.*?>(.*?)<\/label>).*?/g).forEach(match => body += `<th>${match[2].trim()}</th>`);

		// If the layout includes an insert button, allow records insertion
		if (layout.acts(ACTIONS.stwinsert) && !isTruthy(layout.settings.get("disabled"))) {
			body += `<th style="width:1rem;background-color:inherit"></th><tr>`;
			tr = layout.render(request, session, fields, placeholders, true);
			tr.matchAll(/<label(.*?)>(.*?)<\/label>(.*?)(?=<label|$)/g).forEach(match => body += `<td${match[1].trim()}>${match[3].trim()}</td>`);
			body += `<th><i class="fa-light fa-plus"></i></th>`;
		}
		body += "</tr></thead><tbody>";

		body = body.replace(/<thead><tr>(<th><\/th>)*<\/tr><\/thead>/, ""); // Empty header row

		let row = 0;
		while (true) {
			for (const [name, value] of Object.entries(records.rows[row]))
				placeholders.set(`@@${name}`, String(value));
			tr = layout.render(request, session, fields, placeholders, layout.acts(ACTIONS.stwany) && !isTruthy(layout.settings.get("disabled")));

			body += `<tr ${wbpl(layout.groupAttributes, placeholders)}>`;
			tr.matchAll(/<label(.*?)>(.*?)<\/label>(.*?)(?=<label|$)/g).forEach(match => body += `<td${match[1].trim()}>${match[3].trim()}</td>`);

			// If the layout includes a delete button, allow records deletion
			if (layout.acts(ACTIONS.stwdelete) && !isTruthy(layout.settings.get("disabled")))
				body += `<th><i class="fa-light fa-trash-can"></i></th>`;

			body += "</tr>";

			if (++row >= records.rows.length || row >= parseInt(layout.settings.get("rows") || "25"))
				break;
		}

		body += "</tbody><tfoot></tfoot></table>";

		// Remove all <button> elements from the body
		body = body.replace(/<button.*?<\/button>/g, "");

		if (layout.acts(ACTIONS.stwinsert || ACTIONS.stwupdate || ACTIONS.stwdelete) && !isTruthy(layout.settings.get("disabled"))) {
			body = `<form method="post">
				<input type="hidden" name="stwOrigin" value="${this._id}">
				${body}
				<button value="stwcrud" name="stwAction" type="submit">Save</button>
			</form>`;
		}

		return body;
	}
}

registerElement("Table", STWTable);