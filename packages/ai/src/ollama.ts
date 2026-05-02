import { WORKFLOW_PROMPT } from './workflow-prompt.js';

export type WorkflowExtractorOptions = {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
};

export type WorkflowExtractor = {
  baseUrl: string;
  model: string;
  extract(text: string): Promise<string>;
};

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'llama3:8b';
const DEFAULT_TIMEOUT_MS = 180_000;

const resolveBaseUrl = (input: WorkflowExtractorOptions): string =>
  input.baseUrl || process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL;

const resolveModel = (input: WorkflowExtractorOptions): string =>
  input.model || process.env.OLLAMA_MODEL || DEFAULT_MODEL;

const resolveTimeout = (input: WorkflowExtractorOptions): number =>
  input.timeoutMs || Number(process.env.LLM_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

export const createWorkflowExtractor = (
  input: WorkflowExtractorOptions = {},
): WorkflowExtractor => {
  const baseUrl = resolveBaseUrl(input);
  const model = resolveModel(input);
  const timeoutMs = resolveTimeout(input);

  const extract = async (text: string): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const prompt = `${WORKFLOW_PROMPT}\n\nMessage:\n${text}\n\nWorkflow items:`;
      const response = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: { temperature: 0.1 },
        }),
        signal: controller.signal,
      });

      const raw = await response.text();
      let payload: { response?: string; error?: string } | null = null;
      try {
        payload = raw
          ? (JSON.parse(raw) as { response?: string; error?: string })
          : null;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        throw new Error(
          payload?.error || raw || `Ollama request failed (${response.status})`,
        );
      }

      const output = payload?.response?.trim();
      return output || 'No workflow items found.';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`LLM timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  return { baseUrl, model, extract };
};
