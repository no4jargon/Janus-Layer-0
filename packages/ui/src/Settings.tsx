import { useEffect, useState } from 'react';

type Snapshot = Awaited<
  ReturnType<NonNullable<typeof window.janusApi>['getRuntimeState']>
>;

type Props = {
  snapshot: Snapshot;
  onClose: () => void;
};

const themeNext = (
  current: Snapshot['settings']['theme'],
): Snapshot['settings']['theme'] => {
  if (current === 'system') return 'dark';
  if (current === 'dark') return 'light';
  return 'system';
};

export const SettingsModal = ({ snapshot, onClose }: Props) => {
  const [llmModelPath, setLlmModelPath] = useState(
    snapshot.settings.llmModelPath ?? '',
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [diagnosticsResult, setDiagnosticsResult] = useState<string | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateResult, setUpdateResult] = useState<string | null>(null);

  useEffect(() => {
    setLlmModelPath(snapshot.settings.llmModelPath ?? '');
  }, [snapshot.settings.llmModelPath]);

  const cycleTheme = async () => {
    if (!window.janusApi) return;
    try {
      await window.janusApi.updateSettings({
        theme: themeNext(snapshot.settings.theme),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const exportDiagnostics = async () => {
    if (!window.janusApi) return;
    setDiagnosticsBusy(true);
    setDiagnosticsResult(null);
    setError(null);
    try {
      const result = await window.janusApi.diagnostics.export();
      if (result.saved) {
        setDiagnosticsResult(`Saved to ${result.savedPath}`);
      } else {
        setDiagnosticsResult('Cancelled.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDiagnosticsBusy(false);
    }
  };

  const checkForUpdates = async () => {
    if (!window.janusApi) return;
    setUpdateBusy(true);
    setUpdateResult(null);
    setError(null);
    try {
      const result = await window.janusApi.update.check();
      if (result.kind === 'unconfigured') {
        setUpdateResult(result.message);
      } else if (result.kind === 'error') {
        setUpdateResult(`Error: ${result.message}`);
      } else if (result.kind === 'up-to-date') {
        setUpdateResult(
          `Up to date (${result.currentVersion} on ${result.channel}).`,
        );
      } else if (result.kind === 'optional') {
        setUpdateResult(
          `Optional update available: ${result.latestVersion} (current ${result.currentVersion}).`,
        );
      } else if (result.kind === 'required') {
        setUpdateResult(
          `Required update: ${result.latestVersion}. Min supported ${result.minSupportedVersion}, current ${result.currentVersion}.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdateBusy(false);
    }
  };

  const saveLocalAi = async () => {
    if (!window.janusApi) return;
    setSaving(true);
    setError(null);
    try {
      await window.janusApi.updateSettings({
        llmModelPath: llmModelPath.trim() || null,
      });
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const chooseModelFile = async () => {
    if (!window.janusApi) return;
    setError(null);
    try {
      const result = await window.janusApi.ai.chooseModelFile();
      if (result.canceled) return;
      setLlmModelPath(result.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal-card settings-card"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <div className="modal-title-row">
          <h3>Settings</h3>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="settings-body">
          <section className="settings-section">
            <h4>Appearance</h4>
            <div className="settings-row">
              <span>Theme</span>
              <button onClick={() => void cycleTheme()}>
                {snapshot.settings.theme} (cycle)
              </button>
            </div>
          </section>

          <section className="settings-section">
            <h4>Local AI (llama.cpp)</h4>
            <p className="settings-hint">
              Workflow extraction runs in-process via llama.cpp. Leave blank
              to use the bundled default —{' '}
              <strong>Gemma 3 4B Instruct</strong> (Q4_K_M, ~2.5GB) — which
              is auto-downloaded on first use. Override with a path to your
              own <code>.gguf</code> if you prefer a different model. The
              model loads on first use and stays resident until you change
              it or quit.
            </p>
            <label className="settings-field">
              <span>Model file</span>
              <input
                type="text"
                placeholder="/path/to/model.gguf"
                value={llmModelPath}
                onChange={(event) => setLlmModelPath(event.target.value)}
              />
            </label>
            <div className="settings-row">
              <button onClick={() => void chooseModelFile()}>Browse…</button>
              <button onClick={() => void saveLocalAi()} disabled={saving}>
                {saving ? 'Saving…' : 'Save AI settings'}
              </button>
              {savedAt ? (
                <span className="settings-hint">Saved at {savedAt}</span>
              ) : null}
            </div>
          </section>

          <section className="settings-section">
            <h4>Connectors</h4>
            <ul className="settings-list">
              {snapshot.connectors.map((connector) => (
                <li key={connector.connector}>
                  <strong>{connector.connector.toUpperCase()}</strong> ·{' '}
                  {connector.status}
                  {connector.lastSyncedAt
                    ? ` · last sync ${new Date(connector.lastSyncedAt).toLocaleTimeString()}`
                    : ''}
                  {connector.lastError ? (
                    <div className="settings-hint error">
                      {connector.lastError}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <section className="settings-section">
            <h4>Storage</h4>
            <ul className="settings-list">
              <li>
                <strong>App version:</strong> {snapshot.appVersion}
              </li>
              <li>
                <strong>Mode:</strong> {snapshot.mode}
              </li>
              <li>
                <strong>Data root:</strong>{' '}
                <code className="path">{snapshot.paths.baseDir}</code>
              </li>
              <li>
                <strong>Database:</strong>{' '}
                <code className="path">{snapshot.paths.dbPath}</code>
              </li>
              <li>
                <strong>Logs:</strong>{' '}
                <code className="path">{snapshot.paths.logsDir}</code>
              </li>
            </ul>
          </section>

          <section className="settings-section">
            <h4>Diagnostics</h4>
            <p className="settings-hint">
              Exports a JSON bundle (app version, applied migrations, connector
              statuses, recent log lines, backup file list) to share when
              reporting issues. Tokens and message bodies are not included.
            </p>
            <div className="settings-row">
              <button
                onClick={() => void exportDiagnostics()}
                disabled={diagnosticsBusy}
              >
                {diagnosticsBusy ? 'Exporting…' : 'Export diagnostics'}
              </button>
              {diagnosticsResult ? (
                <span className="settings-hint">{diagnosticsResult}</span>
              ) : null}
            </div>
          </section>

          <section className="settings-section">
            <h4>Updates</h4>
            <p className="settings-hint">
              Checks the GitHub Releases update feed (override with{' '}
              <code>JANUS_UPDATE_FEED_URL</code>). Beta channel only for
              now. Required updates block usage if the local version is below
              the minimum supported version.
            </p>
            <div className="settings-row">
              <button
                onClick={() => void checkForUpdates()}
                disabled={updateBusy}
              >
                {updateBusy ? 'Checking…' : 'Check for updates'}
              </button>
              {updateResult ? (
                <span className="settings-hint">{updateResult}</span>
              ) : null}
            </div>
          </section>

          {error ? <p className="error">{error}</p> : null}
        </div>
      </div>
    </div>
  );
};

