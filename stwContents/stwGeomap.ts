/**
 * @fileoverview Defines the geographic map content element.
 *
 * Renders an OpenLayers map container and initializes an OpenStreetMap layer
 * when the client-side library is available.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwGeomap
 * @license GPL-3.0-or-later
 */

import type { STWSession } from "../stwComponents/stwSession.ts";
import { registerElement } from "../stwComponents/stwFactory.ts";
import { STWContent, ISTWContent } from "../stwElements/stwContent.ts";
import { ISTWRecords } from "../stwComponents/stwDBAdapters/adapter.ts";

export class STWGeomap extends STWContent {
	public constructor(content: ISTWContent) {
		super(content);
	}

	// deno-lint-ignore require-await
	public override async render(_req: Request, _session: STWSession, _records: ISTWRecords): Promise<string> {
		return `<div id="Map${this.uuid}"></div>
			<script name="OpenLayers" src="https://www.openlayers.org/api/OpenLayers.js"></script>
			<script name="STWGeomap" onload="fnSTWGeomap('Map${this.uuid}')">
				function fnSTWGeomap(id) {
					if (typeof OpenLayers !== "undefined") {
						map = new OpenLayers.Map(id);
						map.addLayer(new OpenLayers.Layer.OSM());
						map.zoomToMaxExtent();
					} else
						self.document.getElementById(id).innerHTML = 'OpenLayers not loaded, see <a target="_blank" href="https://openlayers.org/">https://openlayers.org/</a>';
				}
			</script>`;
	}
}

registerElement("Geomap", STWGeomap);