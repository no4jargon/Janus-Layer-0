import type { AgentBridgeService } from './service.js';

export const SUPPORTED_MCP_PROTOCOL_VERSIONS: readonly string[] = [
  '2025-11-25', '2025-06-18', '2025-03-26',
];

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: any;
};

const toolSchemas = [
  {
    name: 'resolve_person',
    description: 'Resolve a person name, email, or WhatsApp JID to Chai contact candidates.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        channel: { type: 'string', enum: ['whatsapp', 'gmail'] },
        agentId: { type: 'string' },
        requestId: { type: 'string' },
      },
      required: ['query'],
    },
  },
  {
    name: 'has_message_from',
    description: 'Check whether a resolved person has sent messages since a time.',
    inputSchema: {
      type: 'object',
      properties: {
        personQuery: { type: 'string' },
        since: { type: ['string', 'number'] },
        channel: { type: 'string', enum: ['whatsapp', 'gmail'] },
        agentId: { type: 'string' },
        requestId: { type: 'string' },
      },
      required: ['personQuery'],
    },
  },
  {
    name: 'list_conversations',
    description: 'List recent Gmail and WhatsApp conversations mirrored in Chai.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', enum: ['whatsapp', 'gmail'] },
        query: { type: 'string' },
        limit: { type: 'number' },
        agentId: { type: 'string' },
        requestId: { type: 'string' },
      },
    },
  },
  {
    name: 'read_conversation',
    description: 'Read normalized messages from a conversationId such as whatsapp:<jid> or gmail:<threadId>.',
    inputSchema: {
      type: 'object',
      properties: {
        conversationId: { type: 'string' },
        limit: { type: 'number' },
        agentId: { type: 'string' },
        requestId: { type: 'string' },
      },
      required: ['conversationId'],
    },
  },
  {
    name: 'send_message',
    description: 'Send separate direct messages to one or more recipients through Chai.',
    inputSchema: {
      type: 'object',
      properties: {
        recipients: { type: 'array', items: { type: 'string' } },
        channel: { type: 'string', enum: ['whatsapp', 'gmail'] },
        text: { type: 'string' },
        clientRequestId: { type: 'string' },
        agentId: { type: 'string' },
        requestId: { type: 'string' },
      },
      required: ['recipients', 'text', 'clientRequestId'],
    },
  },
  {
    name: 'create_response_watch',
    description: 'Create an agent-managed response watch for messages from a person and optional context files.',
    inputSchema: {
      type: 'object',
      properties: {
        personQuery: { type: 'string' },
        instructions: { type: 'string' },
        contextRefs: { type: 'array', items: { type: 'string' } },
        agentId: { type: 'string' },
        requestId: { type: 'string' },
      },
      required: ['personQuery', 'instructions'],
    },
  },
  {
    name: 'list_response_watches',
    description: 'List stored response watches, including their instructions and active/paused state.',
    inputSchema: { type: 'object', properties: {
      agentId: { type: 'string' }, requestId: { type: 'string' },
    } },
  },
  {
    name: 'set_response_watch_status',
    description: 'Pause or resume a response watch. Paused watches create no new response tasks.',
    inputSchema: { type: 'object', properties: {
      watchId: { type: 'string' }, status: { type: 'string', enum: ['active', 'paused'] },
      agentId: { type: 'string' }, requestId: { type: 'string' },
    }, required: ['watchId', 'status'] },
  },
  {
    name: 'list_response_tasks',
    description: 'List pending or completed response tasks created by response watches.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'completed'] },
        limit: { type: 'number' },
        agentId: { type: 'string' },
        requestId: { type: 'string' },
      },
    },
  },
  {
    name: 'complete_response_task',
    description: 'Mark a response task completed after an external agent sends or handles it.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        sentMessageIds: { type: 'array', items: { type: 'string' } },
        agentId: { type: 'string' },
        requestId: { type: 'string' },
      },
      required: ['taskId'],
    },
  },
];

