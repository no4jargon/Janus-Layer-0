import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const parseEnvLine = (line) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const idx = trimmed.indexOf('=');
  if (idx <= 0) return null;

  const key = trimmed.slice(0, idx).trim();
  if (!key) return null;

  let value = trimmed.slice(idx + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
};

export const loadEnvFileIfPresent = (envPath) => {
  if (!existsSync(envPath)) return;

  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;

    if (Object.prototype.hasOwnProperty.call(process.env, parsed.key)) {
      continue;
    }

    process.env[parsed.key] = parsed.value;
  }
};

export const loadJanusEnv = (repoRoot) => {
  loadEnvFileIfPresent(path.join(repoRoot, '.env'));
};
