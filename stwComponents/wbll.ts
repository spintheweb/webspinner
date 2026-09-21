declare global {
	var WBLL: {
		HTML?: string;
		FldIndex?: number;
		FormFields?: number;
		Settings?: Map<string, string | boolean | number>;
		Attributes?: Map<string, string | boolean | number>;
		Index?: number;
		[key: string]: unknown;
	};
}

// deno-lint-ignore prefer-const
export let HTML = '', FldIndex = 0, FormFields = 0, Settings = new Map<string, string | boolean | number>(), Attributes = new Map<string, string | boolean | number>(), Index: number | undefined;

type AttrValue = string | boolean | number;

class RootSymbol {
	text = '';
	tagName = '';
	args: string[] = [];
	attrs = new Map<string, AttrValue>();

	constructor(attrs?: string, tagName = '') {
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
		HTML += fragment;
	}
}

class BaseSymbol extends RootSymbol {
	constructor(args: string | undefined, tagName = '') {
		super(args ?? '', tagName);
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
		if (this instanceof FormSymbol && HTML.endsWith('</label>')) {
			HTML = HTML.substring(HTML.length - 8);
			label = '</label>';
		}

		if (this instanceof FormSymbol && Settings.has('disabled'))
			this.attrs.set('disabled', Settings.get('disabled') ?? true);
		const htmlAttrs = [...this.attrs.entries()]
			.map(([key, value]) => value === true ? key : `${key}="${value}"`)
			.join(' ');

		return `<${this.tagName} ${htmlAttrs}>${this.text}</${this.tagName}>${label}`;
	}
}

class TextSymbol extends BaseSymbol {
	constructor(args: string | undefined, tagName = '') {
		super(args, tagName);
		this.text = args ?? '';
	}
}

