/**
 * @fileoverview Defines the graph content element.
 *
 * Provides the graph content subtype and its current placeholder rendering
 * implementation.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwGraph
 * @license GPL-3.0-or-later
 */

import type { STWSession } from "../stwComponents/stwSession.ts";
import { registerElement } from "../stwComponents/stwFactory.ts";
import { STWContent, ISTWContent } from "../stwElements/stwContent.ts";
import { ISTWRecords } from "../stwComponents/stwDBAdapters/adapter.ts";

export class STWGraph extends STWContent {
	public constructor(content: ISTWContent) {
		super(content);
	}

	// deno-lint-ignore require-await
	public override async render(_req: Request, _session: STWSession, _records: ISTWRecords): Promise<string> {
		return `TODO: Render ${this.constructor.name} <pre>${_records}</pre>`;
	}
}

// NOTE: Fixed previous incorrect registry key (was "Tree" mapping to STWGraph)
registerElement("Graph", STWGraph);