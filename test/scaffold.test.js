import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("package.json declares the expected scripts and deps", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
  assert.equal(pkg.type, "module");
  assert.equal(pkg.scripts.start, "node server.js");
  for (const dep of ["express", "better-sqlite3", "dotenv"]) {
    assert.ok(pkg.dependencies[dep], `missing dep ${dep}`);
  }
});
