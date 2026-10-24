import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const packageJson = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../packages/${name}/package.json`, import.meta.url),
      "utf8",
    ),
  );

test("tenant-seed builds its published entry points during recursive CI lifecycles", () => {
  const tenantSeed = packageJson("tenant-seed");
  assert.equal(tenantSeed.main, "./lib/index.js");
  assert.equal(tenantSeed.types, "./lib/index.d.ts");
  for (const lifecycle of ["prepack", "build:test"]) {
    assert.equal(tenantSeed.scripts[lifecycle], "pnpm build", lifecycle);
  }
  assert.equal(tenantSeed.scripts["test:ci"], "pnpm test --silent");
  assert.equal(tenantSeed.eslintConfig?.extends, "@silverhand");
  assert.ok(tenantSeed.devDependencies.eslint);
  assert.ok(tenantSeed.devDependencies["@silverhand/eslint-config"]);
});

test("both console Vite builds use an explicit portable Node heap limit", () => {
  const { scripts } = packageJson("console");
  const vite =
    "node --max-old-space-size=4096 ./node_modules/vite/bin/vite.js build";
  assert.equal(
    scripts.build,
    `pnpm generate && pnpm build:landing-chat && node scripts/sync-landing.mjs && ${vite}`,
  );
  assert.equal(
    scripts["build:landing-chat"],
    `${vite} -c vite.landing-chat.config.ts`,
  );
  assert.equal(
    scripts.prepack,
    "pnpm generate && pnpm build:landing-chat && node scripts/sync-landing.mjs --copy",
  );
});

test("workspace libraries expose their artifacts in clean CI lifecycle builds", () => {
  for (const name of ["cloud", "mcp-portal", "translate", "tunnel"]) {
    const { scripts } = packageJson(name);
    assert.equal(scripts.prepack, "pnpm build", `${name}: prepack`);
    assert.equal(scripts["build:test"], "pnpm build", `${name}: build:test`);
  }
  assert.equal(packageJson("cloud").scripts["test:ci"], "pnpm run test --silent --coverage");
});

test("recursive CI work stays bounded instead of launching every package at once", () => {
  const config = readFileSync(new URL("../.npmrc", import.meta.url), "utf8");
  assert.match(config, /^workspace-concurrency=2$/m);
  const workspace = readFileSync(
    new URL("../pnpm-workspace.yaml", import.meta.url),
    "utf8",
  );
  assert.match(workspace, /^workspaceConcurrency: 2$/m);
  const root = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    root.scripts["ci:test"],
    "pnpm -r --workspace-concurrency=2 --no-bail test:ci && pnpm test:scripts",
  );
});

test("frontend CI suites cap Jest workers without raising test timeouts", () => {
  for (const name of ["console", "experience", "account"]) {
    assert.equal(
      packageJson(name).scripts["test:ci"],
      "jest --maxWorkers=2 --coverage --silent",
      name,
    );
  }
});

test("Core bounds heavyweight V8 coverage workers without raising test timeouts", () => {
  const config = readFileSync(new URL("../packages/core/jest.config.js", import.meta.url), "utf8");
  assert.match(config, /^\s*maxWorkers: 2,$/m);
  assert.ok(!config.includes("testTimeout"));
});
