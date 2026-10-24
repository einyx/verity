import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(
  new URL("./check-private-files.js", import.meta.url),
);
const incomingScript = fileURLToPath(
  new URL("./check-incoming-secrets.sh", import.meta.url),
);
const run = (cwd, args) => spawnSync("git", args, { cwd, encoding: "utf8" });
const check = (cwd, args = ["--staged"]) =>
  spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });

const repository = (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "private-files-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.equal(run(directory, ["init", "--quiet"]).status, 0);
  assert.equal(
    run(directory, ["config", "user.email", "test@example.com"]).status,
    0,
  );
  assert.equal(
    run(directory, ["config", "user.name", "Security test"]).status,
    0,
  );
  return directory;
};

const stage = (directory, name) => {
  const target = path.join(directory, name);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, "Local private content must never be printed.\n");
  assert.equal(run(directory, ["add", "--force", "--", name]).status, 0, name);
};

test("blocks private artifacts even when forcibly staged or already tracked", (context) => {
  const directory = repository(context);
  const names = [
    "session-ses_private.md",
    "session_private.jsonl",
    "docs/session-private.txt",
    "session-private\nexport.md",
    ".env",
    "packages/core/.env.production",
    "development.env",
    ".playwright-mcp/capture.yml",
    "artifacts/demo.png",
    ".cyberstrike/report.md",
    ".superpowers/brainstorm/page.html",
    "scripts/.tmp-probe.cjs",
    "packages/console/verify-lan-https.mjs",
    "browser-profile/Default/Cookies",
    "tests/.auth/state.json",
    "playwright/.auth/user.json",
    "storage-state.json",
    "auth-state.json",
    "id_rsa",
    "keys/private.pem",
    "backup.p12",
    "dump.sql",
    "db-backup.sql.gz",
  ];
  for (const name of names) stage(directory, name);
  assert.equal(
    run(directory, ["commit", "--quiet", "-m", "Private fixture"]).status,
    0,
  );
  stage(directory, "ordinary.txt");
  const result = check(directory);
  assert.equal(result.status, 1, result.stderr);
  for (const name of names)
    assert.ok(result.stderr.includes(JSON.stringify(name)), name);
  assert.ok(!result.stderr.includes("Local private content"));
});

test("allows templates, public keys, source files, and documentation", (context) => {
  const directory = repository(context);
  for (const name of [
    ".env.example",
    ".env.sample",
    ".env.template",
    "packages/core/.env.example",
    "id_rsa.pub",
    "docs/security-review.md",
    "src/credentials.ts",
    "schema.sql",
    "src/assets/artifacts/icon.svg",
    "sessions.ts",
  ])
    stage(directory, name);
  const result = check(directory);
  assert.equal(result.status, 0, result.stderr);
});

test("blocks agent instructions, tool configuration, and generated plans even when tracked", (context) => {
  const directory = repository(context);
  copyFileSync(
    fileURLToPath(new URL("../.gitignore", import.meta.url)),
    path.join(directory, ".gitignore"),
  );
  const names = [
    "AGENTS.md",
    "packages/core/AGENTS.override.md",
    "CLAUDE.md",
    "CLAUDE.local.md",
    "CODEX.md",
    "GEMINI.md",
    ".claude/commands/release.md",
    ".codex/config.toml",
    "packages/app/.agents/skills/private/SKILL.md",
    ".agent/workflows/private.md",
    ".opencode/agents/private.md",
    "opencode.json",
    "opencode.jsonc",
    ".mcp.json",
    ".cursor/rules/private.mdc",
    ".cursorrules",
    ".continue/config.yaml",
    ".gemini/settings.json",
    ".windsurf/rules/private.md",
    ".windsurfrules",
    ".roo/rules/private.md",
    ".kilocode/rules/private.md",
    ".clinerules/private.md",
    ".kiro/specs/private/requirements.md",
    ".specify/memory/constitution.md",
    ".aider.conf.yml",
    ".aider.chat.history.md",
    ".openhands/settings.json",
    ".openclaw/config.json",
    ".copilot/private.md",
    ".junie/guidelines.md",
    ".trae/rules/private.md",
    ".goose/config.yaml",
    ".pi/settings.json",
    ".dsh/config.json",
    ".kimi-code/config.toml",
    ".ecc/memory.md",
    ".github/copilot-instructions.md",
    ".github/instructions/private.instructions.md",
    ".github/prompts/private.prompt.md",
    ".github/agents/private.agent.md",
    "docs/superpowers/specs/private.md",
    "docs/plans/private.md",
    "docs/specs/private.md",
    "docs/agent-plans/private.md",
    "docs/agent-specs/private.md",
    "PROJECT-CONTEXT.md",
    "docs/ask-ai-management-plan.md",
    "docs/landing-cms-editor/test-plan.md",
    "plans/private.md",
    "specs/private.md",
  ];
  for (const name of names) {
    assert.equal(
      run(directory, ["check-ignore", "--no-index", name]).status,
      0,
      name,
    );
    stage(directory, name);
  }
  assert.equal(
    run(directory, ["commit", "--quiet", "-m", "Tracked agent fixtures"])
      .status,
    0,
  );
  const result = check(directory);
  assert.equal(result.status, 1, result.stderr);
  for (const name of names)
    assert.ok(result.stderr.includes(JSON.stringify(name)), name);
  assert.ok(!result.stderr.includes("Local private content"));
});

