import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { AiPanel } from './AiPanel';
import { SettingsModal } from './Settings';
import { OptionalUpdateBanner, PrivacyBanner } from './UpdateScreens';
import { FreemiumBanner, FreemiumModal, TutorialModal } from './Modals';
import {
  CLUSTER_COLORS,
  clusterDot,
  getClusterColor,
  randomClusterColorId,
} from './lib/cluster-colors';
import { avatarInitials, avatarStyle } from './lib/avatar';
import {
  formatTime,
  itemKey,
  SOURCE_BADGES,
  sourceFromItem,
  clusterMapKey,
  memberKeyToItem,
  type ListItem,
  type SourceType,
} from './lib/items';
import { buildClientRequestId } from './lib/workflow-output';
import { useConnectorEvents, useWhatsAppEvents } from './lib/use-runtime';

type Snapshot = Awaited<
  ReturnType<NonNullable<typeof window.chaiApi>['getRuntimeState']>
>;

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
  __kind: 'whatsapp';
};

type EmailAttachment = {
  id: string;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
};

type EmailThreadMessage = {
  id: string;
  threadId: string;
  senderName: string | null;
  senderEmail: string;
  toJson: string;
  ccJson: string;
  direction: 'incoming' | 'outgoing';
  bodyCleanText: string | null;
  hasAttachments: 0 | 1;
  attachments?: EmailAttachment[];
  sentAt: number;
  __kind: 'email';
};

type ThreadMessage = WaThreadMessage | EmailThreadMessage;

type ClusterRecord = {
  id: string;
  name: string;
  color: string | null;
  createdAt: number;
  updatedAt: number;
  memberCount: number;
};

type EmailSyncState = {
  connected: boolean;
  emailAddress: string | null;
  status: 'idle' | 'syncing' | 'error';
  lastError: string | null;
  lastSyncAt: number | null;
};

type ActiveThread = { sourceType: SourceType; id: string } | null;

type ComposerStatus = { text: string; isError: boolean };

const COMING_SOON_CHANNELS = ['Slack', 'Teams', 'Discord', 'Telegram'] as const;
type ComingSoonChannel = (typeof COMING_SOON_CHANNELS)[number];

const CHEAT_CLEAR_CLUSTERS = 'wipeclusters';
const CHEAT_CODES = [
  { trigger: 'Type: wipeclusters', action: 'Clear all clusters' },
  { trigger: 'Cmd/Ctrl + E', action: 'Show cheat codes' },
];

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

const parseRecipientJson = (
  value: string,
): Array<{ name?: string; email: string }> => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const parseEmailList = (value: string): Array<{ email: string }> =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((email) => ({ email }));

const toListItemWhatsapp = (chat: {
  jid: string;
  name: string | null;
  isGroup: boolean;
  lastMessageTs: number;
  lastMessageText: string;
  unread: number;
}): ListItem => ({
  sourceType: 'whatsapp_chat',
  id: chat.jid,
  title: chat.name || chat.jid,
  subtitle: chat.isGroup ? 'Group' : 'Direct',
  preview: chat.lastMessageText || '[No messages]',
  time: chat.lastMessageTs || 0,
  unreadCount: chat.unread || 0,
  hasAttachments: false,
});

const toListItemEmail = (thread: {
  id: string;
  subject: string;
  participantSummary: string;
  lastCleanedPreview: string;
  lastMessageAt: number;
  unreadCount: number;
  hasAttachments: boolean;
}): ListItem => ({
  sourceType: 'email_thread',
  id: thread.id,
  title: thread.subject || '(No subject)',
  subtitle: thread.participantSummary || 'Unknown',
  preview: thread.lastCleanedPreview || '[No preview]',
  time: thread.lastMessageAt || 0,
  unreadCount: thread.unreadCount || 0,
  hasAttachments: !!thread.hasAttachments,
});

const isMobileLayout = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(max-width: 900px)').matches;

const CONNECT_QUOTES = [
  "WhatsApp: where 'urgent' means it's been in your unreads for three weeks.",
  'Email still beats carrier pigeons. By a slim margin.',
  'Decisions made in WhatsApp groups have all the permanence of a TikTok trend.',
  'Every "quick question" arrives exactly one Slack channel too late.',
  'Your inbox is mostly other people’s procrastination wearing a tie.',
  'Email threads: where context goes to die alphabetically.',
  'The action item is buried in message 73 of 81. Good luck.',
  'If WhatsApp built a project tracker, it would be the chat itself. That’s the problem.',
  'Reply-all is a feature. Reply-all is also why you’re tired.',
  'Pinning a WhatsApp message is the corporate equivalent of writing it on your hand.',
  'Read receipts: the office gossip of digital communication.',
  'Nothing says "cross-functional alignment" like a 27-person email thread.',
  'WhatsApp work groups: where decisions are made and then mysteriously forgotten.',
  'Forwarded emails carry the original sender’s regret at the speed of light.',
  'Voice notes in a work chat are a war crime under the Geneva Convention.',
  'No one has ever found anything by scrolling up.',
];

const pickRandomQuote = (current: string | null): string => {
  if (CONNECT_QUOTES.length <= 1) return CONNECT_QUOTES[0] ?? '';
  let next = current;
  while (next === current) {
    next = CONNECT_QUOTES[Math.floor(Math.random() * CONNECT_QUOTES.length)];
  }
  return next ?? CONNECT_QUOTES[0];
};

const summarizeConnector = (snapshot: Snapshot | null) => {
  const gmail = snapshot?.connectors.find((c) => c.connector === 'gmail');
  const whatsapp = snapshot?.connectors.find((c) => c.connector === 'whatsapp');
  return {
    gmailStatus: gmail?.status ?? 'disconnected',
    whatsappStatus: whatsapp?.status ?? 'disconnected',
    gmailEmail:
      (gmail?.metadata && (gmail.metadata as { emailAddress?: string }).emailAddress) ||
      null,
    gmailLastSync: gmail?.lastSyncedAt ?? null,
    gmailLastError: gmail?.lastError ?? null,
  };
};

type Props = {
  snapshot: Snapshot;
  updateInfo: UpdateCheckResult | null;
};

