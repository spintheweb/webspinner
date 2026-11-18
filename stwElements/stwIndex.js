/**
 * @fileoverview Provides the shared Spin the Web element registry.
 *
 * The registry maps element UUIDs to element instances and decouples the
 * circular dependency between `STWElement` and `STWPortal`.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwIndex
 * @note Copilot-assisted
 * @license Apache-2.0
 */
const STWIndex = new Map();
export {
	STWIndex
};
