/**
 * @fileoverview Provides identifier utilities for Spin the Web components.
 *
 * Converts UUID strings to compact base62 identifiers and generates new
 * identifiers from cryptographically random UUID values.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwIds
 * @requires crypto.randomUUID
 * @license GPL-3.0-or-later
 */
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function newId(): string {
	return uuidToBase62(crypto.randomUUID());
}

function uuidToBase62(uuid: string): string {
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
	return "x" + out;
}