export const Workspace = ({ snapshot, updateInfo }: Props) => {
  const [optionalUpdateDismissed, setOptionalUpdateDismissed] = useState(false);
  const [chatFilter, setChatFilter] = useState<
    'all' | 'unread' | 'favorites' | 'groups'
  >('all');
  const [waSearch, setWaSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'whatsapp' | 'email' | 'clusters'>(
    'whatsapp',
  );
  const [whatsappChats, setWhatsappChats] = useState<ListItem[]>([]);
  const [emailThreads, setEmailThreads] = useState<ListItem[]>([]);
  const [activeThread, setActiveThread] = useState<ActiveThread>(null);
  const [activeThreadTitle, setActiveThreadTitle] = useState<string>(
    'No conversation selected',
  );
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [selectedMessageKeys, setSelectedMessageKeys] = useState<Set<string>>(
    new Set(),
  );
  const [clusters, setClusters] = useState<ClusterRecord[]>([]);
  const [clusterMap, setClusterMap] = useState<Record<string, string>>({});
  const [moreChannelsOpen, setMoreChannelsOpen] = useState(false);
  const [comingSoonText, setComingSoonText] = useState<string | null>(null);
  const [waConnectionText, setWaConnectionText] = useState('Connecting…');
  const [waQr, setWaQr] = useState<string | null>(null);
  const [waSendingStatus, setWaSendingStatus] = useState<ComposerStatus>({
    text: 'Select a WhatsApp conversation to send.',
    isError: false,
  });
  const [emailSendingStatus, setEmailSendingStatus] = useState<ComposerStatus>({
    text: 'Connect Gmail and open a thread to reply.',
    isError: false,
  });
  const [waInput, setWaInput] = useState('');
  const [emailNewMode, setEmailNewMode] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailCc, setEmailCc] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [isWaSending, setIsWaSending] = useState(false);
  const [isEmailSending, setIsEmailSending] = useState(false);
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);
  const [cheatModalOpen, setCheatModalOpen] = useState(false);
  const [gmailPreflightOpen, setGmailPreflightOpen] = useState(false);
  const [gmailConnecting, setGmailConnecting] = useState(false);
  const [connectOverlay, setConnectOverlay] = useState<
    'whatsapp' | 'gmail' | null
  >(null);
  const [connectOverlayQuote, setConnectOverlayQuote] = useState<string>(
    CONNECT_QUOTES[0],
  );
  const sawWaQrRef = useRef(false);
  const [promptState, setPromptState] = useState<{
    title: string;
    resolve: (value: string | null) => void;
  } | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const promptInputRef = useRef<HTMLInputElement | null>(null);

  const showPrompt = useCallback(
    (title: string, defaultValue = '') =>
      new Promise<string | null>((resolve) => {
        setPromptValue(defaultValue);
        setPromptState({ title, resolve });
      }),
    [],
  );

  const closePrompt = useCallback((value: string | null) => {
    setPromptState((current) => {
      current?.resolve(value);
      return null;
    });
  }, []);

  useEffect(() => {
    if (promptState) {
      const handle = window.setTimeout(() => {
        promptInputRef.current?.focus();
        promptInputRef.current?.select();
      }, 0);
      return () => window.clearTimeout(handle);
    }
  }, [promptState]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [freemiumModalOpen, setFreemiumModalOpen] = useState(false);
  const [autoRunAllToken, setAutoRunAllToken] = useState(0);
  const [clusterMenu, setClusterMenu] = useState<{
    cluster: ClusterRecord;
    x: number;
    y: number;
  } | null>(null);
  const [emailSyncState, setEmailSyncState] = useState<EmailSyncState>({
    connected: false,
    emailAddress: null,
    status: 'idle',
    lastError: null,
    lastSyncAt: null,
  });

  const cheatBufferRef = useRef('');
  const lastAnchorIndexRef = useRef<number | null>(null);
  const threadElRef = useRef<HTMLDivElement | null>(null);
  const moreChannelsAnchorRef = useRef<HTMLButtonElement | null>(null);
  const moreChannelsMenuRef = useRef<HTMLDivElement | null>(null);
  const comingSoonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connectorSummary = useMemo(() => summarizeConnector(snapshot), [snapshot]);

  // Mirror snapshot -> email sync state
  useEffect(() => {
    setEmailSyncState((prev) => ({
      ...prev,
      connected: connectorSummary.gmailStatus === 'connected' || connectorSummary.gmailStatus === 'syncing',
      emailAddress: connectorSummary.gmailEmail || prev.emailAddress,
      status: connectorSummary.gmailStatus === 'syncing' ? 'syncing' : connectorSummary.gmailStatus === 'error' ? 'error' : 'idle',
      lastError: connectorSummary.gmailLastError || null,
      lastSyncAt: connectorSummary.gmailLastSync
        ? new Date(connectorSummary.gmailLastSync).getTime()
        : prev.lastSyncAt,
    }));
  }, [connectorSummary.gmailStatus, connectorSummary.gmailEmail, connectorSummary.gmailLastError, connectorSummary.gmailLastSync]);

  // Mirror WhatsApp connection text from snapshot
  useEffect(() => {
    const status = connectorSummary.whatsappStatus;
    if (status === 'connected' || status === 'syncing') setWaConnectionText('WhatsApp connected');
    else if (status === 'connecting') setWaConnectionText('Connecting…');
    else if (status === 'error') setWaConnectionText('Connection error');
    else setWaConnectionText('WhatsApp disconnected');
  }, [connectorSummary.whatsappStatus]);

  const refreshClusters = useCallback(async () => {
    if (!window.chaiApi) return;
    const result = await window.chaiApi.cluster.list();
    setClusters(result.clusters);
    setClusterMap(result.clusterMap);
  }, []);

  const loadWhatsappChats = useCallback(async () => {
    if (!window.chaiApi) return;
    const chats = await window.chaiApi.whatsapp.listChats();
    setWhatsappChats(chats.map(toListItemWhatsapp));
  }, []);

  const loadEmailThreads = useCallback(async () => {
    if (!window.chaiApi) return;
    const threads = await window.chaiApi.gmail.listThreads();
    setEmailThreads(threads.map(toListItemEmail));
  }, []);

  const refreshAll = useCallback(async () => {
    if (!window.chaiApi) return;
    await Promise.allSettled([
      window.chaiApi.syncConnector('gmail'),
      window.chaiApi.syncConnector('whatsapp'),
    ]);
    await Promise.all([
      loadWhatsappChats(),
      loadEmailThreads(),
      refreshClusters(),
    ]);
  }, [loadEmailThreads, loadWhatsappChats, refreshClusters]);

  const loadWhatsappThread = useCallback(async (jid: string) => {
    if (!window.chaiApi) return;
    const messages = await window.chaiApi.whatsapp.getChat(jid);
    setThreadMessages(
      messages.map((message) => ({ ...message, __kind: 'whatsapp' }) as WaThreadMessage),
    );
  }, []);

  const loadEmailThread = useCallback(async (threadId: string) => {
    if (!window.chaiApi) return;
    const payload = await window.chaiApi.gmail.getThread(threadId);
    if (!payload) {
      setThreadMessages([]);
      return;
    }
    const messages = (
      payload.messages as unknown as Array<
        EmailThreadMessage & { attachments?: EmailAttachment[] }
      >
    ).map((message) => ({ ...message, __kind: 'email' }) as EmailThreadMessage);
    setThreadMessages(messages);
  }, []);

  const openThread = useCallback(
    async (item: ListItem) => {
      setActiveThread({ sourceType: item.sourceType, id: item.id });
      setActiveThreadTitle(
        item.sourceType === 'email_thread'
          ? `${item.title}\n${item.subtitle}`
          : item.title,
      );
      setMobileThreadOpen(true);
      setSelectedMessageKeys(new Set());
      if (item.sourceType === 'whatsapp_chat') {
        await loadWhatsappThread(item.id);
      } else {
        await loadEmailThread(item.id);
      }
    },
    [loadEmailThread, loadWhatsappThread],
  );

  // Initial load
  useEffect(() => {
    void (async () => {
      await Promise.all([loadWhatsappChats(), loadEmailThreads(), refreshClusters()]);
    })();
  }, [loadEmailThreads, loadWhatsappChats, refreshClusters]);

  // Daily auto-run: fire AiPanel "for all projects (since last opened)" 5 minutes
  // before the user's configured work-start-time. If today's window has passed,
  // schedule for tomorrow.
  useEffect(() => {
    const workStartTime = snapshot.settings.workStartTime;
    if (!workStartTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(workStartTime)) {
      return;
    }
    const [hh, mm] = workStartTime.split(':').map((n) => Number(n));

    const computeNextFireDelay = (): number => {
      const now = new Date();
      const fire = new Date(now);
      fire.setHours(hh, mm, 0, 0);
      fire.setMinutes(fire.getMinutes() - 5);
      if (fire.getTime() <= now.getTime()) {
        fire.setDate(fire.getDate() + 1);
      }
      return fire.getTime() - now.getTime();
    };

    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      const delay = computeNextFireDelay();
      timer = setTimeout(() => {
        setAutoRunAllToken((n) => n + 1);
        arm();
      }, delay);
    };
    arm();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [snapshot.settings.workStartTime]);

  // Refresh thread when active thread changes (after lists update we keep the open one)
  useEffect(() => {
    if (!activeThread) return;
    if (activeThread.sourceType === 'whatsapp_chat') {
      void loadWhatsappThread(activeThread.id);
    } else {
      void loadEmailThread(activeThread.id);
    }
  }, [activeThread, loadEmailThread, loadWhatsappThread]);

  // Stick thread to bottom when messages change
  useEffect(() => {
    if (!threadElRef.current) return;
    threadElRef.current.scrollTop = threadElRef.current.scrollHeight;
  }, [threadMessages]);

  // Subscribe to WhatsApp events for live updates
  const onWaEvent = useCallback(
    (event: Parameters<NonNullable<typeof window.chaiApi>['events']['onWhatsAppEvent']>[0] extends (e: infer T) => void ? T : never) => {
      if (event.type === 'qr') {
        setWaQr(event.payload.qr);
        setWaConnectionText('Scan QR to login');
        sawWaQrRef.current = true;
      } else if (event.type === 'connection' && event.payload.connection === 'open') {
        setWaQr(null);
        setWaConnectionText('WhatsApp connected');
        if (sawWaQrRef.current) {
          sawWaQrRef.current = false;
          setConnectOverlay('whatsapp');
        }
      } else if (event.type === 'connection' && event.payload.connection === 'close') {
        setWaConnectionText('Disconnected. Reconnecting…');
      } else if (event.type === 'pairing-failed') {
        setWaQr(null);
        setWaConnectionText('Logged out. Reset to re-pair.');
      } else if (
        event.type === 'message-upsert' ||
        event.type === 'message-update'
      ) {
        void loadWhatsappChats();
        if (
          activeThread?.sourceType === 'whatsapp_chat' &&
          event.payload.remoteJid === activeThread.id
        ) {
          void loadWhatsappThread(activeThread.id);
        }
      } else if (event.type === 'history-loaded') {
        void loadWhatsappChats();
      }
    },
    [activeThread, loadWhatsappChats, loadWhatsappThread],
  );
  useWhatsAppEvents(onWaEvent);

  // Subscribe to connector events for sync started/completed/failed
  const onConnectorEvent = useCallback(
    (event: { connector: 'gmail' | 'whatsapp'; type: string; error?: string }) => {
      if (event.connector !== 'gmail') return;
      if (event.type === 'sync.completed') {
        void loadEmailThreads();
      }
    },
    [loadEmailThreads],
  );
  useConnectorEvents(onConnectorEvent);

  // Drive the connect overlay: rotate quotes while visible, dismiss after
  // 60s (WhatsApp QR pair) or 20s (Gmail OAuth), and on Gmail completion
  // run a full refresh so messages definitely appear.
  useEffect(() => {
    if (!connectOverlay) return;
    setConnectOverlayQuote((current) => pickRandomQuote(current));
    const interval = window.setInterval(() => {
      setConnectOverlayQuote((current) => pickRandomQuote(current));
    }, 2800);
    const duration = connectOverlay === 'whatsapp' ? 60_000 : 20_000;
    const kind = connectOverlay;
    const timer = window.setTimeout(() => {
      setConnectOverlay(null);
      if (kind === 'gmail') void refreshAll();
    }, duration);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timer);
    };
  }, [connectOverlay, refreshAll]);

  const renderList = useCallback(() => {
    if (activeTab === 'whatsapp') return whatsappChats;
    if (activeTab === 'email') return emailThreads;
    return [];
  }, [activeTab, emailThreads, whatsappChats]);

  const handleItemClick = useCallback(
    (item: ListItem, items: ListItem[], index: number, event: React.MouseEvent) => {
      if (event.shiftKey) {
        const next = new Set(selectedItems);
        const anchor = lastAnchorIndexRef.current ?? index;
        const start = Math.min(anchor, index);
        const end = Math.max(anchor, index);
        for (let i = start; i <= end; i += 1) next.add(itemKey(items[i]));
        if (lastAnchorIndexRef.current === null) {
          lastAnchorIndexRef.current = index;
        }
        setSelectedItems(next);
        return;
      }
      if (event.metaKey || event.ctrlKey) {
        const next = new Set(selectedItems);
        const k = itemKey(item);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        lastAnchorIndexRef.current = index;
        setSelectedItems(next);
        return;
      }
      setSelectedItems(new Set());
      lastAnchorIndexRef.current = null;
      void openThread(item);
    },
    [openThread, selectedItems],
  );

  const onCreateCluster = useCallback(async () => {
    if (!selectedItems.size || !window.chaiApi) return;
    const rawName = await showPrompt('Cluster name?');
    if (rawName === null) return;
    const name = rawName.trim();
    if (!name) {
      window.alert('Please provide a cluster name.');
      return;
    }
    const colorId = randomClusterColorId();
    const members = [...selectedItems]
      .map((key) => {
        const item = memberKeyToItem(key);
        return item
          ? {
              source: sourceFromItem({ sourceType: item.sourceType }),
              sourceRef: item.id,
            }
          : null;
      })
      .filter(
        (entry): entry is { source: 'gmail' | 'whatsapp'; sourceRef: string } => !!entry,
      );

    await window.chaiApi.cluster.create({ name, color: colorId, members });
    setSelectedItems(new Set());
    lastAnchorIndexRef.current = null;
    await refreshClusters();
  }, [refreshClusters, selectedItems, showPrompt]);

  const onRenameCluster = useCallback(
    async (cluster: ClusterRecord) => {
      if (!window.chaiApi) return;
      const next = await showPrompt('Rename cluster', cluster.name);
      if (next === null) return;
      const trimmed = next.trim();
      if (!trimmed) return;
      await window.chaiApi.cluster.rename({
        id: cluster.id,
        name: trimmed,
      });
      await refreshClusters();
    },
    [refreshClusters, showPrompt],
  );

  const onRecolorCluster = useCallback(
    async (cluster: ClusterRecord, color: string) => {
      if (!window.chaiApi) return;
      await window.chaiApi.cluster.rename({
        id: cluster.id,
        name: cluster.name,
        color,
      });
      await refreshClusters();
    },
    [refreshClusters],
  );

  const onDeleteCluster = useCallback(
    async (cluster: ClusterRecord) => {
      if (!window.chaiApi) return;
      if (!window.confirm(`Delete cluster "${cluster.name}"? Members will be unassigned.`)) {
        return;
      }
      await window.chaiApi.cluster.remove(cluster.id);
      await refreshClusters();
    },
    [refreshClusters],
  );

  const clearAllClusters = useCallback(async () => {
    if (!window.chaiApi) return;
    if (!window.confirm('Clear all clusters?')) return;
    await window.chaiApi.cluster.clearAll();
    await refreshClusters();
    window.alert('All clusters cleared.');
  }, [refreshClusters]);

  const sendWhatsappMessage = useCallback(async () => {
    if (!activeThread || activeThread.sourceType !== 'whatsapp_chat') return;
    const text = waInput.trim();
    if (!text) return;
    if (!window.chaiApi) return;
    setIsWaSending(true);
    setWaSendingStatus({ text: 'Sending...', isError: false });
    try {
      await window.chaiApi.whatsapp.sendText({
        jid: activeThread.id,
        text,
        clientRequestId: buildClientRequestId('wa'),
      });
      setWaInput('');
      setWaSendingStatus({ text: 'Queued for send.', isError: false });
      await loadWhatsappThread(activeThread.id);
      await loadWhatsappChats();
    } catch (error) {
      setWaSendingStatus({
        text: `Send failed: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      });
    } finally {
      setIsWaSending(false);
    }
  }, [activeThread, loadWhatsappChats, loadWhatsappThread, waInput]);

  const sendEmailMessage = useCallback(async () => {
    const textBody = emailBody.trim();
    if (!textBody) return;
    if (!window.chaiApi) return;
    const isReplyMode = !emailNewMode;
    setIsEmailSending(true);
    setEmailSendingStatus({ text: 'Sending...', isError: false });
    try {
      await window.chaiApi.gmail.sendEmail({
        clientRequestId: buildClientRequestId('email'),
        threadId:
          isReplyMode && activeThread?.sourceType === 'email_thread'
            ? activeThread.id
            : null,
        to: isReplyMode ? [] : parseEmailList(emailTo),
        cc: isReplyMode ? [] : parseEmailList(emailCc),
        subject: isReplyMode ? '' : emailSubject.trim(),
        textBody,
        htmlBody: null,
      });
      setEmailBody('');
      if (!isReplyMode) {
        setEmailTo('');
        setEmailCc('');
        setEmailSubject('');
      }
      setEmailSendingStatus({ text: 'Queued for send.', isError: false });
      await loadEmailThreads();
      if (activeThread?.sourceType === 'email_thread') {
        await loadEmailThread(activeThread.id);
      }
    } catch (error) {
      setEmailSendingStatus({
        text: `Send failed: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      });
    } finally {
      setIsEmailSending(false);
    }
  }, [
    activeThread,
    emailBody,
    emailCc,
    emailNewMode,
    emailSubject,
    emailTo,
    loadEmailThread,
    loadEmailThreads,
  ]);

  const onConnectGmail = useCallback(() => {
    setGmailPreflightOpen(true);
  }, []);

  const confirmConnectGmail = useCallback(async () => {
    if (!window.chaiApi) return;
    setGmailConnecting(true);
    try {
      await window.chaiApi.connectConnector('gmail');
      setGmailPreflightOpen(false);
      setConnectOverlay('gmail');
    } catch (error) {
      setEmailSendingStatus({
        text: `Connect failed: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      });
      setGmailPreflightOpen(false);
    } finally {
      setGmailConnecting(false);
    }
  }, []);

  const onDisconnectGmail = useCallback(async () => {
    if (!window.chaiApi) return;
    await window.chaiApi.disconnectConnector('gmail');
    setEmailThreads([]);
    if (activeThread?.sourceType === 'email_thread') {
      setActiveThread(null);
      setThreadMessages([]);
      setActiveThreadTitle('No conversation selected');
    }
  }, [activeThread]);

  const onSyncGmail = useCallback(async () => {
    if (!window.chaiApi) return;
    await window.chaiApi.syncConnector('gmail');
    await loadEmailThreads();
  }, [loadEmailThreads]);

  const onConnectWhatsapp = useCallback(async () => {
    if (!window.chaiApi) return;
    try {
      await window.chaiApi.connectConnector('whatsapp');
    } catch (error) {
      setWaSendingStatus({
        text: `Connect failed: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      });
    }
  }, []);

  const onDisconnectWhatsapp = useCallback(async () => {
    if (!window.chaiApi) return;
    await window.chaiApi.disconnectConnector('whatsapp');
    setWhatsappChats([]);
    if (activeThread?.sourceType === 'whatsapp_chat') {
      setActiveThread(null);
      setThreadMessages([]);
      setActiveThreadTitle('No conversation selected');
    }
  }, [activeThread]);

  const refreshCurrentTab = useCallback(async () => {
    if (activeTab === 'email') await loadEmailThreads();
    else if (activeTab === 'clusters') {
      await Promise.all([loadWhatsappChats(), loadEmailThreads()]);
    } else await loadWhatsappChats();
    await refreshClusters();
  }, [activeTab, loadEmailThreads, loadWhatsappChats, refreshClusters]);

  // Show coming-soon banner with auto-hide
  const showComingSoon = useCallback((channel: ComingSoonChannel) => {
    setComingSoonText(`${channel} integration is coming soon. Stay tuned!`);
    if (comingSoonTimerRef.current) clearTimeout(comingSoonTimerRef.current);
    comingSoonTimerRef.current = setTimeout(() => setComingSoonText(null), 4000);
  }, []);

  // Cheat code: typing 'wipeclusters'
  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'e') {
          event.preventDefault();
          setCheatModalOpen(true);
        }
        if (event.key === 'Escape') {
          setCheatModalOpen(false);
          setMoreChannelsOpen(false);
        }
        return;
      }
      if (event.key === 'Escape') {
        setCheatModalOpen(false);
        setMoreChannelsOpen(false);
        return;
      }
      if (event.key.length !== 1) return;
      cheatBufferRef.current = `${cheatBufferRef.current}${event.key.toLowerCase()}`.slice(
        -CHEAT_CLEAR_CLUSTERS.length,
      );
      if (cheatBufferRef.current.endsWith(CHEAT_CLEAR_CLUSTERS)) {
        cheatBufferRef.current = '';
        void clearAllClusters();
      }
    };
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  }, [clearAllClusters]);

  // Close more channels menu on outside click
  useEffect(() => {
    if (!moreChannelsOpen) return;
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        moreChannelsAnchorRef.current?.contains(target) ||
        moreChannelsMenuRef.current?.contains(target)
      ) {
        return;
      }
      setMoreChannelsOpen(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [moreChannelsOpen]);

  // Close cluster context menu on any click or escape
  useEffect(() => {
    if (!clusterMenu) return;
    const onDocClick = () => setClusterMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setClusterMenu(null);
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [clusterMenu]);

  // Compute cluster groups for the Clusters tab
  const clusterGroups = useMemo(() => {
    const itemsIndex = new Map<string, ListItem>();
    for (const item of [...whatsappChats, ...emailThreads]) {
      itemsIndex.set(clusterMapKey(item), item);
    }
    const grouped: Record<
      string,
      { cluster: ClusterRecord; items: ListItem[] }
    > = {};
    for (const [key, clusterId] of Object.entries(clusterMap)) {
      const item = itemsIndex.get(key);
      const cluster = clusters.find((c) => c.id === clusterId);
      if (!item || !cluster) continue;
      if (!grouped[cluster.id]) grouped[cluster.id] = { cluster, items: [] };
      grouped[cluster.id].items.push(item);
    }
    return Object.values(grouped).sort((a, b) =>
      a.cluster.name.localeCompare(b.cluster.name),
    );
  }, [clusterMap, clusters, emailThreads, whatsappChats]);

  const renderItemRow = (
    item: ListItem,
    items: ListItem[],
    index: number,
    extraBadge?: string,
  ) => {
    const cluster = clusters.find(
      (c) => c.id === clusterMap[clusterMapKey(item)],
    );
    const borderStyle: CSSProperties = cluster
      ? { borderLeftColor: getClusterColor(cluster.color) }
      : {};
    const isActive =
      activeThread?.sourceType === item.sourceType &&
      activeThread.id === item.id;
    const isSelected = selectedItems.has(itemKey(item));

    const av = avatarStyle(item.title || item.id);
    const initials = avatarInitials(item.title);
    return (
      <div
        key={`${item.sourceType}:${item.id}`}
        className={`chat-item${isActive ? ' active' : ''}${isSelected ? ' selected' : ''}`}
        style={borderStyle}
        onClick={(event) => handleItemClick(item, items, index, event)}
      >
        <div
          className="chat-avatar"
          style={{ background: av.background, color: av.color }}
          aria-hidden="true"
        >
          {initials}
        </div>
        <div className="chat-item-body">
          <div className="chat-item-top">
            <span className="chat-name">{item.title}</span>
            <span className="chat-time">{formatTime(item.time)}</span>
          </div>
          <div className="chat-item-bottom">
            <span className="chat-preview">
              {item.preview || '[No preview]'}
            </span>
            <span className="chat-item-meta">
              {item.hasAttachments ? (
                <span className="attach-dot" aria-label="has attachment">
                  📎
                </span>
              ) : null}
              {extraBadge ? (
                <span className="source-badge">{extraBadge}</span>
              ) : null}
              {item.unreadCount ? (
                <span className="unread-dot">{item.unreadCount}</span>
              ) : null}
            </span>
          </div>
          {item.subtitle ? (
            <div className="chat-subtitle">{item.subtitle}</div>
          ) : null}
        </div>
      </div>
    );
  };

  const renderMessage = (message: ThreadMessage, index: number) => {
    if (message.__kind === 'whatsapp') {
      const selected = selectedMessageKeys.has(message.messageKey);
      return (
        <div
          key={`${message.messageKey}-${index}`}
          className={`message ${message.fromMe ? 'out' : 'in'}${message.isDeleted ? ' deleted' : ''}${selected ? ' selected' : ''}`}
          onClick={(event) => {
            const next = new Set(selectedMessageKeys);
            if (event.metaKey || event.ctrlKey) {
              if (next.has(message.messageKey)) next.delete(message.messageKey);
              else next.add(message.messageKey);
            } else {
              next.clear();
              next.add(message.messageKey);
            }
            setSelectedMessageKeys(next);
          }}
        >
          <div className="meta">{senderLabelWhatsapp(message)}</div>
          <div className="body">
            {message.isDeleted ? '[Deleted]' : message.text}
          </div>
          <span className="time">{formatTime(message.messageTimestamp)}</span>
        </div>
      );
    }

    const selected = selectedMessageKeys.has(message.id);
    const to = parseRecipientJson(message.toJson)
      .map((entry) => entry.email || entry.name)
      .filter(Boolean)
      .join(', ');
    const cc = parseRecipientJson(message.ccJson)
      .map((entry) => entry.email || entry.name)
      .filter(Boolean)
      .join(', ');
    return (
      <div
        key={`${message.id}-${index}`}
        className={`message ${message.direction === 'outgoing' ? 'out' : 'in'}${selected ? ' selected' : ''}`}
        onClick={(event) => {
          const next = new Set(selectedMessageKeys);
          if (event.metaKey || event.ctrlKey) {
            if (next.has(message.id)) next.delete(message.id);
            else next.add(message.id);
          } else {
            next.clear();
            next.add(message.id);
          }
          setSelectedMessageKeys(next);
        }}
      >
        <div className="meta">{senderLabelEmail(message)}</div>
        <div className="email-meta">
          To: {to || '—'}
          {cc ? ` • Cc: ${cc}` : ''}
        </div>
        <div className="body">
          {message.bodyCleanText || '[No content]'}
        </div>
        {Array.isArray(message.attachments) && message.attachments.length ? (
          <div className="email-attachments">
            {message.attachments.map((attachment) => (
              <button
                key={attachment.id}
                type="button"
                className="attachment-pill"
                onClick={async (event) => {
                  event.stopPropagation();
                  if (!window.chaiApi) return;
                  await window.chaiApi.gmail.downloadAttachment(attachment.id);
                }}
              >
                📎 {attachment.filename || 'attachment'}
              </button>
            ))}
          </div>
        ) : null}
        <span className="time">{formatTime(message.sentAt)}</span>
      </div>
    );
  };

  const items = renderList();
  const showWaComposer = activeTab === 'whatsapp';
  const showEmailComposer = activeTab === 'email';
  const composerVisible = showWaComposer || showEmailComposer;

  const waReady = showWaComposer && activeThread?.sourceType === 'whatsapp_chat';
  const waSendDisabled =
    !waReady || isWaSending || waInput.trim().length === 0;

  const isReplyMode = !emailNewMode;
  const emailReplyReady =
    showEmailComposer &&
    activeThread?.sourceType === 'email_thread' &&
    emailSyncState.connected;
  const emailNewReady = showEmailComposer && emailSyncState.connected;
  const emailHasBody = emailBody.trim().length > 0;
  const emailSendDisabled = isReplyMode
    ? !emailReplyReady || isEmailSending || !emailHasBody
    : !emailNewReady || isEmailSending || !emailHasBody || emailTo.trim().length === 0;

  const selectionMeta =
    selectedItems.size > 0
      ? `${selectedItems.size} selected (Shift-click range)`
      : 'Create project Clusters with Cmd+Click';

  const emailSyncLine = !emailSyncState.connected
    ? 'Email not connected'
    : [
        emailSyncState.emailAddress || 'Connected',
        emailSyncState.status === 'syncing' ? 'Syncing…' : null,
        emailSyncState.status === 'error'
          ? `Error: ${emailSyncState.lastError || 'sync failed'}`
          : null,
        emailSyncState.lastSyncAt
          ? `Last sync ${new Date(emailSyncState.lastSyncAt).toLocaleTimeString()}`
          : null,
      ]
        .filter(Boolean)
        .join(' • ');

  return (
    <div id="app" className={mobileThreadOpen ? 'mobile-thread-open' : ''}>
      <aside className="sidebar">
        <div className="panel-header">
          <h1>Conversations</h1>
          <div className="panel-header-actions">
            <button onClick={() => setSettingsOpen(true)}>Settings</button>
            <button onClick={() => void refreshCurrentTab()}>Refresh</button>
          </div>
        </div>
        {!snapshot.settings.privacyBannerDismissed ? (
          <PrivacyBanner
            onDismiss={() => {
              void window.chaiApi?.updateSettings({
                privacyBannerDismissed: true,
              });
            }}
          />
        ) : null}
        {!snapshot.settings.freemiumBannerDismissed ? (
          <FreemiumBanner
            onUpgradeClick={() => setFreemiumModalOpen(true)}
            onDismiss={() => {
              void window.chaiApi?.updateSettings({
                freemiumBannerDismissed: true,
              });
            }}
          />
        ) : null}
        {updateInfo && updateInfo.kind === 'optional' && !optionalUpdateDismissed ? (
          <OptionalUpdateBanner
            info={updateInfo}
            onDismiss={() => setOptionalUpdateDismissed(true)}
          />
        ) : null}
        <div className="tab-row">
          <div className="channel-partition">
            <div className="channel-carousel-wrap">
              <div className="channel-carousel" aria-label="Channels">
                <button
                  className={`tab-btn${activeTab === 'whatsapp' ? ' active' : ''}`}
                  onClick={() => {
                    setActiveTab('whatsapp');
                    setMoreChannelsOpen(false);
                    setMobileThreadOpen(false);
                  }}
                >
                  WhatsApp
                </button>
                <button
                  className={`tab-btn${activeTab === 'email' ? ' active' : ''}`}
                  onClick={() => {
                    setActiveTab('email');
                    setMoreChannelsOpen(false);
                    setMobileThreadOpen(false);
                  }}
                >
                  Email
                </button>
                <div className="more-channels-wrap">
                  <button
                    ref={moreChannelsAnchorRef}
                    className="tab-btn tab-btn-plus"
                    aria-expanded={moreChannelsOpen}
                    aria-haspopup="menu"
                    onClick={(event) => {
                      event.stopPropagation();
                      setMoreChannelsOpen((open) => !open);
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="workspace-static">
            <button
              className={`tab-btn${activeTab === 'clusters' ? ' active' : ''}`}
              onClick={() => {
                setActiveTab('clusters');
                setMoreChannelsOpen(false);
                setMobileThreadOpen(false);
              }}
            >
              Clusters
            </button>
          </div>
        </div>

        {moreChannelsOpen ? (
          <div
            ref={moreChannelsMenuRef}
            className="more-channels-menu"
            style={{ position: 'absolute', top: 110, left: 200 }}
          >
            {COMING_SOON_CHANNELS.map((channel) => (
              <button
                key={channel}
                className="more-channel-option"
                onClick={() => {
                  setMoreChannelsOpen(false);
                  showComingSoon(channel);
                }}
              >
                {channel}
              </button>
            ))}
          </div>
        ) : null}

        {comingSoonText ? (
          <div className="coming-soon-banner">{comingSoonText}</div>
        ) : null}

        {activeTab === 'email' ? (
          <div className="email-toolbar">
            {!emailSyncState.connected ? (
              <button onClick={() => void onConnectGmail()}>
                Connect Gmail
              </button>
            ) : (
              <>
                <button onClick={() => void onDisconnectGmail()}>
                  Disconnect
                </button>
                <button onClick={() => void onSyncGmail()}>Sync now</button>
              </>
            )}
          </div>
        ) : null}

        {activeTab === 'whatsapp' ? (
          <div className="email-toolbar">
            {connectorSummary.whatsappStatus === 'connected' ||
            connectorSummary.whatsappStatus === 'syncing' ? (
              <button onClick={() => void onDisconnectWhatsapp()}>
                Disconnect
              </button>
            ) : (
              <button onClick={() => void onConnectWhatsapp()}>
                Connect WhatsApp
              </button>
            )}
          </div>
        ) : null}

        <div className="cluster-toolbar">
          <div className="cluster-meta">{selectionMeta}</div>
          <button
            disabled={selectedItems.size === 0}
            onClick={() => void onCreateCluster()}
          >
            Create Cluster
          </button>
        </div>

        {activeTab === 'whatsapp' ? (
          <div className="connection">{waConnectionText}</div>
        ) : null}
        {activeTab === 'email' ? (
          <div className={`connection email-sync${emailSyncState.status === 'error' ? ' error' : ''}`}>
            {emailSyncLine}
          </div>
        ) : null}

        {activeTab === 'whatsapp' && waQr ? (
          <div className="qr">
            <div>Scan with phone:</div>
            <img
              alt="WhatsApp QR"
              src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(waQr)}`}
            />
          </div>
        ) : null}

        {activeTab === 'whatsapp' ? (
          <div className="chat-search">
            <input
              type="search"
              className="chat-search-input"
              placeholder="Search recent chats"
              aria-label="Search recent WhatsApp chats"
              value={waSearch}
              onChange={(event) => setWaSearch(event.target.value)}
            />
          </div>
        ) : null}

        {activeTab !== 'clusters' ? (
          <div className="chat-filter-chips" role="tablist" aria-label="Filter">
            {(['all', 'unread', 'favorites', 'groups'] as const).map(
              (filter) => (
                <button
                  key={filter}
                  type="button"
                  role="tab"
                  aria-selected={chatFilter === filter}
                  className={`chat-filter-chip${chatFilter === filter ? ' active' : ''}`}
                  onClick={() => setChatFilter(filter)}
                >
                  {filter === 'all'
                    ? 'All'
                    : filter === 'unread'
                      ? 'Unread'
                      : filter === 'favorites'
                        ? 'Favorites'
                        : 'Groups'}
                </button>
              ),
            )}
          </div>
        ) : null}

        <div id="chatList">
          {activeTab === 'clusters' ? (
            clusterGroups.length === 0 ? (
              <div className="cluster-group">
                <div className="chat-preview">No clustered items yet.</div>
              </div>
            ) : (
              clusterGroups.map((group) => (
                <section key={group.cluster.id} className="cluster-group">
                  <h3
                    className="cluster-title"
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setClusterMenu({
                        cluster: group.cluster,
                        x: event.clientX,
                        y: event.clientY,
                      });
                    }}
                    title="Right-click for options"
                  >
                    <span
                      className="cluster-title-dot"
                      style={{ background: getClusterColor(group.cluster.color) }}
                    />
                    {group.cluster.name}
                  </h3>
                  {[...group.items]
                    .sort((a, b) => b.time - a.time)
                    .map((item, idx) =>
                      renderItemRow(
                        item,
                        group.items,
                        idx,
                        SOURCE_BADGES[item.sourceType],
                      ),
                    )}
                </section>
              ))
            )
          ) : (
            (() => {
              const searchQuery =
                activeTab === 'whatsapp' ? waSearch.trim().toLowerCase() : '';
              let visible = items;
              if (searchQuery) {
                const scope = [...items]
                  .sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
                  .slice(0, 100);
                visible = scope.filter((item) => {
                  const title = (item.title ?? '').toLowerCase();
                  const preview = (item.preview ?? '').toLowerCase();
                  return (
                    title.includes(searchQuery) ||
                    preview.includes(searchQuery)
                  );
                });
              }
              if (chatFilter === 'unread') {
                visible = visible.filter(
                  (item) => (item.unreadCount ?? 0) > 0,
                );
              }
              if (visible.length === 0) {
                if (searchQuery) {
                  return (
                    <div className="chat-empty-state">
                      No matches in the last 100 chats.
                    </div>
                  );
                }
                if (chatFilter === 'unread') {
                  return (
                    <div className="chat-empty-state">No unread chats.</div>
                  );
                }
              }
              return visible.map((item, idx) =>
                renderItemRow(item, visible, idx),
              );
            })()
          )}
        </div>
      </aside>

      <main className="thread-wrap">
        <header className="thread-header">
          <button
            className="mobile-back-btn"
            aria-label="Back to conversations"
            onClick={() => setMobileThreadOpen(false)}
          >
            ←
          </button>
          {activeThread ? (
            <div
              className="thread-header-avatar"
              style={(() => {
                const av = avatarStyle(activeThreadTitle);
                return { background: av.background, color: av.color };
              })()}
              aria-hidden="true"
            >
              {avatarInitials(activeThreadTitle)}
            </div>
          ) : null}
          <h2>{activeThreadTitle}</h2>
          {activeThread ? (
            <div className="thread-header-actions">
              <button
                className="thread-header-icon-btn"
                aria-label="Video call (coming soon)"
                title="Video call (coming soon)"
                disabled
              >
                📹
              </button>
              <button
                className="thread-header-icon-btn"
                aria-label="Voice call (coming soon)"
                title="Voice call (coming soon)"
                disabled
              >
                📞
              </button>
            </div>
          ) : null}
        </header>
        <div className="thread thread-doodle" ref={threadElRef}>
          {threadMessages.map((message, idx) => renderMessage(message, idx))}
        </div>
        <div className="composer-wrap" hidden={!composerVisible}>
          {showWaComposer ? (
            <div className="composer-block">
              <div className="composer-row composer-row-wa">
                <button
                  className="composer-attach-btn"
                  aria-label="Attach (coming soon)"
                  title="Attach (coming soon)"
                  disabled
                  type="button"
                >
                  +
                </button>
                <textarea
                  className="composer-input"
                  rows={2}
                  placeholder="Type a message"
                  value={waInput}
                  onChange={(event) => setWaInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void sendWhatsappMessage();
                    }
                  }}
                />
                <button
                  className="composer-send-btn"
                  disabled={waSendDisabled}
                  onClick={() => void sendWhatsappMessage()}
                >
                  Send
                </button>
              </div>
              <div
                className={`composer-status${waSendingStatus.isError ? ' error' : ''}`}
              >
                {waSendingStatus.text}
              </div>
            </div>
          ) : null}
          {showEmailComposer ? (
            <div className="composer-block">
              <div className="composer-toggle-row">
                <label className="composer-checkbox">
                  <input
                    type="checkbox"
                    checked={emailNewMode}
                    onChange={(event) => {
                      setEmailNewMode(event.target.checked);
                      setEmailSendingStatus({
                        text: event.target.checked
                          ? 'Compose a new email.'
                          : 'Replying in current thread.',
                        isError: false,
                      });
                    }}
                  />
                  <span>Compose new email</span>
                </label>
              </div>
              {emailNewMode ? (
                <div className="email-new-fields">
                  <input
                    className="composer-text"
                    type="text"
                    placeholder="To (comma-separated emails)"
                    value={emailTo}
                    onChange={(event) => setEmailTo(event.target.value)}
                  />
                  <input
                    className="composer-text"
                    type="text"
                    placeholder="Cc (optional, comma-separated emails)"
                    value={emailCc}
                    onChange={(event) => setEmailCc(event.target.value)}
                  />
                  <input
                    className="composer-text"
                    type="text"
                    placeholder="Subject"
                    value={emailSubject}
                    onChange={(event) => setEmailSubject(event.target.value)}
                  />
                </div>
              ) : null}
              <div className="composer-row">
                <textarea
                  className="composer-input"
                  rows={3}
                  placeholder="Type an email reply"
                  value={emailBody}
                  onChange={(event) => setEmailBody(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      (event.metaKey || event.ctrlKey)
                    ) {
                      event.preventDefault();
                      void sendEmailMessage();
                    }
                  }}
                />
                <button
                  className="composer-send-btn"
                  disabled={emailSendDisabled}
                  onClick={() => void sendEmailMessage()}
                >
                  Send
                </button>
              </div>
              <div
                className={`composer-status${emailSendingStatus.isError ? ' error' : ''}`}
              >
                {emailSendingStatus.text}
              </div>
            </div>
          ) : null}
        </div>
      </main>

      <AiPanel
        clusters={clusters}
        clusterMap={clusterMap}
        whatsappChats={whatsappChats}
        emailThreads={emailThreads}
        selectionCount={selectedMessageKeys.size}
        previousLastOpenedAt={snapshot.previousLastOpenedAt}
        onRefreshAll={refreshAll}
        autoRunAllToken={autoRunAllToken}
      />

      {gmailPreflightOpen ? (
        <div
          className="modal-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget && !gmailConnecting) {
              setGmailPreflightOpen(false);
            }
          }}
        >
          <div
            className="modal-card gmail-preflight-card"
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-title-row">
              <h3>Heads up: Google's about to look concerned</h3>
              {!gmailConnecting ? (
                <button
                  className="modal-close"
                  onClick={() => setGmailPreflightOpen(false)}
                >
                  ✕
                </button>
              ) : null}
            </div>
            <div className="gmail-preflight-body">
              <p>
                When you continue, your browser will open Google's sign-in page.
                After you pick your account, Google will show a scary{' '}
                <strong>"Google hasn't verified this app"</strong> screen.
              </p>
              <p>
                That's expected. Click <strong>Advanced</strong> →{' '}
                <strong>Go to Chai (unsafe)</strong>. Your data still
                only ever touches your machine — nothing is stored on our
                servers.
              </p>
              <details className="gmail-preflight-why">
                <summary>Why the warning?</summary>
                <p>
                  Letting an app talk to Gmail puts you in Google's "restricted
                  scopes" tier. To make that warning go away, we'd need to spend
                  4–6 weeks on Google's verification process plus pay a
                  third-party security firm five figures a year for a CASA
                  audit.
                </p>
                <p>
                  We didn't have 4–6 weeks for that verification BS for a beta.
                  We'll do it once enough of you tell us this thing is worth
                  shipping.
                </p>
              </details>
            </div>
            <div className="prompt-actions">
              <button
                type="button"
                className="modal-close"
                disabled={gmailConnecting}
                onClick={() => setGmailPreflightOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="prompt-submit"
                disabled={gmailConnecting}
                onClick={() => void confirmConnectGmail()}
              >
                {gmailConnecting ? 'Opening Google…' : 'Open Google sign-in'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {promptState ? (
        <div
          className="modal-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) closePrompt(null);
          }}
        >
          <form
            className="modal-card"
            role="dialog"
            aria-modal="true"
            onSubmit={(event) => {
              event.preventDefault();
              closePrompt(promptValue);
            }}
          >
            <div className="modal-title-row">
              <h3>{promptState.title}</h3>
              <button
                type="button"
                className="modal-close"
                onClick={() => closePrompt(null)}
              >
                ✕
              </button>
            </div>
            <input
              ref={promptInputRef}
              className="prompt-input"
              value={promptValue}
              onChange={(event) => setPromptValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closePrompt(null);
                }
              }}
            />
            <div className="prompt-actions">
              <button
                type="button"
                className="modal-close"
                onClick={() => closePrompt(null)}
              >
                Cancel
              </button>
              <button type="submit" className="prompt-submit">
                OK
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {cheatModalOpen ? (
        <div
          className="modal-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) setCheatModalOpen(false);
          }}
        >
          <div className="modal-card" role="dialog" aria-modal="true">
            <div className="modal-title-row">
              <h3>Cheat Codes</h3>
              <button
                className="modal-close"
                onClick={() => setCheatModalOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="cheat-list">
              {CHEAT_CODES.map((code) => (
                <div key={code.trigger} className="cheat-row">
                  <code>{code.trigger}</code>
                  <span>{code.action}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <SettingsModal
          snapshot={snapshot}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      {clusterMenu ? (
        <div
          className="cluster-context-menu"
          style={{ top: clusterMenu.y, left: clusterMenu.x }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            onClick={() => {
              const target = clusterMenu.cluster;
              setClusterMenu(null);
              void onRenameCluster(target);
            }}
          >
            Rename…
          </button>
          <div className="palette" role="group" aria-label="Cluster color">
            {CLUSTER_COLORS.map((entry) => {
              const active = entry.id === clusterMenu.cluster.color;
              return (
                <button
                  key={entry.id}
                  className={`palette-swatch${active ? ' active' : ''}`}
                  style={{ background: entry.color }}
                  aria-label={`Set color ${entry.id}`}
                  onClick={() => {
                    const target = clusterMenu.cluster;
                    setClusterMenu(null);
                    void onRecolorCluster(target, entry.id);
                  }}
                />
              );
            })}
          </div>
          <button
            className="danger"
            onClick={() => {
              const target = clusterMenu.cluster;
              setClusterMenu(null);
              void onDeleteCluster(target);
            }}
          >
            Delete cluster
          </button>
        </div>
      ) : null}

      {!snapshot.settings.tutorialCompleted ? (
        <TutorialModal
          defaultWorkStartTime={snapshot.settings.workStartTime ?? null}
          onComplete={async ({ workStartTime }) => {
            await window.chaiApi?.updateSettings({
              onboardingCompleted: true,
              tutorialCompleted: true,
              workStartTime,
            });
          }}
        />
      ) : null}

      {freemiumModalOpen ? (
        <FreemiumModal onClose={() => setFreemiumModalOpen(false)} />
      ) : null}

      {connectOverlay ? (
        <div
          className="connect-overlay"
          role="alertdialog"
          aria-live="polite"
          aria-label={
            connectOverlay === 'whatsapp'
              ? 'Linking WhatsApp'
              : 'Linking Gmail'
          }
        >
          <div className="connect-overlay-card">
            <div className="connect-overlay-spinner" aria-hidden="true" />
            <div className="connect-overlay-title">
              {connectOverlay === 'whatsapp'
                ? 'Pairing with WhatsApp…'
                : 'Connecting Gmail…'}
            </div>
            <div className="connect-overlay-sub">
              {connectOverlay === 'whatsapp'
                ? 'Syncing your chats. This takes about a minute.'
                : 'Syncing your inbox. About 20 seconds.'}
            </div>
            <div key={connectOverlayQuote} className="connect-overlay-quote">
              “{connectOverlayQuote}”
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export const CLUSTER_PALETTE = CLUSTER_COLORS;
