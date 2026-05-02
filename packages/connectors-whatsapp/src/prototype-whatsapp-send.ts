import crypto from 'crypto'
import type { WAMessageKey } from '../src/Types'
import type { WASocket } from '../src'
import { mkMessageKey, type MirrorDb } from './db'

const normalizeJid = (value: string) => value.trim()

export class WhatsAppSendService {
	private db: MirrorDb
	private getSock: () => WASocket | null

	constructor(opts: { db: MirrorDb; getSock: () => WASocket | null }) {
		this.db = opts.db
		this.getSock = opts.getSock
	}

	private makeId(prefix: string) {
		return `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
	}

	private parseQuotedMessageKey(raw?: string | null): WAMessageKey | undefined {
		if (!raw) return undefined
		const existing = this.db.getMessage(raw)
		if (!existing) return undefined
		return {
			remoteJid: existing.remoteJid,
			id: existing.keyId,
			fromMe: existing.fromMe,
			participant: existing.participant || undefined
		}
	}

	async sendText(input: { jid: string; text: string; quotedMessageKey?: string | null; clientRequestId: string }) {
		const chatJid = normalizeJid(input.jid || '')
		const text = String(input.text || '').trim()
		const clientRequestId = String(input.clientRequestId || '').trim()
		if (!chatJid) throw new Error('jid is required')
		if (!text) throw new Error('text is required')
		if (!clientRequestId) throw new Error('clientRequestId is required')

		const existing = this.db.getWaOutboxMessageByClientRequestId(clientRequestId)
		if (existing && (existing.status === 'sent' || existing.status === 'sending')) return existing

		const created =
			existing ||
			this.db.createWaOutboxMessage({
				id: this.makeId('wa_outbox'),
				clientRequestId,
				chatJid,
				text,
				quotedMessageKey: input.quotedMessageKey || null,
				status: 'queued',
				errorCode: null,
				errorMessage: null,
				waMessageKey: null
			})
		if (!created) throw new Error('Failed to queue WhatsApp send request')

		this.db.updateWaOutboxMessageStatus(created.id, { status: 'sending', errorCode: null, errorMessage: null })
		const sock = this.getSock()
		if (!sock) {
			this.db.updateWaOutboxMessageStatus(created.id, {
				status: 'failed',
				errorCode: 'SOCKET_NOT_READY',
				errorMessage: 'WhatsApp socket is not connected'
			})
			throw new Error('WhatsApp socket is not connected')
		}

		try {
			const quoted = this.parseQuotedMessageKey(input.quotedMessageKey)
			const sent = await sock.sendMessage(chatJid, { text }, quoted ? { quoted } : undefined)
			const messageKey = sent?.key ? mkMessageKey(sent.key) : null
			const updated = this.db.updateWaOutboxMessageStatus(created.id, {
				status: 'sent',
				waMessageKey: messageKey,
				errorCode: null,
				errorMessage: null
			})
			return updated || created
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			this.db.updateWaOutboxMessageStatus(created.id, {
				status: 'failed',
				errorCode: 'WA_SEND_FAILED',
				errorMessage: errorMessage
			})
			throw error
		}
	}
}
