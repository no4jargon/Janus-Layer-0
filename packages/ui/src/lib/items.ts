export type SourceType = 'whatsapp_chat' | 'email_thread';

export type ListItem = {
  sourceType: SourceType;
  id: string;
  title: string;
  subtitle: string;
  preview: string;
  time: number;
  unreadCount: number;
  hasAttachments: boolean;
};

export const SOURCE_BADGES: Record<SourceType, string> = {
  whatsapp_chat: 'WhatsApp',
  email_thread: 'Email',
};

export const itemKey = (item: { sourceType: SourceType; id: string }): string =>
  `${item.sourceType}:${item.id}`;

export const sourceFromItem = (
  item: { sourceType: SourceType },
): 'gmail' | 'whatsapp' =>
  item.sourceType === 'email_thread' ? 'gmail' : 'whatsapp';

export const memberKeyToItem = (
  key: string,
): { sourceType: SourceType; id: string } | null => {
  const idx = key.indexOf(':');
  if (idx <= 0) return null;
  const prefix = key.slice(0, idx);
  const id = key.slice(idx + 1);
  if (!id) return null;
  if (prefix === 'whatsapp_chat' || prefix === 'email_thread') {
    return { sourceType: prefix, id };
  }
  // Cluster IPC stores keys as `${source}:${sourceRef}`, e.g. `gmail:xxx`
  if (prefix === 'gmail') return { sourceType: 'email_thread', id };
  if (prefix === 'whatsapp') return { sourceType: 'whatsapp_chat', id };
  return null;
};

export const clusterMapKey = (item: {
  sourceType: SourceType;
  id: string;
}): string =>
  `${item.sourceType === 'email_thread' ? 'gmail' : 'whatsapp'}:${item.id}`;

export const formatTime = (unixSeconds: number | null | undefined): string => {
  if (!unixSeconds) return '';
  return new Date(unixSeconds * 1000).toLocaleString([], {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};
