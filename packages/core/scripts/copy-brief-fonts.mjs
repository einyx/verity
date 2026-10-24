import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Both tsup entries (including workers) and tsc routes search their ancestor assets directory.
const destination = resolve(
  process.argv[2] ?? fileURLToPath(new URL('../build/assets/brief-fonts/', import.meta.url))
);
await mkdir(destination, { recursive: true });
await cp(new URL('../src/assets/brief-fonts/', import.meta.url), destination, { recursive: true });
