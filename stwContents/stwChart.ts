// SPDX-License-Identifier: GPL-3.0-or-later
// Spin the Web module: stwContents/stwChart.ts

import type { STWSession } from "../stwComponents/stwSession.ts";
import { registerElement } from "../stwComponents/stwFactory.ts";
import { STWContent, ISTWContent } from "../stwElements/stwContent.ts";
import { ISTWRecords } from "../stwComponents/stwDBAdapters/adapter.ts";

export class STWChart extends STWContent {
	public constructor(content: ISTWContent) {
		super(content);
	}

	// deno-lint-ignore require-await
	public override async render(_req: Request, _session: STWSession, _records: ISTWRecords): Promise<string> {
		return `<canvas id="Chart${this._id}"></canvas>
			<script name="chart" src="https://cdn.jsdelivr.net/npm/chart.js"></script>
			<script name="STWChart" onload="fnSTWChart('Chart${this._id}')">
				function fnSTWChart(id) {
					const ctx = self.document.getElementById(id);
					new Chart(ctx, {
						type: 'bar',
						data: {
							labels: ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'Orange'],
							datasets: [{
								label: '# of Votes',
								data: [12, 19, 3, 5, 2, 3],
								borderWidth: 1
							}]
						},
						options: {
							scales: { y: { beginAtZero: true } }
						}
					});
				}
			</script>`;
	}
}

registerElement("Chart", STWChart);
