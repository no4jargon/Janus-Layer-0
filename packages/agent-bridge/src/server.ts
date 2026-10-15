import crypto from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Logger } from '@chai/core';
import { bridgeBaseUrl, loopbackHost, type AgentBridgeConfig } from './config.js';
import type { AgentBridgeService } from './service.js';
import { callAgentBridgeTool, handleMcpJsonRpc, SUPPORTED_MCP_PROTOCOL_VERSIONS } from './mcp.js';

export type AgentBridgeHttpServerOptions = {
  service: AgentBridgeService;
  config: AgentBridgeConfig;
  logger: Logger;
};

export type AgentBridgeHttpServer = {
  start(): Promise<void>;
  close(): Promise<void>;
  status(): {
    enabled: boolean;
    running: boolean;
    host: string;
    port: number;
    rpcUrl: string;
    mcpUrl: string;
    tokenPath: string;
    scopes: string[];
  };
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const readJson = async (req: IncomingMessage): Promise<unknown> => {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new HttpError(415, 'Content-Type must be application/json');
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 2_000_000) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
};

const sendJson = (res: ServerResponse, status: number, payload: unknown) => {
  if (res.destroyed || res.writableEnded) return;
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
};

const tokenFromRequest = (req: IncomingMessage): string => {
  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const header = req.headers['x-chai-agent-token'];
  return Array.isArray(header) ? header[0] || '' : header || '';
};

export const createAgentBridgeHttpServer = (
  options: AgentBridgeHttpServerOptions,
): AgentBridgeHttpServer => {
  const host = loopbackHost(options.config.host);
  if (!options.config.token) throw new Error('The local agent bridge requires a bearer token');
  let server: Server | null = null;
  let running = false;
  let port = options.config.port;
  let starting: Promise<void> | null = null;
  const baseUrl = () => bridgeBaseUrl(host, port);

  const requireAuth = (req: IncomingMessage, res: ServerResponse): boolean => {
    const given = Buffer.from(tokenFromRequest(req));
    const expected = Buffer.from(options.config.token);
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return true;
    res.setHeader('www-authenticate', 'Bearer');
    sendJson(res, 401, { ok: false, error: 'Unauthorized' });
    return false;
  };

  const start = async () => {
    if (!options.config.enabled || running) return;
    if (starting) return starting;
    server = createServer(async (req, res) => {
      try {
        // Native agents omit Origin. Browser requests must originate from this
        // exact local endpoint; neither arbitrary websites nor rebound hosts can call it.
        const authority = new URL(baseUrl()).host;
        if (req.headers.host !== authority ||
            (req.headers.origin !== undefined && req.headers.origin !== baseUrl())) {
          sendJson(res, 403, { ok: false, error: 'Forbidden origin or host' });
          return;
        }
        const url = new URL(req.url || '/', baseUrl());
        if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/health') {
          sendJson(res, 200, { ok: true, service: 'chai-agent-bridge',
            mcpUrl: `${baseUrl()}/mcp`, rpcUrl: `${baseUrl()}/rpc` });
          return;
        }
        if (!['/status', '/rpc', '/mcp'].includes(url.pathname)) {
          sendJson(res, 404, { ok: false, error: 'Not found' });
          return;
        }
        if (!requireAuth(req, res)) return;
        if (req.method === 'GET' && url.pathname === '/status') {
          sendJson(res, 200, { ok: true, status: status() });
          return;
        }
        if (req.method !== 'POST' || url.pathname === '/status') {
          res.setHeader('allow', url.pathname === '/status' ? 'GET' : 'POST');
          sendJson(res, 405, { ok: false, error: 'Method not allowed' });
          return;
        }
        if (url.pathname === '/mcp') {
          const version = req.headers['mcp-protocol-version'];
          if (version !== undefined &&
              (typeof version !== 'string' || !SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(version))) {
            throw new HttpError(400, 'Unsupported MCP protocol version');
          }
        }
        const payload = await readJson(req);
        if (url.pathname === '/mcp') {
          const result = await handleMcpJsonRpc(options.service, payload);
          if (result === null) { res.writeHead(202); res.end(); return; }
          sendJson(res, 200, result);
          return;
        }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          throw new HttpError(400, 'RPC request must be an object');
        }
        const { method, params = {} } = payload as { method?: unknown; params?: unknown };
        if (typeof method !== 'string') throw new HttpError(400, 'RPC method is required');
        try {
          const result = await callAgentBridgeTool(options.service, method, params);
          sendJson(res, 200, { ok: true, result });
        } catch (error) {
          throw new HttpError(400, error instanceof Error ? error.message : String(error));
        }
      } catch (error) {
        sendJson(res, error instanceof HttpError ? error.status : 500, {
          ok: false, error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    server.requestTimeout = 30_000;
    server.headersTimeout = 10_000;
    starting = new Promise<void>((resolve, reject) => {
      const current = server!;
      current.once('error', reject);
      current.listen(options.config.port, host, () => {
        current.off('error', reject);
        const address = current.address();
        if (address && typeof address !== 'string') port = address.port;
        running = true;
        options.logger.info('agent bridge server started', {
          rpcUrl: `${baseUrl()}/rpc`, mcpUrl: `${baseUrl()}/mcp`, tokenPath: options.config.tokenPath,
        });
        resolve();
      });
    });
    try { await starting; } finally { starting = null; }
  };

  const close = async () => {
    if (starting) await starting.catch(() => {});
    const current = server;
    if (!current) return;
    await new Promise<void>((resolve) => {
      const deadline = setTimeout(() => current.closeAllConnections(), 5_000);
      deadline.unref();
      current.close(() => { clearTimeout(deadline); resolve(); });
      current.closeIdleConnections();
    });
    running = false;
    server = null;
  };

  const status = () => ({
    enabled: options.config.enabled, running, host, port,
    rpcUrl: `${baseUrl()}/rpc`, mcpUrl: `${baseUrl()}/mcp`,
    tokenPath: options.config.tokenPath, scopes: options.config.scopes,
  });

  return { start, close, status };
};
