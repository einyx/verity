import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const install = (context) =>
  runInNewContext(
    readFileSync(new URL("./jest-web-apis.cjs", import.meta.url), "utf8"),
    { require: createRequire(import.meta.url), ...context },
  );

test("installs working text codecs before jsdom setup imports application dependencies", () => {
  const context = {};
  // Preserve the same object as globalThis so installed values can be verified outside the VM.
  install({ globalThis: context });
  const encoded = new context.TextEncoder().encode("Hello العربية 日本語");
  assert.equal(
    new context.TextDecoder().decode(encoded),
    "Hello العربية 日本語",
  );
});

test("preserves existing browser text codecs rather than replacing them", () => {
  const encoder = function BrowserEncoder() {};
  const decoder = function BrowserDecoder() {};
  const context = { TextEncoder: encoder, TextDecoder: decoder };
  install({ globalThis: context });
  assert.equal(context.TextEncoder, encoder);
  assert.equal(context.TextDecoder, decoder);
});
