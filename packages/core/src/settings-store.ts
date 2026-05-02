import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Logger } from './logger.js';

export type WorkspaceSettings = {
  onboardingCompleted: boolean;
  theme: 'system' | 'light' | 'dark';
  ollamaBaseUrl: string | null;
  ollamaModel: string | null;
};

const DEFAULT_SETTINGS: WorkspaceSettings = {
  onboardingCompleted: false,
  theme: 'system',
  ollamaBaseUrl: null,
  ollamaModel: null,
};

export const createSettingsStore = (input: { baseDir: string; logger: Logger }) => {
  const settingsPath = path.join(input.baseDir, 'settings.json');

  const read = (): WorkspaceSettings => {
    if (!existsSync(settingsPath)) {
      writeFileSync(settingsPath, JSON.stringify(DEFAULT_SETTINGS, null, 2));
      return { ...DEFAULT_SETTINGS };
    }

    try {
      const raw = readFileSync(settingsPath, 'utf8');
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch (error) {
      input.logger.error('failed reading settings, falling back to defaults', {
        error: String(error),
      });
      return { ...DEFAULT_SETTINGS };
    }
  };

  const write = (patch: Partial<WorkspaceSettings>): WorkspaceSettings => {
    const current = read();
    const next = { ...current, ...patch };
    writeFileSync(settingsPath, JSON.stringify(next, null, 2));
    return next;
  };

  return {
    path: settingsPath,
    read,
    write,
  };
};

export type SettingsStore = ReturnType<typeof createSettingsStore>;
