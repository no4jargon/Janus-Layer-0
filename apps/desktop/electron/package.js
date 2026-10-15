import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, '..');

const isRelease = process.env.CHAI_RELEASE === '1';
const isPublish = process.env.CHAI_PUBLISH === '1';
// In multi-platform CI, only one job (the macOS one) should write
// latest.json. Other platform jobs set this to skip the write+upload.
const skipLatestJson = process.env.CHAI_SKIP_LATEST_JSON === '1';
const pkg = JSON.parse(
  readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'),
);
const version = pkg.version;
const tag = `v${version}`;
const minSupported = process.env.MIN_SUPPORTED_VERSION || version;
const channel = process.env.CHAI_RELEASE_CHANNEL || 'beta';
const { owner, repo } = pkg.build.publish;
const repoSlug = `${owner}/${repo}`;

if (isPublish && !isRelease) {
  throw new Error('CHAI_PUBLISH=1 requires CHAI_RELEASE=1');
}

if (isRelease) {
  const validVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!validVersion.test(version) || !validVersion.test(minSupported)) {
    throw new Error('Release and minimum supported versions must use major.minor.patch');
  }
  const left = minSupported.split('.').map(Number);
  const right = version.split('.').map(Number);
  const firstDifference = left.findIndex((part, index) => part !== right[index]);
  if (firstDifference >= 0 && left[firstDifference] > right[firstDifference]) {
    throw new Error('MIN_SUPPORTED_VERSION cannot exceed the release version');
  }
  if (!['beta', 'stable'].includes(channel)) {
    throw new Error('CHAI_RELEASE_CHANNEL must be beta or stable');
  }
  if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== tag) {
    throw new Error(`Release tag must match desktop package version (${tag})`);
  }
}

if (isPublish && !skipLatestJson) {
  const gh = spawnSync('gh', ['--version'], { stdio: 'ignore' });
  if (gh.error || gh.status !== 0) {
    throw new Error('Publishing latest.json requires the gh CLI; install it before building');
  }
}

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

if (isRelease && !skipLatestJson) {
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
      ['release', 'upload', tag, latestPath, '--repo', repoSlug, '--clobber'],
      { cwd: desktopRoot, stdio: 'inherit' },
    );
    if (upload.error || upload.status !== 0) {
      throw new Error(
        `latest.json upload failed (gh exit=${upload.status ?? 'missing'}). ` +
        `Keep ${tag} as a draft and retry: gh release upload ${tag} "${latestPath}" --repo ${repoSlug} --clobber`,
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
