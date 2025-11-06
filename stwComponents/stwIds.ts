// SPDX-License-Identifier: GPL-3.0-or-later
// Utility: ID helpers (UUID -> base62)

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Convert a UUID string to base62. Dashes are removed before conversion.
 */
export function uuidToBase62(uuid: string): string {
    // Remove dashes and interpret as a hex bigint
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

/**
 * Generate a new base62 id from crypto.randomUUID()
 */
export function newId(): string {
    return uuidToBase62(crypto.randomUUID());
}