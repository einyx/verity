#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const read = (path) => readFileSync(join(root, path), 'utf8');

const corePackage = JSON.parse(read('packages/core/package.json'));
const version = process.argv[2]?.replace(/^v/, '') ?? corePackage.version;
const tag = `v${version}`;

const tags = git('tag', '--list', 'v*', '--sort=-v:refname').split('\n').filter(Boolean);
const tagIndex = tags.indexOf(tag);

if (tagIndex === -1) {
  if (version !== corePackage.version) {
    throw new Error(`${tag} does not exist and packages/core is at ${corePackage.version}`);
  }
  const pending = readdirSync(join(root, '.changeset')).filter(
    (file) => file.endsWith('.md') && file !== 'README.md'
  );
  if (pending.length > 0) {
    throw new Error(`Pending changesets (${pending.join(', ')}); merge the version PR before releasing`);
  }
}

const previous = tagIndex === -1 ? tags[0] : tags[tagIndex + 1];
const taggedDate = git('log', '-1', '--format=%cs', tagIndex === -1 ? 'HEAD' : tag);

const repo = git('remote', 'get-url', 'origin')
  .replace(/^.*github\.com[:/]/, '')
  .replace(/\.git$/, '');

const changelog = read('packages/core/CHANGELOG.md');
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const changelogSection =
  new RegExp(`## ${escapedVersion}\\n([\\s\\S]*?)(?=\\n## |$)`).exec(changelog)?.[1]?.trim() ?? '';

const artworkUrl = `https://github.com/${repo}/releases/download/${tag}/artwork.png`;

const notes = [
  `![MeshX ${tag}](${artworkUrl})`,
  changelogSection,
  previous ? `**Full changelog**: https://github.com/${repo}/compare/${previous}...${tag}` : '',
]
  .filter(Boolean)
  .join('\n\n')
  .concat('\n');

const date = new Date(`${taggedDate}T00:00:00Z`).toLocaleDateString('en-US', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const svg = read('scripts/release/artwork.svg')
  .replaceAll('{{VERSION}}', tag)
  .replaceAll('{{DATE}}', date);

const outDir = join(root, '.release', tag);
mkdirSync(outDir, { recursive: true });
const notesPath = join(outDir, 'notes.md');
const svgPath = join(outDir, 'artwork.svg');
const pngPath = join(outDir, 'artwork.png');
writeFileSync(notesPath, notes);
writeFileSync(svgPath, svg);

const converters = [
  ['rsvg-convert', ['-w', '1280', '-o', pngPath, svgPath]],
  ['magick', [svgPath, '-resize', '1280x640', pngPath]],
];
const converted = converters.some(([command, args]) => {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
});
if (!converted) throw new Error('Could not render artwork; install librsvg (brew install librsvg) or ImageMagick');

console.log(
  JSON.stringify(
    {
      tag,
      previous: previous ?? null,
      tagExists: tagIndex !== -1,
      notes: notesPath,
      artwork: pngPath,
    },
    null,
    2
  )
);
