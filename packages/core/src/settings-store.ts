import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Logger } from './logger.js';

export type JanusSettings = {
  onboardingCompleted: boolean;
  theme: 'system' | 'light' | 'dark';
  llmModelPath: string | null;
  workStartTime: string | null;
  lastOpenedAt: number | null;
  privacyBannerDismissed: boolean;
  tutorialCompleted: boolean;
  freemiumBannerDismissed: boolean;
};

const DEFAULT_SETTINGS: JanusSettings = {
  onboardingCompleted: false,
  theme: 'system',
  llmModelPath: null,
  workStartTime: null,
  lastOpenedAt: null,
  privacyBannerDismissed: false,
  tutorialCompleted: false,
  freemiumBannerDismissed: false,
};

export const createSettingsStore = (input: { baseDir: string; logger: Logger }) => {
  const settingsPath = path.join(input.baseDir, 'settings.json');

  const read = (): JanusSettings => {
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

  const write = (patch: Partial<JanusSettings>): JanusSettings => {
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
