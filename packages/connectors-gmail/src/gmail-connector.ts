import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Logger, ChaiConnector } from '@chai/core';
import type { EmailStore } from '@chai/db';
import {
  authedFetch,
  assertOauthConfig,
  gmailApi,
  parseOauthConfig,
  refreshTokenIfNeeded,
  runDesktopOAuth,
  type GmailToken,
} from './oauth.js';
import {
  extractBodies,
  getHeader,
  looksAutomated,
  normalizeSubject,
  parseAddressList,
  summarizeParticipants,
  type GmailRawMessage,
} from './message-normalizer.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const nowIso = () => new Date().toISOString();

const readJson = <T>(filePath: string): T | null => {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
};

const writeJson = (filePath: string, value: unknown) => {
  writeFileSync(filePath, JSON.stringify(value, null, 2));
};

type GmailProfile = {
  emailAddress: string;
  connectedAt: string;
  lastSyncedAt?: string | null;
};

export type GmailConnectorOptions = {
  keystoreDir: string;
  attachmentCacheDir: string;
  logger: Logger;
  emailStore: EmailStore;
  openExternal: (url: string) => void;
};

export type GmailSyncSummary = {
  emailAddress: string;
  threads: number;
  messages: number;
};

export type GmailConnector = ChaiConnector & {
  readonly tokenPath: string;
  getStatus(): GmailRuntimeStatus;
  getAttachmentContent(
    attachmentId: string,
  ): Promise<{ path: string; mimeType: string; filename: string }>;
};

export type GmailRuntimeStatus = {
  connected: boolean;
  emailAddress: string | null;
  lastSyncAt: number | null;
  lastSyncStatus: 'idle' | 'syncing' | 'error';
  lastSyncError: string | null;
  lastSyncSummary: GmailSyncSummary | null;
};

