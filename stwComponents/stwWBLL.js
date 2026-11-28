/**
 * @fileoverview Generate a runtime rendering function from WBLL code. 
 *
 * Given WBLL code and a content type, generates the body of a function that is then used to render data.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwWBLL
 * @note Copilot-assisted
 * @license Apache-2.0
 */
import { WBPL } from "./stwWBPL.js";
import { signAction } from "./stwActionToken.js";
import { newId } from "./stwIds.js";

const WBLL = { a, A, b, c, d, D, e, f, h, i, j, k, l, L, m, n, o, O, r, s, S, t, u, v, w, x, y, z, $s, $A, $r, $n, $t, $mc };
const FLAGS = {
	stwnone: 0,
	stwinsert: 1,
	stwupdate: 2,
	stwdelete: 4,
	stwsearch: 8,
	stwfilter: 16,
	stwsubmit: 32,
	stwlogon: 64,
	stwlogoff: 128,
	stwpwdreset: 256,
	stwreset: 512,
	stwsummary: 1024,
	stwnovalue: 25,
	stwcud: 7,
	stwany: -1
};
function escapeAttribute(value) {
	return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

class ChoiceQueryError extends Error {}
class EmbedFetchError extends Error {}
class EditorFormatError extends Error {}

class STWLayout {
	wbll;
	justSettings;
	renderer;

	// Define rendering function, placeholders are updated at runtime
	constructor(wbll) {
		this.wbll = wbll;
		const SYMBOLS = new RegExp(
			[
				/(\\r)/,
				/(\\[aAs])(?:\('([^]*?)'\))/,
				/(\\[nt])(?:\('([^]*?)'\))?/,
				/(j)(?:\('((?:\\'|\\(?!')|[^\\])*?)'\))?/,
				/(?:([aAcefhilLmoOpquwxyz]))(?:\('([^]*?)'\))?/,
				/(?:([bdDnrsStvk]))(?:\('([^]*?)'\))/,
				/\/\/.*$/,
				/\/\*[^]*\*\//,
				/(<+|>+)/,
				/(?<error>[\S])/
			].map((r2) => r2.source).join("|"),
			"gmu"
		);

		const code = [];
		let closed = false;
		for (const expression of wbll.matchAll(SYMBOLS)) {
			if (expression.groups?.error !== void 0)
				throw new SyntaxError(`Syntax error at ${layoutPosition(wbll, expression.index)}: unexpected ${JSON.stringify(expression.groups.error)}`);
			const pattern = expression.filter((value, i2) => value !== void 0 && i2);
			if (pattern[0]) {
				if (["<", ">"].includes(pattern[0].at(0) ?? ""))
					code.push(`WBLL.$mc(${(pattern[0].at(0) === "<" ? -1 : 1) * pattern[0].length}, ${expression.index}, runtime)`);
				else {
					const argument = pattern[1] == null ? "null" : pattern[0] === "j"
						? JSON.stringify(pattern[1].replace(/\\'(?=\))/g, "'"))
						: '"' + pattern[1].replace(/"/g, '\\"') + '"';
					const fragment = `${pattern[0].replace("\\", "$")}(${argument}, ${expression.index}, runtime)`;
					if (pattern[0].match(/(p|q|\\a)/) || code.length && code[code.length - 1].match(/^WBLL\.[aAb]/) && pattern[0].match(/^[defintvxyzt]/) && !closed) {
						code[code.length - 1] = code[code.length - 1] + `.${fragment}`;
						closed = pattern[0].match(/^[defintvxyzt]/) !== null;
					} else {
						code.push("WBLL." + fragment);
						closed = false;
					}
				}
			}
		}
		for (let i2 = 0; i2 < code.length; ++i2) {
			if (code[i2].startsWith("WBLL.$n") && code[i2 + 1]?.startsWith("WBLL.$A"))
				code[i2] = "";
			else
				code[i2] = code[i2].match(/^WBLL\.(\$s|\$mc|k|j)/) ? `${code[i2]};` : `await ${code[i2]}.$();`;
		}

		this.justSettings = !code.some((line) => line.startsWith("await "));
		code.push(`runtime.HTML += [...runtime.Wrappers].reverse().map(el => \`</\${el}>\`).join("");`);
		code.push(`let renderIn = ["thead", "tbody", "tfoot"].includes(runtime.RenderIn) ? "tr" : runtime.RenderIn;`);
		code.push(`if (renderIn) runtime.HTML = \`<\${renderIn}>\${runtime.HTML}</\${renderIn}>\`;`);
		code.push(`runtime.Wrappers = [];`);

		const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
		this.renderer = new AsyncFunction("WBLL", "WBPL", "runtime", code.join("").replaceAll(/(\n|\r|\t)/g, ""));
	}

	async render(fields, placeholders, session = { placeholders: new Map([["@@stwlanguage", "en"], ...placeholders]), baseurl: "", tz: "UTC" }, renderIn = "", contentId = "") {
		const runtime = {
			Session: session,
			Fields: fields,
			FormFields: 0,
			Flags: FLAGS.stwnone,
			Placeholders: placeholders,
			HTML: "",
			RenderIn: renderIn,
			TableSection: renderIn,
			Wrappers: [],
			FldIndex: 0,
			Settings: new Map(),
			Scripts: [],
			Actions: "", // Filtering, CRUD, Summary
			ContentId: contentId,
			Cols: 1,
			Index: 0,
			Downgrade: false, // From table to form
			Mode: FLAGS.stwnone,
			HasEmbeddedContent: false
		};
		try {
			await this.renderer(WBLL, WBPL, runtime);

			// Tables are rendered particularly
			if (renderIn === "thead" && runtime.Flags & (FLAGS.stwsearch | FLAGS.stwfilter)) {
				runtime.RenderIn = "tbody";
				runtime.FormFields = 0;
				runtime.FldIndex = 0;
				runtime.Actions = "";
				runtime.Mode = runtime.Flags & (FLAGS.stwsearch | FLAGS.stwfilter);
				await this.renderer(WBLL, WBPL, runtime);
				runtime.HTML += `<tr><td colspan="${runtime.Cols}">${runtime.Actions}</td></tr>`;
			}
			if (renderIn === "thead" && runtime.Flags & FLAGS.stwinsert) {
				const precedingHTML = runtime.HTML;
				runtime.RenderIn = "tbody";
				runtime.FormFields = 0;
				runtime.FldIndex = 0;
				runtime.Actions = "";
				runtime.HTML = "";
				runtime.Mode = FLAGS.stwinsert;
				runtime.Flags = FLAGS.stwinsert;
				await this.renderer(WBLL, WBPL, runtime);
				const actionMarkup = runtime.Actions;
				const insertRow = runtime.HTML.replace("</tr>", `<td><span class="stwTableInsertActions" hidden>${actionMarkup}</span></tr>`)
					.replace(/<tr(?=[\s>])/, "<tr data-stw-insert-row hidden");
				runtime.HTML = `${precedingHTML}<tr class="stwTableInsertCommand"><th colspan="${runtime.Cols}"><button type="button" class="stwTableEditInsert">Edit</button></th></tr>${insertRow}`;
			}
			if (renderIn === "tbody" && runtime.Actions) {
				const rowActions = runtime.Actions;
				const canEdit = /\bvalue="stw(?:update|delete)"/.test(rowActions);
				const actionCell = canEdit
					? `<td><button type="button" class="stwTableEditRow">Edit</button><span class="stwTableRowActions" hidden>${rowActions}</span></td>`
					: `<td>${rowActions}</td>`;
				runtime.HTML = runtime.HTML.replace("</tr>", `${actionCell}</tr>`);
			}
			if (renderIn === "tfoot" && !(runtime.Flags & FLAGS.stwsummary))
				return { settings: runtime.Settings, HTML: "" };

			const scripts = runtime.Scripts.join("");
			return {
				settings: runtime.Settings,
				HTML: runtime.HTML + scripts,
				scripts,
				hasEmbeddedContent: runtime.HasEmbeddedContent,
				formFields: runtime.FormFields
			};
		} catch (error) {
			if (error instanceof ChoiceQueryError || error instanceof EmbedFetchError || error instanceof EditorFormatError) throw error;
			throw new Error(`Layout error at ${layoutPosition(this.wbll, runtime.Index)}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
		}
	}
}

function layoutPosition(wbll, index) {
	const lines = wbll.slice(0, index).split("\n");
	return `line ${lines.length}, column ${lines.at(-1).length + 1}`;
}

//#region Symbols classes
class RootSymbol {
	runtime;
	text = "";
	tagName = "";
	args = [];
	attrs = new Map();

	constructor(attrs = "", tagName = "", runtime) {
		this.runtime = runtime;
		this.tagName = tagName;
		if (attrs)
			for (const pair of attrs.matchAll(/([A-Za-z0-9:\-.]+)(?:="([^"]*)")?/g)) {
				const [, key, value] = pair;
				this.attrs.set(key, value ?? true);
			}
	}

	toString() {
		const htmlAttrs = [...this.attrs.entries()].map(([key, value]) => value === true ? ` ${key}` : ` ${key}="${escapeAttribute(value)}"`).join("");
		return `<${this.tagName}${htmlAttrs}>`;
	}
	
	$() {
		if (!["thead", "tbody", "tfoot"].includes(this.runtime.RenderIn))
			this.runtime.HTML += this.toString();
		else if (this.runtime.RenderIn === "thead") {
			if (this instanceof LabelSymbol)
				this.runtime.HTML += this.toString();
		} else if (this.runtime.RenderIn !== "tfoot")
			this.runtime.HTML += this.toString();
	}
}
class BaseSymbol extends RootSymbol {
	constructor(args, tagName = "", runtime) {
		super(void 0, tagName, runtime);
		let c2 = "";
		let quoted = false;
		let param = "";
		for (c2 of args ?? "") {
			if (c2 === '"') quoted = !quoted;
			else if (c2 === ";" && !quoted) this.args.push(param), param = "";
			else param += c2;
		}
		this.args.push(param.trim());
	}

	$a(attrs, index, runtime) {
		runtime.Index = index;
		attrs = WBPL(attrs, runtime.Placeholders);
		if (!this.tagName)
			this.tagName = "span";
		for (const pair of attrs.matchAll(/([A-Za-z0-9:\-.]+)(?:="([^"]*)")?/g)) {
			const [, key, value] = pair;
			this.attrs.set(key, value ?? true);
		}
		return this;
	}

	toString() {
		if (!this.tagName) return this.text;
		const htmlAttrs = [...this.attrs.entries()].map(([key, value]) => value === true ? ` ${key}` : ` ${key}="${escapeAttribute(value)}"`).join("");
		switch (this.tagName) {
			case "input":
			case "img":
				return `<${this.tagName}${htmlAttrs}>`;
			case "label":
				return `<${this.tagName}${htmlAttrs}>${this.text}`;
			default:
				return `<${this.tagName}${htmlAttrs}>${this.text}</${this.tagName}>`;
		}
	}
}
class TextSymbol extends BaseSymbol {
	constructor(args, tagName = "", runtime) {
		super(args, tagName, runtime);
		this.text = args || Field(runtime);
	}
}
class AnchorSymbol extends BaseSymbol {
	url;
	constructor(url, tagName = "a", runtime) {
		super(url, tagName, runtime);
		url = url || Field(runtime);
		try {
			this.url = new URL(url);
		} catch {
			this.url = new URL(url, `https://${runtime.Session.baseurl}`);
		}
		this.text = url;
		this.attrs.set("href", this.url.toString());
	}
	p(args, index, runtime) {
		if (args === ".")
			return this.q(args, index, runtime);
		runtime.Index = index;
		args = WBPL(args, runtime.Placeholders) || Field(runtime, ";");
		const search = `${args};`.split(";");
		this.url.searchParams.set(search[0] ?? "", search[1] ?? "");
		this.attrs.set("href", this.url.toString());
		return this;
	}
	q(args, index, runtime) {
		runtime.Index = index;
		if (args === ".")
			args = String(runtime.Placeholders.get("@@query_string"));
		else
			args = WBPL(args, runtime.Placeholders);
		try {
			const qs = (args || Field(runtime) || "").trim().replace(/^\?/, "");
			const params = new URLSearchParams(qs);
			for (const [k2, v2] of params.entries())
				this.url.searchParams.set(k2, v2);
			this.attrs.set("href", this.url.toString());
		} catch {
		}
		return this;
	}
	t(args, index, runtime) {
		const symbol = WBLL.t(args, index, runtime);
		this.text = symbol.text;
		return this;
	}
	v(args, index, runtime) {
		const symbol = WBLL.v(args, index, runtime);
		this.text = symbol.text;
		return this;
	}
	f(args, index, runtime) {
		const symbol = WBLL.f(args, index, runtime);
		this.text = symbol.text;
		return this;
	}
	e(args, index, runtime) {
		const symbol = WBLL.f(args, index, runtime);
		this.text = symbol.text;
		return this;
	}
	i(args, index, runtime) {
		const symbol = WBLL.i(args, index, runtime);
		this.text = BaseSymbol.prototype.toString.call(symbol);
		return this;
	}
	n(args, index, runtime) {
		const symbol = WBLL.n(args, index, runtime);
		this.text = symbol.text;
		return this;
	}
	x(args, index, runtime) {
		const symbol = WBLL.x(args, index, runtime);
		this.text = symbol.text;
		return this;
	}
	y(args, index, runtime) {
		const symbol = WBLL.y(args, index, runtime);
		this.text = symbol.text;
		return this;
	}
	z(args, index, runtime) {
		const symbol = WBLL.z(args, index, runtime);
		this.text = symbol.text;
		return this;
	}
}
class LabelSymbol extends BaseSymbol {
	mode;
	constructor(args, runtime) {
		const mode = runtime.RenderIn === "thead" ? "header" : runtime.RenderIn === "tbody" || runtime.RenderIn === "tfoot" ? "cell" : "form";
		const tagName = mode === "header" ? "th" : mode === "cell" ? "td" : "label";
		super(args, tagName, runtime);
		this.mode = mode;
		this.runtime.Flags |= this.args[2] ? FLAGS.stwsummary : 0;
		if (mode === "cell") {
			this.runtime.Cols++;
			runtime.Wrappers.push("td");
			return;
		}
		if (runtime.RenderIn === "tfoot")
			this.text = this.args[2] || this.args[0] || "";
		else
			this.text = this.args[0] || (args == null ? mode === "header" ? runtime.Fields[runtime.FldIndex] : Field(runtime) : "");
		if (runtime.RenderIn === "thead" && this.args[1] != null)
			this.text += `<span class="stwOrderBy" data-orderby="${this.args[1] || runtime.Fields[runtime.FldIndex]}"><i class="fa-light fa-fw fa-angle-up"></i><i class="fa-light fa-fw fa-angle-down"></i></span>`;
		if (mode === "form") {
			runtime.Wrappers.push("label");
			this.attrs.set("for", `stwE${runtime.FormFields}`);
		}
	}
	toString() {
		return this.mode === "cell" ? RootSymbol.prototype.toString.call(this) : super.toString();
	}
}
class FormSymbol extends BaseSymbol {
	constructor(args, tagName = "input", runtime, resolveArgs = false) {
		super(args, tagName, runtime);

		if (resolveArgs) 
			this.args = this.args.map((arg) => WBPL(arg, runtime.Placeholders));
		if (!this.attrs.has("type") && this.args[0])
			this.attrs.set("type", this.args[0]);
		if (!this.attrs.has("id"))
			this.attrs.set("id", `stwE${runtime.FormFields}`);
		if (!this.attrs.has("name"))
			this.attrs.set("name", this.args[1] || runtime.Fields[runtime.FldIndex] || `stwE${runtime.FormFields}`);
		if (runtime.ContentId && ["thead", "tbody"].includes(runtime.RenderIn))
			this.attrs.set("form", `stwF${runtime.Mode & (FLAGS.stwsearch | FLAGS.stwfilter) ? "S" : "E"}${runtime.ContentId}`);
		if (runtime.ContentId && runtime.RenderIn === "tbody" && !(runtime.Mode & (FLAGS.stwsearch | FLAGS.stwfilter | FLAGS.stwinsert)))
			this.attrs.set("hidden", true);
		if (!this.attrs.has("value"))
			this.attrs.set("value", this.attrs.get("name") !== runtime.Fields[runtime.FldIndex] || runtime.Flags & (FLAGS.stwsearch | FLAGS.stwfilter | FLAGS.stwinsert) ? this.args[2] ?? "" : Field(runtime));
		++runtime.FormFields;
		if (this.runtime.Settings.has("disabled"))
			this.attrs.set("disabled", this.runtime.Settings.get("disabled") ?? true);
	}
	toString() {
		let fragment = "";
		if (this.tagName === "input" && this.args[3]) {
			this.attrs.set("list", `${this.attrs.get("id") ?? "Fld0"}_options`);
			fragment = `<datalist id="${this.attrs.get("id") ?? "Fld0"}_options">`;
			for (let i2 = 3; i2 < this.args.length; ++i2)
				fragment += `<option value="${this.args[i2]}"></option>`;
			fragment += "</datalist>";
		}
		return fragment + super.toString();
	}
}
class TextAreaSymbol extends FormSymbol {
	constructor(args, tagName = "textarea", runtime) {
		super(args, tagName, runtime, true);
		const format = this.args[0];
		if (!["", "textarea", "wysiwyg", "javascript", "html", "css"].includes(format))
			throw new EditorFormatError(`Unsupported multiline input format: ${format}`);
		if (format && format !== "textarea")
			this.attrs.set("data-stw-editor", format);
		this.text = String(this.attrs.get("value") ?? "");
		this.attrs.delete("type");
		this.attrs.delete("value");
	}
	toString() {
		const htmlAttrs = [...this.attrs.entries()].map(([key, value]) => value === true ? ` ${key}` : ` ${key}="${escapeAttribute(value)}"`).join("");
		return `<${this.tagName}${htmlAttrs}>${escapeAttribute(this.text)}</${this.tagName}>`;
	}
}
class ButtonSymbol extends FormSymbol {
	url;
	currentUrl;
	relativeUrl;
	params = new Map();
	constructor(args, tagName = "button", runtime) {
		super(args, tagName, runtime);
		this.attrs.set("type", "submit");
		this.attrs.delete("value");
		const rawArgs = [...this.args];
		this.args[0] = WBPL(this.args[0] || "", runtime.Placeholders);
		this.relativeUrl = !/^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/)/.test(this.args[0]);
		if (!this.relativeUrl) {
			this.url = new URL(this.args[0]);
		} else {
			this.url = new URL(this.args[0] || ".", "http://stw.invalid");
		}
		this.currentUrl = rawArgs[0] === ".";
		const actionName = (this.args[1] || "stw").toLocaleLowerCase();
		const action = FLAGS[actionName] ?? FLAGS.stwnone;
		const argsForAction = rawArgs.slice(2);
		const token = signAction({
			action: actionName,
			args: argsForAction,
			currentUrl: this.currentUrl,
			redirect: this.urlValue(),
			origin: runtime.ContentId,
			params: []
		}, runtime.Session.sessionId);
		this.attrs.set("name", "stwAction");
		this.attrs.set("value", actionName);
		this.attrs.set("data-stw-origin", runtime.ContentId);
		this.attrs.set("data-stw-params", "[]");
		if (this.currentUrl) this.attrs.set("data-stw-current-url", "true");
		this.attrs.set("data-stw-action-token", token);
		this.attrs.set("formaction", this.urlValue());

		if (action & (FLAGS.stwsearch | FLAGS.stwfilter)) {
			this.text = action & FLAGS.stwsearch ? "Search" : "Filter";
			this.attrs.delete("name");
			this.attrs.set("formmethod", "GET");
		} else if (action & FLAGS.stwdelete) {
			this.text = "Delete";
			this.attrs.set("formmethod", "POST");
		} else if (action & FLAGS.stwupdate) {
			this.text = "Update";
			this.attrs.set("formmethod", "POST");
		} else if (action & FLAGS.stwinsert) {
			this.text = "Insert";
			this.attrs.set("formmethod", "POST");
		} else if (action & FLAGS.stwreset) {
			this.text = "Reset";
			this.attrs.set("type", "reset");
		} else if (action & FLAGS.stwlogon) {
			this.text = "Log on";
			this.attrs.set("formmethod", "POST");
		} else if (action & FLAGS.stwlogoff) {
			this.text = "Log off";
			this.attrs.set("formmethod", "POST");
		} else {
			this.text = "Submit";
			this.attrs.set("formmethod", "POST");
		}
		runtime.Flags |= action;
	}
	p(args, index, runtime) {
		if (args === ".")
			return this.q(args, index, runtime);
		runtime.Index = index;
		args = WBPL(args, runtime.Placeholders);
		const search = `${args};;`.split(";");
		this.params.set(search[0] ?? "", search[1] ?? "");
		this.url.searchParams.set(search[0] ?? "", search[1] ?? "");
		this.updateActionToken();
		this.attrs.set("formaction", this.urlValue());
		return this;
	}
	q(args, index, runtime) {
		runtime.Index = index;
		if (args === ".")
			args = String(runtime.Placeholders.get("@@query_string"));
		else
			args = WBPL(args, runtime.Placeholders);
		try {
			const qs = (args ?? "").trim().replace(/^\?/, "");
			const params = new URLSearchParams(qs);
			for (const [k2, v2] of params.entries())
				this.url.searchParams.set(k2, v2);
			for (const [k2, v2] of params.entries())
				this.params.set(k2, v2);
			this.updateActionToken();
			this.attrs.set("formaction", this.urlValue());
		} catch {
		}
		return this;
	}
	t(args, index, runtime) {
		const symbol = WBLL.t(args, index, runtime);
		this.text = symbol.text;
		return this;
	}
	toString() {
		if (this.runtime.Settings.get("disabled"))
			return "";
		const fragment = super.toString();
		if (["thead", "tbody", "tfoot"].includes(this.runtime.RenderIn)) {
			this.runtime.Actions += fragment;
			return "";
		}
		return fragment;
	}
	updateActionToken() {
		const payload = JSON.parse(Buffer.from(this.attrs.get("data-stw-action-token").split(".")[0], "base64url").toString("utf8"));
		payload.params = [...this.params.entries()];
		this.attrs.set("data-stw-params", JSON.stringify(payload.params));
		this.attrs.set("data-stw-action-token", signAction(payload, this.runtime.Session.sessionId));
	}
	urlValue() {
		return this.relativeUrl ? `${this.url.pathname}${this.url.search}${this.url.hash}` : this.url.toString();
	}
}
class ChoiceSymbol extends FormSymbol {
	constructor(args, tagName = "checkbox", runtime) {
		super(args, tagName, runtime);
	}
	toString() {
		const type = this.attrs.get("type");
		const supportsGroups = this.tagName === "select" || type === "checkbox" || type === "radio";
		const mode = supportsGroups && this.args[3] === "3" ? 3 : [, "1", "2"].indexOf(this.args[3]);
		if (mode !== -1) {
			const tagName = this.attrs.get("type");
			this.attrs.delete("type");
			let htmlAttrs = [...this.attrs.entries()].map(([key, value]) => value === true ? ` ${key}` : ` ${key}="${escapeAttribute(value ?? "")}"`).join("");
			if (this.options && (tagName === "checkbox" || tagName === "radio")) {
				const groups = new Map();
				for (const option of this.options) {
					const group = option.group ?? "";
					groups.set(group, [...groups.get(group) ?? [], option]);
				}
				const selected = String(this.attrs.get("value") ?? "").split(",");
				const updateValue = tagName === "checkbox" ? `this.querySelector('input[type="hidden"]').value=[...this.querySelectorAll(":checked")].map(el => el.value).join(',')` : `this.querySelectorAll('input[type="radio"]').forEach(el => el.checked=el==event.target);this.querySelector('input[type="hidden"]').value=event.target.value`;
				let fragment = `<div class="stwChoices" onchange="${escapeAttribute(updateValue)}"><input type="hidden"${htmlAttrs}>`;
				for (const [group, options] of groups) {
					fragment += `<fieldset>${group ? `<legend>${escapeAttribute(group)}</legend>` : ""}`;
					for (const option of options) {
						const checked = tagName === "checkbox" ? selected.includes(option.value) : option.value === selected.join(",");
						fragment += `<label><input type="${tagName}" value="${escapeAttribute(option.value)}"${checked ? " checked" : ""}${this.attrs.has("disabled") || option.label.charAt(0) === "!" ? " disabled" : ""}> ${escapeAttribute(option.label)}</label>`;
					}
					fragment += "</fieldset>";
				}
				return fragment + "</div>";
			}
			if (mode === 3 && (tagName === "checkbox" || tagName === "radio")) {
				const options = this.choiceItems(this.args, mode);
				const groups = new Map();
				for (const option of options) {
					const group = option.group ?? "";
					groups.set(group, [...groups.get(group) ?? [], option]);
				}
				const updateValue = tagName === "checkbox" ? `this.querySelector('input[type="hidden"]').value=[...this.querySelectorAll(":checked")].map(el => el.value).join(',')` : `this.querySelectorAll('input[type="radio"]').forEach(el => el.checked=el==event.target);this.querySelector('input[type="hidden"]').value=event.target.value`;
				let fragment2 = `<div class="stwChoices" onchange="${updateValue}"><input type="hidden"${htmlAttrs}>`;
				for (const [group, groupedOptions] of groups) {
					fragment2 += `<fieldset>${group ? `<legend>${group}</legend>` : ""}`;
					for (const option of groupedOptions) {
						fragment2 += `<label><input type="${tagName}" value="${option.value}"${option.value === (this.attrs.get("value") ?? "") ? " checked" : ""}${this.attrs.has("disabled") || option.label.charAt(0) === "!" ? " disabled" : ""}> ${option.label}</label>`;
					}
					fragment2 += "</fieldset>";
				}
				return fragment2 + "</div>";
			}
			let fragment = `<input type="hidden"${htmlAttrs}><fieldset class="stwChoices" onchange="`;
			if (tagName === "checkbox") {
				if (mode === 1)
					fragment += `this.previousElementSibling.value=[...this.querySelectorAll(':checked')].reduce((acc, el) => acc + Number(el.value), 0)">`;
				else
					fragment += `this.previousElementSibling.value=[...this.querySelectorAll(':checked')].map(el => el.value).join(',')">`;
				for (let i2 = 4; i2 < this.args.length; i2 += mode)
					fragment += `<label><input type="checkbox" value="${mode === 1 ? 1 << i2 - 4 : this.args[i2]}"${this.args[i2] === (this.attrs.get("value") ?? "") ? " checked" : ""}${this.attrs.has("disabled") || this.args[i2 + mode - 1].charAt(0) === "!" ? " disabled" : ""}> ${this.args[i2 + mode - 1]}</label>`;
				fragment += "</fieldset>";
			} else if (tagName === "radio") {
				fragment += `this.querySelectorAll('input').forEach(el => el.checked=el==event.target);this.previousElementSibling.value=event.target.value">`;
				for (let i2 = 4; i2 < this.args.length; i2 += mode)
					fragment += `<label><input type="radio" value="${this.args[i2]}"${this.args[i2] === (this.attrs.get("value") ?? "") ? " checked" : ""}${this.attrs.has("disabled") || this.args[i2 + mode - 1].charAt(0) === "!" ? " disabled" : ""}> ${this.args[i2 + mode - 1]}</label>`;
				fragment += "</fieldset>";
			} else if (this.tagName === "select") {
				fragment = `<select${htmlAttrs}>`;
				if (this.attrs.has("data-blank")) {
					fragment += '<option value=""></option>';
					this.attrs.delete("data-blank");
				}
				const options = this.choiceItems(this.args, mode);
				const selected = String(this.attrs.get("value") ?? "");
				const renderOption = ({ value, label }) => `<option value="${escapeAttribute(value)}"${(this.attrs.has("multiple") ? selected.split(",").includes(value) : value === selected) ? " selected" : ""}${label.charAt(0) === "!" ? " disabled" : ""}>${escapeAttribute(label)}</option>`;
				if (mode === 3) {
					const groups = new Map();
					for (const option of options) {
						const group = option.group ?? "";
						groups.set(group, [...groups.get(group) ?? [], option]);
					}
					for (const [group, groupedOptions] of groups)
						fragment += group ? `<optgroup label="${escapeAttribute(group)}">${groupedOptions.map(renderOption).join("")}</optgroup>` : groupedOptions.map(renderOption).join("");
				} else {
					fragment += options.map(renderOption).join("");
				}
				fragment += "</select>";
			} else {
				let i2 = Number(this.attrs.get("value")) + 3;
				if (mode === 2) {
					for (i2 = 4; i2 < this.args.length; i2 += 2)
						if (this.args[i2] == this.attrs.get("value"))
							break;
				}
				this.attrs.delete("id");
				this.attrs.delete("name");
				this.attrs.delete("value");
				htmlAttrs = [...this.attrs.entries()].map(([key, value]) => value === true ? ` ${key}` : ` ${key}="${value || ""}"`).join("");
				fragment = this.args[i2 + 1] || "";
				if (htmlAttrs)
					fragment = `<span${htmlAttrs}>${fragment}</span>`;
			}
			return fragment;
		} else if (this.tagName === "checkbox")
			return `<input${[...this.attrs.entries()].map(
				([key, value]) => value === "" ? ` ${key}` : ` ${key}="${value || ""}"`
			).join("")}>`;
		throw new SyntaxError();
	}
	choiceItems(args, arity) {
		const items = [];
		for (let i2 = 4; i2 < args.length; i2 += arity) {
			items.push({
				value: args[i2],
				label: arity === 1 ? args[i2] : args[i2 + 1],
				group: arity === 3 ? args[i2 + 2] : void 0
			});
		}
		return items;
	}
}
class ConnectorChoiceSymbol extends ChoiceSymbol {
	constructor(args, tagName, runtime) {
		super(`;${WBPL(args, runtime.Placeholders) ?? ";;"}`, tagName, runtime);
		const source = /^([^;]*);([^;]*);([^;]+);([\s\S]*)$/.exec(args ?? "");
		const connector = source ? WBPL(source[3], runtime.Placeholders) : "";
		if (source && connector && !["1", "2", "3"].includes(connector)) {
			this.source = { connector, query: source[4] };
		}
	}
	async $() {
		if (this.source) {
			try {
				const { STWConnectors } = await import("./stwConnectors.js");
				const session = { ...this.runtime.Session, placeholders: this.runtime.Placeholders };
				const records = await STWConnectors.query(session, this.source.connector, this.source.query, { throwOnError: true });
				if (records.fields.length > 3 || (!records.fields.length && records.rows.length)) {
					throw new TypeError("Choice queries must return one to three columns");
				}
				this.args[3] = String(records.fields.length || 1);
				this.options = records.rows.map((row) => {
					const [value, label, group] = records.fields.map((field) => String(row[field] ?? ""));
					return { value, label: label ?? value, group };
				});
			} catch (error) {
				throw new ChoiceQueryError(`Choice query failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
			}
		}
		return super.$();
	}
	choiceItems(args, arity) {
		return this.options ?? super.choiceItems(args, arity);
	}
}
class EmbedSymbol extends BaseSymbol {
	url;
	relativeUrl;
	localContent;
	constructor(args, tagName = "", runtime) {
		super(args, tagName, runtime);

		this.relativeUrl = !/^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/)/.test(this.args[0]);
		const base = runtime.Session.baseurl ? `https://${runtime.Session.baseurl}` : "http://stw.invalid";
		this.url = new URL(this.args[0] || ".", base);
		this.localContent = this.relativeUrl || (runtime.Session.baseurl && this.url.host === new URL(base).host);
		
		if (tagName === "iframe") {
			this.attrs.set("src", this.urlValue());
			this.attrs.set("style", "display:block;width:100%;height:100%;border:none;");
		} else if (this.localContent) {
			this.tagName = "article";
			this.attrs.set("id", newId("c"));
			this.attrs.set("href", this.contentUrl());
		}
	}
	p(args, index, runtime) {
		runtime.Index = index;
		args = WBPL(args, runtime.Placeholders);
		const search = `${args};;`.split(";");
		this.url.searchParams.set(search[0] ?? "", search[1] ?? "");
		if (this.tagName)
			this.attrs.set(this.tagName === "iframe" ? "src" : "href", this.tagName === "iframe" ? this.urlValue() : this.contentUrl());
		return this;
	}
	q(args, index, runtime) {
		runtime.Index = index;
		args = WBPL(args, runtime.Placeholders);
		try {
			const qs = (args ?? "").trim().replace(/^\?/, "");
			const params = new URLSearchParams(qs);
			for (const [k2, v2] of params.entries())
				this.url.searchParams.set(k2, v2);
			if (this.tagName)
				this.attrs.set(this.tagName === "iframe" ? "src" : "href", this.tagName === "iframe" ? this.urlValue() : this.contentUrl());
		} catch {
		}
		return this;
	}
	async $() {
		if (this.runtime.Downgrade)
			return;
		if (this.tagName === "article") {
			const portal = this.runtime.Session.portal;
			if (portal && !portal.find(this.runtime.Session, this.contentUrl()))
				throw new EmbedFetchError(`Embedded content not found: ${this.contentUrl()}`);
			this.runtime.HasEmbeddedContent = true;
			this.runtime.HTML += super.toString();
		} else if (this.tagName === "iframe") {
			this.runtime.HTML += super.toString();
		} else {
			try {
				const response = await fetch(this.url);
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				this.runtime.HTML += await response.text();
			} catch (error) {
				throw new EmbedFetchError(`Embedded content request failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
			}
		}
	}
	urlValue() {
		return this.relativeUrl ? `${this.url.pathname}${this.url.search}${this.url.hash}` : this.url.toString();
	}
	contentUrl() {
		const pathname = /^[xwapc][0-9a-zA-Z]{21,22}(?:[?#]|$)/i.test(this.args[0])
			? this.url.pathname.slice(1) : this.url.pathname;
		return `${pathname}${this.url.search}${this.url.hash}`;
	}
}
class ProgressSymbol extends BaseSymbol {
	value;
	constructor(value, runtime) {
		super(void 0, "div", runtime);
		this.value = Number(value);
		this.attrs.set("role", "progressbar");
		this.attrs.set("aria-valuemin", 0);
		this.attrs.set("aria-valuemax", 1);
		this.attrs.set("aria-valuenow", this.value);
		this.attrs.set("style", "background-color:GrayText;color:AccentColor;");
	}
	toString() {
		if (!Number.isFinite(this.value) || this.value < 0 || this.value > 1)
			return "";
		const htmlAttrs = [...this.attrs.entries()].map(([key, value]) => value === true ? ` ${key}` : ` ${key}="${escapeAttribute(value)}"`).join("");
		return `<div${htmlAttrs}><div style="display:block;width:${this.value * 100}%;height:1rem;background-color:currentColor"></div></div>`;
	}
}
//#endregion

//#region Symbols
function a(url, index, runtime) {
	runtime.Index = index;
	url = WBPL(url, runtime.Placeholders);
	const symbol = new AnchorSymbol(url, void 0, runtime);
	return symbol;
}
function A(url, index, runtime) {
	runtime.Index = index;
	url = WBPL(url, runtime.Placeholders);
	const symbol = new AnchorSymbol(url, void 0, runtime);
	if (!symbol.attrs.has("target"))
		symbol.attrs.set("target", "_blank");
	return symbol;
}
function b(args, index, runtime) {
	runtime.Index = index;
	const symbol = new ButtonSymbol(args, void 0, runtime);
	return symbol;
}
function c(args, index, runtime) {
	runtime.Index = index;
	const symbol = new ConnectorChoiceSymbol(args, "checkbox", runtime);
	symbol.attrs.set("type", "checkbox");
	return symbol;
}
function d(args, index, runtime) {
	runtime.Index = index;
	const symbol = new ConnectorChoiceSymbol(args, "select", runtime);
	symbol.attrs.set("data-blank", true);
	return symbol;
}
function D(args, index, runtime) {
	runtime.Index = index;
	const symbol = new ConnectorChoiceSymbol(args, "select", runtime);
	return symbol;
}
function e(args, index, runtime) {
	runtime.Index = index;
	const symbol = new FormSymbol(args, void 0, runtime, true);
	return symbol;
}
function f(format, index, runtime) {
	runtime.Index = index;
	const symbol = new TextSymbol(void 0, void 0, runtime);
	format = WBPL(format, runtime.Placeholders);
	if (!isNaN(Number(symbol.text)))
		symbol.text = formatNumber(Number(symbol.text), format, runtime.Session.placeholders.get("@@stwlanguage"));
	else if (!Number.isNaN(Date.parse(symbol.text)))
		symbol.text = formatDate(symbol.text, format, runtime.Session.placeholders.get("@@stwlanguage"), runtime.Session.tz);
	return symbol;
}
function h(args, index, runtime) {
	runtime.Index = index;
	const symbol = new FormSymbol(`;${args}`, void 0, runtime, true);
	symbol.attrs.set("type", "hidden");
	return symbol;
}
function i(args, index, runtime) {
	runtime.Index = index;
	let symbol;
	args = WBPL(args, runtime.Placeholders);
	if (args.indexOf(";") === -1) {
		symbol = new BaseSymbol(args, "img", runtime);
		symbol.attrs.set("src", symbol.args[0] || Field(runtime));
	} else {
		symbol = new ChoiceSymbol(";;" + args, "img", runtime);
		symbol.attrs.delete("id");
		symbol.attrs.delete("name");
		symbol.attrs.delete("value");
		symbol.attrs.set("src", symbol.args[2] || Field(runtime));
	}
	return symbol;
}
function j(args, index, runtime) {
	runtime.Index = index;
	const code = WBPL(args || Field(runtime), runtime.Placeholders);
	if (code && !["thead", "tfoot"].includes(runtime.TableSection))
		runtime.Scripts.push(`<script>${code.replace(/<\/script/gi, "<\\/script")}</script>`);
}
function k(args, index, runtime) {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new TextSymbol(args, void 0, runtime);
	const name = symbol.args[0];
	if (name && !name.toLocaleLowerCase().startsWith("stw") || runtime.Fields[runtime.FldIndex]) {
		const placeholder = `@@${(name || runtime.Fields[runtime.FldIndex]).toLowerCase()}`;
		runtime.Session.placeholders.set(placeholder, symbol.args[1]);
		runtime.Placeholders.set(placeholder, symbol.args[1]);
	}
}
function l(args, index, runtime) {
	runtime.Index = index;
	closeAllBlocks(runtime);
	if (args != null)
		args = WBPL(args, runtime.Placeholders);
	return new LabelSymbol(args, runtime);
}
function L(args, index, runtime) {
	return l(args, index, runtime);
}
function m(args, index, runtime) {
	runtime.Index = index;
	const symbol = new TextAreaSymbol(`${args ?? ";"}`, void 0, runtime);
	return symbol;
}
function n(args, index, runtime) {
	runtime.Index = index;
	args = WBPL(";;;" + args, runtime.Placeholders);
	const symbol = new ChoiceSymbol(args, void 0, runtime);
	return symbol;
}
function o(args, index, runtime) {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new EmbedSymbol(args, void 0, runtime);
	return symbol;
}
function O(args, index, runtime) {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new EmbedSymbol(args, "iframe", runtime);
	return symbol;
}
function r(args, index, runtime) {
	runtime.Index = index;
	const symbol = new ConnectorChoiceSymbol(args, "checkbox", runtime);
	symbol.attrs.set("type", "radio");
	return symbol;
}
function s(args, index, runtime) {
	runtime.Index = index;
	const symbol = new ConnectorChoiceSymbol(args, "select", runtime);
	symbol.attrs.set("multiple", true);
	symbol.attrs.set("data-blank", true);
	return symbol;
}
function S(args, index, runtime) {
	runtime.Index = index;
	const symbol = new ConnectorChoiceSymbol(args, "select", runtime);
	symbol.attrs.set("multiple", true);
	return symbol;
}
function t(args, index, runtime) {
	runtime.Index = index;
	const symbol = new TextSymbol(args, void 0, runtime);
	return symbol;
}
function u(args, index, runtime) {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new FormSymbol(`;${args}`, void 0, runtime);
	symbol.attrs.set("type", "file");
	return symbol;
}
function v(args, index, runtime) {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new TextSymbol(args, void 0, runtime);
	if (!isNaN(Number(symbol.args[2])))
		symbol.text = formatNumber(Number(symbol.args[2]), symbol.args[0], runtime.Session.placeholders.get("@@stwlanguage"));
	else if (!Number.isNaN(Date.parse(symbol.args[2])))
		symbol.text = formatDate(symbol.args[2], symbol.args[0], runtime.Session.placeholders.get("@@stwlanguage"), runtime.Session.tz);
	else
		symbol.text = symbol.args[2] ?? "";
	const name = symbol.args[1];
	if (name && !name.toLowerCase().startsWith("stw")) {
		runtime.Session.placeholders.set(`@@${name.toLowerCase()}`, symbol.args[2]);
		runtime.Placeholders.set(`@@${name.toLowerCase()}`, symbol.args[2]);
	}
	return symbol;
}
function w(args, index, runtime) {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new FormSymbol(`;${args}`, void 0, runtime);
	symbol.attrs.set("type", "password");
	return symbol;
}
function x(args, index, runtime) {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new ProgressSymbol(args, runtime);
	return symbol;
}
function y(args, index, runtime) {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new TextSymbol(args, void 0, runtime);
	return symbol;
}
function z(args, index, runtime) {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new TextSymbol(args, void 0, runtime);
	return symbol;
}
function $s(attrs, index, runtime) {
	runtime.Index = index;
	attrs = WBPL(attrs, runtime.Placeholders);
	runtime.Settings.set("rows", 25);
	for (const [, key, dq, sq, bare] of attrs.matchAll(/(?:^|\s+)([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))
		runtime.Settings.set(key, dq ?? sq ?? bare ?? true);
}
function $A(attrs, index, runtime) {
	return WBLL.$n(attrs, index, runtime);
}
function $r(attrs, index, runtime) {
	runtime.Index = index;
	let symbol;
	if (["thead", "tbody", "tfoot"].includes(runtime.RenderIn))
		symbol = new RootSymbol(attrs, "br", runtime);
	else
		symbol = new RootSymbol(`style="flex-basis:100%;" ${attrs || ""}`, "div", runtime);
	return symbol;
}
function $n(attrs, index, runtime) {
	runtime.Index = index;
	closeAllBlocks(runtime);
	attrs = WBPL(attrs, runtime.Placeholders);
	if (!["thead", "tbody", "tfoot"].includes(runtime.RenderIn)) {
		attrs = `style="display:flex;flex-basis:100%;" ${attrs || ""}`;
		runtime.Wrappers.push("div");
		return new RootSymbol(`class="stwLine"${attrs || ""}`, "div", runtime);
	}
	if (["thead", "tfoot"].includes(runtime.RenderIn)) {
		runtime.RenderIn = "";
		runtime.Downgrade = true;
		return new RootSymbol("", "", runtime);
	}
	runtime.HTML += new RootSymbol(attrs, "tr", runtime).toString();
	runtime.Wrappers.push("tr", "td");
	return new RootSymbol(`colspan="${runtime.Cols}"`, "td", runtime);
}
function $t(attrs, index, runtime) {
	runtime.Index = index;
	attrs = WBPL(`class="stwTab"${attrs || ""}`, runtime.Placeholders);
	if (runtime.RenderIn !== "tbody") {
		if (runtime.Wrappers.at(-1) === "span" || runtime.Wrappers.at(-1) === "label")
			closeBlock(runtime);
		runtime.Wrappers.push("span");
		return new RootSymbol(attrs, "span", runtime);
	}
	while (runtime.Wrappers.length && runtime.Wrappers.at(-1) !== "tr")
		closeBlock(runtime);
	if (runtime.Wrappers.at(-1) !== "tr") {
		runtime.HTML += "<tr>";
		runtime.Wrappers.push("tr");
	}
	runtime.Wrappers.push("td");
	return new RootSymbol(attrs, "td", runtime);
}
function $mc(steps, index, runtime) {
	runtime.Index = index;
	runtime.FldIndex += steps;
	if (runtime.FldIndex < 0)
		runtime.FldIndex = 0;
	else if (runtime.FldIndex > runtime.Fields.length - 1)
		runtime.FldIndex = runtime.Fields.length;
}
//#endregion

//#region Helper functions
function formatNumber(value, format, locale) {
	if (!format) return new Intl.NumberFormat(locale).format(value);
	const match = format.match(/[0#,]+(?:\.[0#]+)?/);
	if (!match || match.index === void 0)
		return format;
	const mask = match[0];
	const [integerMask, fractionMask = ""] = mask.split(".");
	const prefix = format.slice(0, match.index).replace("%", "");
	const suffix = format.slice(match.index + mask.length).replace("%", "");
	const formatted = new Intl.NumberFormat(locale, {
		style: format.includes("%") ? "percent" : "decimal",
		useGrouping: integerMask.includes(","),
		minimumIntegerDigits: Math.max(1, integerMask.split("0").length - 1),
		minimumFractionDigits: fractionMask.split("0").length - 1,
		maximumFractionDigits: fractionMask.length
	}).format(value);
	return `${prefix}${formatted}${suffix}`;
}

function formatDate(date, format, locale, timeZone) {
	if (!format) return date;
	const value = new Date(date);
	if (isNaN(value.getTime())) return date;
	const part = (type, options) => new Intl.DateTimeFormat(locale, { timeZone, ...options }).formatToParts(value).find((item) => item.type === type)?.value ?? "";
	const tokens = {
		"d": part("day", { day: "numeric" }),
		"dd": part("day", { day: "2-digit" }),
		"ddd": part("weekday", { weekday: "short" }),
		"dddd": part("weekday", { weekday: "long" }),
		"M": part("month", { month: "numeric" }),
		"MM": part("month", { month: "2-digit" }),
		"MMM": part("month", { month: "short" }),
		"MMMM": part("month", { month: "long" }),
		"yy": part("year", { year: "2-digit" }),
		"yyyy": part("year", { year: "numeric" }),
		"h": part("hour", { hour: "numeric", hourCycle: "h12" }),
		"hh": part("hour", { hour: "2-digit", hourCycle: "h12" }),
		"H": part("hour", { hour: "numeric", hourCycle: "h23" }),
		"HH": part("hour", { hour: "2-digit", hourCycle: "h23" }),
		"m": part("minute", { minute: "numeric" }),
		"mm": part("minute", { minute: "2-digit" }),
		"s": part("second", { second: "numeric" }),
		"ss": part("second", { second: "2-digit" })
	};
	return format.replace(
		/"([^"]*)"|'([^']*)'|dddd|ddd|yyyy|yy|MMMM|MMM|MM|M|dd|d|HH|H|hh|h|mm|m|ss|s/g,
		(match, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted ?? tokens[match]
	);
}

function closeBlock(runtime) {
	const tagName = runtime.Wrappers.pop();
	if (tagName)
		runtime.HTML += `</${tagName}>`;
}

function closeAllBlocks(runtime) {
	while (runtime.Wrappers.length && !(runtime.RenderIn.startsWith("t") && runtime.Wrappers[0] === "tr"))
		closeBlock(runtime);
}

function Field(runtime, separator = "") {
	if (runtime.FldIndex >= runtime.Fields.length)
		return "";
	const fieldName = runtime.Fields[runtime.FldIndex++] || "";
	return `${separator ? fieldName + separator : ""}${runtime.Placeholders.get(`@@${fieldName.toLowerCase()}`)?.toString() || ""}`;
}
function isTruthy(val) {
	if (!val || val === "false") return false;
	if (val === "true") return true;
	const num = Number(val);
	return !isNaN(num) && num !== 0;
}
//#endregion

export {
	FLAGS,
	STWLayout,
	isTruthy
};
