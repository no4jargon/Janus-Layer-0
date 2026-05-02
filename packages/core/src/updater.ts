export type UpdateChannel = 'beta' | 'stable';

export type UpdateMetadata = {
  latestVersion: string;
  minSupportedVersion: string | null;
  releasedAt?: string;
  releaseNotesUrl?: string;
  downloadUrl?: string;
  channel: UpdateChannel;
};

export type UpdateInfo =
  | {
      kind: 'up-to-date';
      currentVersion: string;
      latestVersion: string;
      channel: UpdateChannel;
    }
  | {
      kind: 'optional';
      currentVersion: string;
      latestVersion: string;
      channel: UpdateChannel;
      downloadUrl?: string;
      releaseNotesUrl?: string;
    }
  | {
      kind: 'required';
      currentVersion: string;
      latestVersion: string;
      minSupportedVersion: string;
      channel: UpdateChannel;
      downloadUrl?: string;
      releaseNotesUrl?: string;
    };

export type UpdateCheckerOptions = {
  feedUrl: string;
  currentVersion: string;
  channel?: UpdateChannel;
  fetchImpl?: typeof fetch;
};

const parseVersion = (value: string): number[] =>
  value
    .replace(/^v/, '')
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10) || 0);

export const compareVersions = (a: string, b: string): number => {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const lv = left[i] ?? 0;
    const rv = right[i] ?? 0;
    if (lv > rv) return 1;
    if (lv < rv) return -1;
  }
  return 0;
};

export const decideUpdate = (
  metadata: UpdateMetadata,
  currentVersion: string,
): UpdateInfo => {
  const cmp = compareVersions(currentVersion, metadata.latestVersion);
  if (cmp >= 0) {
    return {
      kind: 'up-to-date',
      currentVersion,
      latestVersion: metadata.latestVersion,
      channel: metadata.channel,
    };
  }

  if (
    metadata.minSupportedVersion &&
    compareVersions(currentVersion, metadata.minSupportedVersion) < 0
  ) {
    return {
      kind: 'required',
      currentVersion,
      latestVersion: metadata.latestVersion,
      minSupportedVersion: metadata.minSupportedVersion,
      channel: metadata.channel,
      downloadUrl: metadata.downloadUrl,
      releaseNotesUrl: metadata.releaseNotesUrl,
    };
  }

  return {
    kind: 'optional',
    currentVersion,
    latestVersion: metadata.latestVersion,
    channel: metadata.channel,
    downloadUrl: metadata.downloadUrl,
    releaseNotesUrl: metadata.releaseNotesUrl,
  };
};

export type UpdateChecker = {
  check(): Promise<UpdateInfo>;
};

export const createUpdateChecker = (
  options: UpdateCheckerOptions,
): UpdateChecker => {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    check: async (): Promise<UpdateInfo> => {
      const response = await fetchImpl(options.feedUrl, {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(
          `Update feed responded with ${response.status} (${options.feedUrl})`,
        );
      }
      const payload = (await response.json()) as Partial<UpdateMetadata>;
      if (!payload.latestVersion) {
        throw new Error('Update feed missing latestVersion');
      }
      const metadata: UpdateMetadata = {
        latestVersion: payload.latestVersion,
        minSupportedVersion: payload.minSupportedVersion ?? null,
        releasedAt: payload.releasedAt,
        releaseNotesUrl: payload.releaseNotesUrl,
        downloadUrl: payload.downloadUrl,
        channel: payload.channel ?? options.channel ?? 'beta',
      };
      return decideUpdate(metadata, options.currentVersion);
    },
  };
};
