/**
 * @fileoverview Defines the breadcrumbs content element.
 *
 * Builds a localized navigation trail from the current request path and
 * renders it through the configured content layout.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwBreadcrumbs
 * @license GPL-3.0-or-later
 */

import type { STWSession } from "../stwComponents/stwSession.ts";
import { registerElement } from "../stwComponents/stwFactory.ts";
import { STWContent, ISTWContent } from "../stwElements/stwContent.ts";
import { ISTWRecords } from "../stwComponents/stwDBAdapters/adapter.ts";

export class STWBreadcrumbs extends STWContent {
	public constructor(content: ISTWContent) {
		super(content);
	}

	// deno-lint-ignore require-await
	public override async render(request: Request, session: STWSession, _records: ISTWRecords): Promise<string> {
		let body = "";
		for (let element = session.portal.find(session, new URL(request.url).pathname); element; element = element.parent)
			if (element.isVisible(session) & 1 && element.pathname(session))
				body = `/<a href="${element.pathname(session)}">${element.localize(session, "name")}</a>` + body;

		return `<nav>${body}</nav>`;
	}
}

registerElement("Breadcrumbs", STWBreadcrumbs);