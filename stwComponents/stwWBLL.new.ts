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
import { WBPL } from './stwWBPL.ts';

const WBLL = { a, A, b, c, d, D, e, f, h, i, j, k, l, m, o, O, r, s, t, u, v, w, $s, $A, $r, $n, $t, $mc };

type WBLLRuntime = {
	Placeholders: Map<string, string | boolean | number>;
	Type: string;
	HTML: string; // HTML generated at runtime
	FldIndex: number;
	FormFields: number;
	Settings: Map<string, string | boolean | number>;
	Attributes: Map<string, string | boolean | number>;
	Index: number; // Parsing position within the WBLL code for error reporting
};

export class STWLayout {
	wbll: string;
	private renderBody: string = ''; // Rendering function body, placeholders need to be replaced at runtime

	constructor(wbll: string, contentType: string = '') {
		console.debug(wbll);
		this.wbll = wbll;

		const SYMBOLS = new RegExp(
			[
				/(\\[aAs])(?:\('([^]*?)'\))/,
				/(\\[nrt])(?:\('([^]*?)'\))?/,
				/(?:([aAcefhilLmoOpqruwxyz]))(?:\('([^]*?)'\))?/,
				/(?:([bdDnjJsStTvVk]))(?:\('([^]*?)'\))/,
				/\/\/.*$/,
				/\/\*[^]*\*\//,
				/(<+|>+)/,
				/(?<error>[\S])/,
			].map((r) => r.source).join('|'),
			'gmu',
		);

		const code: string[] = [];
		let closed: boolean = false;
		for (const expression of wbll.matchAll(SYMBOLS)) {
			if (expression.groups?.error !== undefined)
				throw new SyntaxError(`<pre class="stwError">Syntax error:<br>${expression.input.slice(0, expression.index)}<i>⋙${expression.input.slice(expression.index)}</i></pre>`);

			const pattern = expression.filter((value, i) => (value !== undefined && i));
			if (pattern[0]) {
				if (['<', '>'].includes(pattern[0].at(0) ?? ''))
					code.push(`WBLL.$mc(${(pattern[0].at(0) === '<' ? -1 : 1) * pattern[0].length}, ${expression.index}, runtime)`);
				else {
					const fragment = `${pattern[0].replace('\\', '$')}(${pattern[1] ? '"' + pattern[1].replace(/"/g, '\\"') + '"' : 'null'}, ${expression.index}, runtime)`;

					if (pattern[0].match(/(p|q|\\a)/) || (code.length && code[code.length - 1].match(/^WBLL\.[aA]/) && pattern[0].match(/^[defintxyz]/)) && !closed) {
						code[code.length - 1] = code[code.length - 1] + `.${fragment}`;
						closed = pattern[0].match(/^[defintxyz]/) !== null;
					} else {
						code.push('WBLL.' + fragment);
						closed = false;
					}
				}
			}
		}

		for (let i = 0; i < code.length; ++i) {
			const label = i > 0 && contentType === 'form' && ((code[i].at(5) === 'l' && 'cdemrsuw'.indexOf(code[i + 1]?.at(5) ?? '') !== -1) || (code[i - 1]?.at(11) === 'l' && 'cdemrsuw'.indexOf(code[i].at(5) ?? '') !== -1)) ? true : false;
			code[i] = code[i].match(/\$(A|s|mc)/) ? `${code[i]};` : `await ${code[i]}.$(${label});`;
		}
		code.push(`if ("${contentType}") runtime.HTML = \`<div role="${contentType}">\${runtime.HTML}</div>\`;`);

		this.renderBody = code.join("");
	}

	async render(placeholders: Map<string, string>): Promise<string> {
		const runtime: WBLLRuntime = {
			Placeholders: placeholders,
			Type: '',
			HTML: '',
			FldIndex: 0,
			FormFields: 0,
			Settings: new Map(),
			Attributes: new Map(),
			Index: 0,
		};
		try {
			const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
			const fn = new AsyncFunction("WBLL", "WBPL", "runtime", this.renderBody) as (...args: unknown[]) => Promise<string>;

			await fn(WBLL, WBPL, runtime);

			console.debug(runtime.HTML);
			return runtime.HTML;

		} catch (_err) {
			const index = runtime.Index ?? 0;
			throw new SyntaxError(`<pre class="stwError">Syntax error:<br>${this.wbll.slice(0, index)}<i>⋙${this.wbll.slice(index)}</i></pre>`);
		}
	}
}

//#region WBLL symbol classes
class RootSymbol {
	runtime: WBLLRuntime;
	text = '';
	tagName = '';
	args: string[] = [];
	attrs = new Map<string, string | boolean | number>();

