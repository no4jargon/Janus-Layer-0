export const CLUSTER_COLORS = [
  { id: 'rose', color: '#fb7185' },
  { id: 'amber', color: '#f59e0b' },
  { id: 'emerald', color: '#10b981' },
  { id: 'sky', color: '#38bdf8' },
  { id: 'violet', color: '#8b5cf6' },
] as const;

export type ClusterColorId = (typeof CLUSTER_COLORS)[number]['id'];

const COLOR_BY_ID = new Map(CLUSTER_COLORS.map((entry) => [entry.id, entry.color]));

export const randomClusterColorId = (): ClusterColorId =>
  CLUSTER_COLORS[Math.floor(Math.random() * CLUSTER_COLORS.length)].id;

export const getClusterColor = (colorId: string | null | undefined): string => {
  if (!colorId) return '#94a3b8';
  return COLOR_BY_ID.get(colorId as ClusterColorId) ?? '#94a3b8';
};

export const clusterDot = (colorId: string | null | undefined): string => {
  switch (colorId) {
    case 'rose':
      return '🔴';
    case 'amber':
      return '🟠';
    case 'emerald':
      return '🟢';
    case 'sky':
      return '🔵';
    case 'violet':
      return '🟣';
    default:
      return '⚪';
  }
};
