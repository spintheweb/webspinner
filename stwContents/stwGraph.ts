// SPDX-License-Identifier: GPL-3.0-or-later
// Spin the Web module: stwContents/stwGraph.ts

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