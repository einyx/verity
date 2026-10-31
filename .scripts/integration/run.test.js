import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
  copyFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { test } from "node:test";

const run = promisify(execFile);

for (const scenario of [
  { flag: "0", pnpmExit: 0, address: "127.0.0.1:15432", exit: 0 },
  { flag: "1", pnpmExit: 0, address: "127.0.0.1:15432", exit: 0 },
  { flag: "0", pnpmExit: 42, address: "127.0.0.1:15432", exit: 42 },
  { flag: "0", pnpmExit: 0, address: "0.0.0.0:15432", exit: 1 },
]) {
  test(`integration runner isolates DB, preserves mode ${scenario.flag} and cleans up with exit ${scenario.exit}`, async () => {
    const root = await realpath(
      await mkdtemp(path.join(tmpdir(), "verity-runner-test-")),
    );
    const bin = path.join(root, "bin");
    const eventsPath = path.join(root, "events.jsonl");

    try {
      await Promise.all([
        mkdir(bin),
        mkdir(path.join(root, ".scripts/integration"), { recursive: true }),
        mkdir(path.join(root, "packages/integration-tests"), {
          recursive: true,
        }),
      ]);
      await copyFile(
        new URL("./run.sh", import.meta.url),
        path.join(root, ".scripts/integration/run.sh"),
      );
      const stub = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(process.env.EVENTS_PATH, JSON.stringify({ command, args, cwd: process.cwd(), db: process.env.DB_URL, flag: process.env.DEV_FEATURES_ENABLED, project: process.env.COMPOSE_PROJECT_NAME }) + '\\n');
if (command === 'docker' && args.includes('port')) console.log(process.env.TEST_POSTGRES_ADDRESS);
if (command === 'pnpm' && args[0] === 'run') process.exit(Number(process.env.TEST_PNPM_EXIT_CODE));
`;
      await Promise.all(
        ["docker", "pnpm"].map((command) =>
          writeFile(path.join(bin, command), stub, { mode: 0o755 }),
        ),
      );

      const result = await run(
        "bash",
        [path.join(root, ".scripts/integration/run.sh"), "api"],
        {
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            EVENTS_PATH: eventsPath,
            DEV_FEATURES_ENABLED: scenario.flag,
            TEST_POSTGRES_ADDRESS: scenario.address,
            TEST_PNPM_EXIT_CODE: String(scenario.pnpmExit),
            DB_URL: "postgres://must-not-use-an-external-database/production",
            COMPOSE_PROJECT_NAME: "",
            NO_BUILD: "1",
          },
        },
      ).then(
        () => ({ code: 0 }),
        (error) => error,
      );
      assert.equal(result.code, scenario.exit);
      const events = (await readFile(eventsPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const testsIndex = events.findIndex(
        ({ command, args }) => command === "pnpm" && args[0] === "run",
      );
      const postgresIndex = events.findIndex(
        ({ command, args }) => command === "docker" && args.includes("port"),
      );
      if (scenario.address.startsWith("127.0.0.1:")) {
        const tests = events[testsIndex];
        assert.deepEqual(tests.args, ["run", "test:api"]);
        assert.equal(
          tests.db,
          "postgres://postgres:p0stgr3s@127.0.0.1:15432/postgres",
        );
        assert.equal(tests.flag, scenario.flag);
        assert.equal(tests.cwd, path.join(root, "packages/integration-tests"));
      } else {
        assert.equal(
          testsIndex,
          -1,
          "tests must not run against an unexpected database address",
        );
        assert.match(result.stderr, /expected one loopback PostgreSQL address/);
      }
      const project = events[0].project;
      assert.match(project, /^verity-integration-\d+-\d+$/);
      assert.ok(events.every((event) => event.project === project));
      const downIndexes = events.flatMap(({ command, args }, index) =>
        command === "docker" && args.includes("down") ? [index] : [],
      );
      assert.equal(
        downIndexes.length,
        2,
        "initial teardown and EXIT cleanup must both run",
      );
      assert.ok(downIndexes[1] > Math.max(testsIndex, postgresIndex));
      assert.deepEqual(events[downIndexes[1]].args.slice(-3), [
        "down",
        "-v",
        "--remove-orphans",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
