import { mkdir, readFile, stat, unlink, writeFile } from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import type { MirrorDb } from './db'

export type GmailToken = {
	access_token: string
	expires_in?: number
	expiry_date?: number
	refresh_token?: string
	scope?: string
	token_type?: string
}

type GmailHeader = { name?: string; value?: string }
type GmailBody = { size?: number; data?: string; attachmentId?: string }
type GmailPart = {
	partId?: string
	mimeType?: string
	filename?: string
	headers?: GmailHeader[]
	body?: GmailBody
	parts?: GmailPart[]
}
type GmailMessage = {
	id: string
	threadId: string
	historyId?: string
	internalDate?: string
	labelIds?: string[]
	snippet?: string
	payload?: GmailPart
}
type GmailThread = { id: string; historyId?: string; messages?: GmailMessage[] }

type SyncStatus = {
	connected: boolean
	emailAddress: string | null
	lastSyncAt: number | null
	lastSyncStatus: 'idle' | 'syncing' | 'error'
	lastSyncError: string | null
	lastSyncSummary: { threads: number; messages: number } | null
}

const GMAIL_SCOPES = [
	'https://www.googleapis.com/auth/gmail.readonly',
	'https://www.googleapis.com/auth/gmail.send'
]
const GMAIL_SCOPE = GMAIL_SCOPES.join(' ')

const clean = (value?: string | null) => {
	if (typeof value !== 'string') return ''
	return value.trim()
}

const base64UrlDecode = (value?: string) => {
	if (!value) return ''
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
	const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
	return Buffer.from(padded, 'base64').toString('utf8')
}

const htmlToText = (html: string) => {
	return html
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
		.trim()
}

