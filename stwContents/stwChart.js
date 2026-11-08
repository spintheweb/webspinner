/**
 * @fileoverview Defines the chart content element.
 *
 * Renders a client-side chart canvas and initializes it with the Chart.js
 * library.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwChart
 * @license GPL-3.0-or-later
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";

class STWChart extends STWContent {
  constructor(content) {
    super(content);
  }

  async render(_req, _session, _records) {
    return `<canvas id="Chart${this.uuid}"></canvas>
			<script name="chart" src="https://cdn.jsdelivr.net/npm/chart.js"><\/script>
			<script name="STWChart" onload="fnSTWChart('Chart${this.uuid}')">
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
			<\/script>`;
  }
}

registerElement("Chart", STWChart);

export {
  STWChart
};
