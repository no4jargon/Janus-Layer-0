import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..', '..', '..');
const source = path.join(repoRoot, 'packages', 'db', 'migrations');
const dest = path.join(__dirname, 'migrations');

if (!existsSync(source)) {
  console.error(`[desktop] db migrations not found at ${source}`);
  process.exit(1);
}

if (existsSync(dest)) {
  rmSync(dest, { recursive: true, force: true });
}

mkdirSync(dest, { recursive: true });
cpSync(source, dest, { recursive: true });

console.log(`[desktop] staged DB migrations at: ${dest}`);
