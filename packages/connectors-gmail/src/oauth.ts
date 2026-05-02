import { createServer } from 'node:http';
import crypto from 'node:crypto';

export const GMAIL_SCOPE = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ');

export type GmailToken = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  expiry_date?: number;
  token_type?: string;
};

export type GmailOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export const parseOauthConfig = (): GmailOAuthConfig => {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    'http://127.0.0.1:43123/oauth/google/callback';
  return { clientId, clientSecret, redirectUri };
};

export const assertOauthConfig = (config: GmailOAuthConfig) => {
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    throw new Error(
      'Missing Gmail OAuth env vars. Required: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI.',
    );
  }
};

const parseRedirect = (redirectUri: string) => {
  const parsed = new URL(redirectUri);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') {
    throw new Error(
      'GOOGLE_REDIRECT_URI must use http://127.0.0.1:<port>/... for desktop local callback flow.',
    );
  }
  return {
    host: parsed.hostname,
    port: Number(parsed.port || '80'),
    path: parsed.pathname,
  };
};

export const exchangeCodeForToken = async (
  config: GmailOAuthConfig,
  code: string,
): Promise<GmailToken> => {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`OAuth exchange failed: ${raw}`);
  }

  const token = JSON.parse(raw) as GmailToken;
  return {
    ...token,
    expiry_date: Date.now() + Number(token.expires_in || 3600) * 1000,
  };
};

export const refreshTokenIfNeeded = async (
  config: GmailOAuthConfig,
  token: GmailToken,
): Promise<GmailToken> => {
  if (token.expiry_date && token.expiry_date > Date.now() + 30_000) {
    return token;
  }

  if (!token.refresh_token) return token;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Gmail token refresh failed: ${raw}`);
  }

  const next = JSON.parse(raw) as GmailToken;
  return {
    ...token,
    ...next,
    expiry_date: Date.now() + Number(next.expires_in || 3600) * 1000,
  };
};

export const authedFetch = async (
  token: GmailToken,
  url: string,
  init?: RequestInit,
): Promise<Response> => {
  const headers = new Headers(init?.headers);
  headers.set('authorization', `Bearer ${token.access_token}`);

  return fetch(url, {
    ...(init || {}),
    headers,
  });
};

export type RunOAuthOptions = {
  config: GmailOAuthConfig;
  openExternal: (url: string) => void;
  timeoutMs?: number;
};

export const runDesktopOAuth = async (
  options: RunOAuthOptions,
): Promise<GmailToken> => {
  assertOauthConfig(options.config);
  const localCallback = parseRedirect(options.config.redirectUri);
  const expectedState = crypto.randomBytes(16).toString('hex');

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', options.config.clientId);
  authUrl.searchParams.set('redirect_uri', options.config.redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', GMAIL_SCOPE);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', expectedState);

  const code: string = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for Google OAuth callback.'));
    }, options.timeoutMs ?? 180_000);

    const server = createServer((req, res) => {
      try {
        const requestUrl = new URL(
          req.url || '/',
          `http://${localCallback.host}:${localCallback.port}`,
        );
        if (requestUrl.pathname !== localCallback.path) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }

        const incomingCode = requestUrl.searchParams.get('code') || '';
        const returnedState = requestUrl.searchParams.get('state') || '';

        if (!incomingCode || returnedState !== expectedState) {
          res.statusCode = 400;
          res.end('OAuth failed. You can close this tab and retry.');
          clearTimeout(timeout);
          server.close();
          reject(new Error('Invalid OAuth callback payload/state mismatch.'));
          return;
        }

        res.statusCode = 200;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(
          '<html><body><h3>Workspace App</h3><p>Gmail connected. You can close this tab and return to the app.</p></body></html>',
        );

        clearTimeout(timeout);
        server.close();
        resolve(incomingCode);
      } catch (error) {
        clearTimeout(timeout);
        server.close();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

    server.listen(localCallback.port, localCallback.host, () => {
      options.openExternal(authUrl.toString());
    });
  });

  const token = await exchangeCodeForToken(options.config, code);
  return refreshTokenIfNeeded(options.config, token);
};

export const gmailApi = (
  pathname: string,
  params?: Record<string, string | undefined | null | number>,
): string => {
  const url = new URL(
    `https://gmail.googleapis.com/gmail/v1/users/me/${pathname}`,
  );
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
};
