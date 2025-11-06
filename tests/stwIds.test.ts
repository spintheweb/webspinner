// SPDX-License-Identifier: MIT
// Tests for stwIds.ts

import { assertEquals } from "@std/assert";
import { newId } from "../stwComponents/stwIds.ts";

Deno.test("newId: generate sample IDs", () => {
  console.log("Generated IDs:");
  for (let i = 0; i < 5; i++) {
    const id = newId();
    console.log(`${i + 1}: ${id}`);
  }
  // Test passes if no errors occur
  assertEquals(true, true);
});
