// SPDX-License-Identifier: GPL-3.0-or-later
// Tests for stwIds.ts

import { assertEquals } from "@std/assert";
import { newId } from "../stwComponents/stwIds.ts";

Deno.test("newId: generate sample IDs", () => {
  const ids: string[] = [];

  for (let i = 0; i < 5; i++) {
    const id = newId();
    ids.push(id);
  }

  console.debug("Generated IDs:", ids);

  // Test passes if no errors occur
  assertEquals(ids.length, 5);
  assertEquals(ids.every((id) => id.startsWith("x")), true);
});