	constructor(attrs: string = '', tagName = '', runtime: WBLLRuntime) {
		this.runtime = runtime;
		this.tagName = tagName;
		if (this instanceof RootSymbol && attrs)
			for (const pair of attrs.matchAll(/([A-Za-z0-9:\-.]+)(?:="([^"]*)")?/g)) {
				const [, key, value] = pair;
				this.attrs.set(key, value ?? true);
			}
	}
	valueOf(): string {
		return this.toString();
	}
	toString(): string {
		const htmlAttrs = [...this.attrs.entries()]
			.map(([key, value]) => value === true ? key : `${key}="${value}"`)
			.join(' ');
		return `<${this.tagName} ${htmlAttrs}>`;
	}
	$(label?: boolean): void {
		let fragment = this.toString();
		if (label && this.tagName === 'label')
			fragment = fragment.substring(0, fragment.length - 8);
		else if (label && this instanceof FormSymbol)
			fragment += '</label>';
		this.runtime.HTML += fragment;
	}
}

class BaseSymbol extends RootSymbol {
	constructor(args: string | undefined, tagName = '', runtime: WBLLRuntime) {
		super(args ?? '', tagName, runtime);

		this.attrs.clear();
		let c = '';
		let quoted = false;
		let param = '';
		for (c of args ?? '') {
			if (c === '"') quoted = !quoted;
			else if (c === ';' && !quoted) this.args.push(param), param = '';
			else param += c;
		}
		this.args.push(param.trim());
	}
	$a(attrs: string): this {
		if (!this.tagName)
			this.tagName = 'span';
		for (const pair of attrs.matchAll(/([A-Za-z0-9:\-.]+)(?:="([^"]*)")?/g)) {
			const [, key, value] = pair;
			this.attrs.set(key, value ?? true);
		}
		return this;
	}
	override toString(): string {
		if (!this.tagName) return this.text;

		let label = '';
		if (this instanceof FormSymbol && this.runtime.HTML.endsWith('</label>')) {
			this.runtime.HTML = this.runtime.HTML.substring(this.runtime.HTML.length - 8);
			label = '</label>';
		}

		if (this instanceof FormSymbol && this.runtime.Settings.has('disabled'))
			this.attrs.set('disabled', this.runtime.Settings.get('disabled') ?? true);
		const htmlAttrs = [...this.attrs.entries()]
			.map(([key, value]) => value === true ? key : `${key}="${value}"`)
			.join(' ');

		if (this.tagName.toLowerCase() === 'input')
			return `<${this.tagName} ${htmlAttrs}>${label}`;
		return `<${this.tagName} ${htmlAttrs}>${this.text}</${this.tagName}>${label}`;
	}
}

class TextSymbol extends BaseSymbol {
	constructor(args: string | undefined, tagName = '', runtime: WBLLRuntime) {
		super(args, tagName, runtime);
		this.text = args ?? '';
	}
}

class AnchorSymbol extends BaseSymbol {
	url: URL;

	constructor(args: string | undefined, tagName = 'a', runtime: WBLLRuntime) {
		super(args, tagName, runtime);
		try { this.url = new URL(this.args[0] ?? ''); } catch { this.url = new URL('about:blank'); }
		this.text = this.args[0] ?? '';
	}
	p(args: string): this {
		const search = `${args};`.split(';');
		this.url.searchParams.set(search[0] ?? '', search[1] ?? '');
		this.attrs.set('href', this.url.toString());
		return this;
	}
	q(args: string | undefined): this {
		try {
			const qs = (args ?? '').trim().replace(/^\?/, '');
			const params = new URLSearchParams(qs);
			for (const [k, v] of params.entries())
				this.url.searchParams.set(k, v);
			this.attrs.set('href', this.url.toString());
		} catch {
			// ignore malformed input
		}
		return this;
	}
	t(args: string): this {
		this.text = args;
		return this;
	}
	// TODO: manage other symbols
}

class FormSymbol extends BaseSymbol {
	constructor(args: string | undefined, tagName = 'input', runtime: WBLLRuntime) {
		super(args, tagName, runtime);

		if (!this.attrs.has('type') && this.args[0])
			this.attrs.set('type', this.args[0]);
		if (!this.attrs.has('id'))
			this.attrs.set('id', `Fld${runtime.FormFields}`);
		if (!this.attrs.has('name'))
			this.attrs.set('name', this.args[1] || `Fld${runtime.FormFields}`);
		if (!this.attrs.has('value') && this.args[2])
			this.attrs.set('value', this.args[2]);
		++runtime.FormFields;
	}
	override toString(): string {
		if (this instanceof ButtonSymbol && this.runtime.Settings.get('disabled'))
			return '';

		let fragment = '';
		const mode = [, '1', '2'].indexOf(this.args[3]);
		if (this.tagName === 'input' && mode > 0) {
			this.attrs.set('list', `${this.attrs.get('id') ?? 'Fld0'}_options`);
			fragment = `<datalist id="${this.attrs.get('id') ?? 'Fld0'}_options">`;
			for (let i = 4; i < this.args.length; i += mode)
				fragment += `<option value="${this.args[i]}"${mode === 2 ? ` label="${this.args[i + mode - 1]}"` : ''}></option>`;
			fragment += '</datalist>';
		}
		return super.toString() + fragment;
	}
}

