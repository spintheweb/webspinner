/**
 * @fileoverview Generate a runtime rendering function from WBLL code. 
 *
 * Given WBLL code and a content type, generates the body of a function that is then used to render data.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwWBLL
 * @license GPL-3.0-or-later
 */
import { STWSession } from "./stwSession.ts";
import { WBPL } from "./stwWBPL.ts";

const WBLL = { a, A, b, c, d, D, e, f, h, i, j, k, l, L, m, n, o, O, r, s, S, t, u, v, w, x, y, z, $s, $A, $r, $n, $t, $mc };

type FormattingSession = Pick<STWSession, "baseurl" | "lang" | "tz">;

type WBLLRuntime = {
	Session: FormattingSession;
	Fields: string[];
	FldIndex: number;
	Placeholders: Map<string, string | boolean | number>;
	HTML: string; // HTML generated at runtime
	RenderIn: string; // Possible values: ul -> li, ol -> li, menu -> li, thead -> tr\th, tbody, tfoot -> tr\td
	Wrappers: string[]; // Pending wrapper elements
	FormFields: number;
	Actions: ACTIONS;
	Settings: Map<string, string | boolean | number>;
	Index: number; // Parsing position within the WBLL code for error reporting
};

export enum ACTIONS {
	stwnone = 0,
	stwinsert = 1,
	stwupdate = 2,
	stwdelete = 4,
	stwsearch = 8,
	stwfilter = 16,
	stwsubmit = 32,
	stwlogon = 64,
	stwlogoff = 128,
	stwpwdreset = 256,
	stwany = ~0,
}

export class STWLayout {
	wbll: string;
	justSettings: boolean;
	private renderer: (...args: unknown[]) => Promise<string>; // Rendering function, placeholders are updated at runtime

	constructor(wbll: string) {
		this.wbll = wbll;

		const SYMBOLS = new RegExp(
			[
				/(\\r)/,
				/(\\[aAs])(?:\('([^]*?)'\))/,
				/(\\[nt])(?:\('([^]*?)'\))?/,
				/(?:([aAcefhilLmoOpquwxyz]))(?:\('([^]*?)'\))?/,
				/(?:([bdDnjrsStvk]))(?:\('([^]*?)'\))/,
				/\/\/.*$/,
				/\/\*[^]*\*\//,
				/(<+|>+)/,
				/(?<error>[\S])/,
			].map((r) => r.source).join("|"),
			"gmu",
		);

		const code: string[] = [];
		let closed = false;
		for (const expression of wbll.matchAll(SYMBOLS)) {
			if (expression.groups?.error !== undefined)
				throw new SyntaxError(`<pre class="stwError">Syntax error:<br>${expression.input.slice(0, expression.index)}<i>⋙${expression.input.slice(expression.index)}</i></pre>`);

			const pattern = expression.filter((value, i) => (value !== undefined && i));
			if (pattern[0]) {
				if (["<", ">"].includes(pattern[0].at(0) ?? ""))
					code.push(`WBLL.$mc(${(pattern[0].at(0) === "<" ? -1 : 1) * pattern[0].length}, ${expression.index}, runtime)`);
				else {
					const fragment = `${pattern[0].replace("\\", "$")}(${pattern[1] ? '"' + pattern[1].replace(/"/g, '\\"') + '"' : "null"}, ${expression.index}, runtime)`;

					if (pattern[0].match(/(p|q|\\a)/) || (code.length && code[code.length - 1].match(/^WBLL\.[aAb]/) && pattern[0].match(/^[defintvxyz]/)) && !closed) {
						code[code.length - 1] = code[code.length - 1] + `.${fragment}`;
						closed = pattern[0].match(/^[defintvxyz]/) !== null;
					} else {
						code.push("WBLL." + fragment);
						closed = false;
					}
				}
			}
		}

		for (let i = 0; i < code.length; ++i) {
			if (code[i].startsWith("WBLL.$n") && code[i + 1]?.startsWith("WBLL.$A"))
				code[i] = "";
			else
				code[i] = code[i].match(/^WBLL\.(\$s|\$mc|k|j)/) ? `${code[i]};` : `await ${code[i]}.$();`;
		}
		this.justSettings = !code.some(line => line.startsWith("await "));

		code.push(`runtime.HTML += [...runtime.Wrappers].reverse().map(el => \`</\${el}>\`).join("");`);
		code.push(`let renderIn = ["thead", "tbody", "tfoot"].includes(runtime.RenderIn) ? "tr" : runtime.RenderIn;`);
		code.push(`if (renderIn) runtime.HTML = \`<\${renderIn}>\${runtime.HTML}</\${renderIn}>\`;`);
		code.push(`runtime.Wrappers = [];`);

		const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
		this.renderer = new AsyncFunction("WBLL", "WBPL", "runtime", code.join("").replaceAll(/(\n|\r|\t)/g, ""));
	}

