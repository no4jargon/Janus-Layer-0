import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, '..');
const repoRoot = path.join(desktopRoot, '..', '..');
const uiDist = path.join(repoRoot, 'packages', 'ui', 'dist');
const stagedUiDist = path.join(__dirname, 'ui-dist');

const packages = [
  '@janus/shared',
  '@janus/db',
  '@janus/core',
  '@janus/ai',
  '@janus/connectors-gmail',
  '@janus/connectors-whatsapp',
  '@janus/ui',
];

const filterArgs = packages.flatMap((name) => `--filter ${name}`).join(' ');

execSync(`pnpm ${filterArgs} build`, {
  cwd: repoRoot,
  stdio: 'inherit',
});

if (!existsSync(uiDist)) {
  throw new Error(`UI build output not found at ${uiDist}`);
}

if (existsSync(stagedUiDist)) {
  rmSync(stagedUiDist, { recursive: true, force: true });
}

mkdirSync(stagedUiDist, { recursive: true });
cpSync(uiDist, stagedUiDist, { recursive: true });

execSync('node ./electron/stage-migrations.js', {
  cwd: desktopRoot,
  stdio: 'inherit',
});

console.log(`[desktop] staged UI build at: ${stagedUiDist}`);
