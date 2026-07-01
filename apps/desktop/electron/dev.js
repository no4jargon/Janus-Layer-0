import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import electron from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, '..');
const repoRoot = path.join(desktopRoot, '..', '..');
const uiRoot = path.join(repoRoot, 'packages', 'ui');

const buildPackages = () => {
  const packages = [
    '@chai/shared',
    '@chai/db',
    '@chai/core',
    '@chai/ai-prompts',
    '@chai/ai',
    '@chai/connectors-gmail',
    '@chai/connectors-whatsapp',
  ];

  const filterArgs = packages.flatMap((name) => ['--filter', name]);
  const result = spawnSync('pnpm', [...filterArgs, 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const ensureMigrationsStaged = () => {
  const result = spawnSync(
    'node',
    [path.join(__dirname, 'stage-migrations.js')],
    {
      cwd: desktopRoot,
      stdio: 'inherit',
    },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

buildPackages();
ensureMigrationsStaged();

const vite = await createServer({
  root: uiRoot,
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
});

await vite.listen();

const child = spawn(electron, ['./electron/main.js'], {
  cwd: desktopRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    UI_DEV_URL: 'http://127.0.0.1:5173',
    CHAI_REPO_ROOT: repoRoot,
    NODE_ENV: 'development',
  },
});

const shutdown = async () => {
  child.kill('SIGTERM');
  await vite.close();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await once(child, 'exit');
await vite.close();
