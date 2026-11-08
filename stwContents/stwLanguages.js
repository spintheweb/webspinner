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
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";
import { secureResponse } from "../stwComponents/stwResponse.js";

class STWLanguages extends STWContent {
	constructor(content) {
		super(content);
	}

	serve(_req, session) {
		if (session.portal.langs.length == 1)
			return new Promise((resolve) => resolve(secureResponse(null, { status: 204 })));
		return super.serve(_req, session, void 0);
	}

	async render(_req, session) {
		return `<nav>${session.portal.langs.reduce((langs, lang) => `${langs}<a href="/stw/language/${lang}">${lang.toUpperCase()}</a> `, "")}</nav>`;
	}
}

registerElement("Languages", STWLanguages);

export {
	STWLanguages
};
