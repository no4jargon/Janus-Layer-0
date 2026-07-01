const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chaiMeta', {
  platform: process.platform,
  versions: process.versions,
});

contextBridge.exposeInMainWorld('chaiApi', {
  getRuntimeState: () => ipcRenderer.invoke('chai:get-runtime-state'),
  updateSettings: (patch) =>
    ipcRenderer.invoke('chai:update-settings', patch),
  connectConnector: (connector) =>
    ipcRenderer.invoke('chai:connector:connect', connector),
  disconnectConnector: (connector) =>
    ipcRenderer.invoke('chai:connector:disconnect', connector),
  syncConnector: (connector) =>
    ipcRenderer.invoke('chai:connector:sync', connector),

  gmail: {
    listThreads: () => ipcRenderer.invoke('chai:gmail:list-threads'),
    getThread: (threadId) =>
      ipcRenderer.invoke('chai:gmail:get-thread', threadId),
    sendEmail: (payload) => ipcRenderer.invoke('chai:gmail:send', payload),
    downloadAttachment: (attachmentId) =>
      ipcRenderer.invoke('chai:gmail:download-attachment', attachmentId),
    openAttachment: (attachmentId) =>
      ipcRenderer.invoke('chai:gmail:open-attachment', attachmentId),
  },

  whatsapp: {
    listChats: () => ipcRenderer.invoke('chai:whatsapp:list-chats'),
    getChat: (jid) => ipcRenderer.invoke('chai:whatsapp:get-chat', jid),
    sendText: (payload) =>
      ipcRenderer.invoke('chai:whatsapp:send', payload),
    getStatus: () => ipcRenderer.invoke('chai:whatsapp:status'),
  },

  cluster: {
    list: () => ipcRenderer.invoke('chai:cluster:list'),
    create: (input) => ipcRenderer.invoke('chai:cluster:create', input),
    rename: (input) => ipcRenderer.invoke('chai:cluster:rename', input),
    remove: (id) => ipcRenderer.invoke('chai:cluster:delete', id),
    addMembers: (input) =>
      ipcRenderer.invoke('chai:cluster:add-members', input),
    removeMember: (input) =>
      ipcRenderer.invoke('chai:cluster:remove-member', input),
    listMembers: (clusterId) =>
      ipcRenderer.invoke('chai:cluster:list-members', clusterId),
    clearAll: () => ipcRenderer.invoke('chai:cluster:clear-all'),
  },

  ai: {
    extractWorkflow: (text) =>
      ipcRenderer.invoke('chai:ai:extract-workflow', text),
    chooseModelFile: () => ipcRenderer.invoke('chai:ai:choose-model-file'),
    saveOutput: (input) => ipcRenderer.invoke('chai:ai:save-output', input),
    listOutputs: (clusterId) =>
      ipcRenderer.invoke('chai:ai:list-outputs', clusterId),
  },

  migration: {
    retry: () => ipcRenderer.invoke('chai:migration:retry'),
  },

  diagnostics: {
    export: () => ipcRenderer.invoke('chai:diagnostics:export'),
  },

  update: {
    check: (input) => ipcRenderer.invoke('chai:update:check', input),
    download: () => ipcRenderer.invoke('chai:update:download'),
    install: () => ipcRenderer.invoke('chai:update:install'),
    lastInfo: () => ipcRenderer.invoke('chai:update:last'),
  },

  events: {
    onRuntimeSnapshot: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('chai:runtime-snapshot', listener);
      return () =>
        ipcRenderer.removeListener('chai:runtime-snapshot', listener);
    },
    onWhatsAppEvent: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('chai:whatsapp:event', listener);
      return () =>
        ipcRenderer.removeListener('chai:whatsapp:event', listener);
    },
    onConnectorEvent: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('chai:connector:event', listener);
      return () =>
        ipcRenderer.removeListener('chai:connector:event', listener);
    },
    onGmailEvent: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('chai:gmail:event', listener);
      return () =>
        ipcRenderer.removeListener('chai:gmail:event', listener);
    },
    onUpdateEvent: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('chai:update:event', listener);
      return () =>
        ipcRenderer.removeListener('chai:update:event', listener);
    },
    onModelDownload: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('chai:ai:model-download', listener);
      return () =>
        ipcRenderer.removeListener('chai:ai:model-download', listener);
    },
  },
});