class TextAreaSymbol extends FormSymbol {
	constructor(args: string | undefined, tagName = 'textarea', runtime: WBLLRuntime) {
		super(args, tagName, runtime);
		this.text = String(this.attrs.get('value') ?? '');
		this.attrs.delete('type');
		this.attrs.delete('value');
	}

	override toString(): string {
		if (this.args[0] === 'contenteditable') {
			this.tagName = 'div';
			this.attrs.set('contenteditable', '');
		} else if (this.args[0])
			this.attrs.set('class', this.args[0]);

		const htmlAttrs = [...this.attrs.entries()]
			.map(([key, value]) => value === true ? key : `${key}="${value}"`)
			.join(' ');

		const fragment = `<${this.tagName} ${htmlAttrs}>${this.text || ''}</${this.tagName}>`;
		return fragment;
	}
}

class ButtonSymbol extends FormSymbol {
	url: URL;
	constructor(args: string | undefined, tagName = 'button', runtime: WBLLRuntime) {
		super(args, tagName, runtime);
		this.attrs.delete('type');

		try { this.url = new URL(this.args[0] ?? ''); } catch { this.url = new URL('about:blank'); }
		this.attrs.set('formaction', this.url.toString());
		this.text = this.args[1] ?? '';
	}
	p(args: string): this {
		const search = `${args};;`.split(';');
		this.url.searchParams.set(search[0] ?? '', search[1] ?? '');
		this.attrs.set('formaction', this.url.toString());
		return this;
	}
}

class ChoiceSymbol extends FormSymbol {
	constructor(args: string | undefined, tagName = 'checkbox', runtime: WBLLRuntime) {
		super(args, tagName, runtime);
	}
	override toString(): string {
		const mode = [, '1', '2'].indexOf(this.args[3]);

		if (mode !== -1) {
			const tagName = this.attrs.get('type');
			this.attrs.delete('type');
			const htmlAttrs = [...this.attrs.entries()]
				.map(([key, value]) => value === true ? key : `${key}="${value}"`)
				.join(' ');
			let fragment = `<input type="hidden" ${htmlAttrs}>`;

			if (tagName === 'checkbox') {
				fragment += '<span class="stwChoices">';
				for (let i = 4; i < this.args.length; i += mode)
					fragment += `<label><input form type="checkbox" name="${this.attrs.get('name')}" value="${mode === 1 ? 1 << (i - 4) : this.args[i]}"> ${this.args[i + mode - 1]}</label>`;
				fragment += '</span>';
			} else if (tagName === 'radio') {
				fragment += '<span class="stwChoices">';
				for (let i = 4; i < this.args.length; i += mode)
					fragment += `<label><input form type="radio" name="${this.attrs.get('name')}" value="${this.args[i]}"> ${this.args[i + mode - 1]}</label>`;
				fragment += '</span>';
			} else if (this.tagName === 'select') {
				fragment = `<select ${htmlAttrs}>`;
				if (this.attrs.has('data-blank')) {
					fragment += '<option value=""></option>';
					this.attrs.delete('data-blank');
				}
				for (let i = 4; i < this.args.length; i += mode)
					fragment += `<option value="${this.args[i]}">${this.args[i + mode - 1]}</option>`;
				fragment += '</select>';
			} else {
				throw new SyntaxError();
			}

			return fragment;
		}
		return '';
	}
}

class EmbedSymbol extends BaseSymbol {
	url: URL;

