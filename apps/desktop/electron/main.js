import crypto from 'node:crypto';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import {
  buildDiagnosticsBundle,
  createUpdateChecker,
  createJanusRuntime,
} from '@janus/core';
import {
  createAiOutputStore,
  createClusterStore,
  createEmailStore,
  createWhatsAppStore,
} from '@janus/db';
import {
  createGmailConnector,
  createGmailSendService,
} from '@janus/connectors-gmail';
import {
  createWhatsAppConnector,
  createWhatsAppSendService,
} from '@janus/connectors-whatsapp';
import { createWorkflowExtractor } from '@janus/ai';
import electronUpdater from 'electron-updater';
import { loadJanusEnv } from './env.js';

const { autoUpdater } = electronUpdater;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === 'development';

let runtime = null;
let mainWindow = null;
let gmailConnector = null;
let whatsappConnector = null;
let gmailSendService = null;
let whatsappSendService = null;
let workflowExtractor = null;
let updaterConfigured = false;
let lastUpdateInfo = null;

const broadcastEvent = (channel, payload) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
};

const broadcastSnapshot = () => {
  if (!runtime) return;
  broadcastEvent('janus:runtime-snapshot', runtime.getSnapshot());
};

const createMainWindow = async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (process.env.UI_DEV_URL) {
    await win.loadURL(process.env.UI_DEV_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    await win.loadFile(path.join(__dirname, 'ui-dist', 'index.html'));
  }

  mainWindow = win;
  return win;
};

const requireRuntime = () => {
  if (!runtime) throw new Error('Runtime not initialized');
  return runtime;
};

