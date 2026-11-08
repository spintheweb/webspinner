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
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";
class STWGeomap extends STWContent {
	constructor(content) {
		super(content);
	}
	async render(_request, _session, _records) {
		return `<div id="Map${this.uuid}"></div>
<link name="APISTWGeomap" rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin=""/>
<script name="APISTWGeomap" src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""><\/script>
<script name="STWGeomap" onload="fnSTWGeomap('Map${this.uuid}')">
function fnSTWGeomap(id) {
	const map = L.map(id).setView([45.4064, 11.8768], 13);
	L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
}
<\/script>`;
	}
}

registerElement("Geomap", STWGeomap);
export {
	STWGeomap
};
