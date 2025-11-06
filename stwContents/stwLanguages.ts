// SPDX-License-Identifier: GPL-3.0-or-later
// Spin the Web module: stwContents/stwLanguages.ts

import type { STWSession } from "../stwComponents/stwSession.ts";
import { registerElement } from "../stwComponents/stwFactory.ts";
import { STWContent, ISTWContent } from "../stwElements/stwContent.ts";
import { secureResponse } from "../stwComponents/stwResponse.ts";

export class STWLanguages extends STWContent {
	public constructor(content: ISTWContent) {
		super(content);
	}
	
	override serve(_req: Request, session: STWSession): Promise<Response> {
		if (session.site.langs.length == 1)
			return new Promise<Response>(resolve => resolve(secureResponse(null, { status: 204 }))); // 204 No content

		return super.serve(_req, session, undefined);
	}

	// deno-lint-ignore require-await
	public override async render(_req: Request, session: STWSession): Promise<string> {
		return `<nav>${session.site.langs.reduce((langs, lang) => `${langs}<a href="/stw/language/${lang}">${lang.toUpperCase()}</a> `, "")}</nav>`;
	}
}
registerElement("Languages", STWLanguages);