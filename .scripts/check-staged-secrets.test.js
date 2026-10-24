import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const script = path.join(root, ".scripts/check-staged-secrets.sh");
const scannerAvailable = spawnSync("gitleaks", ["version"]).status === 0;

const run = (cwd, command, args, env = process.env) =>
  spawnSync(command, args, { cwd, env, encoding: "utf8" });

const repository = (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "staged-secrets-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.equal(run(directory, "git", ["init", "--quiet"]).status, 0);
  return directory;
};

const scan = (directory, env) => run(directory, "/bin/sh", [script], env);

test("blocks when Gitleaks is unavailable", (context) => {
  const directory = repository(context);
  const binaries = path.join(directory, "bin");
  mkdirSync(binaries);
  const git = spawnSync("/bin/sh", ["-c", "command -v git"], {
    encoding: "utf8",
  }).stdout.trim();
  symlinkSync(git, path.join(binaries, "git"));
  const result = scan(directory, { ...process.env, PATH: binaries });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Gitleaks is required/);
});

test("propagates scanner failures and always requests redaction", (context) => {
  const directory = repository(context);
  const binaries = path.join(directory, "bin");
  mkdirSync(binaries);
  writeFileSync(
    path.join(binaries, "gitleaks"),
    '#!/bin/sh\nprintf "%s\\n" "$@"\nexit 2\n',
    {
      mode: 0o755,
    },
  );
  const result = scan(directory, {
    ...process.env,
    PATH: `${binaries}:${process.env.PATH}`,
  });
  assert.equal(result.status, 2);
  for (const argument of [
    "--pre-commit",
    "--staged",
    "--redact=100",
    "--ignore-gitleaks-allow",
  ]) {
    assert.ok(result.stdout.split("\n").includes(argument));
  }
});

test("allows clean staged changes", { skip: !scannerAvailable }, (context) => {
  const directory = repository(context);
  writeFileSync(
    path.join(directory, "clean.txt"),
    "Ordinary public documentation.\n",
  );
  assert.equal(run(directory, "git", ["add", "clean.txt"]).status, 0);
  const result = scan(directory);
  assert.equal(result.status, 0, result.stderr);
});

test(
  "blocks a private export even when its contents are not a recognizable secret",
  { skip: !scannerAvailable },
  (context) => {
    const directory = repository(context);
    writeFileSync(
      path.join(directory, "session-private.md"),
      "Private discussion, no credential pattern.\n",
    );
    assert.equal(
      run(directory, "git", ["add", "session-private.md"]).status,
      0,
    );
    const result = scan(directory);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /session-private\.md/);
    assert.ok(
      !`${result.stdout}${result.stderr}`.includes("Private discussion"),
    );
  },
);

test(
  "blocks a staged private key even when the worktree is clean, without printing it",
  { skip: !scannerAvailable },
  (context) => {
    const directory = repository(context);
    const { privateKey } = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const file = path.join(directory, "fixture.txt");
    writeFileSync(file, privateKey);
    assert.equal(run(directory, "git", ["add", "fixture.txt"]).status, 0);
    writeFileSync(file, "The staged key is not in the worktree.\n");
    const result = scan(directory);
    assert.equal(result.status, 1);
    assert.match(`${result.stdout}${result.stderr}`, /leaks found/);
    assert.ok(
      !`${result.stdout}${result.stderr}`.includes(privateKey.split("\n")[1]),
    );
  },
);

test(
  "does not scan an unstaged private key",
  { skip: !scannerAvailable },
  (context) => {
    const directory = repository(context);
    writeFileSync(
      path.join(directory, "clean.txt"),
      "Ordinary public documentation.\n",
    );
    assert.equal(run(directory, "git", ["add", "clean.txt"]).status, 0);
    const { privateKey } = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    writeFileSync(path.join(directory, "local-only.txt"), privateKey);
    const result = scan(directory);
    assert.equal(result.status, 0, result.stderr);
  },
);

test(
  "does not accept a repository config that suppresses secret detectors",
  { skip: !scannerAvailable },
  (context) => {
    const directory = repository(context);
    writeFileSync(
      path.join(directory, ".gitleaks.toml"),
      '[allowlist]\nregexes = [".*"]\n',
    );
    const { privateKey } = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    writeFileSync(path.join(directory, "fixture.txt"), privateKey);
    assert.equal(run(directory, "git", ["add", "fixture.txt"]).status, 0);
    const result = scan(directory);
    assert.equal(result.status, 1);
    assert.ok(
      !`${result.stdout}${result.stderr}`.includes(privateKey.split("\n")[1]),
    );
  },
);

test("ignores private local files but keeps environment templates addable", (context) => {
  const directory = repository(context);
  copyFileSync(
    path.join(root, ".gitignore"),
    path.join(directory, ".gitignore"),
  );
  for (const file of [
    ".env.local",
    "packages/core/.env.production",
    ".playwright-mcp/capture.yml",
    "artifacts/private.png",
    "scripts/.tmp-probe.cjs",
    "session-private.md",
    ".cyberstrike/report.md",
  ]) {
    assert.equal(
      run(directory, "git", ["check-ignore", "--no-index", file]).status,
      0,
      file,
    );
  }
  for (const file of [
    ".env.example",
    ".env.sample",
    ".env.template",
    "packages/core/.env.example",
  ]) {
    assert.equal(
      run(directory, "git", ["check-ignore", "--no-index", file]).status,
      1,
      file,
    );
  }
});
