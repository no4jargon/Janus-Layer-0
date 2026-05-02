import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, '..');

const isRelease = process.env.WORKSPACE_RELEASE === '1';

execSync('node ./electron/build.js', {
  cwd: desktopRoot,
  stdio: 'inherit',
});

const flags = [];

if (!isRelease) {
  // Default local mode: unsigned `dir` output across platforms, no publish.
  flags.push(
    '--dir',
    '--config.mac.identity=null',
    '--config.publish=null',
  );
} else {
  if (process.env.WORKSPACE_PUBLISH === '1') {
    flags.push('--publish=always');
  } else {
    flags.push('--publish=never');
  }
}

execSync(`electron-builder ${flags.join(' ')}`.trim(), {
  cwd: desktopRoot,
  stdio: 'inherit',
});

console.log(
  `[desktop] ${isRelease ? 'release' : 'local dir'} build generated under apps/desktop/dist`,
);
