/**
 * @fileoverview Defines the geographic map content element.
 *
 * Renders a Leaflet map container and initializes an OpenStreetMap layer
 * when the client-side library is available.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwGeomap
 * @note Copilot-assisted
 * @license Apache-2.0
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";

const layers = {
	standard: {
		url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
		options: { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }
	},
	topographic: {
		url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
		options: {
			maxNativeZoom: 17,
			attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="https://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)'
		}
	},
	humanitarian: {
		url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
		options: { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles style by <a href="https://www.hotosm.org/">Humanitarian OpenStreetMap Team</a> hosted by <a href="https://openstreetmap.fr/">OpenStreetMap France</a>' }
	}
};

class STWGeomap extends STWContent {
	async render(_request, session, records, placeholders = session.placeholders) {
		const layout = this.getLayout(session);
		const { settings } = await layout.render(records.fields, placeholders, session, "", this.uuid);
		const mode = settings.get("mode");
		if (mode !== undefined && !Object.hasOwn(layers, mode))
			throw new Error(`Unsupported Geomap mode: ${mode}`);

		const markers = [];
		if (records.rows.length) {
			const key = settings.get("key");
			if (typeof key !== "string" || !key)
				throw new Error("Geomap requires a coordinate field in the key setting");
			const field = records.fields.find(name => name.toLowerCase() === key.toLowerCase());
			if (!field)
				throw new Error(`Geomap coordinate field not found: ${key}`);
			const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
			for (const [index, row] of records.rows.entries()) {
				const value = row[field];
				const parts = typeof value === "string" ? value.split(",").map(part => part.trim()) : [];
				if (parts.length !== 2 || !parts.every(part => number.test(part)))
					throw new Error(`Invalid coordinates in Geomap record ${index + 1}, field ${field}`);
				const position = parts.map(Number);
				if (!position.every(Number.isFinite) || Math.abs(position[0]) > 90 || Math.abs(position[1]) > 180)
					throw new Error(`Invalid coordinates in Geomap record ${index + 1}, field ${field}`);
				const rowPlaceholders = new Map(placeholders);
				rowPlaceholders.set("@@stworigin", this.uuid);
				for (const name of records.fields)
					rowPlaceholders.set(`@@${name.toLowerCase()}`, String(row[name] ?? ""));
				let { HTML } = await layout.render(records.fields, rowPlaceholders, session, "", this.uuid);
				if (HTML.includes("data-stw-action-token") && !/<form\b/i.test(HTML))
					HTML = `<form id="stwFA${this.uuid}"><input type="hidden" name="stwOrigin" value="${this.uuid}">${HTML}</form>`;
				markers.push({ position, HTML });
			}
		}

		return `<div id="Map${this.uuid}" class="stwGeomapCanvas" data-stw-markers="${Buffer.from(JSON.stringify(markers), "utf8").toString("base64")}"></div>
<link name="APISTWGeomap" rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin=""/>
<script name="APISTWGeomap" src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""><\/script>
<script name="STWGeomap" onload="fnSTWGeomap('Map${this.uuid}', '${mode ?? ""}')">
function fnSTWGeomap(id, mode) {
	const layers = ${JSON.stringify(layers)};
	const canvas = document.getElementById(id);
	const markers = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(canvas.dataset.stwMarkers), char => char.charCodeAt(0))));
	const map = L.map(id).setView([45.4064, 11.8768], 13);
	if (mode) {
		const layer = layers[mode];
		L.tileLayer(layer.url, layer.options).addTo(map);
	} else {
		const choices = {
			Standard: L.tileLayer(layers.standard.url, layers.standard.options),
			Topographic: L.tileLayer(layers.topographic.url, layers.topographic.options),
			Humanitarian: L.tileLayer(layers.humanitarian.url, layers.humanitarian.options)
		};
		choices.Standard.addTo(map);
		L.control.layers(choices).addTo(map);
	}
	const dialog = document.createElement("dialog");
	dialog.className = "stwGeomapFullscreen";
	canvas.before(dialog);
	const fullscreen = L.control({ position: "topleft" });
	fullscreen.onAdd = () => {
		const container = L.DomUtil.create("div", "leaflet-bar");
		const button = L.DomUtil.create("button", "stwGeomapExpand", container);
		button.type = "button";
		button.innerHTML = "&#x26F6;";
		button.title = "Expand map";
		button.setAttribute("aria-label", button.title);
		button.setAttribute("aria-pressed", "false");
		L.DomEvent.disableClickPropagation(container);
		const restore = () => {
			if (dialog.open || canvas.parentElement !== dialog) return;
			dialog.after(canvas);
			button.title = "Expand map";
			button.setAttribute("aria-label", button.title);
			button.setAttribute("aria-pressed", "false");
			map.invalidateSize();
		};
		button.addEventListener("click", () => {
			if (dialog.open) {
				dialog.close();
				restore();
			} else {
				dialog.showModal();
				dialog.append(canvas);
				button.title = "Restore map";
				button.setAttribute("aria-label", button.title);
				button.setAttribute("aria-pressed", "true");
				button.focus({ preventScroll: true });
				map.invalidateSize();
			}
		});
		dialog.addEventListener("cancel", event => {
			event.preventDefault();
			dialog.close();
			restore();
		});
		dialog.addEventListener("close", restore);
		return container;
	};
	fullscreen.addTo(map);
	for (const marker of markers) {
		const pin = L.marker(marker.position).addTo(map);
		if (marker.HTML) pin.bindPopup(marker.HTML);
	}
	if (markers.length === 1) map.setView(markers[0].position, 13);
	else if (markers.length > 1) map.fitBounds(markers.map(marker => marker.position), { padding: [20, 20], maxZoom: 13 });
	map.on("popupopen", async event => {
		try {
			await _stwSetupContent(event.popup.getElement());
		} catch (error) {
			console.error("Failed to load popup content:", error);
		}
	});
}
<\/script>`;
	}
}

registerElement("Geomap", STWGeomap);
export {
	STWGeomap
};
