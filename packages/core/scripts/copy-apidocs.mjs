import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = resolve(process.argv[2] ?? fileURLToPath(new URL('../src/routes/', import.meta.url)));
const destination = resolve(process.argv[3] ?? fileURLToPath(new URL('../build/routes/', import.meta.url)));
const copyDocuments = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await copyDocuments(path);
    } else if (entry.isFile() && entry.name.endsWith('.openapi.json')) {
      const target = join(destination, relative(source, path));
      await mkdir(dirname(target), { recursive: true });
      await copyFile(path, target);
    }
  }
};
await copyDocuments(source);
