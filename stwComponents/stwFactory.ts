// SPDX-License-Identifier: GPL-3.0-or-later
// Central registry for Spin the Web element/content constructors.
// This file intentionally has NO runtime dependencies on element implementations
// to avoid circular import chains. Elements call registerElement() at module
// evaluation time to self-register. The loader (stwSpinner.ts) just imports
// element modules (or uses dynamic import) and the registry is populated.

export interface ElementConstructor<T = any> {
  new (definition: any): T;
}

// The factory map (string -> constructor)
export const STWFactory: Record<string, ElementConstructor> = {};

/**
 * Register a constructor under a given logical key (usually element.type)
 * If a key already exists, it will be overwritten (warn in dev scenarios if needed)
 */
export function registerElement(name: string, ctor: ElementConstructor) {
  STWFactory[name] = ctor;
}

/**
 * Helper to assert a constructor exists.
 */
export function requireElement<T = any>(name: string): ElementConstructor<T> {
  const ctor = STWFactory[name];
  if (!ctor) throw new Error(`STWFactory: element '${name}' not registered`);
  return ctor as ElementConstructor<T>;
}
