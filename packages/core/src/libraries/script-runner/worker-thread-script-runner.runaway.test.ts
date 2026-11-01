import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { type ScriptRunInput } from './types.js';
import { WorkerThreadScriptRunner } from './worker-thread-script-runner.js';

const buildInput = (
  script: string,
  limits: Partial<ScriptRunInput['limits']> = {}
): ScriptRunInput => ({
  script,
  entry: 'runAction',
  payload: {},
  limits: { wallClockMs: 300, memoryMb: 64, ...limits },
  egress: { mode: 'allowAll' },
});

/**
 * The runner exists so a runaway script cannot take the host with it. Every case here would hang
 * or exhaust memory without the worker thread bounds.
 */
describe('WorkerThreadScriptRunner runaway containment', () => {
  const runners: WorkerThreadScriptRunner[] = [];

  const createRunner = () => {
    const runner = new WorkerThreadScriptRunner();

    // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- test bookkeeping for teardown
    runners.push(runner);

    return runner;
  };

  afterEach(async () => {
    await Promise.all(runners.map(async (runner) => runner.dispose()));
    // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- test bookkeeping for teardown
    runners.splice(0, runners.length);
  });

  it('times out a script whose top level never finishes', async () => {
    const runner = createRunner();

    await expect(runner.run(buildInput('while (true) {}'))).resolves.toEqual({
      ok: false,
      kind: 'timeout',
    });
  }, 10_000);

  it('times out an infinite loop inside the entry function', async () => {
    const runner = createRunner();

    await expect(
      runner.run(buildInput('const runAction = () => { while (true) {} };'))
    ).resolves.toEqual({ ok: false, kind: 'timeout' });
  }, 10_000);

  // A synchronous-only timeout would never cover this case: a pending promise waits forever
  // unless the wall clock bounds the whole run.
  it('times out a promise that never settles', async () => {
    const runner = createRunner();

    await expect(
      runner.run(buildInput('const runAction = () => new Promise(() => {});'))
    ).resolves.toEqual({ ok: false, kind: 'timeout' });
  }, 10_000);

  it('reports oom for a runaway allocation', async () => {
    const input = buildInput(
      `const runAction = () => {
           const chunks = [];
           while (true) { chunks.push(new Array(1_000_000).fill('x')); }
         };`,
      { wallClockMs: 20_000, memoryMb: 16 }
    );
    // Jest's 4 GB heap flag overrides Worker resourceLimits. Exercise the real 16 MB limit in
    // a fresh process without that inherited override, rather than allocating gigabytes in CI.
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        '--eval',
        `
        (async () => {
        const { WorkerThreadScriptRunner } = await import(${JSON.stringify(new URL('worker-thread-script-runner.js', import.meta.url).href)});
        const runner = new WorkerThreadScriptRunner();
        try { console.log(JSON.stringify(await runner.run(${JSON.stringify(input)}))); }
        finally { await runner.dispose(); }
        })().catch((error) => { console.error(error); process.exitCode = 1; });
      `,
      ],
      { env: { ...process.env, NODE_OPTIONS: '' }, timeout: 25_000 }
    );

    expect(JSON.parse(stdout)).toEqual({ ok: false, kind: 'oom' });
  }, 30_000);

  it('reports runtime when the script exits the thread', async () => {
    const runner = createRunner();
    const result = await runner.run(
      buildInput('const runAction = () => { process.exit(0); };', { wallClockMs: 5000 })
    );

    expect(result).toMatchObject({ ok: false, kind: 'runtime' });
  }, 10_000);

  // Recycling after an out-of-memory kill is deterministic in the spawn-contract suite.
  // The real OOM check above uses a child to avoid Jest's inherited heap override.

  it('serves the next run on a fresh worker after the script exits the thread', async () => {
    const runner = createRunner();
    const script = `var runs = 0;
       const runAction = ({ die }) => {
         runs += 1;
         if (die) { process.exit(0); }
         return { runs };
       };`;

    await expect(
      runner.run({ ...buildInput(script, { wallClockMs: 5000 }), payload: { die: true } })
    ).resolves.toMatchObject({ ok: false, kind: 'runtime' });
    expect(runner.size).toBe(0);

    await expect(
      runner.run({ ...buildInput(script, { wallClockMs: 5000 }), payload: { die: false } })
    ).resolves.toEqual({ ok: true, value: { runs: 1 } });
  }, 10_000);

  it('recycles the worker when the script crashes it outside a run', async () => {
    // A throw from a timer escapes the worker's request handling entirely, so it surfaces as the
    // worker `error` event rather than a settled result — the third recycling trigger next to
    // timeout and out-of-memory.
    const runner = createRunner();
    const script = `const runAction = () => {
         setTimeout(() => { throw new Error('crash'); }, 0);
         return new Promise((resolve) => setTimeout(() => resolve({ survived: true }), 5000));
       };`;

    await expect(runner.run(buildInput(script, { wallClockMs: 8000 }))).resolves.toMatchObject({
      ok: false,
      kind: 'runtime',
      message: 'crash',
    });
    expect(runner.size).toBe(0);

    await expect(
      runner.run(buildInput('const runAction = () => ({ healthy: true });', { wallClockMs: 5000 }))
    ).resolves.toEqual({ ok: true, value: { healthy: true } });
  }, 15_000);

  it('serves the next run after a timeout on a fresh worker', async () => {
    const runner = createRunner();
    const script = 'const runAction = () => { while (true) {} };';

    await expect(runner.run(buildInput(script))).resolves.toEqual({ ok: false, kind: 'timeout' });
    // The faulted worker left the pool rather than lingering as a corpse the next run would await.
    expect(runner.size).toBe(0);
    await expect(runner.run(buildInput(script))).resolves.toEqual({ ok: false, kind: 'timeout' });
    await expect(
      runner.run(buildInput('const runAction = () => ({ ok: true });', { wallClockMs: 5000 }))
    ).resolves.toEqual({ ok: true, value: { ok: true } });
  }, 15_000);

  it('keeps the host event loop responsive while a script runs away', async () => {
    const runner = createRunner();
    const ticks = { count: 0 };
    const interval = setInterval(() => {
      // eslint-disable-next-line @silverhand/fp/no-mutation -- counting ticks is the assertion
      ticks.count += 1;
    }, 10);

    try {
      await expect(
        runner.run(buildInput('const runAction = () => { while (true) {} };', { wallClockMs: 500 }))
      ).resolves.toEqual({ ok: false, kind: 'timeout' });
    } finally {
      clearInterval(interval);
    }

    // A blocked host loop would fire the interval a handful of times at most.
    expect(ticks.count).toBeGreaterThan(15);
  }, 10_000);
});
