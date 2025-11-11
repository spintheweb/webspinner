// SPDX-License-Identifier: GPL-3.0-or-later
// Spin the Web module: stwContents/stwScript.ts

import type { STWSession } from "../stwComponents/stwSession.ts";
import { registerElement } from "../stwComponents/stwFactory.ts";
import { STWContent, ISTWContent } from "../stwElements/stwContent.ts";
import { secureResponse } from "../stwComponents/stwResponse.ts";

export class STWScript extends STWContent {
	public constructor(content: ISTWContent) {
		super(content);
	}
	
	public override serve(_req: Request, _session: STWSession): Promise<Response> {
		if (!this.isVisible(_session))
			return new Promise<Response>(resolve => resolve(secureResponse(null, { status: 204 }))); // 204 No content

		const data = {
			method: "PUT",
			id: this._id,
			section: this.section,
			sequence: this.sequence,
			body: this.layout.get(_session.lang),
		};
		return new Promise<Response>(resolve => {
			const response = secureResponse(`<script>${JSON.stringify(data)}</script>`);
			resolve(response);
		});
	}
}
registerElement("Script", STWScript);