// SPDX-License-Identifier: GPL-3.0-or-later
// Spin the Web module: stwContents/stwImagemap.ts

import type { STWSession } from "../stwComponents/stwSession.ts";
import { registerElement } from "../stwComponents/stwFactory.ts";
import { STWContent, ISTWContent } from "../stwElements/stwContent.ts";

export class STWImagemap extends STWContent {
	public constructor(content: ISTWContent) {
		super(content);
	}
	
	// TODO: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/area
	// deno-lint-ignore require-await
	public override async render(_req: Request, _session: STWSession): Promise<string> {
		return `TODO: Render ${this.constructor.name} for ${_session.user}`;
	}
}

registerElement("Imagemap", STWImagemap);