// Trusted process-group anchor. It stays alive after the CLI exits, until its parent tears down the
// entire owned group. A CLI leader's close must never be mistaken for descendant completion.
import { spawn } from 'node:child_process';

if (!process.send || process.env.LEAD_RESEARCH_SUPERVISED !== '1' || process.platform === 'win32') {
  throw new Error('Research supervisor requires a dedicated POSIX IPC process group.');
}
process.on('SIGTERM', () => {});
process.on('SIGINT', () => {});
setInterval(() => {}, 1000);
const killOwnedGroup = () => {
  // This process is the live group leader, so the group ID cannot belong to a reused process.
  process.kill(-process.pid, 'SIGKILL');
};
process.once('disconnect', killOwnedGroup);
let reported = false;
const report = (code) => {
  if (reported) return;
  reported = true;
  process.send({ type: 'research-exit', code }, (error) => {
    if (error) killOwnedGroup();
  });
};
process.on('uncaughtException', () => report(1));
process.on('unhandledRejection', () => report(1));
const cli = spawn(process.argv[2], process.argv.slice(3), {
  stdio: ['pipe', 'inherit', 'inherit'],
});
cli.once('error', () => report(1));
cli.once('exit', (code) => report(code ?? 1));
cli.stdin.on('error', () => report(1));
process.stdin.on('error', () => report(1));
process.stdin.pipe(cli.stdin);
