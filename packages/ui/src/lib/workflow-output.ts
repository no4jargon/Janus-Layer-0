import {
  APPROX_CHARS_PER_TOKEN,
  MAX_CLUSTER_TEXT_CHARS,
  MAX_CLUSTER_TOKENS,
  WORKFLOW_CATEGORIES,
  type WorkflowCategory,
} from '@chai/ai-prompts';

export {
  APPROX_CHARS_PER_TOKEN,
  MAX_CLUSTER_TEXT_CHARS,
  MAX_CLUSTER_TOKENS,
  WORKFLOW_CATEGORIES,
  type WorkflowCategory,
};

export const LOOKBACK_HOURS_OPTIONS = [2, 4, 8, 12] as const;

export const parseWorkflowOutputByCategory = (
  text: string,
): Record<WorkflowCategory, string[]> => {
  const byCategory = Object.fromEntries(
    WORKFLOW_CATEGORIES.map((name) => [name, [] as string[]]),
  ) as Record<WorkflowCategory, string[]>;
  let currentCategory: WorkflowCategory | null = null;

  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const normalized = (
      line.endsWith(':') ? line.slice(0, -1) : line
    ).toUpperCase();
    if ((WORKFLOW_CATEGORIES as readonly string[]).includes(normalized)) {
      currentCategory = normalized as WorkflowCategory;
      continue;
    }
    if (!currentCategory) continue;
    const numbered = line.match(/^\d+\.\s*(.*)$/);
    const dashed = line.match(/^-\s*(.*)$/);
    const value = (numbered?.[1] || dashed?.[1] || '').trim();
    if (!value || /^none$/i.test(value)) continue;
    byCategory[currentCategory].push(value);
  }
  return byCategory;
};

export type ClusterRunResult = {
  cluster: { id: string; name: string };
  status: 'ok' | 'skipped' | 'failed';
  output: string;
  error: string | null;
};

export const renderCollatedClusterOutput = (
  results: ClusterRunResult[],
  lookbackHours: number,
): string => {
  const grouped = Object.fromEntries(
    WORKFLOW_CATEGORIES.map((name) => [name, [] as Array<{ item: string; cluster: { id: string; name: string } }>]),
  ) as Record<
    WorkflowCategory,
    Array<{ item: string; cluster: { id: string; name: string } }>
  >;

  for (const result of results) {
    if (result.status !== 'ok' || !result.output) continue;
    const parsed = parseWorkflowOutputByCategory(result.output);
    for (const category of WORKFLOW_CATEGORIES) {
      for (const item of parsed[category] || []) {
        grouped[category].push({ item, cluster: result.cluster });
      }
    }
  }

  const lines = [`All projects • last ${lookbackHours} hours`, ''];
  for (const category of WORKFLOW_CATEGORIES) {
    lines.push(`${category}:`);
    const rows = grouped[category];
    if (!rows.length) {
      lines.push('None');
      lines.push('');
      continue;
    }
    for (const [idx, row] of rows.entries()) {
      lines.push(`${idx + 1}. (${row.cluster.name}) ${row.item}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
};

export const buildClientRequestId = (prefix: string): string =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
