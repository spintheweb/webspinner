/**
 * @fileoverview Renders developer-facing error contents.
 *
 * Displays a failed content's error and serialized properties at the
 * location supplied by a virtual shortcut.
 *
 * @author Copilot
 * @module stwError
 * @license Apache-2.0
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { localizedValue } from "../stwComponents/stwLocalization.js";
import { secureResponse } from "../stwComponents/stwResponse.js";
import { STWContent } from "../stwElements/stwContent.js";

function escapeHTML(value) {
	return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

class STWError extends STWContent {
	serve(_request, session, ref) {
		if (!ref?.content || !Object.hasOwn(ref, "error"))
			throw new TypeError("Error content requires a failed content and error");

		const content = ref.content;
		console.error(`Error rendering content ${content.uuid}:`, ref.error);
		const pathname = content.pathname(session);
		let body = "";
		if (session.dev) {
			const uuid = escapeHTML(content.uuid).replaceAll('"', "&quot;");
			const sequence = escapeHTML(ref.sequence).replaceAll('"', "&quot;");
			const message = ref.error instanceof Error ? ref.error.message : ref.error;
			const layout = localizedValue(content.layout, session);
			const properties = JSON.stringify({
				subtype: content.type ?? null,
				name: content.localize(session, "name"),
				slug: content.localize(session, "slug"),
				description: content.localize(session, "description"),
				cssClass: content.cssClass,
				section: content.section,
				sequence: content.sequence,
				connector: content.connector,
				query: content.query,
				params: content.params,
				layout: typeof layout === "string" ? layout : layout?.wbll ?? "",
				contentType: content.contentType
			}, null, 2);
			body = `<article tabindex="0" id="${uuid}" data-sequence="${sequence}" class="stwError">
<h1><i class="fa-light fa-bug"></i> Error: <a href="#" data-stw-editor data-stw-error-content-id="${uuid}" onclick="_stwOpenContentEditor(this.dataset.stwErrorContentId); return false;">${escapeHTML(pathname || content.uuid)}</a></h1>
<section><dl>
  <dt></dt>
  <dd>
    <details>
      <summary>${escapeHTML(message)}</summary>
      <pre>${escapeHTML(properties)}</pre>
    </details>
  </dd>
</dl></section>
</article>`;
		}
		return secureResponse(JSON.stringify({
			method: session.dev ? "PUT" : "DELETE",
			pathname,
			id: content.uuid,
			section: ref.section,
			sequence: ref.sequence,
			error: true,
			body
		}), { headers: { "Content-Type": content.contentType } });
	}
}

registerElement("Error", STWError);

const errorContent = new STWError({ uuid: "stwError", type: "Content", subtype: "Error" });

export { STWError, errorContent };
