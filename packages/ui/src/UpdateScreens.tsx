type RequiredInfo = Extract<UpdateCheckResult, { kind: 'required' }>;

type Props = {
  info: RequiredInfo;
};

export const RequiredUpdateScreen = ({ info }: Props) => {
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

      {info.downloadUrl ? (
        <div className="settings-row" style={{ marginTop: 16 }}>
          <a
            className="button-link"
            href={info.downloadUrl}
            target="_blank"
            rel="noreferrer"
          >
            Download installer from GitHub
          </a>
        </div>
      ) : null}

      <p className="settings-hint" style={{ marginTop: 16 }}>
        Download the new installer, install it over this app, and relaunch.
      </p>
    </div>
  );
};

type OptionalProps = {
  info: Extract<UpdateCheckResult, { kind: 'optional' }>;
  onDismiss: () => void;
};

export const OptionalUpdateBanner = ({ info, onDismiss }: OptionalProps) => {
  return (
    <div className="optional-update-banner">
      <div>
        <strong>Update available:</strong> {info.latestVersion} (you're on{' '}
        {info.currentVersion}).
      </div>
      <div className="optional-update-actions">
        {info.downloadUrl ? (
          <a
            className="button-link"
            href={info.downloadUrl}
            target="_blank"
            rel="noreferrer"
          >
            Download
          </a>
        ) : null}
        <button onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
};
