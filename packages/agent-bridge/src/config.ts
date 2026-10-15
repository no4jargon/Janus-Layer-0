import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Logger } from '@chai/core';

export type AgentBridgeConfig = {
  enabled: boolean;
  host: string;
  port: number;
  token: string;
  tokenPath: string;
  rpcUrl: string;
  mcpUrl: string;
  scopes: string[];
};

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 43124;

export const loopbackHost = (host: string): string => {
  if (host === 'localhost') return DEFAULT_HOST;
  if (host === DEFAULT_HOST || host === '::1') return host;
  throw new Error('The local agent bridge host must be 127.0.0.1, localhost, or ::1');
};

export const bridgeBaseUrl = (host: string, port: number): string =>
  `http://${host === '::1' ? '[::1]' : host}:${port}`;

const SCOPES = [
  'read:messages',
  'send:messages',
  'manage:watches',
  'read:files:any',
];

const cleanPort = (raw: string | undefined): number => {
  const parsed = Number(raw || '');
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536
    ? parsed
    : DEFAULT_PORT;
};

export const loadAgentBridgeConfig = (input: {
  baseDir: string;
  logger: Logger;
}): AgentBridgeConfig => {
  const enabled = process.env.CHAI_AGENT_BRIDGE_DISABLED !== '1';
  const host = loopbackHost(process.env.CHAI_AGENT_BRIDGE_HOST || DEFAULT_HOST);
  const port = cleanPort(process.env.CHAI_AGENT_BRIDGE_PORT);
  const tokenPath = path.join(input.baseDir, 'agent-bridge.json');

  let token = process.env.CHAI_AGENT_BRIDGE_TOKEN || '';
  if (!token && existsSync(tokenPath)) {
    try {
      const parsed = JSON.parse(readFileSync(tokenPath, 'utf8')) as {
        token?: string;
      };
      token = typeof parsed.token === 'string' ? parsed.token : '';
    } catch (error) {
      input.logger.warn('agent bridge token file unreadable', {
        tokenPath,
        error: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
  }

  {
    const temporaryPath = `${tokenPath}.${crypto.randomUUID()}.tmp`;
    try {
      mkdirSync(path.dirname(tokenPath), { recursive: true });
      writeFileSync(
        temporaryPath,
        JSON.stringify(
          {
            token,
            host,
            port,
            scopes: SCOPES,
            updatedAt: new Date().toISOString(),
          },
          null,
          2,
        ) + '\n',
        { mode: 0o600 },
      );
      renameSync(temporaryPath, tokenPath);
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      input.logger.warn('agent bridge token file write failed', {
        tokenPath,
        error: error instanceof Error ? error.name : 'UnknownError',
      });
      throw new Error('Unable to save the local agent bridge token file');
    }
  }

  return {
    enabled,
    host,
    port,
    token,
    tokenPath,
    rpcUrl: `${bridgeBaseUrl(host, port)}/rpc`,
    mcpUrl: `${bridgeBaseUrl(host, port)}/mcp`,
    scopes: SCOPES,
  };
};
