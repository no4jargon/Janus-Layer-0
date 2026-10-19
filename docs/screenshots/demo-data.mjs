/**
 * Fictional, offline data for README screenshots of the actual Chai renderer.
 *
 * Usage with Playwright (no Electron or connected account required):
 *   import { installDemoData } from './docs/screenshots/demo-data.mjs';
 *   await page.addInitScript(installDemoData, { theme: 'light' });
 *
 * This function is intentionally self-contained: Playwright serializes it into
 * the page. Every API operation stays in memory. Sending is explicitly blocked.
 * AI responses are illustrative fixtures, not a model-quality demonstration.
 */
export function installDemoData(options = {}) {
  const fixedNow = new Date('2026-10-19T10:30:00+05:30').getTime();
  const NativeDate = Date;
  class DemoDate extends NativeDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedNow]));
    }
    static now() { return fixedNow; }
  }
  window.Date = DemoDate;
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const seconds = (time) => Math.floor(new NativeDate(`2026-10-19T${time}:00+05:30`).getTime() / 1000);
  const isoNow = new NativeDate(fixedNow).toISOString();
  const listeners = Object.fromEntries(
    ['runtime', 'whatsapp', 'connector', 'gmail', 'update', 'modelDownload'].map((key) => [key, new Set()]),
  );
  const subscribe = (key) => (handler) => {
    listeners[key].add(handler);
    return () => listeners[key].delete(handler);
  };
  const emit = (key, value) => listeners[key].forEach((handler) => handler(copy(value)));
  const snapshot = {
    appVersion: '0.1.13',
    mode: 'production',
    phase: 'ready',
    paths: {
      baseDir: '~/Library/Application Support/Chai/data',
      dbPath: '~/Library/Application Support/Chai/data/app.db',
      logsDir: '~/Library/Application Support/Chai/data/logs',
    },
    settings: {
      onboardingCompleted: true,
      theme: options.theme || 'light',
      llmModelPath: null,
      workStartTime: '09:00',
      lastOpenedAt: fixedNow,
      privacyBannerDismissed: true,
      tutorialCompleted: true,
      freemiumBannerDismissed: true,
      ...(options.settings || {}),
    },
    previousLastOpenedAt: fixedNow - 12 * 60 * 60 * 1000,
    connectors: [
      { connector: 'gmail', status: 'connected', lastError: null, lastSyncedAt: isoNow, updatedAt: isoNow, metadata: { emailAddress: 'alex.studio@example.com' } },
      { connector: 'whatsapp', status: 'connected', lastError: null, lastSyncedAt: isoNow, updatedAt: isoNow, metadata: null },
    ],
    migrationFailure: null,
  };
  // Direct flags are convenient for capturing the introductory tutorial.
  for (const key of ['onboardingCompleted', 'tutorialCompleted', 'privacyBannerDismissed', 'freemiumBannerDismissed']) {
    if (typeof options[key] === 'boolean') snapshot.settings[key] = options[key];
  }

  const chatIds = {
    atlas: 'demo-atlas-team@g.us',
    mira: 'demo-mira@example.com',
    lumen: 'demo-lumen-crew@g.us',
    dev: 'demo-dev@example.com',
    admin: 'demo-studio-admin@g.us',
    noah: 'demo-noah@example.com',
  };
  const waMessages = {};
  const waMessage = (chat, id, time, senderName, text, extra = {}) => ({
    messageKey: id,
    remoteJid: chatIds[chat],
    participant: senderName === 'You' ? null : `${senderName.toLowerCase().replaceAll(' ', '.')}@example.com`,
    senderJid: senderName === 'You' ? 'alex.studio@example.com' : `${senderName.toLowerCase().replaceAll(' ', '.')}@example.com`,
    senderName: senderName === 'You' ? 'Alex Rivera' : senderName,
    fromMe: senderName === 'You',
    text,
    isDeleted: false,
    messageTimestamp: seconds(time),
    replyToText: null,
    replyToSenderJid: null,
    replyToSenderName: null,
    ...extra,
  });
  waMessages[chatIds.atlas] = [
    waMessage('atlas', 'atlas-wa-1', '08:45', 'Mira Shah', 'Morning! The Atlas website review is at 3 pm today. Can we get the final mobile screens ready before then?'),
    waMessage('atlas', 'atlas-wa-2', '08:49', 'You', 'Yes. Desktop layouts are approved. I am finishing mobile spacing and the contact form this morning.'),
    waMessage('atlas', 'atlas-wa-3', '09:05', 'Sam Lee', 'I have sent the approved homepage copy by email. Please use version 3; the older headline is out.'),
    waMessage('atlas', 'atlas-wa-4', '09:10', 'Mira Shah', 'Decision: keep the simple contact form. No booking calendar for this launch.'),
    waMessage('atlas', 'atlas-wa-5', '09:25', 'You', 'Got it. I will send the mobile preview by 1 pm, then we can use the 3 pm call for sign-off.'),
    waMessage('atlas', 'atlas-wa-6', '10:08', 'Mira Shah', 'Perfect. Please also check the form confirmation on a phone before sending the preview.', { replyToText: 'I will send the mobile preview by 1 pm', replyToSenderJid: 'alex.studio@example.com', replyToSenderName: 'You' }),
  ];
  waMessages[chatIds.mira] = [
    waMessage('mira', 'mira-wa-1', '09:12', 'Mira Shah', 'One small Atlas detail: can the footer show hello.atlas@example.com?'),
    waMessage('mira', 'mira-wa-2', '09:18', 'You', 'Absolutely. I will update the footer and include it in the mobile preview.'),
    waMessage('mira', 'mira-wa-3', '09:54', 'Mira Shah', 'Thanks! The launch date is still Thursday, 22 October. We can approve the final build on our call today.'),
  ];
  waMessages[chatIds.lumen] = [
    waMessage('lumen', 'lumen-wa-1', '08:50', 'Dev Morgan', 'Lumen launch update: the landing page is live in staging, and all three product photos are approved.'),
    waMessage('lumen', 'lumen-wa-2', '09:02', 'Tara Chen', 'The newsletter is scheduled for Wednesday, 21 October at 10 am. I need the final page link by 5 pm tomorrow.'),
    waMessage('lumen', 'lumen-wa-3', '09:14', 'You', 'I will test the signup flow today and send you the final page link tomorrow morning.'),
    waMessage('lumen', 'lumen-wa-4', '09:42', 'Dev Morgan', 'Decision from our call: use the green hero image. Alex, please swap it in before QA.'),
    waMessage('lumen', 'lumen-wa-5', '10:15', 'Tara Chen', 'I have emailed the launch checklist. Please confirm the signup test when it is done.'),
  ];
  waMessages[chatIds.dev] = [
    waMessage('dev', 'dev-wa-1', '09:20', 'Dev Morgan', 'For Lumen QA, please check the welcome email as well as the signup form.'),
    waMessage('dev', 'dev-wa-2', '09:33', 'You', 'Added both to my list. I will post the results in the launch group by 4 pm today.'),
  ];
  waMessages[chatIds.admin] = [
    waMessage('admin', 'admin-wa-1', '08:55', 'Priya Ellis', 'Studio admin: the October invoice draft is in your email. Please check the project names before I send it.'),
    waMessage('admin', 'admin-wa-2', '09:04', 'You', 'Thanks, I will review it by noon today. Please keep the Atlas deposit separate from the final balance.'),
    waMessage('admin', 'admin-wa-3', '09:37', 'Priya Ellis', 'Done. Also a reminder: our studio bookkeeping call is Tuesday, 20 October at 11 am.'),
  ];
  waMessages[chatIds.noah] = [
    waMessage('noah', 'noah-wa-1', '09:32', 'Noah Reed', 'Hi Alex, I just emailed a brief for the Harbor portfolio site. Are you free for a quick chat this week?'),
    waMessage('noah', 'noah-wa-2', '10:02', 'You', 'Thanks Noah! I will read the brief and share a couple of times this afternoon.'),
  ];
  const chatDefinitions = [
    ['atlas', 'Atlas Website Team', true, 2],
    ['lumen', 'Lumen Launch Crew', true, 1],
    ['mira', 'Mira Shah', false, 1],
    ['admin', 'Studio Admin', true, 0],
    ['dev', 'Dev Morgan', false, 0],
    ['noah', 'Noah Reed', false, 1],
  ];
  const chats = chatDefinitions.map(([key, name, isGroup, unread]) => {
    const messages = waMessages[chatIds[key]];
    const last = messages[messages.length - 1];
    return { jid: chatIds[key], name, isGroup, lastMessageTs: last.messageTimestamp, lastMessageText: last.text, lastMessageType: 'conversation', unread };
  });

  const emailMessages = {};
  const emailMessage = (threadId, id, time, senderName, senderEmail, text, extra = {}) => ({
    id, threadId, senderName, senderEmail,
    toJson: JSON.stringify([{ name: 'Alex Rivera', email: 'alex.studio@example.com' }]),
    ccJson: '[]', sentAt: seconds(time), direction: 'incoming',
    snippet: text, bodyCleanText: text, hasAttachments: 0, attachments: [], ...extra,
  });
  emailMessages['demo-atlas-copy'] = [
    emailMessage('demo-atlas-copy', 'atlas-copy-1', '09:00', 'Sam Lee', 'sam.lee@example.com', 'Hi Alex,\n\nAttached is the approved Atlas homepage copy, version 3. The client has signed off on the headline and service descriptions.\n\nPlease replace the staging copy before our 3 pm review today. We are keeping the simple contact form for launch.\n\nThanks,\nSam', {
      hasAttachments: 1,
      attachments: [{ id: 'demo-copy-pdf', filename: 'Atlas-homepage-copy-v3.pdf', mimeType: 'application/pdf', sizeBytes: 184320, cachedLocalPath: null }],
    }),
    emailMessage('demo-atlas-copy', 'atlas-copy-2', '09:17', 'Alex Rivera', 'alex.studio@example.com', 'Thanks Sam, I have the approved version. I will replace the copy and share the mobile preview by 1 pm today.', { direction: 'outgoing', toJson: JSON.stringify([{ name: 'Sam Lee', email: 'sam.lee@example.com' }]) }),
    emailMessage('demo-atlas-copy', 'atlas-copy-3', '10:20', 'Sam Lee', 'sam.lee@example.com', 'Great, thank you! One final check: please keep the service names exactly as written in the attached version. See you at the review.'),
  ];
  emailMessages['demo-atlas-review'] = [
    emailMessage('demo-atlas-review', 'atlas-review-1', '09:30', 'Mira Shah', 'mira.shah@example.com', 'Hi Alex,\n\nConfirming our Atlas website sign-off call for today, 19 October, at 3 pm. Please bring the mobile preview and the contact-form test results.\n\nThe launch is Thursday, 22 October. Once we approve the build today, I will arrange the final content check.\n\nMira'),
  ];
  emailMessages['demo-lumen-checklist'] = [
    emailMessage('demo-lumen-checklist', 'lumen-email-1', '09:48', 'Tara Chen', 'tara.chen@example.com', 'Hi Alex,\n\nHere is the Lumen launch checklist:\n• Switch the hero to the approved green image.\n• Test signup on desktop and mobile.\n• Check that the welcome email arrives.\n• Send me the final landing-page link by 5 pm on Tuesday, 20 October.\n\nThe newsletter goes out at 10 am on Wednesday, 21 October. Please post the signup test results in the launch group today.\n\nThanks,\nTara'),
  ];
  emailMessages['demo-studio-invoice'] = [
    emailMessage('demo-studio-invoice', 'admin-email-1', '09:01', 'Priya Ellis', 'priya.ellis@example.com', 'Hi Alex,\n\nThe October invoice draft is ready for your review. Please confirm the client and project names by noon today, 19 October.\n\nI have listed the Atlas deposit separately from the final balance, as requested. I will send the invoice after your approval.\n\nReminder: bookkeeping call tomorrow, Tuesday, 20 October at 11 am.\n\nPriya'),
  ];
  emailMessages['demo-harbor-brief'] = [
    emailMessage('demo-harbor-brief', 'harbor-email-1', '09:28', 'Noah Reed', 'noah.reed@example.com', 'Hi Alex,\n\nI am looking for a simple portfolio website for Harbor Studio: a homepage, a project gallery, and a contact page. I love the clean editorial direction in your work.\n\nCould you share your availability for a 20-minute introduction this week? There is no fixed launch date yet.\n\nThanks,\nNoah'),
  ];
  const emailDefinitions = [
    ['demo-atlas-copy', 'Atlas website — approved homepage copy', 'Sam Lee, Alex Rivera', 1],
    ['demo-lumen-checklist', 'Lumen launch — final checklist & page link', 'Tara Chen', 1],
    ['demo-atlas-review', 'Atlas website — 3 pm sign-off review', 'Mira Shah', 0],
    ['demo-harbor-brief', 'Harbor Studio — portfolio website brief', 'Noah Reed', 1],
    ['demo-studio-invoice', 'October invoice — ready for your review', 'Priya Ellis', 0],
  ];
  const threads = emailDefinitions.map(([id, subject, participantSummary, unreadCount]) => {
    const messages = emailMessages[id];
    const last = messages[messages.length - 1];
    return { id, subject, participantSummary, lastCleanedPreview: last.bodyCleanText.replaceAll('\n', ' '), lastMessageAt: last.sentAt, unreadCount, hasAttachments: messages.some((message) => message.hasAttachments === 1) };
  });

  let clusters = [
    { id: 'demo-atlas', name: 'Atlas website', color: 'sky', createdAt: fixedNow - 86400000, updatedAt: fixedNow, memberCount: 4 },
    { id: 'demo-lumen', name: 'Lumen launch', color: 'violet', createdAt: fixedNow - 86400000, updatedAt: fixedNow, memberCount: 3 },
    { id: 'demo-admin', name: 'Studio admin', color: 'amber', createdAt: fixedNow - 86400000, updatedAt: fixedNow, memberCount: 2 },
  ];
  let clusterMap = {
    [`whatsapp:${chatIds.atlas}`]: 'demo-atlas',
    [`whatsapp:${chatIds.mira}`]: 'demo-atlas',
    'gmail:demo-atlas-copy': 'demo-atlas',
    'gmail:demo-atlas-review': 'demo-atlas',
    [`whatsapp:${chatIds.lumen}`]: 'demo-lumen',
    [`whatsapp:${chatIds.dev}`]: 'demo-lumen',
    'gmail:demo-lumen-checklist': 'demo-lumen',
    [`whatsapp:${chatIds.admin}`]: 'demo-admin',
    'gmail:demo-studio-invoice': 'demo-admin',
  };
  let sequence = 0;
  const outputs = [];
  const refreshCounts = () => clusters.forEach((cluster) => {
    cluster.memberCount = Object.values(clusterMap).filter((value) => value === cluster.id).length;
  });
  const addMembers = (clusterId, members = []) => {
    members.forEach(({ source, sourceRef }) => { clusterMap[`${source}:${sourceRef}`] = clusterId; });
    refreshCounts();
  };
  const formatOutput = (sections) => [
    'TODO ITEMS', 'DEADLINES', 'REMINDERS', 'ASSIGNMENTS', 'PROGRESS UPDATES',
  ].map((heading) => `${heading}:\n${sections[heading]?.map((item, index) => `${index + 1}. ${item}`).join('\n') || 'None'}`).join('\n\n');
  const workflowOutputs = {
    atlas: formatOutput({
      'TODO ITEMS': ['Finish mobile spacing and test the contact form.', 'Replace staging copy with the approved version 3.', 'Update the footer email address.'],
      DEADLINES: ['Mobile preview: today, 19 October, by 1 pm.', 'Website sign-off review: today at 3 pm.', 'Website launch: Thursday, 22 October.'],
      REMINDERS: ['Keep the simple contact form; no booking calendar for launch.', 'Keep service names exactly as written in the approved copy.'],
      ASSIGNMENTS: ['Alex: share the mobile preview and contact-form test results.', 'Mira: arrange the final content check after sign-off.'],
      'PROGRESS UPDATES': ['Desktop layouts and homepage copy are approved.'],
    }),
    lumen: formatOutput({
      'TODO ITEMS': ['Swap in the approved green hero image.', 'Test signup on desktop and mobile, including the welcome email.'],
      DEADLINES: ['Post QA results: today, 19 October, by 4 pm.', 'Final landing-page link: Tuesday, 20 October, by 5 pm.', 'Newsletter: Wednesday, 21 October, at 10 am.'],
      REMINDERS: ['Use the green hero image approved on the call.'],
      ASSIGNMENTS: ['Alex: finish QA and send Tara the final page link.'],
      'PROGRESS UPDATES': ['Landing page is in staging; all three product photos are approved.'],
    }),
    admin: formatOutput({
      'TODO ITEMS': ['Review the October invoice draft and confirm project names.'],
      DEADLINES: ['Invoice review: today, 19 October, by noon.', 'Bookkeeping call: Tuesday, 20 October, at 11 am.'],
      REMINDERS: ['Keep the Atlas deposit separate from the final balance.'],
      ASSIGNMENTS: ['Alex: approve the invoice draft.', 'Priya: send the invoice after approval.'],
      'PROGRESS UPDATES': ['Invoice draft is ready; the Atlas deposit is listed separately.'],
    }),
  };
  const blockedSend = async () => { throw new Error('Screenshot demo: outbound messaging is disabled.'); };
  const updateInfo = { kind: 'up-to-date', currentVersion: '0.1.13', latestVersion: '0.1.13', channel: 'beta' };
  const setConnector = async (connector, status) => {
    const record = snapshot.connectors.find((entry) => entry.connector === connector);
    if (record) { record.status = status; record.updatedAt = isoNow; record.lastError = null; }
    emit('runtime', snapshot);
    if (connector === 'whatsapp') emit('whatsapp', { type: 'connection', payload: { connection: status === 'disconnected' ? 'close' : 'open' } });
    return copy(snapshot);
  };

  window.chaiMeta = { platform: 'darwin', versions: { electron: '39.0.0', chrome: '142.0.0', node: '22.0.0' } };
  window.chaiApi = {
    getRuntimeState: async () => copy(snapshot),
    updateSettings: async (patch) => {
      Object.assign(snapshot.settings, patch);
      emit('runtime', snapshot);
      return copy(snapshot);
    },
    connectConnector: async (connector) => setConnector(connector, 'connected'),
    disconnectConnector: async (connector) => setConnector(connector, 'disconnected'),
    syncConnector: async (connector) => {
      emit('connector', { connector, type: 'sync.started' });
      const result = await setConnector(connector, 'connected');
      emit('connector', { connector, type: 'sync.completed' });
      return result;
    },
    gmail: {
      listThreads: async () => copy(threads),
      getThread: async (id) => {
        const thread = threads.find((entry) => entry.id === id);
        return thread ? copy({ thread, messages: emailMessages[id] }) : null;
      },
      sendEmail: blockedSend,
      downloadAttachment: async () => ({ saved: false }),
      openAttachment: async () => ({ opened: false }),
    },
    whatsapp: {
      listChats: async () => copy(chats),
      getChat: async (jid) => copy(waMessages[jid] || []),
      markChatRead: async (jid) => {
        const chat = chats.find((entry) => entry.jid === jid);
        if (chat) chat.unread = 0;
        return { ok: true };
      },
      sendText: blockedSend,
      getStatus: async () => ({ connected: snapshot.connectors.some((entry) => entry.connector === 'whatsapp' && entry.status === 'connected'), pairedAt: isoNow, lastSyncedAt: isoNow, lastQr: null, reconnectCount: 0, loggedOut: false }),
    },
    agentBridge: {
      status: async () => ({ enabled: false, running: false, host: null, port: null, rpcUrl: null, mcpUrl: null, tokenPath: null, scopes: [] }),
      audit: async () => [],
    },
    cluster: {
      list: async () => copy({ clusters, clusterMap }),
      create: async ({ name, color = 'emerald', members = [] }) => {
        const cluster = { id: `demo-created-${++sequence}`, name, color, createdAt: fixedNow, updatedAt: fixedNow, memberCount: 0 };
        clusters.push(cluster);
        addMembers(cluster.id, members);
        return copy({ cluster, clusterMap });
      },
      rename: async ({ id, name, color }) => {
        const cluster = clusters.find((entry) => entry.id === id);
        if (!cluster) return null;
        Object.assign(cluster, { name, updatedAt: fixedNow }, color === undefined ? {} : { color });
        return copy(cluster);
      },
      remove: async (id) => {
        clusters = clusters.filter((entry) => entry.id !== id);
        clusterMap = Object.fromEntries(Object.entries(clusterMap).filter(([, clusterId]) => clusterId !== id));
        return copy({ clusterMap });
      },
      addMembers: async ({ clusterId, members }) => {
        const cluster = clusters.find((entry) => entry.id === clusterId) || null;
        if (cluster) addMembers(clusterId, members);
        return copy({ cluster, clusterMap });
      },
      removeMember: async ({ clusterId, source, sourceRef }) => {
        const key = `${source}:${sourceRef}`;
        if (clusterMap[key] === clusterId) delete clusterMap[key];
        refreshCounts();
        return copy({ clusterMap });
      },
      listMembers: async (clusterId) => Object.entries(clusterMap).filter(([, id]) => id === clusterId).map(([key]) => {
        const index = key.indexOf(':');
        return { clusterId, source: key.slice(0, index), sourceRef: key.slice(index + 1), addedAt: fixedNow };
      }),
      clearAll: async () => { clusters = []; clusterMap = {}; return { clusters: [], clusterMap: {} }; },
    },
    ai: {
      extractWorkflow: async (prompt) => {
        if (/invoice draft|bookkeeping/i.test(prompt)) return workflowOutputs.admin;
        if (/Lumen/i.test(prompt)) return workflowOutputs.lumen;
        if (/Atlas/i.test(prompt)) return workflowOutputs.atlas;
        return formatOutput({});
      },
      chooseModelFile: async () => ({ canceled: true }),
      saveOutput: async (input) => {
        const output = { id: `demo-output-${outputs.length + 1}`, ...copy(input), createdAt: fixedNow };
        outputs.push(output);
        return copy(output);
      },
      listOutputs: async (clusterId) => copy(outputs.filter((entry) => entry.clusterId === clusterId)),
    },
    migration: { retry: async () => copy(snapshot) },
    diagnostics: { export: async () => ({ saved: false }) },
    update: {
      check: async () => { emit('update', { kind: 'check-result', info: updateInfo }); return copy(updateInfo); },
      download: async () => ({ kind: 'skipped', message: 'Screenshot demo: downloads are disabled.' }),
      install: async () => ({ kind: 'skipped', message: 'Screenshot demo: installation is disabled.' }),
      lastInfo: async () => copy(updateInfo),
    },
    events: {
      onRuntimeSnapshot: subscribe('runtime'),
      onWhatsAppEvent: subscribe('whatsapp'),
      onConnectorEvent: subscribe('connector'),
      onGmailEvent: subscribe('gmail'),
      onUpdateEvent: subscribe('update'),
      onModelDownload: subscribe('modelDownload'),
    },
  };
  window.__chaiDemo = {
    fixedNow,
    chatIds: copy(chatIds),
    setTheme: (theme) => window.chaiApi.updateSettings({ theme }),
    updateSettings: (patch) => window.chaiApi.updateSettings(patch),
    emit: (kind, value) => emit(kind, value),
    inspect: () => copy({ snapshot, chats, threads, clusters, clusterMap, outputs }),
  };
}