export const callAgentBridgeTool = async (
  service: AgentBridgeService,
  name: string,
  args: any,
): Promise<unknown> => {
  const schema = toolSchemas.find((tool) => tool.name === name)?.inputSchema;
  if (!schema) throw new Error(`Unknown tool: ${name}`);
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('Tool arguments must be an object');
  }
  for (const key of ('required' in schema ? schema.required : []) || []) {
    if (!(key in args)) throw new Error(`${key} is required`);
  }
  for (const [key, property] of Object.entries(schema.properties)) {
    const value = args[key];
    if (value === undefined) continue;
    const types: string[] = Array.isArray(property.type) ? property.type : [property.type];
    if (!types.some((type) => type === 'array' ? Array.isArray(value) : typeof value === type) ||
        ('enum' in property && !(property.enum as readonly unknown[]).includes(value)) ||
        (Array.isArray(value) && value.some((item) => typeof item !== 'string')) ||
        (typeof value === 'number' && !Number.isFinite(value))) {
      throw new Error(`Invalid ${key}`);
    }
  }
  switch (name) {
    case 'resolve_person':
      return service.resolvePerson(args || {});
    case 'has_message_from':
      return service.hasMessageFrom(args || {});
    case 'list_conversations':
      return service.listConversations(args || {});
    case 'read_conversation':
      return service.readConversation(args || {});
    case 'send_message':
      return service.sendMessage(args || {});
    case 'create_response_watch':
      return service.createResponseWatch(args || {});
    case 'list_response_watches':
      return service.listResponseWatches(args);
    case 'set_response_watch_status':
      return service.setResponseWatchStatus(args);
    case 'list_response_tasks':
      return service.listResponseTasks(args || {});
    case 'complete_response_task':
      return service.completeResponseTask(args || {});
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
};

const success = (id: JsonRpcRequest['id'], result: unknown) => ({
  jsonrpc: '2.0', id, result,
});

const failure = (id: JsonRpcRequest['id'] | null, code: number, message: string) => ({
  jsonrpc: '2.0', id: id ?? null, error: { code, message },
});

export const handleMcpJsonRpc = async (
  service: AgentBridgeService,
  payload: unknown,
): Promise<unknown> => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure(null, -32600, 'Invalid request');
  }
  const request = payload as JsonRpcRequest;
  const hasId = Object.hasOwn(request, 'id');
  if (request.jsonrpc !== '2.0' ||
      (hasId && typeof request.id !== 'string' &&
        !(typeof request.id === 'number' && Number.isFinite(request.id))) ||
      (request.params !== undefined &&
        (!request.params || typeof request.params !== 'object' || Array.isArray(request.params)))) {
    return failure(null, -32600, 'Invalid request');
  }
  if (typeof request.method !== 'string') {
    // Responses to server requests have no work to perform in this stateless server.
    if (hasId && ('result' in request || 'error' in request)) return null;
    return failure(null, -32600, 'Invalid request');
  }
  // Only client notifications are accepted without an id; a malformed tool call
  // must never trigger an outbound message as a notification.
  if (!hasId) {
    return request.method.startsWith('notifications/')
      ? null : failure(null, -32600, 'Requests require an id');
  }
  if (request.method === 'initialize') {
    const requested = request.params?.protocolVersion;
    if (typeof requested !== 'string') return failure(request.id, -32602, 'protocolVersion is required');
    return success(request.id, {
      protocolVersion: SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(requested)
        ? requested : SUPPORTED_MCP_PROTOCOL_VERSIONS[0],
      capabilities: { tools: {} },
      serverInfo: { name: 'chai-agent-bridge', version: '0.1.0' },
    });
  }
  if (request.method === 'ping') return success(request.id, {});
  if (request.method === 'tools/list') return success(request.id, { tools: toolSchemas });
  if (request.method === 'tools/call') {
    const name = request.params?.name;
    if (typeof name !== 'string' || !toolSchemas.some((tool) => tool.name === name)) {
      return failure(request.id, -32602, 'Unknown tool');
    }
    try {
      const result = await callAgentBridgeTool(service, name, request.params?.arguments ?? {});
      const value = result as { ok?: boolean; results?: Array<{ status: string }> };
      return success(request.id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: value.ok === false || Boolean(value.results?.some((item) => item.status !== 'sent')),
      });
    } catch (error) {
      return success(request.id, {
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      });
    }
  }
  return failure(request.id, -32601, `Method not found: ${request.method}`);
};

export const getAgentBridgeToolSchemas = () => toolSchemas;
