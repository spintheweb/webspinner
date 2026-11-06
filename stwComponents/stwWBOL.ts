/**
 * @fileoverview Parses WBOL XML documents into the element tree consumed by
 * STWElement constructors.
 *
 * Accepts WBOL XML text or a file path, validates supported elements, and
 * preserves WBOL attributes, localized names, text, options, and children.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwWBOL
 * @requires @xmldom/xmldom
 * @license GPL-3.0-or-later
 */

import { readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";

/**
 * Parses a WBOL document or file path into the element tree consumed by STWElement constructors.
 *
 * The source must contain XML beginning with a root element or be a path to a WBOL file.
 * Supported root elements are `webbase` and `webbaselet`; they become `Portal` and `Area` nodes.
 *
 * @param source WBOL XML text or a path to a WBOL file.
 * @returns The parsed WBOL element tree.
 * @throws {Error} If the source has an unsupported root or child element.
 */
export function WBOL(source: string): any {
	if (!source.trimStart().startsWith("<")) source = readFileSync(source, "utf8");
	const document = new DOMParser({
		errorHandler: {
			warning: () => {},
			error: message => { throw new Error(message); },
			fatalError: message => { throw new Error(message); },
		},
	}).parseFromString(source, "application/xml");
	const root = document.documentElement;
	if (!root) throw new Error("WBOL: document has no root element");

	switch (localName(root)) {
		case 'webbase':
			return WBOLFragment(root);
		case 'webbaselet':
			return WBOLFragment(root);
		default:
			throw new Error(`WBOL: unsupported root element ${localName(root)}`);
	}
}

function WBOLFragment(element: Element): any {
	let obj: any = {};
	const name = localName(element);

	if (!['webbase', 'webbaselet', 'area', 'page', 'content', 'shortcut'].includes(name))
		throw new Error(`WBOL: unsupported element ${name}`);

	obj.type = name.charAt(0).toUpperCase() + name.slice(1);
	for (let i = 0; i < element.attributes.length; i++) {
		const attribute = element.attributes.item(i)!;
		const attr = attribute.name;
		if (attr.startsWith('xml:') || attr === 'xmlns') continue;
		if (attr === 'langs')
			obj.langs = attribute.value.split(' ');
		else
			obj[attr] = attribute.value;
	}

	if (name === 'content') {
		obj.subtype = obj.type.charAt(0).toUpperCase() + obj.type.slice(1);
		obj.type = 'Content';
	}

	childElements(element).forEach(child => {
		switch (localName(child)) {
			case 'name':
				obj = Object.assign(parseName(child), obj);
				break;
			case 'layout':
			case 'keywords':
			case 'description':
				obj[localName(child)] = parseText(child);
				break;
			case 'query':
				obj.dsn = child.getAttribute('datasource') ?? undefined;
				obj.parameters = child.getAttribute('parameters') ?? undefined;
				obj.query = innerText(child);
				break;
			case 'options':
				obj.options = parseOptions(child);
				break;
			case 'roles':
			case 'visibilities':
			case 'visibility':
				obj.visibility = {};
				childElements(child).filter(role => localName(role) === 'role').forEach(role => {
					if (name === 'webbase')
						obj.visibility[role.getAttribute('id')!] = undefined; // For webbase, visibility is not explicitly set
					else if (role.getAttribute('visibility') === 'true' || role.getAttribute('visibility') === 'false')
						obj.visibility[role.getAttribute('id')!] = role.getAttribute('visibility') === 'true';
				});
				break;
			case 'children':
				obj.children = [];
				childElements(child).forEach(grandchild =>
					obj.children.push(WBOLFragment(grandchild))
				);
				break;
			default:
				throw new Error(`WBOL: unsupported element ${localName(child)}`);
		}
	});

	if (obj.type === 'Webbase') {
		obj.type = 'Portal';
		Object.keys(obj.slug).forEach(key => obj.slug[key] = ''); // Clear all slugs for Webbase (Portal)
	} else if (obj.type === 'Webbaselet')
		obj.type = 'Area';

	return obj;
}

function parseOptions(wbol: Element | null): any {
	const obj: any = [];
	if (!wbol) return obj;
	childElements(wbol).filter(option => localName(option) === 'option').forEach(option => {
		obj.push({
			name: parseText(option),
			ref: option.getAttribute('ref') ?? undefined,
			parameters: option.getAttribute('parameters') ?? undefined,
			options: parseOptions(childElements(option).find(options => localName(options) === 'options') ?? null)
		});
	});
	return obj;
}

function innerText(wbol: Element): string {
	return wbol.textContent ?? "";
}

function parseName(wbol: Element): any {
	const obj: any = { name: {}, slug: {} };
	childElements(wbol).filter(child => localName(child) === 'text').forEach(name => {
		const lang = name.getAttribute('xml:lang') || 'en';
		obj.slug[lang] = name.getAttribute('slug') ?? undefined;
		obj.name[lang] = name.textContent ?? "";
	});
	return obj;
}

function parseText(wbol: Element): any {
	const obj: any = {};
	childElements(wbol).filter(child => localName(child) === 'text').forEach(text =>
		obj[text.getAttribute('xml:lang') || 'en'] = text.textContent ?? ""
	);
	return obj;
}

function childElements(element: Element): Element[] {
	const children: Element[] = [];
	for (let child = element.firstChild; child; child = child.nextSibling) {
		if (child.nodeType === 1) children.push(child as Element);
	}
	return children;
}

function localName(element: Element): string {
	return element.localName || element.tagName.split(":").at(-1)!;
}