test("blocks project context and feature planning documents even when tracked", (context) => {
  const directory = repository(context);
  const names = [
    "PROJECT-CONTEXT.md",
    "docs/ask-ai-management-plan.md",
    "docs/landing-cms-editor/openapi-draft.md",
    "docs/landing-cms-editor/preview-risk-assessment.md",
    "docs/landing-cms-editor/prod-readiness-lanes.md",
    "docs/landing-cms-editor/stakeholder-mapping.md",
    "docs/landing-cms-editor/test-plan.md",
    "docs/landing-cms-editor/tinacms-integration-plan.md",
    "docs/landing-cms-editor/video-script-draft.md",
  ];
  for (const name of names) stage(directory, name);

  const result = check(directory);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /PROJECT-CONTEXT\.md/);
  assert.match(result.stderr, /docs\/landing-cms-editor\/test-plan\.md/);
});

test("does not block unstaged local artifacts or staged removals", (context) => {
  const directory = repository(context);
  stage(directory, ".env.local");
  assert.equal(
    run(directory, ["commit", "--quiet", "-m", "Private fixture"]).status,
    0,
  );
  assert.equal(run(directory, ["rm", "--cached", ".env.local"]).status, 0);
  const result = check(directory);
  assert.equal(result.status, 0, result.stderr);
});

test("checks the entire repository when called from a package directory", (context) => {
  const directory = repository(context);
  stage(directory, ".env.local");
  const subdirectory = path.join(directory, "packages", "app");
  mkdirSync(subdirectory, { recursive: true });
  assert.equal(check(subdirectory).status, 1);
});

test("incoming secret scanner catches a key added then removed and redacts it", (context) => {
  if (spawnSync("gitleaks", ["version"]).status !== 0) {
    context.skip("Gitleaks unavailable");
    return;
  }
  const directory = repository(context);
  stage(directory, "readme.md");
  assert.equal(run(directory, ["commit", "--quiet", "-m", "Base"]).status, 0);
  const base = run(directory, ["rev-parse", "HEAD"]).stdout.trim();
  const clean = spawnSync("/bin/sh", [incomingScript, base, base], {
    cwd: directory,
    encoding: "utf8",
  });
  assert.equal(clean.status, 0, clean.stderr);
  // Generate a disposable fixture instead of committing reusable credentials in this repo.
  const key = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  }).privateKey;
  writeFileSync(
    path.join(directory, "fixture.txt"),
    `${key}\n# gitleaks:allow\n`,
  );
  assert.equal(run(directory, ["add", "fixture.txt"]).status, 0);
  assert.equal(
    run(directory, ["commit", "--quiet", "-m", "Key fixture"]).status,
    0,
  );
  assert.equal(run(directory, ["rm", "fixture.txt"]).status, 0);
  assert.equal(
    run(directory, ["commit", "--quiet", "-m", "Remove fixture"]).status,
    0,
  );
  const head = run(directory, ["rev-parse", "HEAD"]).stdout.trim();
  const result = spawnSync("/bin/sh", [incomingScript, base, head], {
    cwd: directory,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(`${result.stdout}${result.stderr}`, /leaks found/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(key.split("\n")[1]));
});

test("missing pre-rewrite base scans all reachable commits without weakening detection", (context) => {
  if (spawnSync("gitleaks", ["version"]).status !== 0) {
    context.skip("Gitleaks unavailable");
    return;
  }
  const directory = repository(context);
  stage(directory, "readme.md");
  assert.equal(
    run(directory, ["commit", "--quiet", "-m", "Clean root"]).status,
    0,
  );
  const missingBase = "f".repeat(40);
  const cleanHead = run(directory, ["rev-parse", "HEAD"]).stdout.trim();
  const clean = spawnSync("/bin/sh", [incomingScript, missingBase, cleanHead], {
    cwd: directory,
    encoding: "utf8",
  });
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stderr, /full reachable history/i);

  const key = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  }).privateKey;
  writeFileSync(path.join(directory, "fixture.txt"), key);
  assert.equal(run(directory, ["add", "fixture.txt"]).status, 0);
  assert.equal(
    run(directory, ["commit", "--quiet", "-m", "Add disposable key"]).status,
    0,
  );
  assert.equal(run(directory, ["rm", "fixture.txt"]).status, 0);
  assert.equal(
    run(directory, ["commit", "--quiet", "-m", "Remove disposable key"]).status,
    0,
  );
  const head = run(directory, ["rev-parse", "HEAD"]).stdout.trim();
  const result = spawnSync("/bin/sh", [incomingScript, missingBase, head], {
    cwd: directory,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(`${result.stdout}${result.stderr}`, /leaks found/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(key.split("\n")[1]));
});

