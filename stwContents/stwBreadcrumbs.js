/**
 * @fileoverview Defines the breadcrumbs content element.
 *
 * Builds a localized navigation trail from the current request path and
 * renders it through the configured content layout.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwBreadcrumbs
 * @license GPL-3.0-or-later
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";
class STWBreadcrumbs extends STWContent {
  constructor(content) {
    super(content);
  }
  async render(request, session, _records) {
    let body = "";
    for (let element = session.portal.find(session, new URL(request.url).pathname); element; element = element.parent)
      if (element.isVisible(session) && element.pathname(session))
        body = `/<a href="${element.pathname(session)}">${element.localize(session, "name")}</a>` + body;
    return `<nav>${body}</nav>`;
  }
}
registerElement("Breadcrumbs", STWBreadcrumbs);
export {
  STWBreadcrumbs
};
