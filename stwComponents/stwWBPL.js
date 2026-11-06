/**
 * @fileoverview Replaces WBPL placeholders in text with values from a map.
 *
 * Supports escaped, quoted, and repeated placeholders, including comma-separated
 * values and ellipsis expansion.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwWBPL
 * @license GPL-3.0-or-later
 */
function WBPL(text, placeholders) {
  if (!text || text.indexOf("@") === -1) return text ?? "";
  const ESCAPED_AT = "", EMPTY = "", VALUED = "", AFTER = "", BEFORE = "";
  let result = text.replace(/\\@/gm, ESCAPED_AT);
  result = result.replace(
    /(['"])(@{1,3}[a-zA-Z0-9_$.]*[a-zA-Z0-9_])\1\.\.\./gm,
    (_, quote, ph) => {
      const val = placeholders.get(ph)?.toString() ?? "";
      if (!val) return quote + EMPTY + quote;
      return VALUED + val.split(",").map((v) => quote + v.replace(new RegExp(quote, "gm"), quote + quote) + quote).join(",");
    }
  );
  result = result.replace(
    /(['"])(@{1,3}[a-zA-Z0-9_$.]*[a-zA-Z0-9_])\1/gm,
    (_, quote, ph) => {
      const val = placeholders.get(ph)?.toString() ?? "";
      if (!val) return quote + EMPTY + quote;
      return VALUED + quote + val.replace(new RegExp(quote, "gm"), quote + quote) + quote;
    }
  );
  result = result.replace(
    /(@{1,3}[a-zA-Z0-9_$.]*[a-zA-Z0-9_])/gm,
    (ph) => placeholders.get(ph) ?? "" ? VALUED + placeholders.get(ph) : EMPTY
  );
  result = result.replace(/\{([^{}]*)\}/gm, (match, inner) => {
    if (!inner.includes(VALUED) && !inner.includes(EMPTY))
      return match;
    return inner.includes(VALUED) ? inner : EMPTY;
  });
  result = result.replace(/\[([^\[\]]*)\]/gm, (match, inner, offset, str) => {
    if (!inner.includes(VALUED) && !inner.includes(EMPTY))
      return match;
    if (inner.includes(VALUED))
      return inner;
    if (str.slice(offset + match.length).match(/^\s*\S+/)) return AFTER;
    if (str.slice(0, offset).match(/\S+\s*$/)) return BEFORE;
    return "";
  });
  result = result.replace(new RegExp(`${AFTER}\\s*\\w+|\\w+\\s*${BEFORE}`, "gm"), "");
  result = result.replaceAll(VALUED, "").replaceAll(EMPTY, "").replaceAll(AFTER, "").replaceAll(BEFORE, "").replaceAll(ESCAPED_AT, "@");
  return result;
}
export {
  WBPL
};
