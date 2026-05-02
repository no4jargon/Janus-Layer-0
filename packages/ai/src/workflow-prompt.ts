export const WORKFLOW_CATEGORIES = [
  'TODO ITEMS',
  'DEADLINES',
  'REMINDERS',
  'ASSIGNMENTS',
  'PROGRESS UPDATES',
] as const;

export type WorkflowCategory = (typeof WORKFLOW_CATEGORIES)[number];

export const WORKFLOW_PROMPT = `You are an information extraction system.

Task:
Extract workflow-relevant items from the message below.

Categories:
- TODO ITEMS: clear actionable tasks
- DEADLINES: time-bound commitments or due dates
- REMINDERS: things to remember (no clear action)
- ASSIGNMENTS: tasks explicitly assigned to someone
- PROGRESS UPDATES: status updates about ongoing work

Instructions:
- Only extract items that are explicitly stated or strongly implied
- Do NOT hallucinate or infer missing details
- Each item must be atomic (one action per line)
- Rewrite items cleanly and concisely
- If a category has no items, write 'None'
- Do NOT output JSON
- Do NOT add explanations

Output format (strict):

TODO ITEMS:
1. …
2. …

DEADLINES:
1. …
2. …

REMINDERS:
1. …
2. …

ASSIGNMENTS:
1. …
2. …

PROGRESS UPDATES:
1. …
2. …
`;
