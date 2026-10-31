import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("./select-alteration-baseline.js", import.meta.url),
);
const fixture = (context, version = "1.2.3") => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "alteration-baseline-"));
  context.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  git("init", "--quiet");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  mkdirSync(path.join(cwd, "packages/core"), { recursive: true });
  writeFileSync(
    path.join(cwd, "packages/core/package.json"),
    JSON.stringify({ version }),
  );
  git("add", ".");
  git("commit", "--quiet", "-m", "Release");
  return {
    cwd,
    git,
    pin: (tag, commit) => {
      mkdirSync(path.join(cwd, ".scripts"), { recursive: true });
      writeFileSync(
        path.join(cwd, ".scripts/alteration-baseline.json"),
        JSON.stringify({ tag, commit }),
      );
    },
    run: () =>
      spawnSync(process.execPath, [script], {
        cwd,
        encoding: "utf8",
        env: { ...process.env, GITHUB_OUTPUT: "" },
      }),
  };
};

for (const tag of ["v9.0.0", "@logto/core@9.0.0"]) {
  test(`selects ${tag} and reads the package version rather than tag spelling`, (context) => {
    const { git, run } = fixture(context);
    git("tag", tag);
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `tag=${tag}\nversion=1.2.3\n`);
  });
}

test("fails closed when no release tag exists", (context) => {
  const result = fixture(context).run();
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
});

test("rejects invalid package versions without emitting workflow outputs", (context) => {
  const { git, run } = fixture(context, "1.2.3\nmalicious=output");
  git("tag", "v1.2.3");
  const result = run();
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
});

test("selects the nearest reachable release, not an unrelated newer tag", (context) => {
  const { cwd, git, run } = fixture(context);
  git("tag", "v1.0.0");
  writeFileSync(path.join(cwd, "readme"), "next release");
  git("add", ".");
  git("commit", "--quiet", "-m", "Next release");
  git("tag", "@logto/core@2.0.0");
  const release = git("rev-parse", "HEAD");
  assert.match(run().stdout, /^tag=@logto\/core@2.0.0\n/);
  git("checkout", "--quiet", "--orphan", "unrelated");
  git("commit", "--quiet", "-m", "Unrelated");
  git("tag", "v99.0.0");
  git("checkout", "--quiet", release);
  assert.match(run().stdout, /^tag=@logto\/core@2.0.0\n/);
});

test("uses an explicitly pinned release after history sanitization", (context) => {
  const { git, pin, run } = fixture(context);
  git("tag", "v1.2.3");
  const commit = git("rev-parse", "HEAD");
  git("checkout", "--quiet", "--orphan", "sanitized");
  git("commit", "--quiet", "-m", "Sanitized snapshot");
  pin("v1.2.3", commit);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `tag=v1.2.3\nversion=1.2.3\nref=${commit}\n`);
});

test("rejects a pinned release whose tag no longer matches its commit", (context) => {
  const { git, pin, run } = fixture(context);
  git("tag", "v1.2.3");
  git("checkout", "--quiet", "--orphan", "sanitized");
  git("commit", "--quiet", "-m", "Sanitized snapshot");
  pin("v1.2.3", git("rev-parse", "HEAD"));
  const result = run();
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
});

test("does not let a pin override a reachable release", (context) => {
  const { git, pin, run } = fixture(context);
  git("tag", "v1.2.3");
  pin("v99.0.0", "0".repeat(40));
  assert.equal(run().stdout, "tag=v1.2.3\nversion=1.2.3\n");
});
