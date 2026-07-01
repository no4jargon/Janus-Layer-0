import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildClusterPrompt, type CollatedMessage } from '@chai/ai-prompts';
import { clusterDot } from './lib/cluster-colors';
import {
  LOOKBACK_HOURS_OPTIONS,
  renderCollatedClusterOutput,
  type ClusterRunResult,
} from './lib/workflow-output';
import {
  clusterMapKey,
  formatTime,
  type ListItem,
  memberKeyToItem,
  type SourceType,
} from './lib/items';

type ClusterRecord = {
  id: string;
  name: string;
  color: string | null;
  memberCount: number;
};

type Props = {
  clusters: ClusterRecord[];
  clusterMap: Record<string, string>;
  whatsappChats: ListItem[];
  emailThreads: ListItem[];
  selectionCount: number;
  previousLastOpenedAt: number | null;
  onRefreshAll: () => Promise<void>;
  autoRunAllToken: number;
};

type AllHoursOption = number | 'since-last-opened';

const SINCE_LAST_OPENED_FALLBACK_HOURS = 24;

const computeSinceLastOpenedHours = (
  previousLastOpenedAt: number | null,
): number => {
  if (!previousLastOpenedAt) return SINCE_LAST_OPENED_FALLBACK_HOURS;
  const hours = (Date.now() - previousLastOpenedAt) / (60 * 60 * 1000);
  if (!Number.isFinite(hours) || hours <= 0) {
    return SINCE_LAST_OPENED_FALLBACK_HOURS;
  }
  return hours;
};

type WaThreadMessage = {
  messageKey: string;
  remoteJid: string;
  fromMe: boolean;
  participant: string | null;
  senderJid: string | null;
  senderName: string | null;
  isDeleted: boolean;
  text: string;
  messageTimestamp: number;
  replyToText: string | null;
  replyToSenderJid: string | null;
  replyToSenderName: string | null;
};

type EmailThreadMessage = {
  id: string;
  threadId: string;
  senderName: string | null;
  senderEmail: string;
  direction: 'incoming' | 'outgoing';
  bodyCleanText: string | null;
  sentAt: number;
};

const senderLabelWhatsapp = (message: WaThreadMessage): string => {
  if (message.fromMe) return 'You';
  return (
    message.senderName ||
    message.participant ||
    message.senderJid ||
    message.remoteJid
  );
};

const senderLabelEmail = (message: EmailThreadMessage): string => {
  if (message.direction === 'outgoing') {
    return `You (${message.senderEmail})`;
  }
  return message.senderName
    ? `${message.senderName} <${message.senderEmail}>`
    : message.senderEmail;
};

const MAX_QUOTED_PARENT_CHARS = 200;

const formatQuotedParent = (message: WaThreadMessage): string => {
  if (!message.replyToText) return '';
  const sender =
    message.replyToSenderName ||
    message.replyToSenderJid ||
    'Unknown';
  const trimmed = message.replyToText.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  const truncated =
    trimmed.length > MAX_QUOTED_PARENT_CHARS
      ? `${trimmed.slice(0, MAX_QUOTED_PARENT_CHARS - 1)}…`
      : trimmed;
  return `> ${sender}: ${truncated}\n`;
};

const fetchItemMessages = async (
  item: { sourceType: SourceType; id: string },
): Promise<CollatedMessage[]> => {
  const api = window.chaiApi;
  if (!api) return [];

  if (item.sourceType === 'whatsapp_chat') {
    const messages = (await api.whatsapp.getChat(item.id)) as WaThreadMessage[];
    return messages.map((message) => {
      const body = message.isDeleted ? '' : String(message.text || '');
      return {
        sourceType: 'whatsapp_chat' as const,
        timestampSec: Number(message.messageTimestamp || 0),
        sender: senderLabelWhatsapp(message),
        text: body ? `${formatQuotedParent(message)}${body}` : body,
      };
    });
  }

  const payload = await api.gmail.getThread(item.id);
  if (!payload) return [];
  return (payload.messages as EmailThreadMessage[]).map((message) => ({
    sourceType: 'email_thread' as const,
    timestampSec: Number(message.sentAt || 0),
    sender: senderLabelEmail(message),
    text: String(message.bodyCleanText || ''),
  }));
};

