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
	public override async render(_request: Request, _session: STWSession, _records: ISTWRecords): Promise<string> {
		return `<div id="Map${this.uuid}"></div>
			<link name="APISTWGeomap" rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin=""/>
			<script name="APISTWGeomap" src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
			<script name="STWGeomap" onload="fnSTWGeomap('Map${this.uuid}')">
				function fnSTWGeomap(id) {
					const map = L.map(id).setView([45.4064, 11.8768], 13);
					L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
				}
			</script>`;
	}
}

registerElement("Geomap", STWGeomap);