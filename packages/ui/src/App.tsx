import { useEffect, useState } from 'react';
import { Workspace } from './Workspace';
import { RequiredUpdateScreen } from './UpdateScreens';
import { useRuntimeSnapshot } from './lib/use-runtime';

const MigrationFailureScreen = ({
  failure,
}: {
  failure: NonNullable<
    Awaited<
      ReturnType<NonNullable<typeof window.janusApi>['getRuntimeState']>
    >['migrationFailure']
  >;
}) => {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onRetry = async () => {
    if (!window.janusApi) return;
    setRetrying(true);
    setError(null);
    try {
      await window.janusApi.migration.retry();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="migration-failure-shell">
      <h1>Database update needed</h1>
      <p>
        A required database migration could not be applied automatically. Your
        data has been backed up before the change was attempted.
      </p>
      <ul>
        <li>
          <strong>Failed migration:</strong> {failure.failedMigration}
        </li>
        <li>
          <strong>Error:</strong> {failure.message}
        </li>
        {failure.backupPath ? (
          <li>
            <strong>Backup file:</strong> <pre>{failure.backupPath}</pre>
          </li>
        ) : null}
      </ul>
      <button onClick={() => void onRetry()} disabled={retrying}>
        {retrying ? 'Retrying...' : 'Retry migration'}
      </button>
      {error ? (
        <p className="error" style={{ marginTop: 12 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
};

const Loading = () => (
  <div style={{ padding: 24, color: '#475569' }}>Loading workspace…</div>
);

export const App = () => {
  const [snapshot] = useRuntimeSnapshot();
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);

  useEffect(() => {
    if (!window.janusApi) return;

    void window.janusApi.update.lastInfo().then((value) => {
      if (value) setUpdateInfo(value);
    });

    return window.janusApi.events.onUpdateEvent((event) => {
      if (event.kind === 'check-result') {
        setUpdateInfo(event.info);
      }
    });
  }, []);

  if (!snapshot) return <Loading />;
  if (snapshot.migrationFailure) {
    return <MigrationFailureScreen failure={snapshot.migrationFailure} />;
  }
  if (updateInfo && updateInfo.kind === 'required') {
    return <RequiredUpdateScreen info={updateInfo} />;
  }

  return <Workspace snapshot={snapshot} updateInfo={updateInfo} />;
};
