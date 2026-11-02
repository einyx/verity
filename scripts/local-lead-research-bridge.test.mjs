import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdtemp, writeFile, rm, readFile, access } from 'node:fs/promises';
import { watch } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nodeTest from 'node:test';

// The optional bridge fails closed on Windows until equivalent job-object containment is supplied.
const test = process.platform === 'win32' ? nodeTest.skip : nodeTest;

const syntheticToken = 'synthetic-local-test-token-not-a-secret-000';
const start = async (t, program, profile = { firstName: 'Ada', lastName: 'Example', company: 'Example Co' }) => {
  const directory = await mkdtemp(join(tmpdir(), 'lead-bridge-test-'));
  const cli = join(directory, 'fake-cli.mjs');
  await writeFile(cli, `#!/usr/bin/env node\n${program}`);
  await chmod(cli, 0o700);
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const { port } = reservation.address();
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, ['scripts/local-lead-research-bridge.mjs'], {
    env: { ...process.env, LEAD_RESEARCH_BRIDGE_HOST: '127.0.0.1', LEAD_RESEARCH_BRIDGE_PORT: String(port),
      LEAD_RESEARCH_BRIDGE_TOKEN: syntheticToken, CLAUDE_CLI_PATH: cli,
      LEAD_RESEARCH_CLAUDE_API_KEY: 'synthetic-provider-fixture-only' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
    await rm(directory, { recursive: true });
  });
  await once(child.stdout, 'data');
  const request = (authorization = `Bearer ${syntheticToken}`, signal) => fetch(`http://127.0.0.1:${port}/research`, {
    method: 'POST', headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ lead: profile }),
    signal,
  });
  request.directory = directory;
  return request;
};

test('research subprocess never inherits the bridge bearer credential', async (t) => {
  const request = await start(t, `console.log(JSON.stringify({structured_output: {findings: [], draft: process.env.LEAD_RESEARCH_BRIDGE_TOKEN ? 'leaked' : 'isolated'}}));`);
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).draft, 'isolated');
});

test('provider stderr never escapes in an HTTP error', async (t) => {
  const request = await start(t, `console.error('SYNTHETIC_PRIVATE_PROVIDER_DIAGNOSTIC'); process.exitCode = 1;`);
  const response = await request();
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes('SYNTHETIC_PRIVATE_PROVIDER_DIAGNOSTIC'));
});

test('unauthorized calls cannot invoke the research runtime', async (t) => {
  const request = await start(t, `console.log('{}');`);
  assert.equal((await request('Bearer wrong')).status, 401);
});

test('concurrent requests cannot spawn an unbounded local runtime fleet', async (t) => {
  const request = await start(t, `setTimeout(() => console.log(JSON.stringify({structured_output: {findings: [], draft: 'Unsent'}})), 300);`);
  const responses = await Promise.all([request(), request()]);
  assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 429]);
});

test('an overflow followed by a successful child exit is still a failure', async (t) => {
  const request = await start(t, `process.on('SIGTERM', () => process.exit(0)); process.stdout.write(JSON.stringify({structured_output:{findings:[],draft:'prefix'}})); process.stderr.write('x'.repeat(210000)); setTimeout(() => process.exit(0),1000);`);
  assert.equal((await request()).status, 502);
});

test('runtime ignores ambient hooks, project context, MCP and session persistence', async (t) => {
  const request = await start(t, `const a=process.argv; const isolated=['--bare','--no-session-persistence','--disable-slash-commands','--strict-mcp-config','--setting-sources'].every(x=>a.includes(x)) && process.cwd()===process.env.HOME; console.log(JSON.stringify({structured_output:{findings:[],draft:isolated?'isolated':'ambient'}}));`);
  const response = await request();
  assert.equal((await response.json()).draft, 'isolated');
});

test('a valid public lead does not have to supply optional surname or company', async (t) => {
  const request = await start(t, `console.log(JSON.stringify({structured_output:{findings:[],draft:'Insufficient verified identity'}}));`, { firstName: 'Ada' });
  assert.equal((await request()).status, 200);
});

test('disconnect reaps a TERM-ignoring owned process tree and removes its clean HOME', async (t) => {
  if (process.platform === 'win32') { t.skip('POSIX process-group contract'); return; }
  const request = await start(t, `import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs'; import {dirname,join} from 'node:path'; process.on('SIGTERM',()=>{}); const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit']}); writeFileSync(join(dirname(process.argv[1]),'started'),JSON.stringify({pid:process.pid,descendant:child.pid,home:process.cwd()})); setInterval(()=>{},1000);`);
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { watcher.close(); reject(new Error('Synthetic child did not start')); }, 5000);
    const watcher = watch(request.directory, (_event, name) => {
      if (name === 'started') { clearTimeout(timeout); watcher.close(); resolve(); }
    });
  });
  const lifetime = new AbortController();
  const pending = request(undefined, lifetime.signal);
  await ready;
  const child = JSON.parse(await readFile(join(request.directory, 'started'), 'utf8'));
  const cancelled = assert.rejects(pending, { name: 'AbortError' });
  lifetime.abort();
  await cancelled;
  await new Promise((resolve) => setTimeout(resolve, 2700));
  for (const pid of [child.pid, child.descendant]) {
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  }
  await assert.rejects(access(child.home), { code: 'ENOENT' });
});

const waitForMarker = (directory) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { watcher.close(); reject(new Error('Fixture not ready')); }, 5000);
  const watcher = watch(directory, (_event, name) => {
    if (name === 'started') { clearTimeout(timer); watcher.close(); resolve(); }
  });
});
const detachedWorkerProgram = (success) => `import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs'; import {dirname,join} from 'node:path'; const worker=spawn(process.execPath,['-e',\`process.title='lead-research-fixture-descendant';process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000);\`],{stdio:['ignore','ignore','ignore','ipc']}); worker.once('message',()=>{writeFileSync(join(dirname(process.argv[1]),'started'),JSON.stringify({pid:process.pid,descendant:worker.pid})); ${success ? `process.stdout.write(JSON.stringify({structured_output:{findings:[],draft:'Unsent'}}),()=>process.exit(0));` : 'setInterval(()=>{},1000);'}});`;
const fallbackCleanup = (t, pid) => t.after(() => {
  const command = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).stdout;
  if (command.includes('lead-research-fixture-descendant')) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* Already reaped. */ }
  }
});

test('leader closing after TERM does not cancel cleanup of an independently piped descendant', async (t) => {
  if (process.platform === 'win32') { t.skip('POSIX process-group contract'); return; }
  const request = await start(t, detachedWorkerProgram(false));
  const ready = waitForMarker(request.directory);
  const lifetime = new AbortController();
  const pending = request(undefined, lifetime.signal);
  await ready;
  const { descendant } = JSON.parse(await readFile(join(request.directory, 'started'), 'utf8'));
  fallbackCleanup(t, descendant);
  const cancelled = assert.rejects(pending, { name: 'AbortError' });
  lifetime.abort();
  await cancelled;
  await new Promise((resolve) => setTimeout(resolve, 2700));
  assert.throws(() => process.kill(descendant, 0), { code: 'ESRCH' });
});

test('successful output is not returned until independently piped owned workers are gone', async (t) => {
  if (process.platform === 'win32') { t.skip('POSIX process-group contract'); return; }
  const request = await start(t, detachedWorkerProgram(true));
  const response = await request();
  const { descendant } = JSON.parse(await readFile(join(request.directory, 'started'), 'utf8'));
  fallbackCleanup(t, descendant);
  assert.equal(response.status, 200);
  assert.throws(() => process.kill(descendant, 0), { code: 'ESRCH' });
});
