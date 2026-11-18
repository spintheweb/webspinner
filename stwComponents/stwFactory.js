/**
 * @fileoverview Registry factory for WBOL element and content constructors.
 *
 * Registers element/content classes by name and resolves them during WBOL
 * parsing and portal instantiation.
 *
 * @author Giancarlo Trevisan
 * @version 1.0.0
 * @module stwFactory
 * @note Copilot-assisted
 * @license Apache-2.0
 */
const STWFactory = {};
function registerElement(name, ctor) {
	STWFactory[name] = ctor;
}
function requireElement(name) {
	const ctor = STWFactory[name];
	if (!ctor) throw new Error(`STWFactory: element '${name}' not registered`);
	return ctor;
}
export {
	STWFactory,
	registerElement,
	requireElement
};
