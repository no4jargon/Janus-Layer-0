import type {
  EmailOutboxMessageRecord,
  WaOutboxMessageRecord,
} from '@chai/db';

export type AgentBridgeChannel = 'whatsapp' | 'gmail';

export type AgentBridgeContext = {
  agentId?: string;
  requestId?: string;
};

export type PersonCandidate = {
  personId: string;
  channel: AgentBridgeChannel;
  label: string;
  address: string;
  conversationId: string | null;
  match: 'exact' | 'partial' | 'literal';
};

export type NormalizedConversation = {
  conversationId: string;
  channel: AgentBridgeChannel;
  title: string;
  preview: string;
  timestamp: number;
  unreadCount: number;
};

export type NormalizedMessage = {
  messageId: string;
  channel: AgentBridgeChannel;
  conversationId: string;
  sender: string;
  timestamp: number;
  text: string;
  direction: 'incoming' | 'outgoing';
  rawSourceId: string;
};

export type AgentBridgeAuditEvent = {
  id: string;
  requestId: string | null;
  agentId: string;
  action: string;
  target: string | null;
  status: 'ok' | 'error' | 'blocked';
  metadata: Record<string, unknown> | null;
  createdAt: number;
};

export type ResponseWatchRecord = {
  id: string;
  personQuery: string;
  instructions: string;
  contextRefs: string[];
  status: 'active' | 'paused';
  createdAt: number;
  updatedAt: number;
};

export type ContextDocument = {
  path: string;
  text: string;
  truncated: boolean;
  error: string | null;
};

export type ResponseTaskRecord = {
  id: string;
  watchId: string;
  personQuery: string;
  instructions: string;
  conversationId: string;
  messageId: string;
  message: NormalizedMessage;
  context: ContextDocument[];
  status: 'pending' | 'completed';
  sentMessageIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type SendMessageInput = AgentBridgeContext & {
  recipients: string[];
  channel?: AgentBridgeChannel;
  text: string;
  clientRequestId: string;
};

export type SendRecipientResult = {
  recipient: string;
  status: 'queued' | 'sending' | 'sent' | 'failed';
  person: PersonCandidate;
  outboxId: string | null;
  messageId: string | null;
  error: string | null;
};

export type SendMessageResult =
  | {
      ok: true;
      results: SendRecipientResult[];
    }
  | {
      ok: false;
      reason: 'ambiguous_recipient' | 'not_found' | 'invalid_input';
      errors: Array<{
        recipient: string;
        message: string;
        candidates?: PersonCandidate[];
      }>;
    };

export type GmailSender = {
  sendEmail(input: {
    clientRequestId: string;
    to?: Array<{ name?: string; email: string }>;
    subject?: string;
    textBody: string;
  }): Promise<EmailOutboxMessageRecord>;
};

export type WhatsAppSender = {
  sendText(input: {
    jid: string;
    text: string;
    clientRequestId: string;
  }): Promise<WaOutboxMessageRecord>;
};
