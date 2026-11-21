/**
 * @fileoverview Provides identifier utilities for Spin the Web components.
 *
 * Converts UUID strings to compact base62 identifiers and generates new
 * identifiers from cryptographically random UUID values.
 *
 * @author Giancarlo Trevisan
 * @version 1.0.0
 * @module stwIds
 * @requires crypto.randomUUID
 * @note Copilot-assisted
 * @license Apache-2.0
 */
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
function newId(type = "x") {
	return uuidToBase62(crypto.randomUUID(), type);
}
function uuidToBase62(uuid, type) {
	const hex = uuid.replace(/-/g, "");
	let n = BigInt("0x" + hex);
	if (n === 0n) return "0";
	let out = "";
	const base = BigInt(ALPHABET.length);
	while (n > 0n) {
		const rem = Number(n % base);
		out = ALPHABET[rem] + out;
		n = n / base;
	}
	return type + out;
}
export {
	newId
};