export const createGmailConnector = (
  options: GmailConnectorOptions,
): GmailConnector => {
  const tokenPath = path.join(options.keystoreDir, 'gmail-token.json');
  const profilePath = path.join(options.keystoreDir, 'gmail-profile.json');

  let status: GmailRuntimeStatus = {
    connected: false,
    emailAddress: null,
    lastSyncAt: null,
    lastSyncStatus: 'idle',
    lastSyncError: null,
    lastSyncSummary: null,
  };

  const getStoredProfile = () => readJson<GmailProfile>(profilePath);
  const getStoredToken = () => readJson<GmailToken>(tokenPath);

  const persistAuth = (token: GmailToken, emailAddress: string) => {
    writeJson(tokenPath, token);
    const previous = getStoredProfile();
    writeJson(profilePath, {
      emailAddress,
      connectedAt: previous?.connectedAt || nowIso(),
      lastSyncedAt: previous?.lastSyncedAt || null,
    } satisfies GmailProfile);
  };

  const getFreshToken = async (): Promise<GmailToken> => {
    const config = parseOauthConfig();
    assertOauthConfig(config);

    const stored = getStoredToken();
    if (!stored?.access_token) {
      throw new Error('Gmail is not connected. Run connect first.');
    }
    const fresh = await refreshTokenIfNeeded(config, stored);
    writeJson(tokenPath, fresh);
    return fresh;
  };

  const fetchThread = async (threadId: string, token: GmailToken) => {
    const res = await authedFetch(
      token,
      gmailApi(`threads/${threadId}`, { format: 'full' }),
    );
    const raw = await res.text();
    if (!res.ok) throw new Error(`Failed thread ${threadId}: ${raw}`);
    return JSON.parse(raw) as { messages?: GmailRawMessage[] };
  };

  const listRecentThreadIds = async (token: GmailToken): Promise<string[]> => {
    const query =
      'newer_than:7d -in:spam -in:trash -category:promotions -category:social -category:updates';
    const ids: string[] = [];
    let pageToken = '';

    do {
      const res = await authedFetch(
        token,
        gmailApi('threads', {
          q: query,
          maxResults: '100',
          pageToken,
          includeSpamTrash: 'false',
        }),
      );
      const raw = await res.text();
      if (!res.ok) throw new Error(`Failed thread list: ${raw}`);
      const payload = JSON.parse(raw) as {
        threads?: Array<{ id?: string }>;
        nextPageToken?: string;
      };
      for (const item of payload.threads || []) {
        if (item.id) ids.push(item.id);
      }
      pageToken = payload.nextPageToken || '';
    } while (pageToken);

    return ids;
  };

  const sync = async (): Promise<GmailSyncSummary> => {
    if (!status.connected) {
      throw new Error('Gmail not connected');
    }
    status.lastSyncStatus = 'syncing';
    status.lastSyncError = null;

    const token = await getFreshToken();
    const account = options.emailStore.getEmailAccount('local-user', 'gmail');
    if (!account) throw new Error('Gmail account record not found');

    try {
      const selfEmail = account.emailAddress;
      options.logger.info('gmail sync started', { selfEmail });
      const threadIds = await listRecentThreadIds(token);
      options.logger.info('gmail sync fetched thread ids', {
        count: threadIds.length,
      });
      let upsertedThreads = 0;
      let upsertedMessages = 0;

      for (const providerThreadId of threadIds) {
        const thread = await fetchThread(providerThreadId, token);
        const messages = (thread.messages || []).sort(
          (a, b) => Number(a.internalDate || 0) - Number(b.internalDate || 0),
        );
        if (!messages.length) continue;

        const processed = messages.map((message) => {
          const headers = message.payload?.headers || [];
          const subject = clean(getHeader(headers, 'Subject')) || '(No subject)';
          const from = parseAddressList(getHeader(headers, 'From'));
          const to = parseAddressList(getHeader(headers, 'To'));
          const cc = parseAddressList(getHeader(headers, 'Cc'));
          const sender = from[0] || { name: '', email: '' };
          const bodies = extractBodies(message);
          const senderEmail = clean(sender.email).toLowerCase();
          const direction: 'incoming' | 'outgoing' =
            senderEmail === selfEmail.toLowerCase() ? 'outgoing' : 'incoming';
          const participantEmails = [
            senderEmail,
            ...to.map((a) => a.email),
            ...cc.map((a) => a.email),
          ].filter(Boolean);

          return {
            providerMessageId: message.id,
            gmailHistoryId:
              message.historyId !== undefined ? String(message.historyId) : null,
            subject,
            senderName: clean(sender.name) || null,
            senderEmail,
            to,
            cc,
            sentAt:
              Math.floor(Number(message.internalDate || 0) / 1000) ||
              Math.floor(Date.now() / 1000),
            direction,
            snippet: clean(message.snippet) || null,
            bodyRawHtml: bodies.bodyRawHtml || null,
            bodyRawText: bodies.bodyRawText || null,
            bodyCleanText: bodies.bodyCleanText || clean(message.snippet) || '',
            hasAttachments: bodies.attachments.length > 0,
            attachments: bodies.attachments,
            isAutomated: looksAutomated({
              senderEmail,
              subject,
              bodyText: bodies.bodyCleanText || message.snippet || '',
            }),
            participantEmails,
            labelIds: message.labelIds || [],
          };
        });

        const hasHumanSignal = processed.some((item) => !item.isAutomated);
        if (!hasHumanSignal) continue;

        const allParticipants = processed.flatMap(
          (item) => item.participantEmails,
        );
        const last = processed[processed.length - 1];
        const hasAttachments = processed.some((item) => item.hasAttachments);
        const unreadCount = messages.filter((m) =>
          (m.labelIds || []).includes('UNREAD'),
        ).length;
        const subject =
          processed.find((item) => item.subject)?.subject || '(No subject)';
        const threadId = `gmail_thread_${providerThreadId}`;
        const now = Date.now();

        options.emailStore.upsertEmailThread({
          id: threadId,
          userId: 'local-user',
          accountId: account.id,
          providerThreadId,
          derivedThreadKey: `${normalizeSubject(subject)}|${summarizeParticipants(
            allParticipants,
            selfEmail,
          )}`,
          subject,
          participantSummary: summarizeParticipants(allParticipants, selfEmail),
          lastMessageAt: last.sentAt,
          lastCleanedPreview: clean(last.bodyCleanText).slice(0, 240),
          unreadCount,
          hasAttachments,
          sourceLabelsJson: JSON.stringify(
            messages[messages.length - 1].labelIds || [],
          ),
          createdAt: now,
          updatedAt: now,
        });
        upsertedThreads += 1;

        for (const item of processed) {
          const messageId = `gmail_msg_${item.providerMessageId}`;
          options.emailStore.upsertEmailMessage({
            id: messageId,
            userId: 'local-user',
            accountId: account.id,
            threadId,
            providerMessageId: item.providerMessageId,
            gmailHistoryId: item.gmailHistoryId,
            senderName: item.senderName,
            senderEmail: item.senderEmail,
            toJson: JSON.stringify(item.to),
            ccJson: JSON.stringify(item.cc),
            sentAt: item.sentAt,
            direction: item.direction,
            snippet: item.snippet,
            bodyRawHtml: item.bodyRawHtml,
            bodyRawText: item.bodyRawText,
            bodyCleanText: item.bodyCleanText,
            hasAttachments: item.hasAttachments ? 1 : 0,
            isHiddenAutomated: item.isAutomated && !hasHumanSignal ? 1 : 0,
            createdAt: now,
            updatedAt: now,
          });
          upsertedMessages += 1;

          for (const attachment of item.attachments) {
            options.emailStore.upsertEmailAttachment({
              id: `gmail_att_${item.providerMessageId}_${attachment.attachmentId}`,
              userId: 'local-user',
              accountId: account.id,
              messageId,
              providerAttachmentId: attachment.attachmentId,
              filename: attachment.filename,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
              cachedLocalPath: null,
              cachedAt: null,
              createdAt: now,
            });
          }
        }
      }

      const completedAt = Date.now();
      options.emailStore.updateEmailAccountSync(
        account.id,
        account.syncCursor,
        completedAt,
      );

      const previous = getStoredProfile();
      writeJson(profilePath, {
        emailAddress: previous?.emailAddress || selfEmail,
        connectedAt: previous?.connectedAt || nowIso(),
        lastSyncedAt: nowIso(),
      } satisfies GmailProfile);

      const summary: GmailSyncSummary = {
        emailAddress: selfEmail,
        threads: upsertedThreads,
        messages: upsertedMessages,
      };

      status.lastSyncAt = completedAt;
      status.lastSyncStatus = 'idle';
      status.lastSyncSummary = summary;

      options.logger.info('gmail sync completed', summary);
      return summary;
    } catch (error) {
      status.lastSyncStatus = 'error';
      status.lastSyncError =
        error instanceof Error ? error.message : String(error);
      options.logger.error('gmail sync failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  const bootstrap: ChaiConnector['bootstrap'] = async () => {
    const profile = getStoredProfile();
    const token = getStoredToken();
    const account = options.emailStore.getEmailAccount('local-user', 'gmail');

    if (profile && token?.access_token) {
      status.connected = true;
      status.emailAddress =
        profile.emailAddress || account?.emailAddress || null;
      status.lastSyncStatus = 'idle';
      return {
        connected: true,
        metadata: {
          emailAddress: status.emailAddress,
        },
        lastSyncedAt: profile.lastSyncedAt ?? null,
      };
    }

    return { connected: false };
  };

  const connect: ChaiConnector['connect'] = async () => {
    const config = parseOauthConfig();
    const token = await runDesktopOAuth({
      config,
      openExternal: options.openExternal,
    });

    const profileRes = await authedFetch(token, gmailApi('profile'));
    const profileRaw = await profileRes.text();
    if (!profileRes.ok) {
      throw new Error(`Failed to read Gmail profile: ${profileRaw}`);
    }
    const profile = JSON.parse(profileRaw) as { emailAddress?: string };
    const emailAddress = clean(profile.emailAddress) || 'unknown@gmail.com';

    persistAuth(token, emailAddress);

    const now = Date.now();
    options.emailStore.upsertEmailAccount({
      id: 'gmail_account_local',
      userId: 'local-user',
      provider: 'gmail',
      emailAddress,
      oauthTokenRef: tokenPath,
      syncCursor: null,
      lastSyncAt: null,
      createdAt: now,
      updatedAt: now,
    });

    status = {
      connected: true,
      emailAddress,
      lastSyncAt: null,
      lastSyncStatus: 'idle',
      lastSyncError: null,
      lastSyncSummary: null,
    };

    return { metadata: { emailAddress } };
  };

  const disconnect: ChaiConnector['disconnect'] = async () => {
    if (existsSync(tokenPath)) rmSync(tokenPath, { force: true });
    if (existsSync(profilePath)) rmSync(profilePath, { force: true });

    const account = options.emailStore.getEmailAccount('local-user', 'gmail');
    if (account) {
      options.emailStore.clearEmailDataForAccount(account.id);
    }

    status = {
      connected: false,
      emailAddress: null,
      lastSyncAt: null,
      lastSyncStatus: 'idle',
      lastSyncError: null,
      lastSyncSummary: null,
    };
  };

  const syncWrapped: ChaiConnector['sync'] = async () => {
    const summary = await sync();
    return {
      lastSyncedAt: nowIso(),
      metadata: summary as unknown as Record<string, unknown>,
    };
  };

  const getAttachmentContent: GmailConnector['getAttachmentContent'] = async (
    attachmentId,
  ) => {
    const attachment = options.emailStore.getEmailAttachmentById(attachmentId);
    if (!attachment) throw new Error('Attachment not found');

    if (attachment.cachedLocalPath) {
      try {
        await stat(attachment.cachedLocalPath);
        return {
          path: attachment.cachedLocalPath,
          mimeType: attachment.mimeType || 'application/octet-stream',
          filename: attachment.filename || `${attachment.id}.bin`,
        };
      } catch {
        /* refetch */
      }
    }

    const token = await getFreshToken();
    const res = await authedFetch(
      token,
      gmailApi(
        `messages/${attachment.providerMessageId}/attachments/${attachment.providerAttachmentId}`,
      ),
    );
    const raw = await res.text();
    if (!res.ok) throw new Error(`Failed to fetch attachment: ${raw}`);
    const payload = JSON.parse(raw) as { data?: string };
    if (!payload.data) throw new Error('Attachment payload empty');

    await mkdir(options.attachmentCacheDir, { recursive: true });
    const safeName = (clean(attachment.filename) || `${attachment.id}.bin`).replace(
      /[^a-zA-Z0-9._-]+/g,
      '_',
    );
    const filePath = path.join(
      options.attachmentCacheDir,
      `${attachment.id}_${safeName}`,
    );

    await writeFile(
      filePath,
      Buffer.from(
        payload.data.replace(/-/g, '+').replace(/_/g, '/'),
        'base64',
      ),
    );

    options.emailStore.markEmailAttachmentCached(
      attachment.id,
      filePath,
      Date.now(),
    );

    return {
      path: filePath,
      mimeType: attachment.mimeType || 'application/octet-stream',
      filename: safeName,
    };
  };

  return {
    kind: 'gmail',
    tokenPath,
    bootstrap,
    connect,
    disconnect,
    sync: syncWrapped,
    getStatus: () => ({ ...status }),
    getAttachmentContent,
  };
};
