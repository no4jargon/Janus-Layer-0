import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clusterDot } from './lib/cluster-colors';
import {
  LOOKBACK_HOURS_OPTIONS,
  MAX_CLUSTER_TEXT_CHARS,
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

const fetchItemMessages = async (
  item: { sourceType: SourceType; id: string },
): Promise<
  Array<{
    sourceType: SourceType;
    timestampSec: number;
    sender: string;
    text: string;
  }>
> => {
  const api = window.workspaceApi;
  if (!api) return [];

  if (item.sourceType === 'whatsapp_chat') {
    const messages = (await api.whatsapp.getChat(item.id)) as WaThreadMessage[];
    return messages.map((message) => ({
      sourceType: 'whatsapp_chat' as const,
      timestampSec: Number(message.messageTimestamp || 0),
      sender: senderLabelWhatsapp(message),
      text: message.isDeleted ? '' : String(message.text || ''),
    }));
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

  const windowStartMs = Date.now() - lookbackHours * 60 * 60 * 1000;
  const settled = await Promise.all(
    clusterItems.map((item) => fetchItemMessages(item)),
  );
  const allMessages = settled
    .flat()
    .filter((message) => message.timestampSec > 0 && message.text)
    .filter((message) => message.timestampSec * 1000 >= windowStartMs)
    .sort((a, b) => a.timestampSec - b.timestampSec);

  if (!allMessages.length) {
    return { ok: false, reason: 'empty_window' };
  }

  let charsUsed = 0;
  let includedCount = 0;
  const lines: string[] = [];
  for (const message of allMessages) {
    const line = `[${new Date(message.timestampSec * 1000).toISOString()}] (${message.sourceType}) ${message.sender}: ${message.text}`;
    if (charsUsed + line.length + 1 > MAX_CLUSTER_TEXT_CHARS) break;
    lines.push(line);
    charsUsed += line.length + 1;
    includedCount += 1;
  }

  if (!lines.length) {
    return { ok: false, reason: 'token_budget' };
  }

  return {
    ok: true,
    cluster,
    promptText: lines.join('\n'),
    includedCount,
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
  const [selectedAllHours, setSelectedAllHours] = useState<number>(2);
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

      const result = await window.workspaceApi!.ai.extractWorkflow(
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
        await window.workspaceApi!.ai.saveOutput({
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
          selectedAllHours,
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
            const out = await window.workspaceApi!.ai.extractWorkflow(
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

      const collated = renderCollatedClusterOutput(results, selectedAllHours);
      setOutputAll(collated);

      const okCount = results.filter((r) => r.status === 'ok').length;
      const skippedCount = results.filter((r) => r.status === 'skipped').length;
      const failedCount = results.filter((r) => r.status === 'failed').length;
      setStatusAll(
        `Completed ${okCount} projects • Skipped ${skippedCount} (no new messages)${failedCount ? ` • Failed ${failedCount}` : ''}`,
      );

      try {
        await window.workspaceApi!.ai.saveOutput({
          clusterId: null,
          kind: 'workflow.all-clusters',
          inputSummary: `clusters=${sortedClusters.length} hours=${selectedAllHours}`,
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
      <div className="ai-status">{status}</div>
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
              <span>{selectedAllHours}h</span>
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
