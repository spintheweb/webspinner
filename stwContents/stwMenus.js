/**
 * @fileoverview Defines the menu content element.
 *
 * Loads nested localized menu options and renders them as a navigable content
 * element.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwMenus
 * @license GPL-3.0-or-later
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";
import { newId } from "../stwComponents/stwIds.js";
class STWMenus extends STWContent {
  options = [];
  constructor(content) {
    super(content);
    this.options = loadOptions(content.options || []);
    function loadOptions(options) {
      const _options = [];
      options.forEach(
        (option) => _options.push({
          name: new Map(Object.entries(option.name || {})),
          ref: option.ref || "",
          parameters: option.parameters || "",
          options: loadOptions(option?.options || [])
        })
      );
      return _options;
    }
  }
  toLocalizedJSON(session) {
    return {
      ...super.toLocalizedJSON(session),
      options: this.options.map((option) => ({
        ...option,
        name: Object.fromEntries(option.name)
      }))
    };
  }
  async render(request, session) {
    let body = "";
    const layout = this.getLayout(session);
    const firstRender = await layout.render([], session.placeholders, session);
    const settings = firstRender.settings;
    this.options.forEach((option) => subrender(option));
    if (settings.has("vertical"))
      return `<nav><menu><li style="width:2rem"><div><i class="fa-light fa-bars"></i></div><menu>${body}</menu></li></menu></nav>`;
    return `<nav><menu>${body}</menu></nav>`;
    function subrender(option, iteration = false) {
      let element = session.portal.find(session, option.ref || "");
      let href = option.ref;
      const parameters = option.parameters || "";
      if (element && "mainpage" in element && element.mainpage) {
        const mainPage = session.portal.find(session, element.mainpage);
        if (mainPage && mainPage.isVisible(session)) {
          element = mainPage;
          href = mainPage.pathname(session);
        } else {
          href = "";
        }
      } else if (element) {
        href = element.pathname(session);
      }
      if (href && parameters) {
        href += `${href.includes("?") ? "&" : "?"}${parameters.replace(/^[?&]/, "")}`;
      }
      const name = option?.name.get(session.lang) || element?.localize(session, "name") || href;
      if (name === "-") {
        body += iteration ? "<hr>" : "";
      } else if (!element || element.isVisible(session)) {
        if (element instanceof STWContent) {
          const search = new URL(request.url).search;
          const contentSearch = parameters ? `${search}${search ? "&" : "?"}${parameters.replace(/^[?&]/, "")}` : search;
          body += `<li><article id="${newId()}" href="${element.uuid}${contentSearch}"></article>`;
        } else if (option.options?.length) {
          body += `<li><div>${!option.options?.length && href ? `<a href="${href}">${name}</a>` : name}<i class="fa-light fa-angle-right"></i></div>`;
          body += "<menu>", option.options.forEach((option2) => subrender(option2, true)), body += "</menu>";
        } else {
          body += `<li><div>${!option.options?.length && href ? `<a href="${href}">${name}</a>` : name}</div>`;
        }
        body += "</li>";
      }
    }
  }
}
registerElement("Menus", STWMenus);
export {
  STWMenus
};