	async render(fields: string[], placeholders: Map<string, string>, session: FormattingSession = { baseurl: "", lang: "en", tz: "UTC" }, renderIn: string = ""):
		Promise<{ settings: Map<string, string | boolean | number>, HTML: string }> {
		const runtime: WBLLRuntime = {
			Session: session,
			Fields: fields,
			FormFields: 0,
			Actions: ACTIONS.stwnone,
			Placeholders: placeholders,
			HTML: "",
			RenderIn: renderIn,
			Wrappers: [],
			FldIndex: 0,
			Settings: new Map(),
			Index: 0,
		};
		try {
			await this.renderer(WBLL, WBPL, runtime);
			return { settings: runtime.Settings, HTML: runtime.HTML };
		} catch (_err) {
			const index = runtime.Index;
			throw new SyntaxError(`<pre class="stwError">Syntax error:<br>${this.wbll.slice(0, index)}<i>⋙${this.wbll.slice(index)}</i></pre>`);
		}
	}
}

//#region WBLL symbol classes
class RootSymbol {
	runtime: WBLLRuntime;
	text = "";
	tagName = "";
	args: string[] = [];
	attrs = new Map<string, string | boolean | number>();

	constructor(attrs: string = "", tagName = "", runtime: WBLLRuntime) {
		this.runtime = runtime;
		this.tagName = tagName;
		if (attrs)
			for (const pair of attrs.matchAll(/([A-Za-z0-9:\-.]+)(?:="([^"]*)")?/g)) {
				const [, key, value] = pair;
				this.attrs.set(key, value ?? true);
			}
	}
	toString(): string {
		const htmlAttrs = [...this.attrs.entries()]
			.map(([key, value]) => value === true ? ` ${key}` : ` ${key}="${value}"`)
			.join("");
		return `<${this.tagName}${htmlAttrs}>`;
	}
	$(): void {
		if (this.runtime.RenderIn != "thead" || (this.runtime.RenderIn == "thead" && this.tagName == "th"))
			this.runtime.HTML += this.toString();
	}
}
class BaseSymbol extends RootSymbol {
	constructor(args: string | undefined, tagName = "", runtime: WBLLRuntime) {
		super(undefined, tagName, runtime);

		let c = "";
		let quoted = false;
		let param = "";
		for (c of args ?? "") {
			if (c === '"') quoted = !quoted;
			else if (c === ";" && !quoted) this.args.push(param), param = "";
			else param += c;
		}
		this.args.push(param.trim());
	}
	$a(attrs: string, index: number, runtime: WBLLRuntime): this {
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
	override toString(): string {
		if (!this.tagName) return this.text;

		const htmlAttrs = [...this.attrs.entries()]
			.map(([key, value]) => value === true ? ` ${key}` : ` ${key}="${value}"`)
			.join("");

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
	constructor(args: string | undefined, tagName = "", runtime: WBLLRuntime) {
		super(args, tagName, runtime);
		this.text = args || Field(runtime);
	}
}
class AnchorSymbol extends BaseSymbol {
	url: URL;

	constructor(url: string | undefined, tagName = "a", runtime: WBLLRuntime) {
		super(url, tagName, runtime);

		url = url || Field(runtime);

		try { this.url = new URL(url); } catch { this.url = new URL(url, `https://${runtime.Session.baseurl}`); }
		this.text = url;
		this.attrs.set("href", this.url.toString());
	}
	p(args: string, index: number, runtime: WBLLRuntime): this {
		if (args === ".")
			return this.q(args, index, runtime);

		runtime.Index = index;
		args = WBPL(args, runtime.Placeholders) || Field(runtime, ";");

		const search = `${args};`.split(";");
		this.url.searchParams.set(search[0] ?? "", search[1] ?? "");
		this.attrs.set("href", this.url.toString());
		return this;
	}
	q(args: string, index: number, runtime: WBLLRuntime): this {
		runtime.Index = index;
		if (args === ".")
			args = String(runtime.Placeholders.get("@@query_string"));
		else
			args = WBPL(args, runtime.Placeholders);

		try {
			const qs = (args || Field(runtime) || "").trim().replace(/^\?/, "");
			const params = new URLSearchParams(qs);
			for (const [k, v] of params.entries())
				this.url.searchParams.set(k, v);
			this.attrs.set("href", this.url.toString());
		} catch {
			// ignore malformed input
		}
		return this;
	}
	t(args: string, index: number, runtime: WBLLRuntime): this {
		const symbol = WBLL.t(args, index, runtime);
		this.text = symbol.text;
		return this;
	}
	v(args: string, index: number, runtime: WBLLRuntime): this {
		const symbol = WBLL.v(args, index, runtime);
		this.text = symbol.text;
		return this;
	}
	f(args: string, index: number, runtime: WBLLRuntime): this {
		const symbol = WBLL.f(args, index, runtime);
		this.text = symbol.text;
		return this;
	}
	e(args: string, index: number, runtime: WBLLRuntime): this {
		const symbol = WBLL.f(args, index, runtime);
		this.text = symbol.text;
		return this;
	}
	i(args: string, index: number, runtime: WBLLRuntime): this {
		const symbol = WBLL.i(args, index, runtime);
		this.text = BaseSymbol.prototype.toString.call(symbol); // Return the HTML representation of the image symbol
		return this;
	}
	n(args: string, index: number, runtime: WBLLRuntime): this {
		const symbol = WBLL.n(args, index, runtime);
		this.text = symbol.text;
		return this;
	}
	x(args: string, index: number, runtime: WBLLRuntime): this {
		const symbol = WBLL.x(args, index, runtime);
		this.text = symbol.text;
		return this;
	}
	y(args: string, index: number, runtime: WBLLRuntime): this {
		const symbol = WBLL.y(args, index, runtime);
		this.text = symbol.text;
		return this;
	}
	z(args: string, index: number, runtime: WBLLRuntime): this {
		const symbol = WBLL.z(args, index, runtime);
		this.text = symbol.text;
		return this;
	}
}
type LabelMode = "header" | "cell" | "form";
class LabelSymbol extends BaseSymbol {
	private readonly mode: LabelMode;

	constructor(args: string, runtime: WBLLRuntime) {
		const mode: LabelMode = runtime.RenderIn === "thead"
			? "header"
			: runtime.RenderIn === "tbody" || runtime.RenderIn === "tfoot"
				? "cell"
				: "form";

		const tagName = mode === "header" ? "th" : mode === "cell" ? "td" : "label";
		super(mode === "cell" ? undefined : args, tagName, runtime);
		this.mode = mode;

		if (mode === "cell") {
			runtime.Wrappers.push("td");
			return;
		}
		this.text = args || (
			mode === "header" ? runtime.Fields[runtime.FldIndex] : Field(runtime)
		);
		if (mode === "form") {
			runtime.Wrappers.push("label");
			this.attrs.set("for", `stwE${runtime.FormFields}`);
		}
	}

	override toString(): string {
		return this.mode === "cell" ? RootSymbol.prototype.toString.call(this) : super.toString();
	}
}
class FormSymbol extends BaseSymbol {
	constructor(args: string | undefined, tagName = "input", runtime: WBLLRuntime) {
		super(args, tagName, runtime);

		if (!this.attrs.has("type") && this.args[0])
			this.attrs.set("type", this.args[0]);
		if (!this.attrs.has("id"))
			this.attrs.set("id", `stwE${runtime.FormFields}`);
		if (!this.attrs.has("name"))
			this.attrs.set("name", this.args[1] || runtime.Fields[runtime.FldIndex] || `stwE${runtime.FormFields}`);
		if (!this.attrs.has("value"))
			this.attrs.set("value", this.attrs.get("name") !== runtime.Fields[runtime.FldIndex] ? this.args[2] : Field(runtime));
		++runtime.FormFields;

		if (this.runtime.Settings.has("disabled"))
			this.attrs.set("disabled", this.runtime.Settings.get("disabled") ?? true);
	}
	override toString(): string {
		if (this instanceof ButtonSymbol && this.runtime.Settings.get("disabled"))
			return "";

		let fragment = "";
		if (this.tagName === "input" && this.args[3]) {
			this.attrs.set("list", `${this.attrs.get("id") ?? "Fld0"}_options`);
			fragment = `<datalist id="${this.attrs.get("id") ?? "Fld0"}_options">`;
			for (let i = 3; i < this.args.length; ++i)
				fragment += `<option value="${this.args[i]}"></option>`;
			fragment += "</datalist>";
		}
		return fragment + super.toString();
	}
}
class TextAreaSymbol extends FormSymbol {
	constructor(args: string | undefined, tagName = "textarea", runtime: WBLLRuntime) {
		super(args, tagName, runtime);
		this.text = String(this.attrs.get("value") ?? "");
		this.attrs.delete("type");
		this.attrs.delete("value");
	}

	override toString(): string {
		if (this.args[0] === "contenteditable") {
			this.tagName = "div";
			this.attrs.set("contenteditable", "");
		} else if (this.args[0])
			this.attrs.set("class", this.args[0]);

		const htmlAttrs = [...this.attrs.entries()]
			.map(([key, value]) => value === true ? ` ${key}` : ` ${key}="${value}"`)
			.join("");

		const fragment = `<${this.tagName}${htmlAttrs}>${this.text || ""}</${this.tagName}>`;
		return fragment;
	}
}
class ButtonSymbol extends FormSymbol {
	url: URL;
	constructor(args: string | undefined, tagName = "button", runtime: WBLLRuntime) {
		super(args, tagName, runtime);
		this.attrs.delete("type");

		try { this.url = new URL(this.args[0]); } catch { this.url = new URL(this.args[0] ?? "", `https://${runtime.Session.baseurl}`); }

		const action = this.action(this.args[1]);
		this.attrs.set("formaction", this.url.toString());
		if (action & (ACTIONS.stwsearch | ACTIONS.stwfilter)) {
			this.attrs.delete("name");
			this.attrs.set("formmethod", "GET");
		} else if (action & ACTIONS.stwdelete) {
			this.attrs.set("formmethod", "DELETE");
		} else if (action & ACTIONS.stwupdate) {
			this.attrs.set("formmethod", "PATCH");
		} else if (action & ACTIONS.stwinsert) {
			this.attrs.set("formmethod", "PUT");
		} else
			this.attrs.set("formmethod", "POST");
		runtime.Actions |= action;

		this.attrs.delete("value");
		this.attrs.set("type", "submit");
		this.text = "";
	}
	p(args: string, index: number, runtime: WBLLRuntime): this {
		if (args === ".")
			return this.q(args, index, runtime);

		runtime.Index = index;
		args = WBPL(args, runtime.Placeholders);

		const search = `${args};;`.split(";");
		this.url.searchParams.set(search[0] ?? "", search[1] ?? "");
		this.attrs.set("formaction", this.url.toString());
		return this;
	}
	q(args: string, index: number, runtime: WBLLRuntime): this {
		runtime.Index = index;

		if (args === ".")
			args = String(runtime.Placeholders.get("@@query_string"));
		else
			args = WBPL(args, runtime.Placeholders);

		try {
			const qs = (args ?? "").trim().replace(/^\?/, "");
			const params = new URLSearchParams(qs);
			for (const [k, v] of params.entries())
				this.url.searchParams.set(k, v);
			this.attrs.set("formaction", this.url.toString());
		} catch {
			// ignore malformed input
		}
		return this;
	}
	t(args: string, index: number, runtime: WBLLRuntime): this {
		const symbol = WBLL.t(args, index, runtime);
		this.text = symbol.text;
		return this;
	}

	private action(value: string): ACTIONS {
		value = (value || "").toLocaleLowerCase();
		const action = Object.entries(ACTIONS).find(([name, member]) => name === value && typeof member === "number")?.[1];
		return typeof action === "number" ? action : ACTIONS.stwnone;
	}
}
type ChoiceItem = { value: string; label: string; group?: string };
class ChoiceSymbol extends FormSymbol {
	constructor(args: string | undefined, tagName = "checkbox", runtime: WBLLRuntime) {
		super(args, tagName, runtime);
	}
	override toString(): string {
		const type = this.attrs.get("type");
		const supportsGroups = this.tagName === "select" || type === "checkbox" || type === "radio";
		const mode = supportsGroups && this.args[3] === "3"
			? 3
			: [, "1", "2"].indexOf(this.args[3]);

		// TODO: if mode is -1 then args[3] is assumed to reppresents a datasource and args[4] a query. For example, "mydatasource;select a, b from table".

		if (mode !== -1) {
			const tagName = this.attrs.get("type");
			this.attrs.delete("type");

			let htmlAttrs = [...this.attrs.entries()]
				.map(([key, value]) => value === true ? ` ${key}` : ` ${key}="${value || ""}"`)
				.join("");

			if (mode === 3 && (tagName === "checkbox" || tagName === "radio")) {
				const options = this.choiceItems(this.args, mode);
				const groups = new Map<string, ChoiceItem[]>();
				for (const option of options) {
					const group = option.group ?? "";
					groups.set(group, [...(groups.get(group) ?? []), option]);
				}

				const updateValue = tagName === "checkbox"
					? `this.querySelector('input[type="hidden"]').value=[...this.querySelectorAll(":checked")].map(el => el.value).join(',')`
					: `this.querySelectorAll('input[type="radio"]').forEach(el => el.checked=el==event.target);this.querySelector('input[type="hidden"]').value=event.target.value`;

				let fragment = `<div class="stwChoices" onchange="${updateValue}"><input type="hidden"${htmlAttrs}>`;
				for (const [group, groupedOptions] of groups) {
					fragment += `<fieldset>${group ? `<legend>${group}</legend>` : ""}`;
					for (const option of groupedOptions) {
						fragment += `<label><input type="${tagName}" value="${option.value}"${option.value === (this.attrs.get("value") ?? "") ? " checked" : ""}${this.attrs.has("disabled") || option.label.charAt(0) === "!" ? " disabled" : ""}> ${option.label}</label>`;
					}
					fragment += "</fieldset>";
				}
				return fragment + "</div>";
			}

			let fragment = `<input type="hidden"${htmlAttrs}><fieldset class="stwChoices" onchange="`;
			if (tagName === "checkbox") {
				if (mode === 1)
					fragment += `this.previousElementSibling.value=[...this.querySelectorAll(':checked')].reduce((acc, el) => acc + Number(el.value), 0)">`;
				else
					fragment += `this.previousElementSibling.value=[...this.querySelectorAll(':checked')].map(el => el.value).join(',')">`;
				for (let i = 4; i < this.args.length; i += mode)
					fragment += `<label><input type="checkbox" value="${mode === 1 ? 1 << (i - 4) : this.args[i]}"${this.args[i] === (this.attrs.get("value") ?? "") ? ' checked' : ""}${this.attrs.has("disabled") || this.args[i + mode - 1].charAt(0) === "!" ? " disabled" : ""}> ${this.args[i + mode - 1]}</label>`;
				fragment += "</fieldset>";

			} else if (tagName === "radio") {
				fragment += `this.querySelectorAll('input').forEach(el => el.checked=el==event.target);this.previousElementSibling.value=event.target.value">`;
				for (let i = 4; i < this.args.length; i += mode)
					fragment += `<label><input type="radio" value="${this.args[i]}"${this.args[i] === (this.attrs.get("value") ?? "") ? " checked" : ""}${this.attrs.has("disabled") || this.args[i + mode - 1].charAt(0) === "!" ? " disabled" : ""}> ${this.args[i + mode - 1]}</label>`;
				fragment += "</fieldset>";

			} else if (this.tagName === "select") {
				fragment = `<select${htmlAttrs}>`;
				if (this.attrs.has("data-blank")) {
					fragment += '<option value=""></option>';
					this.attrs.delete("data-blank");
				}
				const options = this.choiceItems(this.args, mode);
				const renderOption = ({ value, label }: ChoiceItem) =>
					`<option value="${value}"${value === (this.attrs.get("value") ?? "") ? " selected" : ""}${label.charAt(0) === "!" ? " disabled" : ""}>${label}</option>`;
				if (mode === 3) {
					const groups = new Map<string, ChoiceItem[]>();
					for (const option of options) {
						const group = option.group ?? "";
						groups.set(group, [...(groups.get(group) ?? []), option]);
					}
					for (const [group, groupedOptions] of groups)
						fragment += group
							? `<optgroup label="${group}">${groupedOptions.map(renderOption).join("")}</optgroup>`
							: groupedOptions.map(renderOption).join("");
				} else {
					fragment += options.map(renderOption).join("");
				}
				fragment += "</select>";

			} else {
				let i = Number(this.attrs.get("value")) + 3;
				if (mode === 2)
					for (i = 4; i < this.args.length; i += 2)
						if (this.args[i] == this.attrs.get("value"))
							break;
				this.attrs.delete("id");
				this.attrs.delete("name");
				this.attrs.delete("value");
				htmlAttrs = [...this.attrs.entries()]
					.map(([key, value]) => value === true ? ` ${key}` : ` ${key}="${value || ""}"`)
					.join("");
				fragment = this.args[i + 1] || "";
				if (htmlAttrs)
					fragment = `<span${htmlAttrs}>${fragment}</span>`;
			}
			return fragment;

		} else if (this.tagName === "checkbox")
			return `<input${[...this.attrs.entries()].map(([key, value]) =>
				value === "" ? ` ${key}` : ` ${key}="${value || ""}"`
			).join("")}>`;

		throw new SyntaxError();
	}
	private choiceItems(args: string[], arity: number): ChoiceItem[] {
		const items: ChoiceItem[] = [];
		for (let i = 4; i < args.length; i += arity) {
			items.push({
				value: args[i],
				label: arity === 1 ? args[i] : args[i + 1],
				group: arity === 3 ? args[i + 2] : undefined,
			});
		}
		return items;
	}
}
class EmbedSymbol extends BaseSymbol {
	url: URL;

	constructor(args: string | undefined, tagName: string = "", runtime: WBLLRuntime) {
		super(args, tagName, runtime);

		try { this.url = new URL(this.args[0]); } catch { this.url = new URL(this.args[0], `https://${runtime.Session.baseurl}`); }
		if (tagName === "embed") {
			this.attrs.set("src", this.url.toString());
			this.attrs.set("type", "text/html");
			this.attrs.set("style", "display:block; width: 100%; height: 100%");
		}
	}
	p(args: string, index: number, runtime: WBLLRuntime): this {
		runtime.Index = index;
		args = WBPL(args, runtime.Placeholders);
		const search = `${args};;`.split(";");
		this.url.searchParams.set(search[0] ?? "", search[1] ?? "");
		this.attrs.set("src", this.url.toString());
		return this;
	}
	q(args: string, index: number, runtime: WBLLRuntime): this {
		runtime.Index = index;
		args = WBPL(args, runtime.Placeholders);
		try {
			const qs = (args ?? "").trim().replace(/^\?/, "");
			const params = new URLSearchParams(qs);
			for (const [k, v] of params.entries())
				this.url.searchParams.set(k, v);
			this.attrs.set("src", this.url.toString());
		} catch {
			// ignore malformed input
		}
		return this;
	}
	override async $(): Promise<void> {
		if (this.tagName === "embed")
			this.runtime.HTML += super.toString();
		else {
			const response = await fetch(this.url);
			this.runtime.HTML += await response.text();
		}
	}
}
class ProgressSymbol extends BaseSymbol {
	value: number;

	constructor(value: string, runtime: WBLLRuntime) {
		super(undefined, "div", runtime);
		this.value = Number(value);
		this.attrs.set("role", "progressbar");
		this.attrs.set("aria-valuemin", 0);
		this.attrs.set("aria-valuemax", 1);
		this.attrs.set("aria-valuenow", this.value);
		this.attrs.set("style", "background-color:GrayText;color:AccentColor;");
	}

	override toString(): string {
		if (!Number.isFinite(this.value) || this.value < 0 || this.value > 1)
			return "";

		const htmlAttrs = [...this.attrs.entries()]
			.map(([key, value]) => value === true ? ` ${key}` : ` ${key}="${value}"`)
			.join("");

		return `<div${htmlAttrs}><div style="display:block;width:${this.value * 100}%;height:1rem;background-color:currentColor"></div></div>`;
	}
}
//#endregion

//#region WBLL symbols
function a(url: string, index: number, runtime: WBLLRuntime): AnchorSymbol {
	runtime.Index = index;
	url = WBPL(url, runtime.Placeholders);
	const symbol = new AnchorSymbol(url, undefined, runtime);
	return symbol;
}
function A(url: string, index: number, runtime: WBLLRuntime): AnchorSymbol {
	runtime.Index = index;
	url = WBPL(url, runtime.Placeholders);
	const symbol = new AnchorSymbol(url, undefined, runtime);
	if (!symbol.attrs.has("target"))
		symbol.attrs.set("target", "_blank");
	return symbol;
}
function b(args: string, index: number, runtime: WBLLRuntime): ButtonSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new ButtonSymbol(args, undefined, runtime);
	return symbol;
}
function c(args: string, index: number, runtime: WBLLRuntime): ChoiceSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new ChoiceSymbol(`;${args ?? ";;"}`, undefined, runtime);
	symbol.attrs.set("type", "checkbox");
	return symbol;
}
function d(args: string, index: number, runtime: WBLLRuntime): ChoiceSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new ChoiceSymbol(`;${args ?? ";;"}`, "select", runtime);
	symbol.attrs.set("data-blank", true);
	return symbol;
}
function D(args: string, index: number, runtime: WBLLRuntime): ChoiceSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new ChoiceSymbol(`;${args ?? ";;"}`, "select", runtime);
	return symbol;
}
function e(args: string, index: number, runtime: WBLLRuntime): FormSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new FormSymbol(args, undefined, runtime);
	return symbol;
}
function f(format: string, index: number, runtime: WBLLRuntime): TextSymbol {
	runtime.Index = index;
	const symbol = new TextSymbol(undefined, undefined, runtime);

	format = WBPL(format, runtime.Placeholders);
	if (!isNaN(Number(symbol.text)))
		symbol.text = formatNumber(Number(symbol.text), format, runtime.Session.lang);
	else if (!Number.isNaN(Date.parse(symbol.text)))
		symbol.text = formatDate(symbol.text, format, runtime.Session.lang, runtime.Session.tz);

	return symbol;
}
function h(args: string, index: number, runtime: WBLLRuntime): FormSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new FormSymbol(`;${args}`, undefined, runtime);
	symbol.attrs.set("type", "hidden");
	return symbol;
}
function i(args: string, index: number, runtime: WBLLRuntime): BaseSymbol {
	runtime.Index = index;

	let symbol: BaseSymbol;
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
// Concatenate all j() in the layout in runtime.Settings script
function j(args: string, index: number, runtime: WBLLRuntime): void {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	runtime.Settings.set("script", (runtime.Settings.get("script") || "") + args);
}
function k(args: string, index: number, runtime: WBLLRuntime): void {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new TextSymbol(args, undefined, runtime);
	if (symbol.args[0] || runtime.Fields[runtime.FldIndex]) // If no key is provided use the current field name
		runtime.Placeholders.set(`@@${symbol.args[0] || runtime.Fields[runtime.FldIndex]}`, symbol.args[1]);
}
function l(args: string, index: number, runtime: WBLLRuntime): LabelSymbol {
	runtime.Index = index;
	closeAllBlocks(runtime);
	args = WBPL(args, runtime.Placeholders);
	return new LabelSymbol(args, runtime);
}
function L(args: string, index: number, runtime: WBLLRuntime): LabelSymbol {
	return l(args, index, runtime);
}
function m(args: string, index: number, runtime: WBLLRuntime): TextAreaSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new TextAreaSymbol(`${args ?? ";"}`, undefined, runtime);
	return symbol;
}
function n(args: string, index: number, runtime: WBLLRuntime): TextSymbol {
	runtime.Index = index;
	args = WBPL(";;;" + args, runtime.Placeholders);
	const symbol = new ChoiceSymbol(args, undefined, runtime);
	return symbol;
}
function o(args: string, index: number, runtime: WBLLRuntime): EmbedSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new EmbedSymbol(args, undefined, runtime);
	return symbol;
}
function O(args: string, index: number, runtime: WBLLRuntime): EmbedSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new EmbedSymbol(args, "embed", runtime);
	return symbol;
}
function r(args: string, index: number, runtime: WBLLRuntime): ChoiceSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new ChoiceSymbol(`;${args ?? ";;"}`, undefined, runtime);
	symbol.attrs.set("type", "radio");
	return symbol;
}
function s(args: string, index: number, runtime: WBLLRuntime): ChoiceSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new ChoiceSymbol(`;${args ?? ";;"}`, "select", runtime);
	symbol.attrs.set("multiple", true);
	symbol.attrs.set("data-blank", true);
	return symbol;
}
function S(args: string, index: number, runtime: WBLLRuntime): ChoiceSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new ChoiceSymbol(`;${args ?? ";;"}`, "select", runtime);
	symbol.attrs.set("multiple", true);
	return symbol;
}
function t(args: string, index: number, runtime: WBLLRuntime): TextSymbol {
	runtime.Index = index;
	const symbol = new TextSymbol(args, undefined, runtime);
	return symbol;
}
function u(args: string, index: number, runtime: WBLLRuntime): FormSymbol {
	// TODO: File naming
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new FormSymbol(`;${args}`, undefined, runtime);
	symbol.attrs.set("type", "file");
	return symbol;
}
function v(args: string, index: number, runtime: WBLLRuntime): TextSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new TextSymbol(args, undefined, runtime);

	if (!isNaN(Number(symbol.args[2])))
		symbol.text = formatNumber(Number(symbol.args[2]), symbol.args[0], runtime.Session.lang);
	else if (!Number.isNaN(Date.parse(symbol.args[2])))
		symbol.text = formatDate(symbol.args[2], symbol.args[0], runtime.Session.lang, runtime.Session.tz);
	else
		symbol.text = symbol.args[2] ?? "";

	if (symbol.args[1])
		runtime.Placeholders.set(`@@${symbol.args[1]}`, symbol.args[2]);
	return symbol;
}
function w(args: string, index: number, runtime: WBLLRuntime): FormSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new FormSymbol(`;${args}`, undefined, runtime);
	symbol.attrs.set("type", "password");
	return symbol;
}
function x(args: string, index: number, runtime: WBLLRuntime): TextSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new ProgressSymbol(args, runtime);
	return symbol;
}
// TODO
function y(args: string, index: number, runtime: WBLLRuntime): TextSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new TextSymbol(args, undefined, runtime);
	return symbol;
}
// TODO
function z(args: string, index: number, runtime: WBLLRuntime): TextSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new TextSymbol(args, undefined, runtime);
	return symbol;
}
function $s(attrs: string, index: number, runtime: WBLLRuntime): void {
	runtime.Index = index;
	attrs = WBPL(attrs, runtime.Placeholders);
	runtime.Settings.set("rows", 25);
	for (const [, key, dq, sq, bare] of attrs.matchAll(/(?:^|\s+)([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))
		runtime.Settings.set(key, dq ?? sq ?? bare ?? true);
}
// The \A behaves like a \n, if \A follows an \n the \n is discarded. Does a layout that starts with \n make sense? No, use a \A, it declares: "I want an outermost wrapper with these attributes".
function $A(attrs: string, index: number, runtime: WBLLRuntime): RootSymbol {
	return WBLL.$n(attrs, index, runtime);
}
function $r(attrs: string, index: number, runtime: WBLLRuntime): RootSymbol {
	runtime.Index = index;

	let symbol;
	if (["thead", "tbody", "tfoot"].includes(runtime.RenderIn))
		symbol = new RootSymbol(attrs, "br", runtime);
	else
		symbol = new RootSymbol(`style="flex-basis:100%;" ${attrs || ""}`, "div", runtime);

	return symbol;
}
function $n(attrs: string, index: number, runtime: WBLLRuntime): RootSymbol {
	runtime.Index = index;
	closeAllBlocks(runtime);

	attrs = WBPL(attrs, runtime.Placeholders);
	if (runtime.RenderIn !== "tbody") {
		attrs = `style="display:flex;flex-basis:100%;" ${attrs || ""}`;
		runtime.Wrappers.push("div");
		return new RootSymbol(`class="stwLine"${attrs || ""}`, "div", runtime);
	}

	runtime.HTML += new RootSymbol(attrs, "tr", runtime).toString();
	runtime.Wrappers.push("tr", "td");
	return new RootSymbol("", "td", runtime);
}
function $t(attrs: string, index: number, runtime: WBLLRuntime): RootSymbol {
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
function $mc(steps: number, index: number, runtime: WBLLRuntime): void {
	runtime.Index = index;

	runtime.FldIndex += steps;
	if (runtime.FldIndex < 0)
		runtime.FldIndex = 0;
	else if (runtime.FldIndex > runtime.Fields.length - 1)
		runtime.FldIndex = runtime.Fields.length;
}
//#endregion

//#region Formatting functions for numbers and dates
function formatNumber(value: number, format: string, locale: string): string {
	if (!format) return new Intl.NumberFormat(locale).format(value);

	const match = format.match(/[0#,]+(?:\.[0#]+)?/);
	if (!match || match.index === undefined)
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
		maximumFractionDigits: fractionMask.length,
	}).format(value);

	return `${prefix}${formatted}${suffix}`;
}
function formatDate(date: string, format: string, locale: string, timeZone: string): string {
	if (!format) return date;

	const value = new Date(date);
	if (isNaN(value.getTime())) return date;

	const part = (type: string, options: Intl.DateTimeFormatOptions): string =>
		new Intl.DateTimeFormat(locale, { timeZone, ...options })
			.formatToParts(value)
			.find((item) => item.type === type)?.value ?? "";
	const tokens: Record<string, string> = {
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
		"ss": part("second", { second: "2-digit" }),
	};

	return format.replace(/"([^"]*)"|'([^']*)'|dddd|ddd|yyyy|yy|MMMM|MMM|MM|M|dd|d|HH|H|hh|h|mm|m|ss|s/g,
		(match, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted ?? tokens[match]);
}
//#endregion

//#region Helper Functions
function closeBlock(runtime: WBLLRuntime): void {
	const tagName = runtime.Wrappers.pop();
	if (tagName)
		runtime.HTML += `</${tagName}>`;
}
function closeAllBlocks(runtime: WBLLRuntime): void {
	while (runtime.Wrappers.length)
		closeBlock(runtime);
}
function Field(runtime: WBLLRuntime, separator: string = ""): string {
	if (runtime.FldIndex >= runtime.Fields.length)
		return "";

	const fieldName = runtime.Fields[runtime.FldIndex++] || "";
	return `${separator ? fieldName + separator : ""}${runtime.Placeholders.get(`@@${fieldName}`)?.toString() || ""}`;
}
export function isTruthy(val: string | undefined): boolean {
	if (!val || val === "false") return false;
	if (val === "true") return true;
	const num = Number(val);
	return !isNaN(num) && num !== 0;
}
//#endregion