test("missing scan base still blocks private artifacts removed in a later commit", (context) => {
  const directory = repository(context);
  stage(directory, "readme.md");
  assert.equal(
    run(directory, ["commit", "--quiet", "-m", "Clean root"]).status,
    0,
  );
  stage(directory, ".claude/commands/private.md");
  assert.equal(
    run(directory, ["commit", "--quiet", "-m", "Private export"]).status,
    0,
  );
  assert.equal(run(directory, ["rm", ".claude/commands/private.md"]).status, 0);
  assert.equal(
    run(directory, ["commit", "--quiet", "-m", "Remove export"]).status,
    0,
  );
  const head = run(directory, ["rev-parse", "HEAD"]).stdout.trim();
  const result = spawnSync("/bin/sh", [incomingScript, "e".repeat(40), head], {
    cwd: directory,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /full reachable history/i);
  assert.match(result.stderr, /\.claude\/commands\/private\.md/);
  assert.ok(!result.stderr.includes("Local private content"));
});

test("checks intermediate incoming commits, not just the final tree", (context) => {
  const directory = repository(context);
  stage(directory, "readme.md");
  assert.equal(run(directory, ["commit", "--quiet", "-m", "Base"]).status, 0);
  const base = run(directory, ["rev-parse", "HEAD"]).stdout.trim();
  stage(directory, "session-private.md");
  assert.equal(
    run(directory, ["commit", "--quiet", "-m", "Add export"]).status,
    0,
  );
  assert.equal(run(directory, ["rm", "session-private.md"]).status, 0);
  assert.equal(
    run(directory, ["commit", "--quiet", "-m", "Remove export"]).status,
    0,
  );
  const head = run(directory, ["rev-parse", "HEAD"]).stdout.trim();
  const result = check(directory, ["--range", base, head]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /session-private\.md/);
});

test("scans secrets introduced only in merge commits and redacts them", (context) => {
  if (spawnSync("gitleaks", ["version"]).status !== 0) {
    context.skip("Gitleaks unavailable");
    return;
  }
  const directory = repository(context);
  stage(directory, "readme.md");
  assert.equal(run(directory, ["commit", "--quiet", "-m", "Base"]).status, 0);
  const base = run(directory, ["rev-parse", "HEAD"]).stdout.trim();
  const main = run(directory, ["branch", "--show-current"]).stdout.trim();
  assert.equal(
    run(directory, ["checkout", "--quiet", "-b", "feature"]).status,
    0,
  );
  stage(directory, "feature.txt");
  assert.equal(
    run(directory, ["commit", "--quiet", "-m", "Feature"]).status,
    0,
  );
  assert.equal(run(directory, ["checkout", "--quiet", main]).status, 0);
  stage(directory, "main.txt");
  assert.equal(run(directory, ["commit", "--quiet", "-m", "Main"]).status, 0);
  assert.equal(
    run(directory, ["merge", "--no-ff", "--no-commit", "feature"]).status,
    0,
  );
  const key = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  }).privateKey;
  writeFileSync(path.join(directory, "fixture.txt"), key);
  assert.equal(run(directory, ["add", "fixture.txt"]).status, 0);
  assert.equal(
    run(directory, ["commit", "--quiet", "-m", "Merge feature"]).status,
    0,
  );
  const head = run(directory, ["rev-parse", "HEAD"]).stdout.trim();
  const result = spawnSync("/bin/sh", [incomingScript, base, head], {
    cwd: directory,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(`${result.stdout}${result.stderr}`, /leaks found/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(key.split("\n")[1]));
});

test("accepts a clean incoming commit range and rejects invalid arguments", (context) => {
  const directory = repository(context);
  stage(directory, "readme.md");
  assert.equal(run(directory, ["commit", "--quiet", "-m", "Base"]).status, 0);
  const base = run(directory, ["rev-parse", "HEAD"]).stdout.trim();
  stage(directory, "src/code.ts");
  assert.equal(run(directory, ["commit", "--quiet", "-m", "Source"]).status, 0);
  const head = run(directory, ["rev-parse", "HEAD"]).stdout.trim();
  assert.equal(check(directory, ["--range", base, head]).status, 0);
  assert.notEqual(check(directory, ["--range", "--all", head]).status, 0);
  assert.notEqual(
    check(directory, ["--range", "a".repeat(40), head]).status,
    0,
  );
});
