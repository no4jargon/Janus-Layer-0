const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('janusMeta', {
  platform: process.platform,
  versions: process.versions,
});

contextBridge.exposeInMainWorld('janusApi', {
  getRuntimeState: () => ipcRenderer.invoke('janus:get-runtime-state'),
  updateSettings: (patch) =>
    ipcRenderer.invoke('janus:update-settings', patch),
  connectConnector: (connector) =>
    ipcRenderer.invoke('janus:connector:connect', connector),
  disconnectConnector: (connector) =>
    ipcRenderer.invoke('janus:connector:disconnect', connector),
  syncConnector: (connector) =>
    ipcRenderer.invoke('janus:connector:sync', connector),

  gmail: {
    listThreads: () => ipcRenderer.invoke('janus:gmail:list-threads'),
    getThread: (threadId) =>
      ipcRenderer.invoke('janus:gmail:get-thread', threadId),
    sendEmail: (payload) => ipcRenderer.invoke('janus:gmail:send', payload),
    downloadAttachment: (attachmentId) =>
      ipcRenderer.invoke('janus:gmail:download-attachment', attachmentId),
    openAttachment: (attachmentId) =>
      ipcRenderer.invoke('janus:gmail:open-attachment', attachmentId),
  },

  whatsapp: {
    listChats: () => ipcRenderer.invoke('janus:whatsapp:list-chats'),
    getChat: (jid) => ipcRenderer.invoke('janus:whatsapp:get-chat', jid),
    sendText: (payload) =>
      ipcRenderer.invoke('janus:whatsapp:send', payload),
    getStatus: () => ipcRenderer.invoke('janus:whatsapp:status'),
  },

  cluster: {
    list: () => ipcRenderer.invoke('janus:cluster:list'),
    create: (input) => ipcRenderer.invoke('janus:cluster:create', input),
    rename: (input) => ipcRenderer.invoke('janus:cluster:rename', input),
    remove: (id) => ipcRenderer.invoke('janus:cluster:delete', id),
    addMembers: (input) =>
      ipcRenderer.invoke('janus:cluster:add-members', input),
    removeMember: (input) =>
      ipcRenderer.invoke('janus:cluster:remove-member', input),
    listMembers: (clusterId) =>
      ipcRenderer.invoke('janus:cluster:list-members', clusterId),
    clearAll: () => ipcRenderer.invoke('janus:cluster:clear-all'),
  },

  ai: {
    extractWorkflow: (text) =>
      ipcRenderer.invoke('janus:ai:extract-workflow', text),
    chooseModelFile: () => ipcRenderer.invoke('janus:ai:choose-model-file'),
    saveOutput: (input) => ipcRenderer.invoke('janus:ai:save-output', input),
    listOutputs: (clusterId) =>
      ipcRenderer.invoke('janus:ai:list-outputs', clusterId),
  },

  migration: {
    retry: () => ipcRenderer.invoke('janus:migration:retry'),
  },

  diagnostics: {
    export: () => ipcRenderer.invoke('janus:diagnostics:export'),
  },

  update: {
    check: (input) => ipcRenderer.invoke('janus:update:check', input),
    download: () => ipcRenderer.invoke('janus:update:download'),
    install: () => ipcRenderer.invoke('janus:update:install'),
    lastInfo: () => ipcRenderer.invoke('janus:update:last'),
  },

  events: {
    onRuntimeSnapshot: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('janus:runtime-snapshot', listener);
      return () =>
        ipcRenderer.removeListener('janus:runtime-snapshot', listener);
    },
    onWhatsAppEvent: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('janus:whatsapp:event', listener);
      return () =>
        ipcRenderer.removeListener('janus:whatsapp:event', listener);
    },
    onConnectorEvent: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('janus:connector:event', listener);
      return () =>
        ipcRenderer.removeListener('janus:connector:event', listener);
    },
    onGmailEvent: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('janus:gmail:event', listener);
      return () =>
        ipcRenderer.removeListener('janus:gmail:event', listener);
    },
    onUpdateEvent: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('janus:update:event', listener);
      return () =>
        ipcRenderer.removeListener('janus:update:event', listener);
    },
    onModelDownload: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('janus:ai:model-download', listener);
      return () =>
        ipcRenderer.removeListener('janus:ai:model-download', listener);
    },
  },
});