const collapseQuotedAndSignature = (text: string) => {
	const lines = text.split('\n')
	const out: string[] = []
	let quotedCollapsed = false
	let sigCollapsed = false

	for (const rawLine of lines) {
		const line = rawLine.trimEnd()
		const trimmed = line.trim()
		if (!trimmed) {
			out.push('')
			continue
		}

		if (/^>+/.test(trimmed) || /^On\s.+wrote:$/i.test(trimmed) || /^From:\s/i.test(trimmed)) {
			if (!quotedCollapsed) {
				out.push('[Quoted text collapsed]')
				quotedCollapsed = true
			}
			continue
		}

		if (!sigCollapsed && (/^--\s*$/.test(trimmed) || /^sent from my /i.test(trimmed) || /^best,?$/i.test(trimmed) || /^regards,?$/i.test(trimmed))) {
			out.push('[Signature collapsed]')
			sigCollapsed = true
			continue
		}

		if (sigCollapsed) continue
		out.push(line)
	}

	return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

const getHeader = (headers: GmailHeader[] | undefined, key: string) => {
	const found = headers?.find(h => h.name?.toLowerCase() === key.toLowerCase())
	return found?.value || ''
}

const parseAddressList = (value: string): Array<{ name: string; email: string }> => {
	if (!value.trim()) return []
	return value
		.split(',')
		.map(entry => entry.trim())
		.filter(Boolean)
		.map(entry => {
			const match = entry.match(/^(.*)<([^>]+)>$/)
			if (match) {
				return { name: match[1].replace(/"/g, '').trim(), email: match[2].trim().toLowerCase() }
			}
			const email = entry.replace(/"/g, '').trim().toLowerCase()
			return { name: '', email }
		})
}

const normalizeSubject = (subject: string) =>
	subject
		.toLowerCase()
		.replace(/^(re|fwd|fw):\s*/gi, '')
		.replace(/\s+/g, ' ')
		.trim()

const looksAutomated = (msg: { senderEmail: string; subject: string; bodyText: string }) => {
	const email = msg.senderEmail.toLowerCase()
	const subject = msg.subject.toLowerCase()
	const body = msg.bodyText.toLowerCase()

	const noReply = email.includes('noreply') || email.includes('no-reply') || email.startsWith('donotreply')
	const newsletter =
		subject.includes('newsletter') ||
		subject.includes('weekly digest') ||
		body.includes('unsubscribe') ||
		body.includes('manage preferences')
	const otp =
		subject.includes('otp') ||
		subject.includes('verification code') ||
		body.includes('one-time password') ||
		body.includes('your code is')
	const automated =
		subject.includes('notification') || subject.includes('alert') || subject.includes('automated') || subject.includes('receipt from')

	return noReply || newsletter || otp || automated
}

const summarizeParticipants = (emails: string[], selfEmail?: string | null) => {
	const dedup = [...new Set(emails.map(v => v.toLowerCase()))]
	const filtered = dedup.filter(v => v && v !== (selfEmail || '').toLowerCase())
	if (!filtered.length) return selfEmail || 'Unknown'
	return filtered.slice(0, 3).join(', ') + (filtered.length > 3 ? ` +${filtered.length - 3}` : '')
}

export class GmailMirrorService {
	private db: MirrorDb
	private clientId: string
	private clientSecret: string
	private redirectUri: string
	private attachmentCacheDir: string
	private tokenFilePath: string
	private oauthState: string | null = null
	private syncInFlight = false
	private status: SyncStatus = {
		connected: false,
		emailAddress: null,
		lastSyncAt: null,
		lastSyncStatus: 'idle',
		lastSyncError: null,
		lastSyncSummary: null
	}

	constructor(opts: {
		db: MirrorDb
		clientId: string
		clientSecret: string
		redirectUri: string
		attachmentCacheDir: string
		tokenFilePath: string
	}) {
		this.db = opts.db
		this.clientId = opts.clientId
		this.clientSecret = opts.clientSecret
		this.redirectUri = opts.redirectUri
		this.attachmentCacheDir = opts.attachmentCacheDir
		this.tokenFilePath = opts.tokenFilePath
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

	private async clearTokenFile() {
		try {
			await unlink(this.tokenFilePath)
		} catch {}
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

	private gmailApi(pathname: string, params?: Record<string, string>) {
		const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${pathname}`)
		for (const [key, value] of Object.entries(params || {})) {
			if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value)
		}
		return url.toString()
	}

	async bootstrap() {
		const account = this.db.getEmailAccount('local-user', 'gmail')
		const token = await this.readTokenFile()
		if (account && token) {
			this.status.connected = true
			this.status.emailAddress = account.emailAddress
			this.status.lastSyncAt = account.lastSyncAt
		}
	}

	getStatus() {
		return { ...this.status }
	}

	getOAuthStartUrl() {
		if (!this.clientId || !this.clientSecret || !this.redirectUri) {
			throw new Error('Google OAuth env vars are missing')
		}
		this.oauthState = crypto.randomBytes(16).toString('hex')
		const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
		url.searchParams.set('client_id', this.clientId)
		url.searchParams.set('redirect_uri', this.redirectUri)
		url.searchParams.set('response_type', 'code')
		url.searchParams.set('scope', GMAIL_SCOPE)
		url.searchParams.set('access_type', 'offline')
		url.searchParams.set('prompt', 'consent')
		url.searchParams.set('state', this.oauthState)
		return url.toString()
	}

	async handleOAuthCallback(code: string, state: string) {
		if (!this.oauthState || state !== this.oauthState) {
			throw new Error('Invalid OAuth state')
		}
		this.oauthState = null
		const response = await fetch('https://oauth2.googleapis.com/token', {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				code,
				client_id: this.clientId,
				client_secret: this.clientSecret,
				redirect_uri: this.redirectUri,
				grant_type: 'authorization_code'
			})
		})
		const raw = await response.text()
		if (!response.ok) throw new Error(`OAuth callback exchange failed: ${raw}`)
		const token = JSON.parse(raw) as GmailToken
		const saved: GmailToken = {
			...token,
			expiry_date: Date.now() + Number(token.expires_in || 3600) * 1000
		}
		await this.writeTokenFile(saved)

		const profileRes = await this.authedFetch(this.gmailApi('profile'))
		const profileRaw = await profileRes.text()
		if (!profileRes.ok) throw new Error(`Failed to read Gmail profile: ${profileRaw}`)
		const profile = JSON.parse(profileRaw) as { emailAddress?: string }
		const emailAddress = clean(profile.emailAddress) || 'unknown@gmail.com'

		const now = Date.now()
		const accountId = `gmail_account_local`
		this.db.upsertEmailAccount({
			id: accountId,
			userId: 'local-user',
			provider: 'gmail',
			emailAddress,
			oauthTokenRef: this.tokenFilePath,
			syncCursor: null,
			lastSyncAt: null,
			createdAt: now,
			updatedAt: now
		})

		this.status.connected = true
		this.status.emailAddress = emailAddress
		this.status.lastSyncError = null
		this.status.lastSyncStatus = 'idle'
	}

	async disconnect() {
		const account = this.db.getEmailAccount('local-user', 'gmail')
		if (account) {
			this.db.clearEmailDataForAccount(account.id)
		}
		await this.clearTokenFile()
		this.status = {
			connected: false,
			emailAddress: null,
			lastSyncAt: null,
			lastSyncStatus: 'idle',
			lastSyncError: null,
			lastSyncSummary: null
		}
	}

	private extractBodies(message: GmailMessage) {
		let plainText = ''
		let htmlText = ''
		const attachments: Array<{ attachmentId: string; filename: string; mimeType: string; sizeBytes: number }> = []

		const walk = (part?: GmailPart) => {
			if (!part) return
			const mime = clean(part.mimeType || '')
			const body = part.body || {}

			if (mime === 'text/plain' && body.data) {
				plainText += `\n${base64UrlDecode(body.data)}`
			}
			if (mime === 'text/html' && body.data) {
				htmlText += `\n${base64UrlDecode(body.data)}`
			}

			if (body.attachmentId && (part.filename || '').trim()) {
				attachments.push({
					attachmentId: body.attachmentId,
					filename: clean(part.filename),
					mimeType: mime || 'application/octet-stream',
					sizeBytes: Number(body.size || 0)
				})
			}

			for (const child of part.parts || []) walk(child)
		}

		walk(message.payload)
		const bodyRawText = plainText.trim()
		const bodyRawHtml = htmlText.trim()
		const bodyCleanText = collapseQuotedAndSignature(bodyRawText || htmlToText(bodyRawHtml || message.snippet || ''))
		return { bodyRawText, bodyRawHtml, bodyCleanText, attachments }
	}

	private deriveDirection(senderEmail: string, selfEmail: string): 'incoming' | 'outgoing' {
		return senderEmail.toLowerCase() === selfEmail.toLowerCase() ? 'outgoing' : 'incoming'
	}

	private getParticipants(message: GmailMessage) {
		const headers = message.payload?.headers || []
		const from = parseAddressList(getHeader(headers, 'From'))
		const to = parseAddressList(getHeader(headers, 'To'))
		const cc = parseAddressList(getHeader(headers, 'Cc'))
		const sender = from[0] || { name: '', email: '' }
		return { sender, to, cc }
	}

	private async fetchThread(threadId: string): Promise<GmailThread> {
		const res = await this.authedFetch(this.gmailApi(`threads/${threadId}`, { format: 'full' }))
		const raw = await res.text()
		if (!res.ok) throw new Error(`Failed thread ${threadId}: ${raw}`)
		return JSON.parse(raw) as GmailThread
	}

	private async listRecentThreadIds() {
		const query = 'newer_than:7d -in:spam -in:trash -category:promotions -category:social -category:updates'
		const ids: string[] = []
		let pageToken = ''
		do {
			const res = await this.authedFetch(
				this.gmailApi('threads', {
					q: query,
					maxResults: '100',
					pageToken,
					includeSpamTrash: 'false'
				})
			)
			const raw = await res.text()
			if (!res.ok) throw new Error(`Failed thread list: ${raw}`)
			const payload = JSON.parse(raw) as { threads?: Array<{ id: string }>; nextPageToken?: string }
			for (const item of payload.threads || []) ids.push(item.id)
			pageToken = payload.nextPageToken || ''
		} while (pageToken)
		return ids
	}

	async sync(opts?: { onEvent?: (event: { type: string; payload: unknown }) => void }) {
		if (this.syncInFlight) return this.status.lastSyncSummary
		if (!this.status.connected) throw new Error('Gmail not connected')

		this.syncInFlight = true
		this.status.lastSyncStatus = 'syncing'
		this.status.lastSyncError = null
		opts?.onEvent?.({ type: 'email.sync.started', payload: { at: Date.now() } })

		try {
			const account = this.db.getEmailAccount('local-user', 'gmail')
			if (!account) throw new Error('Gmail account record not found')
			const selfEmail = account.emailAddress
			const threadIds = await this.listRecentThreadIds()
			let upsertedThreads = 0
			let upsertedMessages = 0
			const touchedThreadIds = new Set<string>()

			for (const providerThreadId of threadIds) {
				const thread = await this.fetchThread(providerThreadId)
				const messages = (thread.messages || []).sort((a, b) => Number(a.internalDate || 0) - Number(b.internalDate || 0))
				if (!messages.length) continue

				const processed = messages.map(message => {
					const headers = message.payload?.headers || []
					const subject = clean(getHeader(headers, 'Subject')) || '(No subject)'
					const { sender, to, cc } = this.getParticipants(message)
					const bodies = this.extractBodies(message)
					const senderEmail = clean(sender.email).toLowerCase()
					const direction = this.deriveDirection(senderEmail, selfEmail)
					const participantEmails = [senderEmail, ...to.map(a => a.email), ...cc.map(a => a.email)].filter(Boolean)
					return {
						providerMessageId: message.id,
						gmailHistoryId: message.historyId || null,
						subject,
						senderName: clean(sender.name) || null,
						senderEmail,
						to,
						cc,
						sentAt: Math.floor(Number(message.internalDate || 0) / 1000) || Math.floor(Date.now() / 1000),
						direction,
						snippet: clean(message.snippet) || null,
						bodyRawHtml: bodies.bodyRawHtml || null,
						bodyRawText: bodies.bodyRawText || null,
						bodyCleanText: bodies.bodyCleanText || clean(message.snippet) || '',
						hasAttachments: bodies.attachments.length > 0,
						attachments: bodies.attachments,
						isAutomated: looksAutomated({ senderEmail, subject, bodyText: bodies.bodyCleanText || message.snippet || '' }),
						participantEmails
					}
				})

				const hasHumanSignal = processed.some(item => !item.isAutomated)
				if (!hasHumanSignal) continue

				const kept = processed
				const allParticipants = kept.flatMap(item => item.participantEmails)
				const last = kept[kept.length - 1]
				const hasAttachments = kept.some(item => item.hasAttachments)
				const unreadCount = messages.filter(m => (m.labelIds || []).includes('UNREAD')).length
				const subject = kept.find(item => item.subject)?.subject || '(No subject)'
				const threadId = `gmail_thread_${providerThreadId}`
				const now = Date.now()

				touchedThreadIds.add(threadId)
				this.db.upsertEmailThread({
					id: threadId,
					userId: 'local-user',
					accountId: account.id,
					providerThreadId,
					derivedThreadKey: `${normalizeSubject(subject)}|${summarizeParticipants(allParticipants, selfEmail)}`,
					subject,
					participantSummary: summarizeParticipants(allParticipants, selfEmail),
					lastMessageAt: last.sentAt,
					lastCleanedPreview: clean(last.bodyCleanText).slice(0, 240),
					unreadCount,
					hasAttachments,
					sourceLabelsJson: JSON.stringify(messages[messages.length - 1].labelIds || []),
					createdAt: now,
					updatedAt: now
				})
				upsertedThreads += 1

				for (const item of kept) {
					const messageId = `gmail_msg_${item.providerMessageId}`
					this.db.upsertEmailMessage({
						id: messageId,
						userId: 'local-user',
						accountId: account.id,
						threadId,
						providerMessageId: item.providerMessageId,
						gmailHistoryId: item.gmailHistoryId,
						senderName: item.senderName,
						senderEmail: item.senderEmail,
						toJson: JSON.stringify(item.to),
						ccJson: JSON.stringify(item.cc),
						sentAt: item.sentAt,
						direction: item.direction,
						snippet: item.snippet,
						bodyRawHtml: item.bodyRawHtml,
						bodyRawText: item.bodyRawText,
						bodyCleanText: item.bodyCleanText,
						hasAttachments: item.hasAttachments ? 1 : 0,
						isHiddenAutomated: item.isAutomated && !hasHumanSignal ? 1 : 0,
						createdAt: now,
						updatedAt: now
					})
					upsertedMessages += 1

					for (const attachment of item.attachments) {
						this.db.upsertEmailAttachment({
							id: `gmail_att_${item.providerMessageId}_${attachment.attachmentId}`,
							userId: 'local-user',
							accountId: account.id,
							messageId,
							providerAttachmentId: attachment.attachmentId,
							filename: attachment.filename,
							mimeType: attachment.mimeType,
							sizeBytes: attachment.sizeBytes,
							cachedLocalPath: null,
							cachedAt: null,
							createdAt: now
						})
					}
				}
			}

			const summary = { threads: upsertedThreads, messages: upsertedMessages }
			const completedAt = Date.now()
			this.db.updateEmailAccountSync(account.id, account.syncCursor, completedAt)
			this.status.lastSyncAt = completedAt
			this.status.lastSyncStatus = 'idle'
			this.status.lastSyncSummary = summary
			opts?.onEvent?.({ type: 'email.threads.upsert', payload: this.db.getEmailThreads('local-user') })
			opts?.onEvent?.({
				type: 'email.messages.upsert',
				payload: { threadIds: [...touchedThreadIds], count: upsertedMessages }
			})
			opts?.onEvent?.({ type: 'email.sync.completed', payload: { at: completedAt, ...summary } })
			return summary
		} catch (error) {
			this.status.lastSyncStatus = 'error'
			this.status.lastSyncError = error instanceof Error ? error.message : String(error)
			opts?.onEvent?.({ type: 'email.sync.failed', payload: { error: this.status.lastSyncError } })
			throw error
		} finally {
			this.syncInFlight = false
		}
	}

	async getAttachmentContent(attachmentId: string) {
		const attachment = this.db.getEmailAttachmentById(attachmentId)
		if (!attachment) throw new Error('Attachment not found')

		if (attachment.cachedLocalPath) {
			try {
				await stat(attachment.cachedLocalPath)
				return { path: attachment.cachedLocalPath, mimeType: attachment.mimeType || 'application/octet-stream', filename: attachment.filename }
			} catch {}
		}

		const message = this.db.getEmailMessageById(attachment.messageId)
		if (!message) throw new Error('Attachment linkage missing')
		if (!this.db.getEmailAccount('local-user', 'gmail')) throw new Error('Gmail account not found')

		const res = await this.authedFetch(
			this.gmailApi(`messages/${message.providerMessageId}/attachments/${attachment.providerAttachmentId}`)
		)
		const raw = await res.text()
		if (!res.ok) throw new Error(`Failed to fetch attachment: ${raw}`)
		const payload = JSON.parse(raw) as { data?: string }
		if (!payload.data) throw new Error('Attachment payload empty')

		await mkdir(this.attachmentCacheDir, { recursive: true })
		const safeName = (clean(attachment.filename) || `${attachment.id}.bin`).replace(/[^a-zA-Z0-9._-]+/g, '_')
		const filePath = path.join(this.attachmentCacheDir, `${attachment.id}_${safeName}`)
		await writeFile(filePath, Buffer.from(payload.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64'))
		this.db.markEmailAttachmentCached(attachment.id, filePath, Date.now())
		return { path: filePath, mimeType: attachment.mimeType || 'application/octet-stream', filename: safeName }
	}
}