class AnchorSymbol extends BaseSymbol {
	url: URL;
	constructor(args: string | undefined, tagName = 'a') {
		super(args, tagName);
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
	constructor(args: string | undefined, tagName = 'input') {
		super(args, tagName);
		if (!this.attrs.has('type') && this.args[0])
			this.attrs.set('type', this.args[0]);
		if (!this.attrs.has('id'))
			this.attrs.set('id', `Fld${FormFields}`);
		if (!this.attrs.has('name'))
			this.attrs.set('name', this.args[1] || `Fld${FormFields}`);
		if (!this.attrs.has('value') && this.args[2])
			this.attrs.set('value', this.args[2]);
		++FormFields;
	}
	override toString(): string {
		if (this instanceof ButtonSymbol && Settings.get('disabled'))
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
	constructor(args: string | undefined, tagName = 'textarea') {
		super(args, tagName);
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
	constructor(args: string | undefined, tagName = 'button') {
		super(args, tagName);
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
	constructor(args: string | undefined, tagName = 'checkbox') {
		super(args, tagName);
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
	constructor(args: string | undefined, tagName?: string) {
		super(args, tagName ?? '');
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
			HTML += super.toString();
		else {
			const response = await fetch(this.url);
			HTML += await response.text();
		}
	}
}

export function a(url: string, index: number) {
	Index = index;
	const symbol = new AnchorSymbol(url);
	return symbol;
}
export function A(url: string, index: number) {
	Index = index;
	const symbol = new AnchorSymbol(url);
	if (!symbol.attrs.has('target'))
		symbol.attrs.set('target', '_blank');
	return symbol;
}
export function b(args: string | undefined, index: number) {
	Index = index;
	const symbol = new ButtonSymbol(args);
	return symbol;
}
export function c(args: string | undefined, index: number) {
	Index = index;
	const symbol = new ChoiceSymbol(`;${args ?? ';;'}`);
	symbol.attrs.set('type', 'checkbox');
	return symbol;
}
export function d(args: string | undefined, index: number) {
	Index = index;
	const symbol = new ChoiceSymbol(`;${args ?? ';;'}`, 'select');
	symbol.attrs.set('data-blank', true);
	return symbol;
}
export function D(args: string | undefined, index: number) {
	Index = index;
	const symbol = new ChoiceSymbol(`;${args ?? ';;'}`, 'select');
	return symbol;
}
export function e(args: string | undefined, index: number) {
	Index = index;
	const symbol = new FormSymbol(args);
	return symbol;
}
export function f(args: string | undefined, index: number) {
	Index = index;
	const symbol = new FormSymbol(args, 'span');
	return symbol;
}
export function h(args: string | undefined, index: number) {
	Index = index;
	const symbol = new FormSymbol(`;${args}`);
	symbol.attrs.set('type', 'hidden');
	return symbol;
}
// TODO: single image, key/image
export function i(args: string | undefined, index: number) {
	Index = index;
	const symbol = new BaseSymbol(args, 'img');
	return symbol;
}
export function j(args: string | undefined, index: number) {
	Index = index;
	const symbol = new TextSymbol(args, 'script');
	return symbol;
}
export function k(args: string | undefined, index: number) {
	// TODO: short version of v
	Index = index;
	void args;
}
export function l(args: string | undefined, index: number) {
	Index = index;
	const symbol = new TextSymbol(args, 'label');
	symbol.text = `<span>${symbol.text}</span>`;
	symbol.attrs.set('for', `Fld${WBLL.FormFields}`);
	return symbol;
}
export function m(args: string | undefined, index: number) {
	Index = index;
	const symbol = new TextAreaSymbol(`${args ?? ';'}`);
	return symbol;
}
export function o(args: string | undefined, index: number) {
	Index = index;
	const symbol = new EmbedSymbol(args);
	return symbol;
}
export function O(args: string | undefined, index: number) {
	Index = index;
	const symbol = new EmbedSymbol(args, 'embed');
	return symbol;
}
export function r(args: string | undefined, index: number) {
	Index = index;
	const symbol = new ChoiceSymbol(`;${args ?? ';;'}`);
	symbol.attrs.set('type', 'radio');
	return symbol;
}
export function s(args: string | undefined, index: number) {
	Index = index;
	const symbol = new ChoiceSymbol(`;${args ?? ';;'}`, 'select');
	symbol.attrs.set('multiple', true);
	return symbol;
}
export function t(args: string | undefined, index: number) {
	Index = index;
	const symbol = new TextSymbol(args);
	return symbol;
}
export function u(args: string | undefined, index: number) {
	// TODO: File naming
	Index = index;
	const symbol = new FormSymbol(`;${args}`);
	symbol.attrs.set('type', 'file');
	return symbol;
}
export function v(args: string | undefined, index: number) {
	// TODO: Store and show expression result
	Index = index;
	void args;
}
export function w(args: string | undefined, index: number) {
	Index = index;
	const symbol = new FormSymbol(`;${args}`);
	symbol.attrs.set('type', 'password');
	return symbol;
}
export function $s(args: string, index: number) {
	Index = index;
	Settings.set('rows', 25);
	for (const pair of args.matchAll(/([A-Za-z0-9:\-.]+)(?:="([^"]*)")?/g)) {
		const [, key, value] = pair;
		Settings.set(key, value ?? true);
	}
}
export function $A(args: string, index: number) {
	Index = index;
	for (const pair of args.matchAll(/([A-Za-z0-9:\-.]+)(?:="([^"]*)")?/g)) {
		const [, key, value] = pair;
		Attributes.set(key, value ?? true);
	}
}
export function $r(args: string, index: number) {
	Index = index;
	const symbol = new RootSymbol(args, 'br');
	return symbol;
}
// TODO: New row, applicable to table content
export function $n(args: string | undefined, index: number) {
	Index = index;
	void args;
}
export function $t(args: string | undefined, index: number) {
	Index = index;
	void args;
}
export function $mc(steps: number, index: number) {
	Index = index;
	FldIndex += steps;
}

// Macrorenderer
// TODO: Microrenderer
class _Lexer {
	constructor(content: unknown, data: unknown) {
		void content;
		void data;
	}
}

export async function render(content: Record<string, unknown> = {}, data: unknown = {}, wbll: string) {
	if (!globalThis.WBLL)
		globalThis.WBLL = await import('./wbll.js');

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
	let closed = false;
	for (const expression of wbll.matchAll(SYMBOLS)) {
		if (expression.groups?.error !== undefined)
			throw new SyntaxError(`<pre class="stwError">Syntax error:<br>${expression.input.slice(0, expression.index)}<i>⋙${expression.input.slice(expression.index)}</i></pre>`);

		const pattern = expression.filter((value, i) => (value !== undefined && i));
		if (pattern[0]) {
			if (['<', '>'].includes(pattern[0].at(0) ?? ''))
				code.push(`WBLL.$mc(${(pattern[0].at(0) === '<' ? -1 : 1) * pattern[0].length}, ${expression.index})`);
			else {
				const fragment = `${pattern[0].replace('\\', '$')}(${pattern[1] ? '"' + pattern[1].replace(/"/g, '\\"') + '"' : 'null'}, ${expression.index})`;

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
		const label = i > 0 && content.type === 'form' && ((code[i].at(5) === 'l' && 'cdemrsuw'.indexOf(code[i + 1]?.at(5) ?? '') !== -1) || (code[i - 1]?.at(11) === 'l' && 'cdemrsuw'.indexOf(code[i].at(5) ?? '') !== -1)) ? true : false;
		code[i] = code[i].match(/\$(A|s|mc)/) ? `${code[i]};` : `await ${code[i]}.$(${label});`;
	}

	console.clear();
	console.debug(code.join(''));

	code.push('return content ? `<div role="' + '${content.type}' + '">${WBLL.HTML}</div>` : WBLL.HTML;');

	HTML = '';
	const render = new Function('content', 'data', 'WBLL', 'return (async () => { ' + code.join('') + ' })();');
	try {
		return await render(content, data, WBLL);
	} catch (_err) {
		const index = WBLL.Index ?? 0;
		throw new SyntaxError(`<pre class="stwError">Syntax error:<br>${wbll.slice(0, index)}<i>⋙${wbll.slice(index)}</i></pre>`);
	}
}