const collectClusterPromptPayload = async (
  cluster: ClusterRecord,
  lookbackHours: number,
  clusterItems: Array<{ sourceType: SourceType; id: string }>,
): Promise<
  | {
      ok: true;
      cluster: ClusterRecord;
      promptText: string;
      includedCount: number;
    }
  | { ok: false; reason: 'empty_cluster' | 'empty_window' | 'token_budget' }
> => {
  if (!clusterItems.length) {
    return { ok: false, reason: 'empty_cluster' };
  }

  const settled = await Promise.all(
    clusterItems.map((item) => fetchItemMessages(item)),
  );
  const result = buildClusterPrompt({
    messages: settled.flat(),
    lookbackHours,
  });
  if (!result.ok) return result;

  return {
    ok: true,
    cluster,
    promptText: result.promptText,
    includedCount: result.includedCount,
  };
};

const itemsForCluster = (
  clusterId: string,
  clusterMap: Record<string, string>,
): Array<{ sourceType: SourceType; id: string }> => {
  const out: Array<{ sourceType: SourceType; id: string }> = [];
  for (const [key, mappedId] of Object.entries(clusterMap)) {
    if (mappedId !== clusterId) continue;
    const item = memberKeyToItem(key);
    if (item) out.push(item);
  }
  return out;
};

