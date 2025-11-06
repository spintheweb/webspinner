// SPDX-License-Identifier: GPL-3.0-or-later
// Spin the Web module: stwContents/stwList.ts

import type { STWSession } from "../stwComponents/stwSession.ts";
import { registerElement } from "../stwComponents/stwFactory.ts";
import { STWContent, ISTWContent } from "../stwElements/stwContent.ts";
import { STWLayout } from "../stwComponents/stwWBLL.ts";
import { ISTWRecords } from "../stwComponents/stwDBAdapters/adapter.ts";
import { wbpl } from "../stwComponents/stwWBPL.ts";

export class STWList extends STWContent {
	public constructor(content: ISTWContent) {
		super(content);
	}

	public override async render(request: Request, session: STWSession, records: ISTWRecords): Promise<string> {
		let layout = this.getLayout(session);

		if (!records.fields?.length || !records.rows?.length) 
			return layout.settings.get("nodata") || "";

		const fields = records.fields.map(f => f.name) || Object.keys(records.rows[0] || {});
		if (!layout.hasTokens) {
			this.layout.set(session.lang, new STWLayout(layout.wbll + "lf".repeat(fields.length)));
			layout = this.getLayout(session);
		}

		let body = "";
		let row = 0;

		const placeholders = new Map(session.placeholders);
		for (const [name, value] of Object.entries(records.rows[0]))
			placeholders.set(`@@${name}`, String(value));

		body = `<ul>`;
		while (true) {
			body += `<li${wbpl(layout.groupAttributes, placeholders)}>${await layout.render(request, session, fields, placeholders)}</li>`;
			if (++row >= records.rows.length || row >= parseInt(layout.settings.get("rows") || "25"))
				break;
			for (const [name, value] of Object.entries(records.rows[row]))
				placeholders.set(`@@${name}`, String(value));
		}
		body += "</ul>";

		return body;
	}
}

registerElement("List", STWList);