import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const upstreamJobs = {
  "repository-dispatch.yml": ["event_dispatch"],
  "changesets.yml": ["changesets"],
  "release.yml": [
    "dockerize",
    "dockerize-edge",
    "publish-and-tag",
    "create-github-release",
  ],
};

for (const [file, jobs] of Object.entries(upstreamJobs)) {
  const source = readFileSync(
    new URL(`../.github/workflows/${file}`, import.meta.url),
    "utf8",
  );
  for (const job of jobs) {
    test(`${file}: ${job} cannot publish or dispatch outside its upstream repository`, () => {
      const block = source.split(`\n  ${job}:\n`)[1]?.split(/\n  [\w-]+:\n/)[0];
      assert.ok(block, `Missing job ${job}`);
      const condition = block.split("\n").find((line) => /^    if:/.test(line));
      assert.ok(
        condition?.includes("github.repository == 'logto-io/logto'"),
        "Upstream-only side effects need an explicit repository gate",
      );
      assert.ok(
        !condition.includes("||"),
        "The upstream gate must not be bypassable with an OR condition",
      );
    });
  }
  test(`${file}: reports unconfigured upstream automation explicitly`, () => {
    assert.match(source, /GITHUB_STEP_SUMMARY/);
    assert.match(source, /not configured/i);
  });
}
