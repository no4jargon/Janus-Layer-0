import crypto from 'crypto'
import path from 'path'
import { mkdir, readFile, writeFile } from 'fs/promises'
import type { MirrorDb } from './db'

type GmailToken = {
	access_token: string
	expires_in?: number
	expiry_date?: number
	refresh_token?: string
	token_type?: string
}

type SendEmailInput = {
	clientRequestId: string
	threadId?: string | null
	to?: Array<{ name?: string; email: string }> | string[]
	cc?: Array<{ name?: string; email: string }> | string[]
	subject?: string
	textBody: string
	htmlBody?: string | null
}

const clean = (value?: string | null) => (typeof value === 'string' ? value.trim() : '')

const base64UrlEncode = (value: string) =>
	Buffer.from(value, 'utf8')
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/g, '')

const parseRecipients = (values?: Array<{ name?: string; email: string }> | string[]) => {
	const out: Array<{ name: string; email: string }> = []
	for (const item of values || []) {
		if (typeof item === 'string') {
			const email = clean(item).toLowerCase()
			if (email) out.push({ name: '', email })
		} else {
			const email = clean(item.email).toLowerCase()
			if (email) out.push({ name: clean(item.name), email })
		}
	}
	return out
}

const formatAddress = (entry: { name: string; email: string }) => (entry.name ? `"${entry.name.replace(/"/g, '')}" <${entry.email}>` : entry.email)

const parseRecipientJson = (value: string): Array<{ name: string; email: string }> => {
	try {
		const raw = JSON.parse(value)
		if (!Array.isArray(raw)) return []
		return raw
			.map(item => ({ name: clean(item?.name), email: clean(item?.email).toLowerCase() }))
			.filter(item => !!item.email)
	} catch {
		return []
	}
}

export class GmailSendService {
	private db: MirrorDb
	private clientId: string
	private clientSecret: string
	private tokenFilePath: string

	constructor(opts: { db: MirrorDb; clientId: string; clientSecret: string; tokenFilePath: string }) {
		this.db = opts.db
		this.clientId = opts.clientId
		this.clientSecret = opts.clientSecret
		this.tokenFilePath = opts.tokenFilePath
	}

	private makeId(prefix: string) {
		return `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
	}

	private async readTokenFile(): Promise<GmailToken | null> {
		try {
			const raw = await readFile(this.tokenFilePath, 'utf8')
			const parsed = JSON.parse(raw) as GmailToken
			if (!parsed.access_token) return null
			return parsed
		} catch {
			return null
		}
	}

	private async writeTokenFile(token: GmailToken) {
		await mkdir(path.dirname(this.tokenFilePath), { recursive: true })
		await writeFile(this.tokenFilePath, JSON.stringify(token, null, 2), 'utf8')
	}

	private async refreshTokenIfNeeded(token: GmailToken): Promise<GmailToken> {
		const now = Date.now()
		if (token.expiry_date && token.expiry_date > now + 30_000) return token
		if (!token.refresh_token) return token

		const res = await fetch('https://oauth2.googleapis.com/token', {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				client_id: this.clientId,
				client_secret: this.clientSecret,
				grant_type: 'refresh_token',
				refresh_token: token.refresh_token
			})
		})
		const raw = await res.text()
		if (!res.ok) throw new Error(`Failed to refresh Gmail token: ${raw}`)
		const next = JSON.parse(raw) as GmailToken
		const merged: GmailToken = {
			...token,
			...next,
			expiry_date: Date.now() + Number(next.expires_in || 3600) * 1000
		}
		await this.writeTokenFile(merged)
		return merged
	}

	private async authedFetch(url: string, init?: RequestInit) {
		const token = await this.readTokenFile()
		if (!token) throw new Error('Gmail not connected')
		const fresh = await this.refreshTokenIfNeeded(token)
		const headers = new Headers(init?.headers || {})
		headers.set('authorization', `Bearer ${fresh.access_token}`)
		return fetch(url, { ...init, headers })
	}

	private async fetchRfcReplyHeaders(providerMessageId: string) {
		const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(providerMessageId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`
		try {
			const res = await this.authedFetch(url)
			const raw = await res.text()
			if (!res.ok) return { inReplyTo: '', references: '' }
			const payload = JSON.parse(raw) as { payload?: { headers?: Array<{ name?: string; value?: string }> } }
			const headers = payload.payload?.headers || []
			const messageId = clean(headers.find(h => clean(h.name).toLowerCase() === 'message-id')?.value)
			const refs = clean(headers.find(h => clean(h.name).toLowerCase() === 'references')?.value)
			return {
				inReplyTo: messageId,
				references: refs ? `${refs} ${messageId}`.trim() : messageId
			}
		} catch {
			return { inReplyTo: '', references: '' }
		}
	}

