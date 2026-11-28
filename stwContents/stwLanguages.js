/**
 * @fileoverview Defines the language selector content element.
 *
 * Renders the active language and links for the other configured languages.
 * Suppresses output when the portal exposes only one language.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwLanguages
 * @note Copilot-assisted
 * @license Apache-2.0
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";
import { secureResponse } from "../stwComponents/stwResponse.js";

class STWLanguages extends STWContent {
	serve(_req, session) {
		if (session.portal.langs.length == 1)
			return new Promise((resolve) => resolve(secureResponse(null, { status: 204 })));
		return super.serve(_req, session, void 0);
	}

	async render(_req, session) {
		return `<nav>${session.portal.langs.map(lang => lang === session.placeholders.get("@@stwlanguage")
			? `<strong aria-current="true">${lang.toUpperCase()}</strong>`
			: `<a href="/stw/language/${lang}">${lang.toUpperCase()}</a>`).join(" ")}</nav>`;
	}
}

registerElement("Languages", STWLanguages);

export {
	STWLanguages
};
