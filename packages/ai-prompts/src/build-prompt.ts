export const APPROX_CHARS_PER_TOKEN = 4;
export const MAX_CLUSTER_TOKENS = 10000;
export const MAX_CLUSTER_TEXT_CHARS =
  MAX_CLUSTER_TOKENS * APPROX_CHARS_PER_TOKEN;

export type CollatedMessageSource = 'whatsapp_chat' | 'email_thread';

export type CollatedMessage = {
  sourceType: CollatedMessageSource;
  /** Unix seconds. */
  timestampSec: number;
  sender: string;
  text: string;
};

export type BuildClusterPromptInput = {
  messages: CollatedMessage[];
  lookbackHours: number;
  /** Injectable clock for deterministic tests. Defaults to `Date.now()`. */
  nowMs?: number;
};

export type BuildClusterPromptResult =
  | { ok: true; promptText: string; includedCount: number }
  | { ok: false; reason: 'empty_window' | 'token_budget' };

/**
 * Pure transform: filters messages to the lookback window, sorts ascending by
 * timestamp, and emits a line-per-message body fitted under
 * `MAX_CLUSTER_TEXT_CHARS`. The output is the body the InferenceProvider
 * receives; the WORKFLOW_PROMPT framing is applied by the provider.
 *
 * Lives outside the renderer so the same logic runs on the worker
 * (against server-side message rows) and produces byte-identical input to
 * the model.
 */
export const buildClusterPrompt = ({
  messages,
  lookbackHours,
  nowMs = Date.now(),
}: BuildClusterPromptInput): BuildClusterPromptResult => {
  const windowStartMs = nowMs - lookbackHours * 60 * 60 * 1000;

  const inWindow = messages
    .filter((message) => message.timestampSec > 0 && message.text)
    .filter((message) => message.timestampSec * 1000 >= windowStartMs)
    .sort((a, b) => a.timestampSec - b.timestampSec);

  if (!inWindow.length) return { ok: false, reason: 'empty_window' };

  let charsUsed = 0;
  let includedCount = 0;
  const lines: string[] = [];

  for (const message of inWindow) {
    const line = `[${new Date(message.timestampSec * 1000).toISOString()}] (${message.sourceType}) ${message.sender}: ${message.text}`;
    if (charsUsed + line.length + 1 > MAX_CLUSTER_TEXT_CHARS) break;
    lines.push(line);
    charsUsed += line.length + 1;
    includedCount += 1;
  }

  if (!lines.length) return { ok: false, reason: 'token_budget' };

  return { ok: true, promptText: lines.join('\n'), includedCount };
};
