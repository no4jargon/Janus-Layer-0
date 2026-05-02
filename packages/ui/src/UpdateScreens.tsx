import { useEffect, useState } from 'react';

type RequiredInfo = Extract<UpdateCheckResult, { kind: 'required' }>;

type Props = {
  info: RequiredInfo;
};

const ProgressLine = ({ event }: { event: UpdateEvent | null }) => {
  if (!event) return null;
  if (event.kind === 'checking') return <p>Checking for update…</p>;
  if (event.kind === 'available') {
    return <p>Update {event.version ?? ''} is available — preparing download…</p>;
  }
  if (event.kind === 'progress') {
    const pct = event.percent ?? 0;
    return (
      <div>
        <p>Downloading update… {Math.round(pct)}%</p>
        <div className="ai-progress-bar">
          <div className="ai-progress-fill" style={{ width: `${Math.round(pct)}%` }} />
        </div>
      </div>
    );
  }
  if (event.kind === 'downloaded') {
    return (
      <p>
        Update {event.version ?? ''} downloaded — click <strong>Install &amp; restart</strong>
        {' '}to finish.
      </p>
    );
  }
  if (event.kind === 'not-available') {
    return <p>No new build is available right now. Try again later.</p>;
  }
  if (event.kind === 'error') {
    return <p className="error">{event.message}</p>;
  }
  return null;
};

export const RequiredUpdateScreen = ({ info }: Props) => {
  const [event, setEvent] = useState<UpdateEvent | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!window.workspaceApi) return;
    return window.workspaceApi.events.onUpdateEvent((next) => {
      setEvent(next);
      if (next.kind === 'downloaded') setDownloaded(true);
    });
  }, []);

  const startDownload = async () => {
    if (!window.workspaceApi) return;
    setBusy(true);
    try {
      const result = await window.workspaceApi.update.download();
      if (result.kind === 'skipped') {
        setEvent({ kind: 'error', message: result.message ?? 'Skipped.' });
      } else if (result.kind === 'error') {
        setEvent({ kind: 'error', message: result.message ?? 'Failed.' });
      }
    } finally {
      setBusy(false);
    }
  };

  const installNow = async () => {
    if (!window.workspaceApi) return;
    await window.workspaceApi.update.install();
  };

  return (
    <div className="required-update-shell">
      <h1>Update required</h1>
      <p>
        This version of Workspace App is no longer supported and needs to be
        updated before continuing.
      </p>
      <ul>
        <li>
          <strong>You're on:</strong> {info.currentVersion}
        </li>
        <li>
          <strong>Minimum supported:</strong> {info.minSupportedVersion}
        </li>
        <li>
          <strong>Latest:</strong> {info.latestVersion} ({info.channel})
        </li>
        {info.releaseNotesUrl ? (
          <li>
            <a href={info.releaseNotesUrl} target="_blank" rel="noreferrer">
              Release notes
            </a>
          </li>
        ) : null}
      </ul>

      <div className="settings-row" style={{ marginTop: 16 }}>
        {!downloaded ? (
          <button onClick={() => void startDownload()} disabled={busy}>
            {busy ? 'Starting download…' : 'Download update'}
          </button>
        ) : (
          <button onClick={() => void installNow()}>Install &amp; restart</button>
        )}
      </div>

      <ProgressLine event={event} />
    </div>
  );
};

type OptionalProps = {
  info: Extract<UpdateCheckResult, { kind: 'optional' }>;
  onDismiss: () => void;
};

export const OptionalUpdateBanner = ({ info, onDismiss }: OptionalProps) => {
  const [busy, setBusy] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.workspaceApi) return;
    return window.workspaceApi.events.onUpdateEvent((event) => {
      if (event.kind === 'progress') setProgress(event.percent ?? 0);
      if (event.kind === 'downloaded') setDownloaded(true);
      if (event.kind === 'error') setError(event.message);
    });
  }, []);

  const startDownload = async () => {
    if (!window.workspaceApi) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.workspaceApi.update.download();
      if (result.kind === 'skipped' || result.kind === 'error') {
        setError(result.message ?? 'Update could not start.');
      }
    } finally {
      setBusy(false);
    }
  };

  const installNow = async () => {
    if (!window.workspaceApi) return;
    await window.workspaceApi.update.install();
  };

  return (
    <div className="optional-update-banner">
      <div>
        <strong>Update available:</strong> {info.latestVersion} (you're on{' '}
        {info.currentVersion}).
        {progress !== null && !downloaded ? (
          <span> Downloading… {Math.round(progress)}%</span>
        ) : null}
        {error ? <span className="error"> {error}</span> : null}
      </div>
      <div className="optional-update-actions">
        {!downloaded ? (
          <button onClick={() => void startDownload()} disabled={busy}>
            {busy ? 'Starting…' : 'Download'}
          </button>
        ) : (
          <button onClick={() => void installNow()}>Install &amp; restart</button>
        )}
        <button onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
};
