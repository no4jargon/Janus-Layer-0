import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, '..');

const isRelease = process.env.WORKSPACE_RELEASE === '1';
const isPublish = process.env.WORKSPACE_PUBLISH === '1';

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
  if (isPublish) {
    flags.push('--publish=always');
  } else {
    flags.push('--publish=never');
  }
}

execSync(`electron-builder ${flags.join(' ')}`.trim(), {
  cwd: desktopRoot,
  stdio: 'inherit',
});

if (isRelease) {
  const pkg = JSON.parse(
    readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'),
  );
  const version = pkg.version;
  const tag = `v${version}`;
  const minSupported = process.env.MIN_SUPPORTED_VERSION || version;
  const channel = process.env.WORKSPACE_RELEASE_CHANNEL || 'beta';
  const repoSlug = 'no4jargon/Janus-Layer-0';

  const latest = {
    latestVersion: version,
    minSupportedVersion: minSupported,
    channel,
    releasedAt: new Date().toISOString(),
    downloadUrl: `https://github.com/${repoSlug}/releases/tag/${tag}`,
    releaseNotesUrl: `https://github.com/${repoSlug}/releases/tag/${tag}`,
  };

  const distDir = path.join(desktopRoot, 'dist');
  mkdirSync(distDir, { recursive: true });
  const latestPath = path.join(distDir, 'latest.json');
  writeFileSync(latestPath, JSON.stringify(latest, null, 2) + '\n');
  console.log(
    `[desktop] wrote ${latestPath} (latestVersion=${version}, minSupportedVersion=${minSupported}, channel=${channel})`,
  );

  if (isPublish) {
    const upload = spawnSync(
      'gh',
      ['release', 'upload', tag, latestPath, '--clobber'],
      { cwd: desktopRoot, stdio: 'inherit' },
    );
    if (upload.error || upload.status !== 0) {
      console.warn(
        `\n[desktop] could not auto-upload latest.json (gh exit=${upload.status ?? 'missing'}).`,
      );
      console.warn(
        `[desktop] run this manually once the GitHub release is published:`,
      );
      console.warn(
        `[desktop]   gh release upload ${tag} ${latestPath} --clobber\n`,
      );
    } else {
      console.log(
        `[desktop] uploaded latest.json to GitHub release ${tag}`,
      );
    }
  }
}

console.log(
  `[desktop] ${isRelease ? 'release' : 'local dir'} build generated under apps/desktop/dist`,
);
