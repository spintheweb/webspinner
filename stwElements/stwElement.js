/**
 * @fileoverview Defines the base types and abstract element implementation
 * shared by Spin the Web portal elements.
 *
 * Builds element hierarchies through the factory, maintains localized metadata
 * and paths, evaluates role-based visibility, serializes elements, applies
 * updates, and provides the default response behavior for subclasses.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwElement
 * @requires ../stwComponents/stwSession.js
 * @requires ../stwComponents/stwFactory.js
 * @requires ./stwContent.js
 * @requires ./stwIndex.js
 * @requires ../stwComponents/stwResponse.js
 * @requires ../stwComponents/stwIds.js
 * @license GPL-3.0-or-later
 */
import { STWFactory } from "../stwComponents/stwFactory.js";
import { STWIndex } from "./stwIndex.js";
import { secureResponse } from "../stwComponents/stwResponse.js";
import { newId } from "../stwComponents/stwIds.js";
class STWElement {
  uuid;
  type;
  name;
  slug;
  keywords;
  description;
  visibility;
  parent;
  children = [];
  modified;
  extra;
  constructor(element) {
    this.uuid = element.uuid ? element.uuid : newId();
    this.type = element.type || this.constructor.name.replace("STW", "");
    this.name = new Map(Object.entries(element.name || { "en": `New ${this.type}` }));
    this.slug = new Map(Object.entries(element.slug || { "en": `New ${this.type}`.replace(/[^a-z0-9_]/gi, "").toLowerCase() }));
    this.keywords = new Map(Object.entries(element.keywords || {}));
    this.description = new Map(Object.entries(element.description || {}));
    this.visibility = new Map(Object.entries(element.visibility || {}));
    this.modified = element.modified || Date.now();
    this.extra = element.extra;
    for (const child of element.children || []) {
      const constructor = STWFactory[child.subtype || child.type];
      if (constructor) {
        const elementInstance = new constructor(child);
        elementInstance.parent = this;
        this.children.push(elementInstance);
        STWIndex.set(elementInstance.uuid, elementInstance);
      }
    }
  }
  getData(session, key) {
    if (["name", "slug", "keywords", "description"].includes(key))
      return this.localize(session, key);
    return "";
  }
  getExtra() {
    return this.extra;
  }
  setExtra(extra) {
    this.extra = extra;
    this.modified = Date.now();
  }
  /**
   * @param session The session
   * @returns Return a / separated reverse chain of slugs of this element up to the root element
   */
  pathname(session) {
    if (this.parent)
      return this.parent.pathname(session) + "/" + this.localize(session, "slug");
    return "";
  }
  localize(session, name, value = "") {
    if (value) {
      value = name === "slug" ? value.replace(/[^a-z0-9_]/gi, "").toLowerCase() : value;
      this[name].set(session.lang, value);
      return value;
    }
    return this[name].get(session.lang) || this[name].keys().next().value || "undefined";
  }
  toLocalizedJSON(session) {
    return {
      uuid: this.uuid,
      type: this.type,
      subtype: this.subtype || this.type,
      name: this.localize(session, "name"),
      slug: this.localize(session, "slug"),
      keywords: this.localize(session, "keywords"),
      description: this.localize(session, "description"),
      visibility: Object.fromEntries(this.visibility),
      modified: this.modified,
      children: this.children.map((child) => child.uuid)
    };
  }
  /**
   * Determines the Role Based Visibility of the element climbing up the webbase hierarchy if necessary.
   * By default an element is not visible except for the portal's mainpage. Given the session roles,
   * apply a logical OR of these roles in element visiblity, if no role applies move to
   * the element parent.
   *
   * @param session The session
   * @returns Return a number greater than 0 if element visible
   */
  isVisible(session, recurse = false) {
    let ac;
    if (session.portal.mainpage === this.uuid) {
      ac = recurse ? 3 : 1;
    }
    for (let i = 0; ac != 1 && i < session.roles.length; ++i) {
      if (this.visibility.has(session.roles[i])) {
        ac |= this.visibility.get(session.roles[i]) ? 1 : 0;
      }
    }
    if (typeof ac === "undefined") {
      if (this.parent) {
        ac = 2 | this.parent.isVisible(session, true);
      } else if (["Portal", "Area", "Page"].indexOf(this.type) === -1) {
        ac = 2;
      }
    }
    return ac || 0;
  }
  // Export element as XML
  export() {
    let xml = `<${this.type} id="${this.uuid}" type="${this.type}" subtype="${this.type}" modified="${this.modified}">
`;
    for (const [key, value] of Object.entries(this)) {
      if (key === "parent" || key === "children") {
        continue;
      }
      if (key === "visibility") {
        xml += `	<${key}>
`;
        for (const [role, visible] of Object.entries(value)) {
          xml += `		<${role} ${visible ? 'visible="true"' : 'visible="false"'} />
`;
        }
        xml += `	</${key}>
`;
      } else if (typeof value === "object") {
        xml += `	<${key}>${JSON.stringify(value)}</${key}>
`;
      } else {
        xml += `	<${key}>${value}</${key}>
`;
      }
    }
    return xml + `</${this.type}>
`;
  }
  update(session, data) {
    this.updateLocalizedField(session, "name", data.name);
    this.updateLocalizedField(session, "slug", data.slug);
    this.updateLocalizedField(session, "keywords", data.keywords);
    this.updateLocalizedField(session, "description", data.description);
    this.modified = Date.now();
    if (data.visibility) {
      this.visibility.clear();
      for (const [role, visible] of Object.entries(data?.visibility)) {
        if (typeof visible === "undefined" || visible === null) {
          this.visibility.delete(role);
        } else {
          this.visibility.set(role, Boolean(visible));
        }
      }
    }
  }
  updateLocalizedField(session, field, value) {
    if (typeof value === "string") {
      if (field === "name" || field === "slug") this.localize(session, field, value);
      else this[field].set(session.lang, value);
      return;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) return;
    const entries = Object.entries(value);
    if (!entries.every((entry) => typeof entry[1] === "string")) {
      throw new TypeError(`${field} must be a string or a map of language codes to strings`);
    }
    this[field].clear();
    for (const [lang, localizedValue] of entries) {
      this[field].set(
        lang,
        field === "slug" ? localizedValue.replace(/[^a-z0-9_]/gi, "").toLowerCase() : localizedValue
      );
    }
  }
  serve(_req, _session, _ref) {
    return Promise.resolve(secureResponse("Not implemented", { status: 501 }));
  }
}
function serializeSTWElement(element) {
  const result = {};
  for (const [key, value] of Object.entries(element)) {
    if (key === "parent") continue;
    if (key === "children") {
      result.children = element.children.map(serializeSTWElement);
    } else if (key === "type" && "contentType" in element) {
      result.type = "Content";
      result.subtype = value;
    } else {
      result[key] = serializeElementValue(value);
    }
  }
  return result;
}
function serializeElementValue(value) {
  if (value instanceof Map) {
    return Object.fromEntries([...value].map(([key, entry]) => [key, serializeElementValue(entry)]));
  }
  if (Array.isArray(value)) return value.map(serializeElementValue);
  if (typeof value === "object" && value !== null) {
    if ("wbll" in value && typeof value.wbll === "string") return value.wbll;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serializeElementValue(entry)]));
  }
  return value;
}
export {
  STWElement,
  serializeSTWElement
};