export const AiPanel = ({
  clusters,
  clusterMap,
  whatsappChats: _whatsappChats,
  emailThreads: _emailThreads,
  selectionCount,
  previousLastOpenedAt,
  onRefreshAll,
  autoRunAllToken,
}: Props) => {
  void _whatsappChats;
  void _emailThreads;
  void clusterMapKey;
  void formatTime;

  const sortedClusters = useMemo(
    () => [...clusters].sort((a, b) => a.name.localeCompare(b.name)),
    [clusters],
  );

  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(
    null,
  );
  const [selectedHours, setSelectedHours] = useState<number>(2);
  const [selectedAllHours, setSelectedAllHours] = useState<AllHoursOption>(2);
  const [clusterMenuOpen, setClusterMenuOpen] = useState(false);
  const [hoursMenuOpen, setHoursMenuOpen] = useState(false);
  const [allHoursMenuOpen, setAllHoursMenuOpen] = useState(false);
  const [output, setOutput] = useState('Workflow insights will appear here');
  const [outputAll, setOutputAll] = useState(
    'Color coded collated output will appear here',
  );
  const [status, setStatus] = useState(
    'Choose a project and time window, then click.',
  );
  const [statusAll, setStatusAll] = useState(
    'Run all projects to generate collated insights.',
  );
  const [busy, setBusy] = useState(false);
  const [busyAll, setBusyAll] = useState(false);
  const [progress, setProgress] = useState<{
    visible: boolean;
    completed: number;
    total: number;
    label: string;
  }>({ visible: false, completed: 0, total: 0, label: 'Processing projects…' });

  const containerRef = useRef<HTMLElement | null>(null);
  const runForAllRef = useRef<() => Promise<void>>(async () => {});
  const [modelDownload, setModelDownload] = useState<{
    transferredBytes: number;
    totalBytes: number;
  } | null>(null);

  useEffect(() => {
    const api = window.chaiApi;
    if (!api) return;
    return api.events.onModelDownload((status) => {
      setModelDownload(status);
      if (status.totalBytes > 0 && status.transferredBytes >= status.totalBytes) {
        setTimeout(() => setModelDownload(null), 500);
      }
    });
  }, []);

  const downloadStatusText = useMemo(() => {
    if (!modelDownload || modelDownload.totalBytes <= 0) return null;
    const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
    const pct = Math.round(
      (modelDownload.transferredBytes / modelDownload.totalBytes) * 100,
    );
    return `Downloading default model (Gemma 3 4B): ${mb(
      modelDownload.transferredBytes,
    )} / ${mb(modelDownload.totalBytes)} MB (${pct}%)`;
  }, [modelDownload]);

  useEffect(() => {
    if (selectedClusterId && sortedClusters.some((c) => c.id === selectedClusterId)) {
      return;
    }
    setSelectedClusterId(sortedClusters[0]?.id ?? null);
  }, [sortedClusters, selectedClusterId]);

  const closeAllMenus = useCallback(() => {
    setClusterMenuOpen(false);
    setHoursMenuOpen(false);
    setAllHoursMenuOpen(false);
  }, []);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.target as Node)) return;
      closeAllMenus();
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [closeAllMenus]);

  const selectedCluster = useMemo(
    () =>
      selectedClusterId
        ? sortedClusters.find((c) => c.id === selectedClusterId) || null
        : null,
    [selectedClusterId, sortedClusters],
  );

  const canRun = sortedClusters.length > 0 && !busy && !busyAll;

  const runForCluster = async () => {
    if (!selectedCluster) {
      setStatus('Create at least one cluster first.');
      return;
    }
    closeAllMenus();
    setBusy(true);
    setOutput('');
    setStatus(
      `Running on ${(selectedCluster.name || '').trim() || 'Unnamed'}...`,
    );

    try {
      const items = itemsForCluster(selectedCluster.id, clusterMap);
      const payload = await collectClusterPromptPayload(
        selectedCluster,
        selectedHours,
        items,
      );
      if (!payload.ok) {
        if (payload.reason === 'empty_cluster' || payload.reason === 'empty_window') {
          setStatus('No new messages in the selected window.');
          setOutput('Messages included: 0');
        } else {
          setStatus('Message payload exceeds token budget.');
          setOutput('Messages included: 0');
        }
        return;
      }

      const result = await window.chaiApi!.ai.extractWorkflow(
        payload.promptText,
      );
      const summary = [
        `Messages included: ${payload.includedCount}`,
        '',
        result,
      ].join('\n');
      setOutput(summary);
      setStatus('Cluster extraction complete.');

      try {
        await window.chaiApi!.ai.saveOutput({
          clusterId: selectedCluster.id,
          kind: 'workflow.cluster',
          inputSummary: `messages=${payload.includedCount} hours=${selectedHours}`,
          outputText: summary,
        });
      } catch {
        /* persistence is best-effort */
      }
    } catch (error) {
      setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const runForAll = async () => {
    if (!sortedClusters.length) {
      setStatusAll('Create at least one cluster first.');
      return;
    }
    closeAllMenus();
    setBusyAll(true);

    const isSinceLastOpened = selectedAllHours === 'since-last-opened';
    const effectiveLookbackHours = isSinceLastOpened
      ? computeSinceLastOpenedHours(previousLastOpenedAt)
      : selectedAllHours;

    if (isSinceLastOpened) {
      setStatusAll('Refreshing connectors before extraction…');
      setOutputAll('Refreshing connectors and reloading data…');
      try {
        await onRefreshAll();
      } catch (error) {
        // Refresh failures are non-fatal; we still attempt the run on cached data.
        setStatusAll(
          `Refresh failed (${error instanceof Error ? error.message : String(error)}); running on cached data…`,
        );
      }
    }

    setOutputAll('Running extraction across all projects...');
    setStatusAll('Starting all-project extraction...');
    setProgress({
      visible: true,
      completed: 0,
      total: sortedClusters.length,
      label: 'Processing projects…',
    });

    const results: ClusterRunResult[] = [];
    try {
      for (const [index, cluster] of sortedClusters.entries()) {
        setStatusAll(`Running ${index + 1} of ${sortedClusters.length}: ${cluster.name}`);
        const items = itemsForCluster(cluster.id, clusterMap);
        const payload = await collectClusterPromptPayload(
          cluster,
          effectiveLookbackHours,
          items,
        );
        if (!payload.ok) {
          const skipped =
            payload.reason === 'empty_cluster' || payload.reason === 'empty_window';
          results.push({
            cluster: { id: cluster.id, name: cluster.name },
            output: '',
            status: skipped ? 'skipped' : 'failed',
            error: skipped ? null : payload.reason,
          });
        } else {
          try {
            const out = await window.chaiApi!.ai.extractWorkflow(
              payload.promptText,
            );
            results.push({
              cluster: { id: cluster.id, name: cluster.name },
              output: out,
              status: 'ok',
              error: null,
            });
          } catch (error) {
            results.push({
              cluster: { id: cluster.id, name: cluster.name },
              output: '',
              status: 'failed',
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        setProgress((prev) => ({ ...prev, completed: index + 1 }));
      }

      const collated = renderCollatedClusterOutput(
        results,
        effectiveLookbackHours,
      );
      setOutputAll(collated);

      const okCount = results.filter((r) => r.status === 'ok').length;
      const skippedCount = results.filter((r) => r.status === 'skipped').length;
      const failedCount = results.filter((r) => r.status === 'failed').length;
      setStatusAll(
        `Completed ${okCount} projects • Skipped ${skippedCount} (no new messages)${failedCount ? ` • Failed ${failedCount}` : ''}`,
      );

      try {
        const hoursSummary = isSinceLastOpened
          ? `since-last-opened(${effectiveLookbackHours.toFixed(2)}h)`
          : `${effectiveLookbackHours}h`;
        await window.chaiApi!.ai.saveOutput({
          clusterId: null,
          kind: 'workflow.all-clusters',
          inputSummary: `clusters=${sortedClusters.length} hours=${hoursSummary}`,
          outputText: collated,
        });
      } catch {
        /* persistence best-effort */
      }
    } finally {
      setTimeout(
        () => setProgress((prev) => ({ ...prev, visible: false })),
        800,
      );
      setBusyAll(false);
    }
  };

  useEffect(() => {
    runForAllRef.current = runForAll;
  });

  useEffect(() => {
    if (autoRunAllToken <= 0) return;
    void runForAllRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunAllToken]);

  return (
    <aside ref={containerRef} className="ai-panel open">
      <div className="ai-header">
        <h3>Insights Extraction</h3>
      </div>
      <div className="ai-selection-meta">
        {selectionCount
          ? `${selectionCount} message${selectionCount > 1 ? 's' : ''} selected (thread selection)`
          : 'Insights are based on your selected project and time window.'}
      </div>

      <div className="ai-cluster-run">
        <div className="ai-cluster-action">
          <button
            type="button"
            className={`ai-btn ai-run-cluster-btn${canRun ? '' : ' is-disabled'}`}
            disabled={!canRun}
            onClick={(event) => {
              event.stopPropagation();
              if (!canRun) return;
              if (
                event.target instanceof HTMLElement &&
                event.target.closest('[data-role="cluster-picker"], [data-role="hours-picker"]')
              ) {
                return;
              }
              void runForCluster();
            }}
          >
            <span>For</span>
            <span
              className="ai-cluster-picker"
              data-role="cluster-picker"
              role="button"
              aria-haspopup="menu"
              aria-expanded={clusterMenuOpen}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setHoursMenuOpen(false);
                setAllHoursMenuOpen(false);
                setClusterMenuOpen((open) => !open);
              }}
            >
              <span>
                {selectedCluster
                  ? `${clusterDot(selectedCluster.color)} ${(
                      selectedCluster.name || ''
                    ).trim() || 'Unnamed'}`
                  : '—'}
              </span>
              <span className="ai-cluster-caret">▾</span>
            </span>
            <span className="ai-run-between">over the last</span>
            <span
              className="ai-cluster-picker"
              data-role="hours-picker"
              role="button"
              aria-haspopup="menu"
              aria-expanded={hoursMenuOpen}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setClusterMenuOpen(false);
                setAllHoursMenuOpen(false);
                setHoursMenuOpen((open) => !open);
              }}
            >
              <span>{selectedHours}h</span>
              <span className="ai-cluster-caret">▾</span>
            </span>
          </button>

          {clusterMenuOpen ? (
            <div className="ai-cluster-menu">
              {sortedClusters.length === 0 ? (
                <div className="ai-cluster-option">No clusters yet.</div>
              ) : (
                sortedClusters.map((cluster) => (
                  <button
                    key={cluster.id}
                    type="button"
                    className="ai-cluster-option"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedClusterId(cluster.id);
                      setClusterMenuOpen(false);
                    }}
                  >
                    {clusterDot(cluster.color)}{' '}
                    {(cluster.name || '').trim() || 'Unnamed'}
                  </button>
                ))
              )}
            </div>
          ) : null}

          {hoursMenuOpen ? (
            <div className="ai-cluster-menu">
              {LOOKBACK_HOURS_OPTIONS.map((hour) => (
                <button
                  key={hour}
                  type="button"
                  className="ai-cluster-option"
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedHours(hour);
                    setHoursMenuOpen(false);
                  }}
                >
                  {hour}h
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="ai-status">{downloadStatusText ?? status}</div>
      <textarea
        className="ai-output-box"
        rows={7}
        value={output}
        onChange={(event) => setOutput(event.target.value)}
      />

      <div className="ai-cluster-run">
        <div className="ai-cluster-action">
          <button
            type="button"
            className={`ai-btn ai-run-cluster-btn${canRun ? '' : ' is-disabled'}`}
            disabled={!canRun}
            onClick={(event) => {
              event.stopPropagation();
              if (!canRun) return;
              if (
                event.target instanceof HTMLElement &&
                event.target.closest('[data-role="all-hours-picker"]')
              ) {
                return;
              }
              void runForAll();
            }}
          >
            <span>For all projects over the last</span>
            <span
              className="ai-cluster-picker"
              data-role="all-hours-picker"
              role="button"
              aria-haspopup="menu"
              aria-expanded={allHoursMenuOpen}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setClusterMenuOpen(false);
                setHoursMenuOpen(false);
                setAllHoursMenuOpen((open) => !open);
              }}
            >
              <span>
                {selectedAllHours === 'since-last-opened'
                  ? 'since last opened'
                  : `${selectedAllHours}h`}
              </span>
              <span className="ai-cluster-caret">▾</span>
            </span>
          </button>

          {allHoursMenuOpen ? (
            <div className="ai-cluster-menu">
              {LOOKBACK_HOURS_OPTIONS.map((hour) => (
                <button
                  key={hour}
                  type="button"
                  className="ai-cluster-option"
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedAllHours(hour);
                    setAllHoursMenuOpen(false);
                  }}
                >
                  {hour}h
                </button>
              ))}
              <button
                key="since-last-opened"
                type="button"
                className="ai-cluster-option"
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedAllHours('since-last-opened');
                  setAllHoursMenuOpen(false);
                }}
              >
                since last opened
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <div className="ai-status">{statusAll}</div>
      {progress.visible ? (
        <div className="ai-progress">
          <div className="ai-progress-top">
            <span>{progress.label}</span>
            <span>
              {progress.completed} out of {progress.total}
            </span>
          </div>
          <div className="ai-progress-bar">
            <div
              className="ai-progress-fill"
              style={{
                width:
                  progress.total > 0
                    ? `${Math.round((progress.completed / progress.total) * 100)}%`
                    : '0%',
              }}
            />
          </div>
        </div>
      ) : null}
      <textarea
        className="ai-output-box"
        rows={7}
        value={outputAll}
        onChange={(event) => setOutputAll(event.target.value)}
      />
    </aside>
  );
};
