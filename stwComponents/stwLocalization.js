/**
 * @fileoverview Resolves localized values and negotiates session languages.
 *
 * Selects localized properties using session, default, and available languages,
 * and matches user language preferences against portal languages.
 *
 * @author Copilot
 * @version 1.0.0
 * @module stwLocalization
 * @license Apache-2.0
 */
function localizedEntry(values, session) {
	if (!(values instanceof Map)) return undefined;
	const languages = [
		session.placeholders.get("@@stwlanguage"),
		session.placeholders.get("@@stwdefaultlanguage"),
		...values.keys()
	];
	for (const language of languages) {
		const value = values.get(language);
		if (value !== undefined && value !== null && value !== "")
			return [language, value];
	}
	return undefined;
}

function localizedValue(values, session) {
	return localizedEntry(values, session)?.[1];
}

export { localizedEntry, localizedValue, negotiateLanguage, parseAcceptLanguage };
function parseAcceptLanguage(header) {
	return (header || "").split(",").map((part, index) => {
		const [language, ...parameters] = part.trim().split(";");
		const quality = parameters.find(parameter => parameter.trim().toLowerCase().startsWith("q="));
		const weight = quality ? Number(quality.trim().slice(2)) : 1;
		return { language, weight, index };
	}).filter(({ language, weight }) =>
		/^[a-z]+(?:-[a-z0-9]+)*$/i.test(language) && weight > 0 && weight <= 1
	).sort((a, b) => b.weight - a.weight || a.index - b.index).map(({ language }) => language);
}

function negotiateLanguage(languages, preferences, defaultLanguage) {
	for (const preference of preferences) {
		if (typeof preference !== "string") continue;
		let candidate = preference.toLowerCase();
		while (candidate) {
			const match = languages.find(language => language.toLowerCase() === candidate);
			if (match) return match;
			const separator = candidate.lastIndexOf("-");
			candidate = separator < 0 ? "" : candidate.slice(0, separator);
		}
	}
	return defaultLanguage;
}