const newId = (prefix) =>
  `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

const registerIpcHandlers = () => {
  ipcMain.handle('janus:get-runtime-state', () =>
    requireRuntime().getSnapshot(),
  );

  ipcMain.handle('janus:update-settings', (_event, patch) => {
    const current = requireRuntime().settingsStore.write(patch || {});
    rebuildWorkflowExtractor(current);
    broadcastSnapshot();
    return runtime.getSnapshot();
  });

  ipcMain.handle('janus:connector:connect', async (_event, connector) => {
    await requireRuntime().connectorRuntime.connect(connector);
    broadcastSnapshot();
    return runtime.getSnapshot();
  });

  ipcMain.handle('janus:connector:disconnect', async (_event, connector) => {
    await requireRuntime().connectorRuntime.disconnect(connector);
    broadcastSnapshot();
    return runtime.getSnapshot();
  });

  ipcMain.handle('janus:connector:sync', async (_event, connector) => {
    broadcastEvent('janus:connector:event', {
      connector,
      type: 'sync.started',
    });
    try {
      await requireRuntime().connectorRuntime.syncNow(connector);
      broadcastEvent('janus:connector:event', {
        connector,
        type: 'sync.completed',
      });
    } catch (error) {
      broadcastEvent('janus:connector:event', {
        connector,
        type: 'sync.failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
    broadcastSnapshot();
    return runtime.getSnapshot();
  });

  ipcMain.handle('janus:gmail:list-threads', () => {
    if (!runtime) return [];
    const store = createEmailStore(runtime.db);
    return store.getEmailThreads('local-user');
  });

  ipcMain.handle('janus:gmail:get-thread', (_event, threadId) => {
    if (!runtime) return null;
    const store = createEmailStore(runtime.db);
    const thread = store.getEmailThreadById(threadId);
    if (!thread) return null;
    const messages = store.getEmailMessagesForThread(threadId);
    const messagesWithAttachments = messages.map((message) => ({
      ...message,
      attachments: store.getEmailAttachmentsForMessage(message.id),
    }));
    return { thread, messages: messagesWithAttachments };
  });

  ipcMain.handle('janus:gmail:send', async (_event, payload) => {
    if (!gmailSendService) {
      throw new Error('Gmail send service is not available.');
    }
    const result = await gmailSendService.sendEmail(payload);
    broadcastEvent('janus:gmail:event', {
      type: 'send.completed',
      payload: result,
    });
    return result;
  });

  ipcMain.handle(
    'janus:gmail:download-attachment',
    async (_event, attachmentId) => {
      if (!gmailConnector) throw new Error('Gmail connector unavailable.');
      const file = await gmailConnector.getAttachmentContent(attachmentId);
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: file.filename,
      });
      if (result.canceled || !result.filePath) {
        return { saved: false };
      }
      const { readFile } = await import('node:fs/promises');
      const data = await readFile(file.path);
      await writeFile(result.filePath, data);
      return { saved: true, savedPath: result.filePath };
    },
  );

  ipcMain.handle(
    'janus:gmail:open-attachment',
    async (_event, attachmentId) => {
      if (!gmailConnector) throw new Error('Gmail connector unavailable.');
      const file = await gmailConnector.getAttachmentContent(attachmentId);
      await shell.openPath(file.path);
      return { opened: true };
    },
  );

  ipcMain.handle('janus:whatsapp:list-chats', () => {
    if (!runtime) return [];
    const store = createWhatsAppStore(runtime.db);
    return store.getChats();
  });

  ipcMain.handle('janus:whatsapp:get-chat', (_event, jid) => {
    if (!runtime) return [];
    const store = createWhatsAppStore(runtime.db);
    const messages = store.getMessagesForChat(jid, 200);
    return messages.map((message) => ({
      ...message,
      senderName: store.resolveDisplayName(message.participant ?? message.senderJid),
    }));
  });

  ipcMain.handle('janus:whatsapp:send', async (_event, payload) => {
    if (!whatsappSendService) {
      throw new Error('WhatsApp send service is not available.');
    }
    return whatsappSendService.sendText(payload);
  });

  ipcMain.handle('janus:whatsapp:status', () => {
    return whatsappConnector?.getStatus() ?? null;
  });

  ipcMain.handle('janus:cluster:list', () => {
    if (!runtime) return { clusters: [], clusterMap: {} };
    const store = createClusterStore(runtime.db);
    return {
      clusters: store.list(),
      clusterMap: store.getClusterMap(),
    };
  });

  ipcMain.handle('janus:cluster:create', (_event, input) => {
    const store = createClusterStore(requireRuntime().db);
    const id = newId('cluster');
    const cluster = store.create({
      id,
      name: input.name,
      color: input.color ?? null,
    });
    if (Array.isArray(input.members) && input.members.length) {
      store.addMembers(id, input.members);
    }
    return {
      cluster: store.get(id) ?? cluster,
      clusterMap: store.getClusterMap(),
    };
  });

  ipcMain.handle('janus:cluster:rename', (_event, input) => {
    const store = createClusterStore(requireRuntime().db);
    return store.rename(input.id, input.name, input.color ?? null);
  });

  ipcMain.handle('janus:cluster:delete', (_event, id) => {
    const store = createClusterStore(requireRuntime().db);
    store.remove(id);
    return { clusterMap: store.getClusterMap() };
  });

  ipcMain.handle('janus:cluster:add-members', (_event, input) => {
    const store = createClusterStore(requireRuntime().db);
    store.addMembers(input.clusterId, input.members || []);
    return {
      cluster: store.get(input.clusterId),
      clusterMap: store.getClusterMap(),
    };
  });

  ipcMain.handle('janus:cluster:remove-member', (_event, input) => {
    const store = createClusterStore(requireRuntime().db);
    store.removeMember(input.clusterId, input.source, input.sourceRef);
    return { clusterMap: store.getClusterMap() };
  });

  ipcMain.handle('janus:cluster:list-members', (_event, clusterId) => {
    const store = createClusterStore(requireRuntime().db);
    return store.listMembers(clusterId);
  });

  ipcMain.handle('janus:cluster:clear-all', () => {
    const store = createClusterStore(requireRuntime().db);
    store.clearAll();
    return { clusterMap: {}, clusters: [] };
  });

  ipcMain.handle('janus:ai:extract-workflow', async (_event, text) => {
    if (!workflowExtractor) throw new Error('AI runtime unavailable.');
    return workflowExtractor.extract(text);
  });

  ipcMain.handle('janus:ai:save-output', (_event, input) => {
    const store = createAiOutputStore(requireRuntime().db);
    return store.create({
      id: newId('ai_output'),
      clusterId: input.clusterId ?? null,
      kind: input.kind,
      inputSummary: input.inputSummary ?? null,
      outputText: input.outputText,
      model: input.model ?? null,
    });
  });

  ipcMain.handle('janus:ai:list-outputs', (_event, clusterId) => {
    const store = createAiOutputStore(requireRuntime().db);
    return store.listForCluster(clusterId);
  });

  ipcMain.handle('janus:diagnostics:export', async () => {
    const r = requireRuntime();
    const bundle = buildDiagnosticsBundle({
      appVersion: app.getVersion(),
      mode: isDev ? 'development' : 'production',
      paths: r.paths,
      settings: r.settingsStore.read(),
      db: r.db,
    });

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save diagnostics bundle',
      defaultPath: `janus-diagnostics-${new Date()
        .toISOString()
        .replace(/[:.]/g, '-')}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) {
      return { saved: false };
    }
    await writeFile(result.filePath, JSON.stringify(bundle, null, 2));
    return { saved: true, savedPath: result.filePath };
  });

  ipcMain.handle('janus:update:check', async (_event, input) => {
    return runUpdateCheck(input);
  });

  ipcMain.handle('janus:update:download', async () => {
    if (isDev) {
      return {
        kind: 'skipped',
        message: 'Update download is disabled in development mode.',
      };
    }
    configureAutoUpdater();
    try {
      await autoUpdater.checkForUpdates();
      await autoUpdater.downloadUpdate();
      return { kind: 'started' };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      broadcastEvent('janus:update:event', { kind: 'error', message });
      return { kind: 'error', message };
    }
  });

  ipcMain.handle('janus:update:install', () => {
    if (isDev) {
      return {
        kind: 'skipped',
        message: 'quitAndInstall is disabled in development mode.',
      };
    }
    autoUpdater.quitAndInstall(false, true);
    return { kind: 'installing' };
  });

  ipcMain.handle('janus:update:last', () => lastUpdateInfo);

  ipcMain.handle('janus:migration:retry', async () => {
    runtime?.close();
    runtime = await createRuntime();
    rebuildWorkflowExtractor(runtime.settingsStore.read());
    broadcastSnapshot();
    return runtime.getSnapshot();
  });
};

