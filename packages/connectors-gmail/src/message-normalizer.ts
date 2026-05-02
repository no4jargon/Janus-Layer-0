export type GmailHeader = { name?: string; value?: string };

export type GmailPart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
};

export type GmailRawMessage = {
  id: string;
  historyId?: string | number;
  internalDate?: string | number;
  snippet?: string;
  labelIds?: string[];
  payload?: { headers?: GmailHeader[] } & GmailPart;
};

export type AttachmentRef = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

export type NormalizedAddress = { name: string; email: string };

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const base64UrlDecode = (value?: string): string => {
  if (!value) return '';
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64').toString('utf8');
};

export const htmlToText = (html: string): string =>
  html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const collapseQuotedAndSignature = (text: string): string => {
  const lines = text.split('\n');
  const out: string[] = [];
  let quotedCollapsed = false;
  let sigCollapsed = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      out.push('');
      continue;
    }

    if (
      /^>+/.test(trimmed) ||
      /^On\s.+wrote:$/i.test(trimmed) ||
      /^From:\s/i.test(trimmed)
    ) {
      if (!quotedCollapsed) {
        out.push('[Quoted text collapsed]');
        quotedCollapsed = true;
      }
      continue;
    }

    if (
      !sigCollapsed &&
      (/^--\s*$/.test(trimmed) ||
        /^sent from my /i.test(trimmed) ||
        /^best,?$/i.test(trimmed) ||
        /^regards,?$/i.test(trimmed))
    ) {
      out.push('[Signature collapsed]');
      sigCollapsed = true;
      continue;
    }

    if (sigCollapsed) continue;
    out.push(line);
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

export const getHeader = (
  headers: GmailHeader[] | undefined,
  key: string,
): string => {
  const found = (headers || []).find(
    (h) => clean(h.name).toLowerCase() === key.toLowerCase(),
  );
  return clean(found?.value);
};

export const parseAddressList = (value: string): NormalizedAddress[] => {
  if (!clean(value)) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const match = entry.match(/^(.*)<([^>]+)>$/);
      if (match) {
        return {
          name: match[1].replace(/"/g, '').trim(),
          email: match[2].trim().toLowerCase(),
        };
      }
      const email = entry.replace(/"/g, '').trim().toLowerCase();
      return { name: '', email };
    });
};

export const normalizeSubject = (subject: string): string =>
  subject
    .toLowerCase()
    .replace(/^(re|fwd|fw):\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

export const looksAutomated = (msg: {
  senderEmail: string;
  subject: string;
  bodyText: string;
}): boolean => {
  const email = msg.senderEmail.toLowerCase();
  const subject = msg.subject.toLowerCase();
  const body = msg.bodyText.toLowerCase();

  const noReply =
    email.includes('noreply') ||
    email.includes('no-reply') ||
    email.startsWith('donotreply');
  const newsletter =
    subject.includes('newsletter') ||
    subject.includes('weekly digest') ||
    body.includes('unsubscribe') ||
    body.includes('manage preferences');
  const otp =
    subject.includes('otp') ||
    subject.includes('verification code') ||
    body.includes('one-time password') ||
    body.includes('your code is');
  const automated =
    subject.includes('notification') ||
    subject.includes('alert') ||
    subject.includes('automated') ||
    subject.includes('receipt from');

  return noReply || newsletter || otp || automated;
};

export const summarizeParticipants = (
  emails: string[],
  selfEmail: string | null,
): string => {
  const dedup = [...new Set(emails.map((v) => v.toLowerCase()))];
  const filtered = dedup.filter(
    (v) => v && v !== (selfEmail || '').toLowerCase(),
  );
  if (!filtered.length) return selfEmail || 'Unknown';
  return (
    filtered.slice(0, 3).join(', ') +
    (filtered.length > 3 ? ` +${filtered.length - 3}` : '')
  );
};

export type ExtractedBodies = {
  bodyRawText: string;
  bodyRawHtml: string;
  bodyCleanText: string;
  attachments: AttachmentRef[];
};

export const extractBodies = (message: GmailRawMessage): ExtractedBodies => {
  let plainText = '';
  let htmlText = '';
  const attachments: AttachmentRef[] = [];

  const walk = (part?: GmailPart) => {
    if (!part) return;
    const mime = clean(part.mimeType);
    const body = part.body || {};

    if (mime === 'text/plain' && body.data) {
      plainText += `\n${base64UrlDecode(body.data)}`;
    }
    if (mime === 'text/html' && body.data) {
      htmlText += `\n${base64UrlDecode(body.data)}`;
    }

    if (body.attachmentId && clean(part.filename)) {
      attachments.push({
        attachmentId: body.attachmentId,
        filename: clean(part.filename),
        mimeType: mime || 'application/octet-stream',
        sizeBytes: Number(body.size || 0),
      });
    }

    for (const child of part.parts || []) walk(child);
  };

  walk(message.payload);

  const bodyRawText = plainText.trim();
  const bodyRawHtml = htmlText.trim();
  const bodyCleanText = collapseQuotedAndSignature(
    bodyRawText || htmlToText(bodyRawHtml || message.snippet || ''),
  );

  return { bodyRawText, bodyRawHtml, bodyCleanText, attachments };
};
