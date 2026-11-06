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
