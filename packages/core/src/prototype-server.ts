import { existsSync, readFileSync } from 'fs'
import { readFile } from 'fs/promises'
import { createServer } from 'http'
import path from 'path'
import { Boom } from '@hapi/boom'
import P from 'pino'
import qrcode from 'qrcode-terminal'
import { WebSocketServer } from 'ws'

import {
	Browsers,
	DisconnectReason,
	getContentType,
	isJidGroup,
	isJidStatusBroadcast,
	makeCacheableSignalKeyStore,
	makeWASocket,
	normalizeMessageContent
} from '../src'
import { fetchLatestBaileysVersion, useMultiFileAuthState } from '../src'
import type { WAMessage, WAMessageUpdate } from '../src/Types'
import type { EmailMessageRecord, MessageRecord } from './db'
import { MirrorDb, getMessageTimestamp, mkMessageKey } from './db'
import { GmailMirrorService } from './email'
import { WhatsAppSendService } from './whatsapp-send'
import { GmailSendService } from './email-send'

const initialEnvKeys = new Set(Object.keys(process.env))

const loadEnvFile = (envPath: string) => {
	if (!existsSync(envPath)) return
	const raw = readFileSync(envPath, 'utf8')
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) continue
		const idx = trimmed.indexOf('=')
		if (idx <= 0) continue
		const key = trimmed.slice(0, idx).trim()
		if (!key || initialEnvKeys.has(key)) continue
		let value = trimmed.slice(idx + 1).trim()
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1)
		}
		process.env[key] = value
	}
}

const CWD = process.cwd()
loadEnvFile(path.join(CWD, '.env'))
loadEnvFile(path.join(CWD, 'demo', '.env'))

