import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cloudRepository = 'https://github.com/einyx/cloud.git';

/** Inject a pinned package before pnpm installation; only local fixtures may override the remote. */
export const prepareCloudPlugin = ({
  root = process.cwd(),
  includeCloud = '1',
  revision,
  repository = cloudRepository,
  tokenFile = '/run/secrets/cloud_github_token',
} = {}) => {
  if (!['0', '1'].includes(includeCloud)) {
    throw new Error('include_cloud must be 0 or 1');
  }
  const destination = join(root, 'packages/cloud');
  if (existsSync(destination)) {
    throw new Error('packages/cloud already exists; refusing to replace local work');
  }
  if (includeCloud === '0') {
    return false;
  }
  const sha = revision ?? readFileSync(join(root, '.scripts/cloud-plugin-revision'), 'utf8').trim();
  if (!/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error('The cloud plugin revision must be a full commit SHA');
  }
  if (repository !== cloudRepository && !isAbsolute(repository)) {
    throw new Error('Only a local repository path can override the cloud repository');
  }
  if (repository === cloudRepository && (!existsSync(tokenFile) || !readFileSync(tokenFile, 'utf8').trim())) {
    throw new Error('Private cloud requires the cloud_github_token BuildKit secret; use --build-arg include_cloud=0 for OSS');
  }

  const temporary = mkdtempSync(join(tmpdir(), 'cloud-checkout-'));
  const manifestPath = join(root, 'packages/core/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  try {
    const checkout = join(temporary, 'checkout');
    mkdirSync(checkout);
    const askpass = join(temporary, 'askpass');
    // Credentials are read from the mount, never interpolated into URLs, argv, files or logs.
    writeFileSync(askpass, '#!/bin/sh\ncase "$1" in\n*Username*) printf "%s\\n" x-access-token ;;\n*) cat "$CLOUD_GITHUB_TOKEN_FILE" ;;\nesac\n', { mode: 0o700 });
    const env = {
      ...process.env,
      GIT_ASKPASS: askpass,
      GIT_TERMINAL_PROMPT: '0',
      CLOUD_GITHUB_TOKEN_FILE: tokenFile,
    };
    const git = (...args) => execFileSync('git', ['-c', 'credential.helper=', ...args], {
      cwd: checkout, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    git('init', '--quiet');
    git('fetch', '--quiet', '--depth=1', '--no-tags', repository, sha);
    if (git('rev-parse', 'FETCH_HEAD').toString().trim() !== sha) {
      throw new Error('Fetched revision did not match the pinned SHA');
    }
    const staged = join(temporary, 'package');
    mkdirSync(staged);
    execFileSync('tar', ['-xf', '-', '-C', staged], { input: git('archive', sha) });
    const cloudManifest = JSON.parse(readFileSync(join(staged, 'package.json'), 'utf8'));
    if (cloudManifest.name !== '@meshx/cloud') {
      throw new Error('The pinned tree is not the @meshx/cloud package');
    }
    mkdirSync(join(root, 'packages'), { recursive: true });
    // Copy through a same-filesystem staging directory: tmpdir may be a different mount in Docker.
    const staging = mkdtempSync(join(root, 'packages/.cloud-checkout-'));
    try {
      execFileSync('tar', ['-xf', '-', '-C', staging], { input: git('archive', sha) });
      renameSync(staging, destination);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
    manifest.dependencies = { ...manifest.dependencies, '@meshx/cloud': 'workspace:^' };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    return true;
  } catch {
    throw new Error('Private cloud checkout failed; verify repository access and the pinned commit');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const included = prepareCloudPlugin({ includeCloud: process.argv[2] ?? '1' });
    console.log(included ? 'Pinned private cloud package included' : 'OSS build: private cloud omitted');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
