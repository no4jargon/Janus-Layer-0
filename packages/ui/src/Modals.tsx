import { useState } from 'react';

const isValidHHMM = (value: string): boolean =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

type FreemiumBannerProps = {
  onUpgradeClick: () => void;
  onDismiss: () => void;
};

export const FreemiumBanner = ({
  onUpgradeClick,
  onDismiss,
}: FreemiumBannerProps) => {
  return (
    <div className="freemium-banner">
      <button
        className="freemium-banner-body"
        onClick={onUpgradeClick}
        aria-label="Learn about cross-platform sync"
      >
        <span className="freemium-banner-icon" aria-hidden="true">
          📱
        </span>
        <span>
          <strong>Want this sexy view on your phone?</strong>{' '}
          <span className="freemium-banner-cta">Click here →</span>
        </span>
      </button>
      <button
        className="freemium-banner-close"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
};

type FreemiumModalProps = {
  onClose: () => void;
};

export const FreemiumModal = ({ onClose }: FreemiumModalProps) => {
  const [interestStatus, setInterestStatus] = useState<string | null>(null);

  return (
    <div
      className="modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal-card freemium-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Cross-platform sync"
      >
        <div className="modal-title-row">
          <h3>Chai on your phone</h3>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="freemium-modal-body">
          <p>
            Get the same workspace on your phone. We&rsquo;ll host a dedicated
            server that syncs your laptop and mobile so you can pick up where
            you left off — anywhere.
          </p>
          <ul>
            <li>
              <strong>End-to-end encrypted.</strong> All chats on the sync
              server are encrypted with keys only your devices hold. We
              can&rsquo;t read them.
            </li>
            <li>
              <strong>Per-user dedicated server.</strong> Your data is not
              co-tenanted with anyone else&rsquo;s.
            </li>
            <li>
              <strong>One subscription, all your devices.</strong>
            </li>
          </ul>
          <div className="freemium-price">
            <span className="freemium-price-amount">₹200</span>
            <span className="freemium-price-period">/ month</span>
          </div>
          <div className="settings-row">
            <button
              className="composer-send-btn"
              disabled={interestStatus !== null}
              onClick={() =>
                setInterestStatus(
                  "Got it — we'll email you when sync goes live.",
                )
              }
            >
              {interestStatus ? 'Thanks!' : 'Notify me when this is ready'}
            </button>
          </div>
          {interestStatus ? (
            <p className="settings-hint">{interestStatus}</p>
          ) : null}
          <p className="settings-hint" style={{ marginTop: 12 }}>
            This feature is on the roadmap. Until then, your data stays
            local-only on this device.
          </p>
        </div>
      </div>
    </div>
  );
};

type TutorialStep = {
  title: string;
  emoji: string;
  body: string;
  highlight?: string;
  kind?: 'work-start-time';
};

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: 'Welcome to Chai',
    emoji: '👋',
    body: 'A desktop-first, local workspace for the chats and threads you actually work in. Let’s get you set up — takes about a minute.',
  },
  {
    title: 'When do you start your day?',
    emoji: '⏰',
    body: 'We’ll quietly refresh your messages and run a fresh project-insights pass five minutes before this time, so the moment you sit down everything is up to date.',
    kind: 'work-start-time',
  },
  {
    title: 'Connect WhatsApp',
    emoji: '💬',
    body: 'Click the WhatsApp tab in the sidebar, then "Connect WhatsApp." Scan the QR code with your phone (the same way WhatsApp Web pairs). Your chats start syncing into this app — fully local, never sent to a server.',
    highlight: 'Sidebar → WhatsApp tab → Connect WhatsApp',
  },
  {
    title: 'Connect Gmail',
    emoji: '📧',
    body: 'Switch to the Email tab and click "Connect Gmail." Sign in with Google in your browser. Your inbox arrives in the same workspace, alongside your WhatsApp conversations.',
    highlight: 'Sidebar → Email tab → Connect Gmail',
  },
  {
    title: 'Group conversations into Clusters',
    emoji: '🎯',
    body: 'Cmd-click (or Ctrl-click) any chats and email threads that belong to the same project, then hit "Create Cluster." A cluster is a colored project bucket that spans both messaging channels.',
    highlight: 'Cmd/Ctrl-click items → Create Cluster',
  },
  {
    title: 'Get AI insights from your projects',
    emoji: '🧠',
    body: 'Open the AI panel on the right. Pick a cluster and a time window, then click — Chai reads through every message in that window and extracts todos, deadlines, assignments, and updates. All inference runs locally; nothing leaves your device.',
    highlight: 'AI panel (right side) → Pick project → Run',
  },
];

type TutorialModalProps = {
  defaultWorkStartTime: string | null;
  onComplete: (payload: { workStartTime: string }) => void | Promise<void>;
};

export const TutorialModal = ({
  defaultWorkStartTime,
  onComplete,
}: TutorialModalProps) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [workStartTime, setWorkStartTime] = useState<string>(
    defaultWorkStartTime && isValidHHMM(defaultWorkStartTime)
      ? defaultWorkStartTime
      : '09:00',
  );
  const [timeError, setTimeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const step = TUTORIAL_STEPS[stepIndex];
  const isLast = stepIndex === TUTORIAL_STEPS.length - 1;

  const advance = async () => {
    if (step.kind === 'work-start-time' && !isValidHHMM(workStartTime)) {
      setTimeError('Enter a valid time in HH:MM format.');
      return;
    }
    setTimeError(null);
    if (isLast) {
      setBusy(true);
      try {
        await onComplete({ workStartTime });
      } finally {
        setBusy(false);
      }
    } else {
      setStepIndex((i) => i + 1);
    }
  };

  return (
    <div className="modal-overlay">
      <div
        className="modal-card tutorial-card"
        role="dialog"
        aria-modal="true"
        aria-label="Getting started"
      >
        <div className="tutorial-progress">
          {TUTORIAL_STEPS.map((_, idx) => (
            <span
              key={idx}
              className={`tutorial-progress-dot${idx === stepIndex ? ' active' : ''}${idx < stepIndex ? ' done' : ''}`}
            />
          ))}
        </div>
        <div className="tutorial-emoji" aria-hidden="true">
          {step.emoji}
        </div>
        <h3 className="tutorial-title">{step.title}</h3>
        <p className="tutorial-body">{step.body}</p>
        {step.kind === 'work-start-time' ? (
          <div className="tutorial-input-row">
            <label
              htmlFor="tutorial-work-start"
              className="tutorial-input-label"
            >
              Start time
            </label>
            <input
              id="tutorial-work-start"
              type="time"
              className="tutorial-time-input"
              value={workStartTime}
              onChange={(event) => {
                setWorkStartTime(event.target.value);
                setTimeError(null);
              }}
            />
          </div>
        ) : null}
        {step.highlight ? (
          <div className="tutorial-highlight">{step.highlight}</div>
        ) : null}
        {timeError ? (
          <div className="tutorial-error" role="alert">
            {timeError}
          </div>
        ) : null}
        <div className="tutorial-actions">
          <div className="tutorial-nav">
            {stepIndex > 0 ? (
              <button
                onClick={() => setStepIndex((i) => i - 1)}
                type="button"
                disabled={busy}
              >
                Back
              </button>
            ) : null}
            <button
              className="composer-send-btn"
              onClick={() => void advance()}
              type="button"
              disabled={busy}
            >
              {busy ? 'Saving…' : isLast ? 'Get started' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