const rebuildWorkflowExtractor = (settings) => {
  workflowExtractor = createWorkflowExtractor({
    baseUrl: settings?.ollamaBaseUrl || undefined,
    model: settings?.ollamaModel || undefined,
  });
};

const configureAutoUpdater = () => {
  if (updaterConfigured) return;
  updaterConfigured = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  // electron-updater reads provider/owner/repo from the bundled app-update.yml
  // (built from build.publish in package.json). Don't override here — the
  // JANUS_UPDATE_FEED_URL env var only drives the JSON metadata feed used
  // by createUpdateChecker for forced-update enforcement.

  autoUpdater.on('checking-for-update', () => {
    broadcastEvent('janus:update:event', { kind: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    broadcastEvent('janus:update:event', {
      kind: 'available',
      version: info?.version,
      releaseDate: info?.releaseDate,
      releaseNotes: info?.releaseNotes,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    broadcastEvent('janus:update:event', {
      kind: 'not-available',
      version: info?.version,
    });
  });

  autoUpdater.on('error', (error) => {
    broadcastEvent('janus:update:event', {
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    broadcastEvent('janus:update:event', {
      kind: 'progress',
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    broadcastEvent('janus:update:event', {
      kind: 'downloaded',
      version: info?.version,
    });
  });
};

const DEFAULT_UPDATE_FEED_URL =
  'https://github.com/no4jargon/Janus-Layer-0/releases/latest/download/latest.json';

const runUpdateCheck = async (input) => {
  const feedUrl =
    input?.feedUrl ||
    process.env.JANUS_UPDATE_FEED_URL ||
    DEFAULT_UPDATE_FEED_URL;
  const checker = createUpdateChecker({
    feedUrl,
    currentVersion: app.getVersion(),
    channel: input?.channel || 'beta',
  });
  try {
    const info = await checker.check();
    lastUpdateInfo = info;
    broadcastEvent('janus:update:event', {
      kind: 'check-result',
      info,
    });
    return info;
  } catch (error) {
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

const createRuntime = async () => {
  const repoRoot =
    process.env.JANUS_REPO_ROOT || path.join(__dirname, '..', '..', '..');

  loadJanusEnv(repoRoot);

  return createJanusRuntime({
    mode: isDev ? 'development' : 'production',
    repoRoot,
    userDataPath: app.getPath('userData'),
    migrationsDir: path.join(__dirname, 'migrations'),
    appVersion: app.getVersion(),
    buildConnectors: ({ db, paths, logger }) => {
      const emailStore = createEmailStore(db);
      const whatsappStore = createWhatsAppStore(db);

      gmailConnector = createGmailConnector({
        keystoreDir: paths.keystoreDir,
        attachmentCacheDir: path.join(paths.attachmentsDir, 'email'),
        logger,
        emailStore,
        openExternal: (url) => {
          shell.openExternal(url);
        },
      });

      gmailSendService = createGmailSendService({
        emailStore,
        tokenFilePath: gmailConnector.tokenPath,
        logger,
      });

      whatsappConnector = createWhatsAppConnector({
        keystoreDir: paths.keystoreDir,
        logger,
        store: whatsappStore,
        onEvent: (event) => {
          broadcastEvent('janus:whatsapp:event', event);
        },
      });

      whatsappSendService = createWhatsAppSendService({
        store: whatsappStore,
        logger,
        getSocket: () => whatsappConnector?.getActiveSocket() ?? null,
      });

      return {
        gmail: gmailConnector,
        whatsapp: whatsappConnector,
      };
    },
  });
};

const bootstrap = async () => {
  runtime = await createRuntime();
  rebuildWorkflowExtractor(runtime.settingsStore.read());
  registerIpcHandlers();
  await createMainWindow();
  broadcastSnapshot();

  if (!isDev) {
    configureAutoUpdater();
    runUpdateCheck().catch((error) => {
      runtime?.logger?.warn?.('initial update check failed', {
        error: String(error),
      });
    });
  }
};

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    await bootstrap();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    runtime?.close();
  });
}
