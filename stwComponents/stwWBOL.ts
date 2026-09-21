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
 * @requires jsr:@std/xml
 * @license GPL-3.0-or-later
 */

// deno-lint-ignore no-unversioned-import
import * as xml from "jsr:@std/xml";

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
export function parseWBOL(source: string): any {
	if (!source.startsWith('<'))
		source = Deno.readTextFileSync(source);
	const wbol = xml.parse(source);

	switch (wbol.root.name.local) {
		case 'webbase':
			return parseWBOLFragment(wbol.root);
		case 'webbaselet':
			return parseWBOLFragment(wbol.root);
		default:
			throw new Error(`WBOL: unsupported root element ${wbol.root.name.local}`);
	}
}

function parseWBOLFragment(element: xml.XmlElement): any {
	let obj: any = {};

	if (['webbase', 'webbaselet', 'area', 'page', 'content', 'shortcut'].findIndex(e => e === element.name.local) === -1)
		throw new Error(`WBOL: unsupported element ${element.name.local}`);

	obj.type = element.name.local.charAt(0).toUpperCase() + element.name.local.slice(1);
	for (const attr in element.attributes) {
		if (attr.startsWith('xml:') || attr === 'xmlns') continue;
		if (attr === 'langs')
			obj.langs = element.attributes[attr].split(' ');
		else
			obj[attr] = element.attributes[attr];
	}

	if (element.name.local === 'content') {
		obj.subtype = obj.type.charAt(0).toUpperCase() + obj.type.slice(1);
		obj.type = 'Content';
	}

	element.children.filter(child => child.type === 'element').forEach(child => {
		switch (child.name.local) {
			case 'name':
				obj = Object.assign(parseName(child), obj);
				break;
			case 'layout':
			case 'keywords':
			case 'description':
				obj[child.name.local] = parseText(child);
				break;
			case 'query':
				obj.dsn = child.attributes.datasource;
				obj.parameters = child.attributes.parameters;
				obj.query = innerText(child);
				break;
			case 'options':
				obj.options = parseOptions(child);
				break;
			case 'visibilities':
				obj.visibility = {};
				child.children.filter(role => role.type === 'element' && role.name.local === 'role').forEach((role: any) =>
					obj.visibility[role.attributes.id] = role.attributes.visibility
				);
				break;
			case 'children':
				obj.children = [];
				child.children.filter(grandchild => grandchild.type === 'element').forEach(grandchild =>
					obj.children.push(parseWBOLFragment(grandchild))
				);
				break;
			default:
				throw new Error(`WBOL: unsupported element ${child.name.local}`);
		}
	});

	if (obj.type === 'Webbase') {
		obj.type = 'Portal';
		Object.keys(obj.slug).forEach(key => obj.slug[key] = ''); // Clear all slugs for Webbase (Portal)
	} else if (obj.type === 'Webbaselet')
		obj.type = 'Area';

	return obj;
}

function parseOptions(wbol: xml.XmlElement = { attributes: {}, children: [], name: { raw: '', local: '' }, type: 'element' }): any {
	const obj: any = [];
	wbol.children.filter(option => option.type === 'element' && option.name.local === 'option').forEach((option: any) => {
		obj.push({
			name: parseText(option),
			ref: option.attributes.ref,
			parameters: option.attributes.parameters,
			options: option.children ? parseOptions(option.children.find((options: any) => options.type === 'element' && options.name.local === 'options')) : []
		});
	});
	return obj;
}

function innerText(wbol: xml.XmlElement): string {
	return (wbol.children.find(child => child.type === 'cdata') || { text: '' }).text;
}

function parseName(wbol: xml.XmlElement): any {
	const obj: any = { name: {}, slug: {} };
	wbol.children.filter(child => child.type === 'element' && child.name.local === 'text').forEach((name: any) => {
		obj.slug[name.attributes['xml:lang'] || 'en'] = name.attributes.slug;
		obj.name[name.attributes['xml:lang'] || 'en'] = name.children[0].text;
	});
	return obj;
}

function parseText(wbol: xml.XmlElement): any {
	const obj: any = {};
	wbol.children.filter(child => child.type === 'element' && child.name.local === 'text').forEach((text: any) =>
		obj[text.attributes['xml:lang'] || 'en'] = text.children[0].text
	);
	return obj;
}
