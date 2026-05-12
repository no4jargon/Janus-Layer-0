import { existsSync } from 'node:fs';
import { WORKFLOW_PROMPT } from './workflow-prompt.js';

export type WorkflowExtractorOptions = {
  /** Absolute path to a local .gguf model. Overrides the bundled default. */
  modelPath?: string | null;
  /** Directory used to download/cache the default model when no path is set. */
  modelsDir?: string | null;
  contextSize?: number;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Called with download progress for the default model. */
  onModelDownloadProgress?: (status: {
    transferredBytes: number;
    totalBytes: number;
  }) => void;
};

export type WorkflowExtractor = {
  /** Path the user explicitly configured (or null when relying on the default). */
  modelPath: string | null;
  /** Resolved path of the model that was actually loaded (populated after first call). */
  resolvedModelPath: () => string | null;
  /** Eagerly download (if needed) and load the model. Safe to call multiple times. */
  prepare(): Promise<void>;
  extract(text: string): Promise<string>;
  dispose(): Promise<void>;
};

/**
 * Default model: Google's Gemma 3 4B Instruct, Q4_K_M quant (~2.5GB).
 * Architecture is supported by the stock node-llama-cpp prebuilt binary.
 */
export const DEFAULT_MODEL_URI =
  'hf:unsloth/gemma-3-4b-it-GGUF:gemma-3-4b-it-Q4_K_M.gguf';
export const DEFAULT_MODEL_LABEL = 'Gemma 3 4B Instruct (Q4_K_M)';

const DEFAULT_CONTEXT_SIZE = 4096;
const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_TEMPERATURE = 0.1;
const DEFAULT_TIMEOUT_MS = 180_000;

const trimOrNull = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

type LlamaCppModule = typeof import('node-llama-cpp');
type LlamaInstance = Awaited<ReturnType<LlamaCppModule['getLlama']>>;
type LlamaModel = Awaited<ReturnType<LlamaInstance['loadModel']>>;

let cachedLlamaModulePromise: Promise<LlamaCppModule> | null = null;

const loadLlamaModule = (): Promise<LlamaCppModule> => {
  if (!cachedLlamaModulePromise) {
    cachedLlamaModulePromise = import('node-llama-cpp');
  }
  return cachedLlamaModulePromise;
};

export const createWorkflowExtractor = (
  input: WorkflowExtractorOptions = {},
): WorkflowExtractor => {
  const explicitModelPath = trimOrNull(input.modelPath);
  const envOverride = trimOrNull(process.env.JANUS_LLM_MODEL_PATH);
  const modelsDir = trimOrNull(input.modelsDir);

  const contextSize = input.contextSize ?? DEFAULT_CONTEXT_SIZE;
  const maxTokens = input.maxTokens ?? DEFAULT_MAX_TOKENS;
  const temperature = input.temperature ?? DEFAULT_TEMPERATURE;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let llama: LlamaInstance | null = null;
  let model: LlamaModel | null = null;
  let resolvedPath: string | null = null;
  let loadingPromise: Promise<LlamaModel> | null = null;

  const resolveDefaultModel = async (
    mod: LlamaCppModule,
  ): Promise<string> => {
    if (!modelsDir) {
      throw new Error(
        'No local LLM model is configured and no models directory is available to download the default into.',
      );
    }
    return mod.resolveModelFile(DEFAULT_MODEL_URI, {
      directory: modelsDir,
      cli: false,
      onProgress: ({ totalSize, downloadedSize }) => {
        input.onModelDownloadProgress?.({
          transferredBytes: downloadedSize,
          totalBytes: totalSize,
        });
      },
    });
  };

  const ensureModel = async (): Promise<LlamaModel> => {
    if (model) return model;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
      const mod = await loadLlamaModule();
      const userPath = explicitModelPath ?? envOverride;

      let modelPath: string;
      if (userPath) {
        if (!existsSync(userPath)) {
          throw new Error(`Model file not found at ${userPath}`);
        }
        modelPath = userPath;
      } else {
        modelPath = await resolveDefaultModel(mod);
      }

      llama = await mod.getLlama();
      const loaded = await llama.loadModel({ modelPath });
      model = loaded;
      resolvedPath = modelPath;
      return loaded;
    })();

    try {
      return await loadingPromise;
    } finally {
      loadingPromise = null;
    }
  };

  const extract = async (text: string): Promise<string> => {
    const loadedModel = await ensureModel();
    const mod = await loadLlamaModule();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const context = await loadedModel.createContext({ contextSize });
    try {
      const completion = new mod.LlamaCompletion({
        contextSequence: context.getSequence(),
      });
      const prompt = `${WORKFLOW_PROMPT}\n\nMessage:\n${text}\n\nWorkflow items:`;
      const output = await completion.generateCompletion(prompt, {
        maxTokens,
        temperature,
        signal: controller.signal,
      });
      const trimmed = output.trim();
      return trimmed || 'No workflow items found.';
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'AbortError' || controller.signal.aborted)
      ) {
        throw new Error(`LLM timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      await context.dispose();
    }
  };

  const dispose = async (): Promise<void> => {
    if (model) {
      try {
        await model.dispose();
      } catch {
        /* swallow — model may already be disposed */
      }
    }
    model = null;
    llama = null;
    resolvedPath = null;
  };

  const prepare = async (): Promise<void> => {
    await ensureModel();
  };

  return {
    modelPath: explicitModelPath ?? envOverride ?? null,
    resolvedModelPath: () => resolvedPath,
    prepare,
    extract,
    dispose,
  };
};
