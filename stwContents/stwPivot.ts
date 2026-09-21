/**
 * @fileoverview Defines the pivot content element.
 *
 * Provides the pivot content subtype and its current placeholder rendering
 * implementation.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwPivot
 * @license GPL-3.0-or-later
 */

import type { STWSession } from "../stwComponents/stwSession.ts";
import { registerElement } from "../stwComponents/stwFactory.ts";
import { STWContent, ISTWContent } from "../stwElements/stwContent.ts";
import { ISTWRecords } from "../stwComponents/stwDBAdapters/adapter.ts";

export class STWPivot extends STWContent {
	public constructor(content: ISTWContent) {
		super(content);
	}

	// deno-lint-ignore require-await
	public override async render(_req: Request, _session: STWSession, _records: ISTWRecords): Promise<string> {
		return `TODO: Render ${this.constructor.name} for ${_session.user} <pre>${_records}</pre>`;
	}
}

registerElement("Pivot", STWPivot);