const PORT = Number(process.env.PORT || '3000')
const BASE_DIR = process.cwd()
const PUBLIC_DIR = path.join(BASE_DIR, 'demo', 'public')
const AUTH_DIR = path.join(BASE_DIR, 'baileys_auth_info')
const DB_PATH = path.join(BASE_DIR, 'demo', 'data', 'whatsapp-mirror.db')
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || '180000')
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3:8b'
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/api/email/gmail/oauth/callback`
const ATTACHMENT_CACHE_DIR = process.env.ATTACHMENT_CACHE_DIR || path.join(BASE_DIR, 'demo', 'data', 'email-attachments')
const EMAIL_TOKEN_FILE = path.join(BASE_DIR, 'demo', 'data', 'keystore', 'gmail-token.json')
const WORKFLOW_PROMPT =
	"You are an information extraction system.\n\nTask:\nExtract workflow-relevant items from the message below.\n\nCategories:\n- TODO ITEMS: clear actionable tasks\n- DEADLINES: time-bound commitments or due dates\n- REMINDERS: things to remember (no clear action)\n- ASSIGNMENTS: tasks explicitly assigned to someone\n- PROGRESS UPDATES: status updates about ongoing work\n\nInstructions:\n- Only extract items that are explicitly stated or strongly implied\n- Do NOT hallucinate or infer missing details\n- Each item must be atomic (one action per line)\n- Rewrite items cleanly and concisely\n- If a category has no items, write 'None'\n- Do NOT output JSON\n- Do NOT add explanations\n\nOutput format (strict):\n\nTODO ITEMS:\n1. …\n2. …\n\nDEADLINES:\n1. …\n2. …\n\nREMINDERS:\n1. …\n2. …\n\nASSIGNMENTS:\n1. …\n2. …\n\nPROGRESS UPDATES:\n1. …\n2. …\n"

const logger = P({ level: process.env.LOG_LEVEL || 'info' })
const db = new MirrorDb(DB_PATH)
let activeSock: ReturnType<typeof makeWASocket> | null = null
const emailService = new GmailMirrorService({
	db,
	clientId: GOOGLE_CLIENT_ID,
	clientSecret: GOOGLE_CLIENT_SECRET,
	redirectUri: GOOGLE_REDIRECT_URI,
	attachmentCacheDir: ATTACHMENT_CACHE_DIR,
	tokenFilePath: EMAIL_TOKEN_FILE
})
const whatsappSendService = new WhatsAppSendService({
	db,
	getSock: () => activeSock
})
const gmailSendService = new GmailSendService({
	db,
	clientId: GOOGLE_CLIENT_ID,
	clientSecret: GOOGLE_CLIENT_SECRET,
	tokenFilePath: EMAIL_TOKEN_FILE
})
const wss = new WebSocketServer({ noServer: true })

const broadcast = (payload: unknown) => {
	for (const client of wss.clients) {
		if (client.readyState === 1) {
			client.send(JSON.stringify(payload))
		}
	}
}

const parseTextFromMessage = (message: WAMessage): string => {
	const content = normalizeMessageContent(message.message) as Record<string, any> | undefined
	if (!content) return '[Message]'

	const msgType = getContentType(content as any) as string | undefined
	if (msgType === 'conversation') return content.conversation || '[Message]'
	if (msgType === 'extendedTextMessage') return content.extendedTextMessage?.text || '[Message]'
	if (msgType === 'imageMessage') return content.imageMessage?.caption || '[Image]'
	if (msgType === 'videoMessage') return content.videoMessage?.caption || '[Video]'
	if (msgType === 'audioMessage') return '[Audio]'
	if (msgType === 'documentMessage') return content.documentMessage?.fileName ? `[Document] ${content.documentMessage.fileName}` : '[Document]'
	if (msgType === 'stickerMessage') return '[Sticker]'
	if (msgType === 'locationMessage') return '[Location]'
	if (msgType === 'liveLocationMessage') return '[Live location]'
	if (msgType === 'contactMessage') return '[Contact]'
	if (msgType === 'pollCreationMessage') return content.pollCreationMessage?.name || '[Poll]'
	if (msgType === 'reactionMessage') return '[Reaction]'
	if (msgType === 'protocolMessage') return '[Protocol message]'
	return '[Message]'
}

const messageToApi = (row: MessageRecord) => ({
	messageKey: row.messageKey,
	remoteJid: row.remoteJid,
	keyId: row.keyId,
	fromMe: row.fromMe,
	participant: row.participant,
	senderJid: row.senderJid,
	senderName: db.resolveContactDisplay(row.participant || row.senderJid || null),
	messageTimestamp: row.messageTimestamp,
	time: row.messageTimestamp,
	messageType: row.messageType,
	text: row.text,
	status: row.status,
	isDeleted: row.isDeleted
})

const emailThreadToApi = (row: ReturnType<MirrorDb['getEmailThreads']>[number]) => ({
	id: row.id,
	subject: row.subject,
	participantSummary: row.participantSummary,
	lastCleanedPreview: row.lastCleanedPreview,
	lastMessageAt: row.lastMessageAt,
	unreadCount: row.unreadCount,
	hasAttachments: row.hasAttachments
})

const parseRecipientJson = (value: string) => {
	try {
		const parsed = JSON.parse(value)
		if (Array.isArray(parsed)) return parsed
		return []
	} catch {
		return []
	}
}

const emailMessageToApi = (row: EmailMessageRecord) => {
	const attachments = db.getEmailAttachmentsForMessage(row.id).map(item => ({
		id: item.id,
		filename: item.filename,
		mimeType: item.mimeType,
		sizeBytes: item.sizeBytes,
		cached: !!item.cachedLocalPath
	}))

	return {
		id: row.id,
		threadId: row.threadId,
		senderName: row.senderName,
		senderEmail: row.senderEmail,
		to: parseRecipientJson(row.toJson),
		cc: parseRecipientJson(row.ccJson),
		sentAt: row.sentAt,
		direction: row.direction,
		snippet: row.snippet,
		bodyCleanText: row.bodyCleanText || row.snippet || '',
		hasAttachments: row.hasAttachments === 1,
		attachments
	}
}

const waOutboxToApi = (row: ReturnType<MirrorDb['getWaOutboxMessageById']>) => {
	if (!row) return null
	return {
		id: row.id,
		clientRequestId: row.clientRequestId,
		chatJid: row.chatJid,
		text: row.text,
		quotedMessageKey: row.quotedMessageKey,
		status: row.status,
		errorCode: row.errorCode,
		errorMessage: row.errorMessage,
		waMessageKey: row.waMessageKey,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	}
}

const emailOutboxToApi = (row: ReturnType<MirrorDb['getEmailOutboxMessageById']>) => {
	if (!row) return null
	return {
		id: row.id,
		clientRequestId: row.clientRequestId,
		accountId: row.accountId,
		threadId: row.threadId,
		providerThreadId: row.providerThreadId,
		to: parseRecipientJson(row.toJson),
		cc: parseRecipientJson(row.ccJson),
		subject: row.subject,
		textBody: row.textBody,
		htmlBody: row.htmlBody,
		status: row.status,
		errorCode: row.errorCode,
		errorMessage: row.errorMessage,
		gmailMessageId: row.gmailMessageId,
		gmailThreadId: row.gmailThreadId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	}
}

const buildMessageRow = (message: WAMessage): MessageRecord => {
	const content = normalizeMessageContent(message.message)
	const messageType = getContentType(content as any)
	const key = message.key
	const senderJid = key.fromMe ? key.remoteJid || null : key.participant || key.remoteJid || null

	return {
		messageKey: mkMessageKey(key),
		remoteJid: key.remoteJid || '',
		keyId: key.id || '',
		fromMe: !!key.fromMe,
		participant: key.participant || null,
		senderJid,
		messageTimestamp: getMessageTimestamp(message),
		messageType: messageType || null,
		text: parseTextFromMessage(message),
		status: (message as { status?: number | null }).status ?? null,
		isDeleted: false,
		mediaType: null,
		mediaMime: null,
		mediaPath: null,
		mediaThumbDataUri: null,
		rawContent: JSON.stringify(message)
	}
}

const shouldSkipRemote = (jid?: string | null) => !jid || isJidStatusBroadcast(jid)

const processIncomingMessages = async (messages: WAMessage[]) => {
	for (const message of messages) {
		if (shouldSkipRemote(message.key?.remoteJid)) continue
		const persisted = db.upsertMessage(buildMessageRow(message))
		if (!persisted) continue
		broadcast({ type: 'messages.upsert', payload: { chatId: persisted.remoteJid, message: messageToApi(persisted) } })
	}
}

const processMessageUpdate = async (update: WAMessageUpdate) => {
	const key = mkMessageKey(update.key)
	const existing = db.getMessage(key)
	if (!existing) {
		db.upsertMessageFromUpdate(update)
	} else {
		const text =
			update.update.message === null
				? '[This message was deleted]'
				: update.update.message?.conversation || update.update.message?.extendedTextMessage?.text || existing.text
		db.updateMessage(key, {
			text,
			status: update.update.status ?? existing.status,
			isDeleted: update.update.message === null
		})
	}

	const refreshed = db.getMessage(key)
	if (refreshed) {
		broadcast({ type: 'messages.update', payload: { chatId: refreshed.remoteJid, message: messageToApi(refreshed) } })
	}
}

const processMessageDelete = (data: { keys: any[] } | { jid: string; all: true }) => {
	if ('all' in data && data.all && data.jid) {
		db.deleteAllMessagesForChat(data.jid)
		broadcast({ type: 'messages.delete', payload: { chatId: data.jid, all: true } })
		return
	}

	for (const item of (data as { keys: any[] }).keys || []) {
		const messageKey = mkMessageKey(item)
		db.markMessagesDeleted(messageKey)
		const row = db.getMessage(messageKey)
		if (row) {
			broadcast({ type: 'messages.delete', payload: { chatId: row.remoteJid, messageKey } })
		}
	}
}

const serveStatic = async (res: import('http').ServerResponse, reqPath: string) => {
	const safePath = reqPath === '/' ? '/index.html' : reqPath
	const filePath = path.join(PUBLIC_DIR, safePath)
	const ext = path.extname(filePath)
	const MIME: Record<string, string> = {
		'.html': 'text/html; charset=utf-8',
		'.css': 'text/css; charset=utf-8',
		'.js': 'application/javascript; charset=utf-8'
	}

	try {
		const bytes = await readFile(filePath)
		res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' })
		res.end(bytes)
	} catch {
		res.statusCode = 404
		res.end('not found')
	}
}

const sendJson = (res: import('http').ServerResponse, payload: unknown, statusCode = 200) => {
	res.statusCode = statusCode
	res.setHeader('content-type', 'application/json; charset=utf-8')
	res.end(JSON.stringify(payload))
}

const readJsonBody = async (req: import('http').IncomingMessage): Promise<Record<string, unknown>> => {
	const chunks: Buffer[] = []
	for await (const chunk of req) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
	}
	const raw = Buffer.concat(chunks).toString('utf8').trim()
	if (!raw) return {}
	return JSON.parse(raw) as Record<string, unknown>
}

const runWorkflowExtraction = async (text: string): Promise<string> => {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)

	try {
		const prompt = `${WORKFLOW_PROMPT}\n\nMessage:\n${text}\n\nWorkflow items:`
		const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				model: OLLAMA_MODEL,
				prompt,
				stream: false,
				options: { temperature: 0.1 }
			}),
			signal: controller.signal
		})

		const raw = await response.text()
		let payload: { response?: string; error?: string } | null = null
		try {
			payload = raw ? (JSON.parse(raw) as { response?: string; error?: string }) : null
		} catch {
			payload = null
		}

		if (!response.ok) {
			throw new Error(payload?.error || raw || `Ollama request failed (${response.status})`)
		}

		const output = payload?.response?.trim()
		return output || 'No workflow items found.'
	} catch (error: unknown) {
		if (error instanceof Error && error.name === 'AbortError') {
			throw new Error(`LLM timed out after ${LLM_TIMEOUT_MS}ms`)
		}
		throw error
	} finally {
		clearTimeout(timer)
	}
}

const apiHandler = async (req: import('http').IncomingMessage, res: import('http').ServerResponse, reqUrl: URL) => {
	if (reqUrl.pathname === '/api/chats' && req.method === 'GET') {
		sendJson(res, db.getChats())
		return
	}

	if (reqUrl.pathname.startsWith('/api/thread/') && req.method === 'GET') {
		const jid = decodeURIComponent(reqUrl.pathname.replace('/api/thread/', ''))
		const limit = Number(reqUrl.searchParams.get('limit') || '200')
		const rows = db.getMessagesForChat(jid, limit)
		sendJson(res, rows.map(messageToApi))
		return
	}

	if (reqUrl.pathname === '/api/whatsapp/send' && req.method === 'POST') {
		try {
			const body = await readJsonBody(req)
			const jid = String(body.jid || '').trim()
			const text = String(body.text || '').trim()
			const quotedMessageKey = body.quotedMessageKey ? String(body.quotedMessageKey) : null
			const clientRequestId = String(body.clientRequestId || '').trim()
			if (!jid || !text || !clientRequestId) {
				sendJson(res, { error: 'jid, text and clientRequestId are required' }, 400)
				return
			}

			let queued = db.getWaOutboxMessageByClientRequestId(clientRequestId)
			if (queued && (queued.status === 'sent' || queued.status === 'sending')) {
				sendJson(res, { ok: true, outbox: waOutboxToApi(queued) })
				return
			}
			if (!queued) {
				queued = db.createWaOutboxMessage({
					id: `wa_outbox_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
					clientRequestId,
					chatJid: jid,
					text,
					quotedMessageKey,
					status: 'queued',
					errorCode: null,
					errorMessage: null,
					waMessageKey: null
				})
			}

			if (!queued) throw new Error('Failed to create WA outbox row')
			broadcast({ type: 'wa.send.queued', payload: waOutboxToApi(queued) })

			void whatsappSendService
				.sendText({ jid, text, quotedMessageKey, clientRequestId })
				.then(() => {
					const updated = db.getWaOutboxMessageByClientRequestId(clientRequestId)
					broadcast({ type: 'wa.send.sent', payload: waOutboxToApi(updated) })
				})
				.catch(error => {
					const updated = db.getWaOutboxMessageByClientRequestId(clientRequestId)
					broadcast({
						type: 'wa.send.failed',
						payload: {
							...(waOutboxToApi(updated) || {}),
							errorMessage: error instanceof Error ? error.message : String(error)
						}
					})
				})

			sendJson(res, { ok: true, outbox: waOutboxToApi(queued) })
		} catch (error) {
			sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500)
		}
		return
	}

	if (reqUrl.pathname.startsWith('/api/whatsapp/send/') && req.method === 'GET') {
		const id = decodeURIComponent(reqUrl.pathname.replace('/api/whatsapp/send/', ''))
		const row = db.getWaOutboxMessageById(id)
		if (!row) {
			sendJson(res, { error: 'Outbox message not found' }, 404)
			return
		}
		sendJson(res, waOutboxToApi(row))
		return
	}

	if (reqUrl.pathname === '/api/email/send' && req.method === 'POST') {
		try {
			const body = await readJsonBody(req)
			const clientRequestId = String(body.clientRequestId || '').trim()
			const threadId = body.threadId ? String(body.threadId) : null
			const subject = body.subject ? String(body.subject) : ''
			const textBody = String(body.textBody || '').trim()
			const htmlBody = body.htmlBody ? String(body.htmlBody) : null
			const toInput = Array.isArray(body.to) ? (body.to as Array<{ name?: string; email?: string }>) : []
			const ccInput = Array.isArray(body.cc) ? (body.cc as Array<{ name?: string; email?: string }>) : []
			if (!clientRequestId || !textBody) {
				sendJson(res, { error: 'clientRequestId and textBody are required' }, 400)
				return
			}

			let queued = db.getEmailOutboxMessageByClientRequestId(clientRequestId)
			if (queued && (queued.status === 'sent' || queued.status === 'sending')) {
				sendJson(res, { ok: true, outbox: emailOutboxToApi(queued) })
				return
			}
			if (!queued) {
				const account = db.getEmailAccount('local-user', 'gmail')
				if (!account) {
					sendJson(res, { error: 'Gmail not connected' }, 400)
					return
				}
				queued = db.createEmailOutboxMessage({
					id: `email_outbox_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
					clientRequestId,
					accountId: account.id,
					threadId,
					providerThreadId: threadId ? db.getEmailThreadById(threadId)?.providerThreadId || null : null,
					toJson: JSON.stringify(
						toInput
							.map(item => ({ name: String(item?.name || '').trim(), email: String(item?.email || '').trim().toLowerCase() }))
							.filter(item => !!item.email)
					),
					ccJson: JSON.stringify(
						ccInput
							.map(item => ({ name: String(item?.name || '').trim(), email: String(item?.email || '').trim().toLowerCase() }))
							.filter(item => !!item.email)
					),
					subject,
					textBody,
					htmlBody,
					status: 'queued',
					errorCode: null,
					errorMessage: null,
					gmailMessageId: null,
					gmailThreadId: null
				})
			}
			if (!queued) throw new Error('Failed to create email outbox row')
			broadcast({ type: 'email.send.queued', payload: emailOutboxToApi(queued) })

			void gmailSendService
				.sendEmail({
					clientRequestId,
					threadId,
					to: toInput.map(item => ({ name: String(item?.name || ''), email: String(item?.email || '') })),
					cc: ccInput.map(item => ({ name: String(item?.name || ''), email: String(item?.email || '') })),
					subject,
					textBody,
					htmlBody
				})
				.then(async () => {
					const updated = db.getEmailOutboxMessageByClientRequestId(clientRequestId)
					broadcast({ type: 'email.send.sent', payload: emailOutboxToApi(updated) })
					void runEmailSync('manual')
				})
				.catch(error => {
					const updated = db.getEmailOutboxMessageByClientRequestId(clientRequestId)
					broadcast({
						type: 'email.send.failed',
						payload: {
							...(emailOutboxToApi(updated) || {}),
							errorMessage: error instanceof Error ? error.message : String(error)
						}
					})
				})

			sendJson(res, { ok: true, outbox: emailOutboxToApi(queued) })
		} catch (error) {
			sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500)
		}
		return
	}

	if (reqUrl.pathname.startsWith('/api/email/send/') && req.method === 'GET') {
		const id = decodeURIComponent(reqUrl.pathname.replace('/api/email/send/', ''))
		const row = db.getEmailOutboxMessageById(id)
		if (!row) {
			sendJson(res, { error: 'Outbox message not found' }, 404)
			return
		}
		sendJson(res, emailOutboxToApi(row))
		return
	}

	if (reqUrl.pathname === '/api/email/gmail/oauth/start' && req.method === 'GET') {
		try {
			const url = emailService.getOAuthStartUrl()
			res.statusCode = 302
			res.setHeader('location', url)
			res.end()
		} catch (error) {
			sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500)
		}
		return
	}

	if (reqUrl.pathname === '/api/email/gmail/oauth/callback' && req.method === 'GET') {
		const code = reqUrl.searchParams.get('code') || ''
		const state = reqUrl.searchParams.get('state') || ''
		try {
			await emailService.handleOAuthCallback(code, state)
			broadcastEmailSnapshot()
			res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
			res.end(`<!doctype html><html><body><script>window.location.href='/'</script><p>Gmail connected. <a href="/">Return to app</a></p></body></html>`)
			void runEmailSync('app-open')
		} catch (error) {
			res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' })
			res.end(`<h3>Failed to connect Gmail</h3><pre>${error instanceof Error ? error.message : String(error)}</pre>`) 
		}
		return
	}

	if (reqUrl.pathname === '/api/email/gmail/disconnect' && req.method === 'POST') {
		await emailService.disconnect()
		broadcastEmailSnapshot()
		sendJson(res, { ok: true })
		return
	}

	if (reqUrl.pathname === '/api/email/sync/refresh' && req.method === 'POST') {
		if (!emailService.getStatus().connected) {
			sendJson(res, { error: 'Gmail not connected' }, 400)
			return
		}
		void runEmailSync('manual')
		sendJson(res, { ok: true })
		return
	}

	if (reqUrl.pathname === '/api/email/sync/status' && req.method === 'GET') {
		sendJson(res, emailService.getStatus())
		return
	}

	if (reqUrl.pathname === '/api/email/threads' && req.method === 'GET') {
		sendJson(res, db.getEmailThreads('local-user').map(emailThreadToApi))
		return
	}

	if (reqUrl.pathname.startsWith('/api/email/thread/') && req.method === 'GET') {
		const threadId = decodeURIComponent(reqUrl.pathname.replace('/api/email/thread/', ''))
		const thread = db.getEmailThreadById(threadId)
		if (!thread) {
			sendJson(res, { error: 'Thread not found' }, 404)
			return
		}
		const messages = db.getEmailMessagesForThread(threadId).map(emailMessageToApi)
		sendJson(res, { thread: emailThreadToApi(thread), messages })
		return
	}

	if (reqUrl.pathname.startsWith('/api/email/message/') && req.method === 'GET') {
		const messageId = decodeURIComponent(reqUrl.pathname.replace('/api/email/message/', ''))
		const message = db.getEmailMessageById(messageId)
		if (!message) {
			sendJson(res, { error: 'Message not found' }, 404)
			return
		}
		sendJson(res, emailMessageToApi(message))
		return
	}

	if (reqUrl.pathname.startsWith('/api/email/attachment/') && req.method === 'GET') {
		const attachmentId = decodeURIComponent(reqUrl.pathname.replace('/api/email/attachment/', ''))
		try {
			const file = await emailService.getAttachmentContent(attachmentId)
			const bytes = await readFile(file.path)
			res.writeHead(200, {
				'content-type': file.mimeType,
				'content-disposition': `inline; filename="${file.filename || 'attachment'}"`
			})
			res.end(bytes)
			broadcast({ type: 'email.attachments.cached', payload: { attachmentId } })
		} catch (error) {
			sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 404)
		}
		return
	}

	if (reqUrl.pathname === '/api/ai/extract-workflow' && req.method === 'POST') {
		try {
			const body = await readJsonBody(req)
			const text = String(body.text || '').trim()
			if (!text) {
				sendJson(res, { error: 'Message text is required' }, 400)
				return
			}

			const output = await runWorkflowExtraction(text)
			sendJson(res, { output })
		} catch (error: unknown) {
			logger.error({ error }, 'Workflow extraction failed')
			sendJson(
				res,
				{
					error: 'Failed to run local LLM extraction',
					detail: error instanceof Error ? error.message : String(error)
				},
				500
			)
		}
		return
	}

	sendJson(res, { error: 'Not found' }, 404)
}

const httpServer = createServer((req, res) => {
	if (!req.url) {
		res.statusCode = 400
		res.end('bad request')
		return
	}

	const url = new URL(req.url, `http://localhost:${PORT}`)
	if (url.pathname.startsWith('/api/')) {
		void apiHandler(req, res, url)
	} else {
		void serveStatic(res, url.pathname)
	}
})

httpServer.on('upgrade', (request, socket, head) => {
	if (!request.url || !request.url.startsWith('/ws')) {
		socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
		socket.destroy()
		return
	}
	wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws))
})

wss.on('connection', socket => {
	wsClientCount += 1
	if (wsClientCount === 1) startEmailSyncLoop()

	socket.send(JSON.stringify({ type: 'connected', payload: { status: 'connected' } }))
	socket.send(JSON.stringify({ type: 'chats', payload: db.getChats() }))
	socket.send(JSON.stringify({ type: 'email.threads.upsert', payload: db.getEmailThreads('local-user').map(emailThreadToApi) }))
	socket.send(JSON.stringify({ type: 'email.sync.status', payload: emailService.getStatus() }))

	socket.on('close', () => {
		wsClientCount = Math.max(0, wsClientCount - 1)
		if (wsClientCount === 0) stopEmailSyncLoop()
	})
})

let reconnectHandle: NodeJS.Timeout | null = null
let reconnectCount = 0
let emailSyncHandle: NodeJS.Timeout | null = null
let wsClientCount = 0

const broadcastEmailSnapshot = () => {
	broadcast({ type: 'email.threads.upsert', payload: db.getEmailThreads('local-user').map(emailThreadToApi) })
	broadcast({ type: 'email.sync.status', payload: emailService.getStatus() })
}

const runEmailSync = async (reason: 'app-open' | 'interval' | 'manual') => {
	if (!emailService.getStatus().connected) return
	try {
		await emailService.sync({
			onEvent: evt => {
				broadcast(evt)
				if (evt.type === 'email.threads.upsert' || evt.type.startsWith('email.sync')) {
					broadcast({ type: 'email.sync.status', payload: emailService.getStatus() })
				}
			}
		})
		broadcast({ type: 'email.threads.upsert', payload: db.getEmailThreads('local-user').map(emailThreadToApi) })
	} catch (error) {
		logger.warn({ error, reason }, 'email sync failed')
	}
}

const startEmailSyncLoop = () => {
	if (emailSyncHandle) return
	emailSyncHandle = setInterval(() => {
		void runEmailSync('interval')
	}, 60_000)
}

const stopEmailSyncLoop = () => {
	if (!emailSyncHandle) return
	clearInterval(emailSyncHandle)
	emailSyncHandle = null
}

const startSocket = async () => {
	const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
	const { version } = await fetchLatestBaileysVersion()

	const sock = makeWASocket({
		version,
		logger,
		browser: Browsers.macOS('Chrome'),
		auth: {
			creds: state.creds,
			keys: makeCacheableSignalKeyStore(state.keys, logger)
		},
		getMessage: async () => undefined,
		syncFullHistory: true,
		printQRInTerminal: false,
		shouldSyncHistoryMessage: () => true
	})
	activeSock = sock

	const groupNameQueue = new Set<string>()
	let groupNameWorkerRunning = false
	let groupNameLookups = 0
	const GROUP_LOOKUP_LIMIT = 250
	const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

	const hydrateGroupNames = async (jids: string[]) => {
		for (const jid of jids) {
			if (!isJidGroup(jid)) continue
			if (!db.needsGroupNameLookup(jid)) continue
			groupNameQueue.add(jid)
		}

		if (groupNameWorkerRunning || !groupNameQueue.size) return
		groupNameWorkerRunning = true

		let changed = false
		try {
			while (groupNameQueue.size && groupNameLookups < GROUP_LOOKUP_LIMIT) {
				const jid = groupNameQueue.values().next().value as string
				groupNameQueue.delete(jid)
				groupNameLookups += 1

				try {
					const meta = await sock.groupMetadata(jid)
					const subject = meta?.subject?.trim()
					if (subject) {
						db.upsertChat({ id: jid, name: subject }, subject)
						changed = true
					}
				} catch (error) {
					logger.debug({ jid, error }, 'group metadata lookup failed')
				}

				await delay(250)
			}
		} finally {
			groupNameWorkerRunning = false
			if (changed) {
				broadcast({ type: 'chats.upsert', payload: db.getChats() })
			}
		}
	}

	sock.ev.process(async events => {
		if (events['creds.update']) {
			await saveCreds()
		}

		if (events['connection.update']) {
			const update = events['connection.update']
			if (update.qr) {
				logger.info('QR received. Scan in terminal.')
				qrcode.generate(update.qr, { small: true })
				broadcast({ type: 'connection.update', payload: { connection: 'qr', qr: update.qr } })
			}
			if (update.connection === 'open') {
				reconnectCount = 0
				broadcast({ type: 'connection.update', payload: { connection: 'open' } })
			}
			if (update.connection === 'close') {
				if (activeSock === sock) activeSock = null
				const status = (update.lastDisconnect?.error as Boom | undefined)?.output?.statusCode
				const shouldReconnect = status !== DisconnectReason.loggedOut
				broadcast({ type: 'connection.update', payload: { connection: 'close', status } })

				if (shouldReconnect) {
					reconnectCount += 1
					const delay = Math.min(3000 * 2 ** Math.min(reconnectCount, 5), 30000)
					if (reconnectHandle) clearTimeout(reconnectHandle)
					reconnectHandle = setTimeout(() => {
						void startSocket().catch(e => logger.error({ e }, 'failed reconnect'))
					}, delay)
				} else {
					logger.warn('Logged out. Delete baileys_auth_info and restart to re-pair.')
				}
			}
		}

		if (events['messaging-history.set']) {
			const { chats = [], messages = [], contacts = [], lidPnMappings = [] } = events['messaging-history.set']
			for (const mapping of lidPnMappings) {
				db.upsertLidPnMapping(mapping)
			}
			for (const contact of contacts) {
				db.upsertContact(contact as any)
			}
			for (const chat of chats) {
				if (chat.id) db.upsertChat(chat as any)
			}
			await hydrateGroupNames(chats.map(chat => chat.id).filter((jid): jid is string => !!jid))
			await processIncomingMessages(messages as WAMessage[])
			broadcast({ type: 'history.set', payload: { chats: chats.length, messages: messages.length } })
		}

		if (events['chats.upsert']) {
			const groupIds: string[] = []
			for (const chat of events['chats.upsert']) {
				if (!chat.id) continue
				db.upsertChat(chat as any)
				if (isJidGroup(chat.id)) groupIds.push(chat.id)
			}
			void hydrateGroupNames(groupIds)
			broadcast({ type: 'chats.upsert', payload: db.getChats() })
		}

		if (events['groups.upsert']) {
			const groupIds: string[] = []
			for (const group of events['groups.upsert']) {
				const g = group as any
				db.upsertChat({ id: g.id, name: g.subject || g.name }, g.subject || g.name)
				if (g.id) groupIds.push(g.id)
			}
			void hydrateGroupNames(groupIds)
			broadcast({ type: 'chats.upsert', payload: db.getChats() })
		}

		if (events['groups.update']) {
			const groupIds: string[] = []
			for (const group of events['groups.update']) {
				db.upsertChat(group as any)
				if ((group as any).id) groupIds.push((group as any).id)
			}
			void hydrateGroupNames(groupIds)
			broadcast({ type: 'chats.upsert', payload: db.getChats() })
		}

		if (events['contacts.upsert']) {
			for (const contact of events['contacts.upsert']) db.upsertContact(contact as any)
			broadcast({ type: 'chats.upsert', payload: db.getChats() })
		}
		if (events['contacts.update']) {
			for (const contact of events['contacts.update']) {
				if (contact.id) db.upsertContact(contact as any)
			}
			broadcast({ type: 'chats.upsert', payload: db.getChats() })
		}

		if (events['lid-mapping.update']) {
			db.upsertLidPnMapping(events['lid-mapping.update'])
			broadcast({ type: 'chats.upsert', payload: db.getChats() })
		}

		if (events['messages.upsert']) {
			await processIncomingMessages(events['messages.upsert'].messages as WAMessage[])
		}

		if (events['messages.update']) {
			for (const update of events['messages.update']) await processMessageUpdate(update)
		}

		if (events['messages.delete']) {
			processMessageDelete(events['messages.delete'])
		}
	})
}

const main = async () => {
	logger.info(
		{
			ollamaBaseUrl: OLLAMA_BASE_URL,
			ollamaModel: OLLAMA_MODEL,
			emailOAuthConfigured: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET)
		},
		'LLM runtime config'
	)
	await emailService.bootstrap()
	httpServer.listen(PORT, () => logger.info(`Demo UI running on http://localhost:${PORT}`))
	await startSocket()
	if (emailService.getStatus().connected) {
		void runEmailSync('app-open')
	}
}

main().catch(error => {
	logger.error({ error }, 'Failed to start')
	process.exit(1)
})

process.on('SIGINT', () => {
	logger.info('Shutting down...')
	if (reconnectHandle) clearTimeout(reconnectHandle)
	stopEmailSyncLoop()
	db.close()
	httpServer.close(() => process.exit(0))
})
