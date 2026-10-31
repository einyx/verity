import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./package.sh", import.meta.url));

test("packages renamed checkouts with the expected logto root and intact relative links", (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "verity-package-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const checkout = path.join(directory, "renamed checkout");
  const bin = path.join(directory, "bin");
  const archive = path.join(directory, "logto.tar.gz");
  mkdirSync(path.join(checkout, "packages/core/lib"), { recursive: true });
  mkdirSync(bin);
  writeFileSync(
    path.join(checkout, "packages/core/lib/main.js"),
    "export const ready = true;",
  );
  symlinkSync("main.js", path.join(checkout, "packages/core/lib/entry.js"));
  linkSync(
    path.join(checkout, "packages/core/lib/main.js"),
    path.join(checkout, "packages/core/lib/hard-link.js"),
  );
  writeFileSync(path.join(bin, "pnpm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  // Keep the legacy fixed output path inside this disposable fixture, even before the fix.
  writeFileSync(
    path.join(bin, "tar"),
    `#!${process.execPath}\nimport { spawnSync } from 'node:child_process';
const args = process.argv.slice(2).map((value) => value === '/tmp/logto.tar.gz' ? process.env.TEST_ARCHIVE : value);
const result = spawnSync('/usr/bin/tar', args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`,
    { mode: 0o755 },
  );
  const result = spawnSync("bash", [script], {
    cwd: checkout,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      IS_CLOUD: "0",
      SKIP_TAR: "",
      TEST_ARCHIVE: archive,
    },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const entries = execFileSync("/usr/bin/tar", ["-tzf", archive], {
    encoding: "utf8",
  })
    .trim()
    .split("\n");
  assert.ok(entries.includes("logto/packages/core/lib/main.js"));
  assert.ok(entries.includes("logto/packages/core/lib/entry.js"));
  assert.ok(
    entries.every((entry) => entry === "logto" || entry.startsWith("logto/")),
  );
  const unpacked = path.join(directory, "unpacked");
  mkdirSync(unpacked);
  execFileSync("/usr/bin/tar", ["-xzf", archive, "-C", unpacked]);
  assert.equal(
    readlinkSync(path.join(unpacked, "logto/packages/core/lib/entry.js")),
    "main.js",
  );
  assert.equal(
    statSync(path.join(unpacked, "logto/packages/core/lib/hard-link.js")).ino,
    statSync(path.join(unpacked, "logto/packages/core/lib/main.js")).ino,
  );
  assert.equal(
    readFileSync(
      path.join(unpacked, "logto/packages/core/lib/entry.js"),
      "utf8",
    ),
    "export const ready = true;",
  );
});
