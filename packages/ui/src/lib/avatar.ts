// Deterministic avatar color + initials from a display name.
// Mirrors the WhatsApp-on-mac look: round filled circle with white initials.

const AVATAR_PALETTE = [
  '#dcf8c6', // mint (WhatsApp accent)
  '#fef3c7', // amber
  '#fed7aa', // peach
  '#fecaca', // pink
  '#ddd6fe', // lavender
  '#bfdbfe', // sky
  '#bbf7d0', // green
  '#e9d5ff', // violet
  '#fde68a', // butter
  '#fdba74', // tangerine
];

const AVATAR_FG = [
  '#14532d',
  '#78350f',
  '#9a3412',
  '#9f1239',
  '#4c1d95',
  '#1e3a8a',
  '#14532d',
  '#581c87',
  '#78350f',
  '#7c2d12',
];

const hashString = (input: string): number => {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
};

export const avatarStyle = (
  seed: string,
): { background: string; color: string } => {
  const idx = hashString(seed || '?') % AVATAR_PALETTE.length;
  return { background: AVATAR_PALETTE[idx], color: AVATAR_FG[idx] };
};

export const avatarInitials = (name: string | null | undefined): string => {
  const cleaned = (name || '').trim();
  if (!cleaned) return '?';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    const word = parts[0];
    return word.slice(0, 2).toUpperCase();
  }
  const first = parts[0]?.[0] ?? '';
  const last = parts[parts.length - 1]?.[0] ?? '';
  return (first + last).toUpperCase();
};