	constructor(args: string | undefined, tagName: string = '', runtime: WBLLRuntime) {
		super(args, tagName, runtime);

		try { this.url = new URL(this.args[0] ?? ''); } catch { this.url = new URL('about:blank'); }
		if (tagName === 'embed') {
			this.attrs.set('src', this.url.toString());
			this.attrs.set('type', 'text/html');
			this.attrs.set('style', 'display:block; width: 100%; height: 100%');
		}
	}
	p(args: string): this {
		const search = `${args};;`.split(';');
		this.url.searchParams.set(search[0] ?? '', search[1] ?? '');
		this.attrs.set('src', this.url.toString());
		return this;
	}
	q(args: string | undefined): this {
		try {
			const qs = (args ?? '').trim().replace(/^\?/, '');
			const params = new URLSearchParams(qs);
			for (const [k, v] of params.entries())
				this.url.searchParams.set(k, v);
			this.attrs.set('href', this.url.toString());
		} catch {
			// ignore malformed input
		}
		return this;
	}
	override async $(): Promise<void> {
		if (this.tagName === 'embed')
			this.runtime.HTML += super.toString();
		else {
			const response = await fetch(this.url);
			this.runtime.HTML += await response.text();
		}
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
	if (!symbol.attrs.has('target'))
		symbol.attrs.set('target', '_blank');
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
	const symbol = new ChoiceSymbol(`;${args ?? ';;'}`, undefined, runtime);
	symbol.attrs.set('type', 'checkbox');
	return symbol;
}
function d(args: string, index: number, runtime: WBLLRuntime): ChoiceSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new ChoiceSymbol(`;${args ?? ';;'}`, 'select', runtime);
	symbol.attrs.set('data-blank', true);
	return symbol;
}
function D(args: string, index: number, runtime: WBLLRuntime): ChoiceSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new ChoiceSymbol(`;${args ?? ';;'}`, 'select', runtime);
	return symbol;
}
function e(args: string, index: number, runtime: WBLLRuntime): FormSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new FormSymbol(args, undefined, runtime);
	return symbol;
}
function f(args: string, index: number, runtime: WBLLRuntime): FormSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new FormSymbol(args, 'span', runtime);
	return symbol;
}
function h(args: string, index: number, runtime: WBLLRuntime): FormSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new FormSymbol(`;${args}`, undefined, runtime);
	symbol.attrs.set('type', 'hidden');
	return symbol;
}
// TODO: single image, key/image
function i(args: string, index: number, runtime: WBLLRuntime): BaseSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new BaseSymbol(args, 'img', runtime);
	return symbol;
}
function j(args: string, index: number, runtime: WBLLRuntime): TextSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new TextSymbol(args, 'script', runtime);
	return symbol;
}
function k(args: string, index: number, runtime: WBLLRuntime): void {
	// TODO: short version of v
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
}
function l(args: string, index: number, runtime: WBLLRuntime): TextSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new TextSymbol(args, 'label', runtime);
	symbol.text = `<span>${symbol.text}</span>`;
	symbol.attrs.set('for', `Fld${runtime.FormFields}`);
	return symbol;
}
function m(args: string, index: number, runtime: WBLLRuntime): TextAreaSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new TextAreaSymbol(`${args ?? ';'}`, undefined, runtime);
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
	const symbol = new EmbedSymbol(args, 'embed', runtime);
	return symbol;
}
function r(args: string, index: number, runtime: WBLLRuntime): ChoiceSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new ChoiceSymbol(`;${args ?? ';;'}`, undefined, runtime);
	symbol.attrs.set('type', 'radio');
	return symbol;
}
function s(args: string, index: number, runtime: WBLLRuntime): ChoiceSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new ChoiceSymbol(`;${args ?? ';;'}`, 'select', runtime);
	symbol.attrs.set('multiple', true);
	return symbol;
}
function t(args: string, index: number, runtime: WBLLRuntime): TextSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new TextSymbol(args, undefined, runtime);
	return symbol;
}
function u(args: string, index: number, runtime: WBLLRuntime): FormSymbol {
	// TODO: File naming
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new FormSymbol(`;${args}`, undefined, runtime);
	symbol.attrs.set('type', 'file');
	return symbol;
}
function v(args: string, index: number, runtime: WBLLRuntime): void {
	// TODO: Store and show expression result
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
}
function w(args: string, index: number, runtime: WBLLRuntime): FormSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new FormSymbol(`;${args}`, undefined, runtime);
	symbol.attrs.set('type', 'password');
	return symbol;
}
function $s(args: string, index: number, runtime: WBLLRuntime): void {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	runtime.Settings.set('rows', 25);
	for (const pair of args.matchAll(/([A-Za-z0-9:\-.]+)(?:="([^"]*)")?/g)) {
		const [, key, value] = pair;
		runtime.Settings.set(key, value ?? true);
	}
}
function $A(args: string, index: number, runtime: WBLLRuntime): void {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	for (const pair of args.matchAll(/([A-Za-z0-9:\-.]+)(?:="([^"]*)")?/g)) {
		const [, key, value] = pair;
		runtime.Attributes.set(key, value ?? true);
	}
}
function $r(args: string, index: number, runtime: WBLLRuntime): RootSymbol {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
	const symbol = new RootSymbol(args, 'br', runtime);
	return symbol;
}
// TODO: New row, applicable to table content
function $n(args: string, index: number, runtime: WBLLRuntime): void {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
}
function $t(args: string, index: number, runtime: WBLLRuntime): void {
	runtime.Index = index;
	args = WBPL(args, runtime.Placeholders);
}
function $mc(steps: number, index: number, runtime: WBLLRuntime): void {
	runtime.Index = index;
	runtime.FldIndex += steps;
}
//#endregion