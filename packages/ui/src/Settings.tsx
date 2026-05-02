import { useEffect, useState } from 'react';

type Snapshot = Awaited<
  ReturnType<NonNullable<typeof window.workspaceApi>['getRuntimeState']>
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
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState(
    snapshot.settings.ollamaBaseUrl ?? '',
  );
  const [ollamaModel, setOllamaModel] = useState(
    snapshot.settings.ollamaModel ?? '',
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [diagnosticsResult, setDiagnosticsResult] = useState<string | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateResult, setUpdateResult] = useState<string | null>(null);

  useEffect(() => {
    setOllamaBaseUrl(snapshot.settings.ollamaBaseUrl ?? '');
    setOllamaModel(snapshot.settings.ollamaModel ?? '');
  }, [snapshot.settings.ollamaBaseUrl, snapshot.settings.ollamaModel]);

  const cycleTheme = async () => {
    if (!window.workspaceApi) return;
    try {
      await window.workspaceApi.updateSettings({
        theme: themeNext(snapshot.settings.theme),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const exportDiagnostics = async () => {
    if (!window.workspaceApi) return;
    setDiagnosticsBusy(true);
    setDiagnosticsResult(null);
    setError(null);
    try {
      const result = await window.workspaceApi.diagnostics.export();
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
    if (!window.workspaceApi) return;
    setUpdateBusy(true);
    setUpdateResult(null);
    setError(null);
    try {
      const result = await window.workspaceApi.update.check();
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

  const saveOllama = async () => {
    if (!window.workspaceApi) return;
    setSaving(true);
    setError(null);
    try {
      await window.workspaceApi.updateSettings({
        ollamaBaseUrl: ollamaBaseUrl.trim() || null,
        ollamaModel: ollamaModel.trim() || null,
      });
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
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
            <h4>Local AI (Ollama)</h4>
            <p className="settings-hint">
              Workflow extraction runs against a local Ollama instance. Leave
              blank to use defaults (<code>http://127.0.0.1:11434</code> /{' '}
              <code>llama3:8b</code>) or env vars.
            </p>
            <label className="settings-field">
              <span>Base URL</span>
              <input
                type="text"
                placeholder="http://127.0.0.1:11434"
                value={ollamaBaseUrl}
                onChange={(event) => setOllamaBaseUrl(event.target.value)}
              />
            </label>
            <label className="settings-field">
              <span>Model</span>
              <input
                type="text"
                placeholder="llama3:8b"
                value={ollamaModel}
                onChange={(event) => setOllamaModel(event.target.value)}
              />
            </label>
            <div className="settings-row">
              <button onClick={() => void saveOllama()} disabled={saving}>
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
              <code>WORKSPACE_UPDATE_FEED_URL</code>). Beta channel only for
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

type OnboardingProps = {
  onDone: () => void;
};

export const OnboardingModal = ({ onDone }: OnboardingProps) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = async () => {
    if (!window.workspaceApi) return;
    setBusy(true);
    setError(null);
    try {
      await window.workspaceApi.updateSettings({ onboardingCompleted: true });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div
        className="modal-card onboarding-card"
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-title-row">
          <h3>Welcome to Workspace App</h3>
        </div>
        <div className="settings-body">
          <p>
            A desktop-first, local-first workspace for your WhatsApp and Gmail
            conversations.
          </p>
          <ul>
            <li>Connect Gmail and WhatsApp from the sidebar.</li>
            <li>
              Group chats and threads into project clusters with Cmd-click in the
              list.
            </li>
            <li>
              Run local AI insights against your selected cluster and time
              window.
            </li>
            <li>
              Your messages live on this device only. Nothing is stored on our
              servers.
            </li>
          </ul>
          <p className="settings-hint">
            You can change theme, AI model, and review storage paths anytime
            from the Settings button (top of the sidebar).
          </p>
          {error ? <p className="error">{error}</p> : null}
          <div className="settings-row">
            <button onClick={() => void finish()} disabled={busy}>
              {busy ? 'Setting up…' : 'Get started'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
