import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFileIfPresent } from './env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, '..');
const repoRoot = path.join(desktopRoot, '..', '..');
const uiDist = path.join(repoRoot, 'packages', 'ui', 'dist');
const stagedUiDist = path.join(__dirname, 'ui-dist');
const embeddedConfigPath = path.join(__dirname, 'embedded-config.json');

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

loadEnvFileIfPresent(path.join(repoRoot, '.env'));

const embeddedConfig = {
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_REDIRECT_URI:
    process.env.GOOGLE_REDIRECT_URI ||
    'http://127.0.0.1:43123/oauth/google/callback',
};

writeFileSync(embeddedConfigPath, JSON.stringify(embeddedConfig, null, 2) + '\n');

const haveGoogleSecrets = Boolean(
  embeddedConfig.GOOGLE_CLIENT_ID && embeddedConfig.GOOGLE_CLIENT_SECRET,
);
console.log(
  `[desktop] baked embedded-config.json (gmail oauth: ${haveGoogleSecrets ? 'present' : 'MISSING — Connect Gmail will fail'})`,
);

console.log(`[desktop] staged UI build at: ${stagedUiDist}`);
