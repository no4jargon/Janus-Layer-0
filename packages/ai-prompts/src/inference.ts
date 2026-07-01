export type InferenceProviderOptions = {
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type InferenceResult = {
  /** The raw model output text. */
  text: string;
  /** Identifier of the model that produced the output (path, URI, or API model name). */
  model: string;
};

/**
 * Pluggable backend for workflow extraction. Implementations include the
 * in-process llama.cpp runtime on the desktop (`LocalLlamaCppProvider`),
 * a remote worker-fleet proxy used by the control plane / PWA, and future
 * direct API providers (Anthropic, OpenAI).
 *
 * The contract is intentionally small: `extract` receives the collated
 * message body produced by `buildClusterPrompt` and is responsible for
 * applying the `WORKFLOW_PROMPT` framing internally so that consumers stay
 * decoupled from prompt details.
 */
export interface InferenceProvider {
  /** Short identifier used in logs and `ai_outputs.model` rows. */
  readonly providerId: string;
  /** Resolved model identifier once known; null before first prepare/extract. */
  resolvedModel(): string | null;
  /** Eager warmup (download, load weights). Safe to call repeatedly. */
  prepare?(): Promise<void>;
  /** Run extraction over a collated message payload. */
  extract(
    messageBody: string,
    opts?: InferenceProviderOptions,
  ): Promise<InferenceResult>;
  /** Release backing resources. */
  dispose?(): Promise<void>;
}
