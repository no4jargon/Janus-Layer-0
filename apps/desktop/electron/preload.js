import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('workspaceMeta', {
  platform: process.platform,
  versions: process.versions,
});

contextBridge.exposeInMainWorld('workspaceApi', {
  getRuntimeState: () => ipcRenderer.invoke('workspace:get-runtime-state'),
  updateSettings: (patch) =>
    ipcRenderer.invoke('workspace:update-settings', patch),
  connectConnector: (connector) =>
    ipcRenderer.invoke('workspace:connector:connect', connector),
  disconnectConnector: (connector) =>
    ipcRenderer.invoke('workspace:connector:disconnect', connector),
  syncConnector: (connector) =>
    ipcRenderer.invoke('workspace:connector:sync', connector),

  gmail: {
    listThreads: () => ipcRenderer.invoke('workspace:gmail:list-threads'),
    getThread: (threadId) =>
      ipcRenderer.invoke('workspace:gmail:get-thread', threadId),
    sendEmail: (payload) => ipcRenderer.invoke('workspace:gmail:send', payload),
    downloadAttachment: (attachmentId) =>
      ipcRenderer.invoke('workspace:gmail:download-attachment', attachmentId),
    openAttachment: (attachmentId) =>
      ipcRenderer.invoke('workspace:gmail:open-attachment', attachmentId),
  },

  whatsapp: {
    listChats: () => ipcRenderer.invoke('workspace:whatsapp:list-chats'),
    getChat: (jid) => ipcRenderer.invoke('workspace:whatsapp:get-chat', jid),
    sendText: (payload) =>
      ipcRenderer.invoke('workspace:whatsapp:send', payload),
    getStatus: () => ipcRenderer.invoke('workspace:whatsapp:status'),
  },

  cluster: {
    list: () => ipcRenderer.invoke('workspace:cluster:list'),
    create: (input) => ipcRenderer.invoke('workspace:cluster:create', input),
    rename: (input) => ipcRenderer.invoke('workspace:cluster:rename', input),
    remove: (id) => ipcRenderer.invoke('workspace:cluster:delete', id),
    addMembers: (input) =>
      ipcRenderer.invoke('workspace:cluster:add-members', input),
    removeMember: (input) =>
      ipcRenderer.invoke('workspace:cluster:remove-member', input),
    listMembers: (clusterId) =>
      ipcRenderer.invoke('workspace:cluster:list-members', clusterId),
    clearAll: () => ipcRenderer.invoke('workspace:cluster:clear-all'),
  },

  ai: {
    extractWorkflow: (text) =>
      ipcRenderer.invoke('workspace:ai:extract-workflow', text),
    saveOutput: (input) => ipcRenderer.invoke('workspace:ai:save-output', input),
    listOutputs: (clusterId) =>
      ipcRenderer.invoke('workspace:ai:list-outputs', clusterId),
  },

  migration: {
    retry: () => ipcRenderer.invoke('workspace:migration:retry'),
  },

  diagnostics: {
    export: () => ipcRenderer.invoke('workspace:diagnostics:export'),
  },

  update: {
    check: (input) => ipcRenderer.invoke('workspace:update:check', input),
    download: () => ipcRenderer.invoke('workspace:update:download'),
    install: () => ipcRenderer.invoke('workspace:update:install'),
    lastInfo: () => ipcRenderer.invoke('workspace:update:last'),
  },

  events: {
    onRuntimeSnapshot: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('workspace:runtime-snapshot', listener);
      return () =>
        ipcRenderer.removeListener('workspace:runtime-snapshot', listener);
    },
    onWhatsAppEvent: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('workspace:whatsapp:event', listener);
      return () =>
        ipcRenderer.removeListener('workspace:whatsapp:event', listener);
    },
    onConnectorEvent: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('workspace:connector:event', listener);
      return () =>
        ipcRenderer.removeListener('workspace:connector:event', listener);
    },
    onGmailEvent: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('workspace:gmail:event', listener);
      return () =>
        ipcRenderer.removeListener('workspace:gmail:event', listener);
    },
    onUpdateEvent: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('workspace:update:event', listener);
      return () =>
        ipcRenderer.removeListener('workspace:update:event', listener);
    },
  },
});
