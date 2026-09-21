/**
 * @fileoverview Defines the language selector content element.
 *
 * Renders links for the portal's configured languages and suppresses output
 * when the portal exposes only one language.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwLanguages
 * @license GPL-3.0-or-later
 */

import type { STWSession } from "../stwComponents/stwSession.ts";
import { registerElement } from "../stwComponents/stwFactory.ts";
import { STWContent, ISTWContent } from "../stwElements/stwContent.ts";
import { secureResponse } from "../stwComponents/stwResponse.ts";

export class STWLanguages extends STWContent {
	public constructor(content: ISTWContent) {
		super(content);
	}
	
	override serve(_req: Request, session: STWSession): Promise<Response> {
		if (session.portal.langs.length == 1)
			return new Promise<Response>(resolve => resolve(secureResponse(null, { status: 204 }))); // 204 No content

		return super.serve(_req, session, undefined);
	}

	// deno-lint-ignore require-await
	public override async render(_req: Request, session: STWSession): Promise<string> {
		return `<nav>${session.portal.langs.reduce((langs, lang) => `${langs}<a href="/stw/language/${lang}">${lang.toUpperCase()}</a> `, "")}</nav>`;
	}
}
registerElement("Languages", STWLanguages);