	private buildRawMime(input: {
		to: Array<{ name: string; email: string }>
		cc: Array<{ name: string; email: string }>
		subject: string
		textBody: string
		htmlBody?: string | null
		inReplyTo?: string
		references?: string
	}) {
		const headers: string[] = [
			`To: ${input.to.map(formatAddress).join(', ')}`,
			...(input.cc.length ? [`Cc: ${input.cc.map(formatAddress).join(', ')}`] : []),
			`Subject: ${input.subject}`,
			'MIME-Version: 1.0'
		]
		if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`)
		if (input.references) headers.push(`References: ${input.references}`)

		if (input.htmlBody && clean(input.htmlBody)) {
			const boundary = `alt_${crypto.randomUUID()}`
			headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)
			const parts = [
				`--${boundary}`,
				'Content-Type: text/plain; charset="UTF-8"',
				'Content-Transfer-Encoding: 7bit',
				'',
				input.textBody,
				'',
				`--${boundary}`,
				'Content-Type: text/html; charset="UTF-8"',
				'Content-Transfer-Encoding: 7bit',
				'',
				input.htmlBody,
				'',
				`--${boundary}--`,
				''
			].join('\r\n')
			return `${headers.join('\r\n')}\r\n\r\n${parts}`
		}

		headers.push('Content-Type: text/plain; charset="UTF-8"')
		headers.push('Content-Transfer-Encoding: 7bit')
		return `${headers.join('\r\n')}\r\n\r\n${input.textBody}`
	}

	async sendEmail(input: SendEmailInput) {
		const clientRequestId = clean(input.clientRequestId)
		if (!clientRequestId) throw new Error('clientRequestId is required')
		const textBody = clean(input.textBody)
		if (!textBody) throw new Error('textBody is required')

		const account = this.db.getEmailAccount('local-user', 'gmail')
		if (!account) throw new Error('Gmail account not connected')

		const dedupe = this.db.getEmailOutboxMessageByClientRequestId(clientRequestId)
		if (dedupe && (dedupe.status === 'sent' || dedupe.status === 'sending')) return dedupe

		let to = parseRecipients(input.to)
		let cc = parseRecipients(input.cc)
		let subject = clean(input.subject)
		let providerThreadId: string | null = null
		let internalThreadId: string | null = null
		let inReplyTo = ''
		let references = ''

		if (input.threadId) {
			const thread = this.db.getEmailThreadById(input.threadId)
			if (!thread) throw new Error('Email thread not found')
			internalThreadId = thread.id
			providerThreadId = thread.providerThreadId
			subject = subject || thread.subject || '(No subject)'

			const messages = this.db.getEmailMessagesForThread(thread.id)
			const newest = messages[messages.length - 1]
			const latestIncoming = [...messages].reverse().find(msg => msg.direction === 'incoming')
			if (!to.length && latestIncoming?.senderEmail) {
				to = [{ name: clean(latestIncoming.senderName), email: clean(latestIncoming.senderEmail).toLowerCase() }]
			}
			if (!to.length && newest) {
				to = parseRecipientJson(newest.toJson)
			}
			if (!cc.length && newest) {
				cc = parseRecipientJson(newest.ccJson)
			}

			if (newest?.providerMessageId) {
				const replyHeaders = await this.fetchRfcReplyHeaders(newest.providerMessageId)
				inReplyTo = replyHeaders.inReplyTo
				references = replyHeaders.references
			}
		}

		if (!to.length) throw new Error('At least one recipient is required')
		if (!subject) subject = '(No subject)'

		const queued =
			dedupe ||
			this.db.createEmailOutboxMessage({
				id: this.makeId('email_outbox'),
				clientRequestId,
				accountId: account.id,
				threadId: internalThreadId,
				providerThreadId,
				toJson: JSON.stringify(to),
				ccJson: JSON.stringify(cc),
				subject,
				textBody,
				htmlBody: input.htmlBody || null,
				status: 'queued',
				errorCode: null,
				errorMessage: null,
				gmailMessageId: null,
				gmailThreadId: null
			})
		if (!queued) throw new Error('Failed to queue email send request')

		this.db.updateEmailOutboxMessageStatus(queued.id, { status: 'sending', errorCode: null, errorMessage: null })

		try {
			const mime = this.buildRawMime({
				to,
				cc,
				subject,
				textBody,
				htmlBody: input.htmlBody,
				inReplyTo,
				references
			})
			const payload: Record<string, unknown> = { raw: base64UrlEncode(mime) }
			if (providerThreadId) payload.threadId = providerThreadId

			const sendRes = await this.authedFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload)
			})
			const raw = await sendRes.text()
			if (!sendRes.ok) {
				if (raw.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') || raw.includes('insufficientPermissions')) {
					throw new Error(
						'Gmail token is missing send scope. Disconnect Gmail, reconnect, and grant permissions again (gmail.readonly + gmail.send).'
					)
				}
				throw new Error(`Gmail send failed: ${raw}`)
			}
			const sent = JSON.parse(raw) as { id?: string; threadId?: string }

			const updated = this.db.updateEmailOutboxMessageStatus(queued.id, {
				status: 'sent',
				gmailMessageId: clean(sent.id) || null,
				gmailThreadId: clean(sent.threadId) || null,
				errorCode: null,
				errorMessage: null
			})
			return updated || queued
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			this.db.updateEmailOutboxMessageStatus(queued.id, {
				status: 'failed',
				errorCode: 'EMAIL_SEND_FAILED',
				errorMessage: message
			})
			throw error
		}
	}
}
