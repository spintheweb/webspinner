/**
 * @fileoverview Provides the shared Spin the Web element registry.
 *
 * The registry maps element UUIDs to element instances and decouples the
 * circular dependency between `STWElement` and `STWPortal`.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwIndex
 * @license GPL-3.0-or-later
 */

export const STWIndex: Map<string, unknown> = new Map();
