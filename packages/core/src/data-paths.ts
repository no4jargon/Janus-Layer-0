import { mkdirSync } from 'node:fs';
import path from 'node:path';

export type RuntimeMode = 'development' | 'production';

export type AppDataPaths = {
  baseDir: string;
  dbPath: string;
  logsDir: string;
  attachmentsDir: string;
  keystoreDir: string;
};

export const resolveAppDataPaths = (input: {
  mode: RuntimeMode;
  repoRoot: string;
  userDataPath: string;
}): AppDataPaths => {
  const baseDir =
    input.mode === 'development'
      ? path.join(input.repoRoot, '.dev-data')
      : path.join(input.userDataPath, 'data');

  return {
    baseDir,
    dbPath: path.join(baseDir, 'app.db'),
    logsDir: path.join(baseDir, 'logs'),
    attachmentsDir: path.join(baseDir, 'attachments'),
    keystoreDir: path.join(baseDir, 'keystore'),
  };
};

export const ensureAppDataPaths = (paths: AppDataPaths) => {
  mkdirSync(paths.baseDir, { recursive: true });
  mkdirSync(paths.logsDir, { recursive: true });
  mkdirSync(paths.attachmentsDir, { recursive: true });
  mkdirSync(paths.keystoreDir, { recursive: true });
};
