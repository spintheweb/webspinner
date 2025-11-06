// SPDX-License-Identifier: GPL-3.0-or-later
// Spin the Web component: wbpl

/**
 * Webbase Placeholders Language replaces placeholders in the given text with values from the provided map.
 *
 * @param text Text containing placeholders.
 * @param placeholders Map of placeholder values.
 * @returns Text with placeholders replaced.
 */
export function wbpl(text: string, placeholders: Map<string, string>): string {
    const ESCAPED_AT = "\u0001", EMPTY = "\u0002", VALUED = "\u0003", AFTER = "\u0004", BEFORE = "\u0005";

    // Step 1: Handle escaped @
    let result = text.replace(/\\@/g, ESCAPED_AT);

    // Step 2: Handle quoted placeholders with ellipsis first
    result = result.replace(/(['"])(@{1,3}[a-zA-Z0-9_$.]*[a-zA-Z0-9_])\1\.\.\./g,
        (_, quote, ph) => {
            const val = placeholders.get(ph) ?? "";
            if (!val) return EMPTY;
            return VALUED + val.split(",")
                .map(v => quote + v.replace(new RegExp(quote, "g"), quote + quote) + quote)
                .join(",");
        });

    // Step 3: Handle quoted placeholders
    result = result.replace(/(['"])(@{1,3}[a-zA-Z0-9_$.]*[a-zA-Z0-9_])\1/g,
        (_, quote, ph) => {
            const val = placeholders.get(ph) ?? "";
            if (!val) return EMPTY;
            return VALUED + quote + val.replace(new RegExp(quote, "g"), quote + quote) + quote;
        });

    // Step 4: Mark remaining placeholders
    result = result.replace(/(@{1,3}[a-zA-Z0-9_$.]*[a-zA-Z0-9_])/g, ph =>
        (placeholders.get(ph) ?? "") ? VALUED + placeholders.get(ph)! : EMPTY
    );

    // Step 5: Process brackets and braces
    // Handle inner most curly brackets (no nested { } inside)
    result = result.replace(/\{([^{}]*)\}/g, (match, inner) => {
        if (!inner.includes(VALUED) && !inner.includes(EMPTY))
            return match;
        return inner.includes(VALUED) ? inner : EMPTY;
    });

    // Handle innermost square brackets (no nested [ ] inside)
    result = result.replace(/\[([^\[\]]*)\]/g, (match, inner, offset, str) => {
        if (!inner.includes(VALUED) && !inner.includes(EMPTY))
            return match;
        if (inner.includes(VALUED))
            return inner;
        if (str.slice(offset + match.length).match(/^\s*\S+/)) return AFTER;
        if (str.slice(0, offset).match(/\S+\s*$/)) return BEFORE;
        return "";
    });
    result = result.replace(new RegExp(`${AFTER}\\s*\\w+|\\s*\\w+${BEFORE}`, "g"), "");

    // Step 6: Clean up markers
    result = result
        .replaceAll(VALUED, "")
        .replaceAll(EMPTY, "")
        .replaceAll(AFTER, "")
        .replaceAll(BEFORE, "")
        .replaceAll(ESCAPED_AT, "@");

    return result;
}
