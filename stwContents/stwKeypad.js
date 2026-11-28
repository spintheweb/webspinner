/**
 * @fileoverview Renders an on-screen keypad for the focused input.
 *
 * Copyright(c) 2017 Giancarlo Trevisan
 * MIT Licensed
 *
 * @module stwKeypad
 * @note Copilot-assisted
 * @license MIT
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";

function escapeHtml(value) {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

class STWKeypad extends STWContent {
	async render(_request, session, records, placeholders = session.placeholders) {
		const layout = this.getLayout(session);
		const layoutPlaceholders = new Map(placeholders);
		layoutPlaceholders.set("@@stworigin", this.uuid);
		const { settings, scripts } = await layout.render(records.fields, layoutPlaceholders, session, "", this.uuid);
		const mode = settings.get("mode");
		if (typeof mode !== "string" || !mode)
			throw new Error("Keypad requires a non-empty mode setting");

		const rows = mode.split(/\r\n|\r|\n/).map(row => {
			let buttons = "";
			for (let i = 0; i < row.length;) {
				if (row[i] === "{") {
					const end = row.indexOf("}", i + 1);
					if (end === -1 || row.slice(i, end + 1) !== "{ENTER}")
						throw new Error(`Unsupported keypad key: ${end === -1 ? row.slice(i) : row.slice(i, end + 1)}`);
					buttons += '<button type="button" data-stw-keypad-enter>ENTER</button>';
					i = end + 1;
				} else {
					if (row[i] === "}") throw new Error("Unexpected } in keypad mode");
					const key = String.fromCodePoint(row.codePointAt(i));
					if (/[\u0000-\u001f\u007f]/.test(key))
						throw new Error("Keypad mode contains an unsupported control character");
					const escaped = escapeHtml(key);
					buttons += `<button type="button" data-stw-keypad-key="${escaped}"${key === " " ? ' aria-label="Space"' : ""}>${escaped}</button>`;
					i += key.length;
				}
			}
			return `<div>${buttons}</div>`;
		});

		return `<div class="stwKeypadKeys" role="group" aria-label="Keypad">${rows.join("")}</div>
<script name="STWKeypad" onload="stwInitKeypad(this)">
var stwInitKeypad = (() => {
	let target = null;
	const isEditable = element => element instanceof HTMLTextAreaElement ||
		element instanceof HTMLInputElement && ["text", "search", "tel", "url", "email", "password", "number"].includes(element.type);
	const selectTarget = element => {
		if (isEditable(element)) target = element;
		else if (!element.closest(".stwKeypadKeys")) target = null;
	};
	selectTarget(document.activeElement);
	document.addEventListener("focusin", event => selectTarget(event.target));
	document.addEventListener("pointerdown", event => {
		if (!event.target.closest(".stwKeypadKeys") && event.target !== target) target = null;
	}, true);
	return script => {
		const keypad = script.previousElementSibling;
		keypad.addEventListener("pointerdown", event => {
			if (event.target.closest("button")) event.preventDefault();
		});
		keypad.addEventListener("click", event => {
			const button = event.target.closest("button");
			if (!button || !keypad.contains(button)) return;
			if (!target || !target.isConnected || target.matches(":disabled") || target.readOnly) {
				console.warn("Keypad requires a focused editable input.");
				return;
			}
			target.focus({ preventScroll: true });
			if (button.hasAttribute("data-stw-keypad-enter")) {
				const form = target.form;
				if (!form) {
					console.warn("Keypad ENTER requires an input associated with a form.");
					return;
				}
				const submitter = [...document.querySelectorAll("button, input")].find(element =>
					element.form === form && (element.type === "submit" || element.type === "image"));
				if (submitter) {
					if (!submitter.matches(":disabled")) submitter.click();
				} else {
					form.requestSubmit();
				}
			} else {
				// Native editing preserves selection, input events, undo, and number-input intermediate values.
				if (!document.execCommand("insertText", false, button.dataset.stwKeypadKey))
					console.error("Keypad could not insert the selected key.");
			}
		});
	};
})();
<\/script>${scripts || ""}`;
	}
}

registerElement("Keypad", STWKeypad);
export { STWKeypad };
