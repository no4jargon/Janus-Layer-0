import { mkdir } from 'fs/promises'
import { DatabaseSync } from 'node:sqlite'
import path from 'path'
import type { WAMessage, WAMessageKey, WAMessageUpdate } from '../src/Types'
import type { Chat, Contact, LIDMapping } from '../src/Types'
import { isJidGroup, jidDecode, jidNormalizedUser } from '../src'

export type DBMessage = {
	messageKey: string
	remoteJid: string
	keyId: string
	fromMe: 1 | 0
	participant: string | null
	senderJid: string | null
	messageTimestamp: number
	messageType: string | null
	text: string
	status: number | null
	isDeleted: 1 | 0
	mediaType: string | null
	mediaMime: string | null
	mediaPath: string | null
	mediaThumbDataUri: string | null
	rawContent: string | null
	createdAt: number
	updatedAt: number
}

export type MessageRecord = Omit<DBMessage, 'fromMe' | 'isDeleted' | 'createdAt' | 'updatedAt'> & {
	fromMe: boolean
	isDeleted: boolean
}

export type ChatRecord = {
	jid: string
	name: string
	isGroup: boolean
	lastMessageTs: number
	lastMessageText: string
	lastMessageType: string
	unread: number
}

export type EmailAccountRecord = {
	id: string
	userId: string
	provider: string
	emailAddress: string
	oauthTokenRef: string | null
	syncCursor: string | null
	lastSyncAt: number | null
	createdAt: number
	updatedAt: number
}

export type EmailThreadRecord = {
	id: string
	userId: string
	accountId: string
	providerThreadId: string
	derivedThreadKey: string | null
	subject: string
	participantSummary: string
	lastMessageAt: number
	lastCleanedPreview: string
	unreadCount: number
	hasAttachments: boolean
	sourceLabelsJson: string | null
	createdAt: number
	updatedAt: number
}

export type EmailMessageRecord = {
	id: string
	userId: string
	accountId: string
	threadId: string
	providerMessageId: string
	gmailHistoryId: string | null
	senderName: string | null
	senderEmail: string
	toJson: string
	ccJson: string
	sentAt: number
	direction: 'incoming' | 'outgoing'
	snippet: string | null
	bodyRawHtml: string | null
	bodyRawText: string | null
	bodyCleanText: string | null
	hasAttachments: 1 | 0
	isHiddenAutomated: 1 | 0
	createdAt: number
	updatedAt: number
}

export type EmailAttachmentRecord = {
	id: string
	userId: string
	accountId: string
	messageId: string
	providerAttachmentId: string
	filename: string | null
	mimeType: string | null
	sizeBytes: number | null
	cachedLocalPath: string | null
	cachedAt: number | null
	createdAt: number
}

export type WaOutboxStatus = 'queued' | 'sending' | 'sent' | 'failed'
export type EmailOutboxStatus = 'queued' | 'sending' | 'sent' | 'failed'

export type WaOutboxMessageRecord = {
	id: string
	clientRequestId: string
	chatJid: string
	text: string
	quotedMessageKey: string | null
	status: WaOutboxStatus
	errorCode: string | null
	errorMessage: string | null
	waMessageKey: string | null
	createdAt: number
	updatedAt: number
}

export type EmailOutboxMessageRecord = {
	id: string
	clientRequestId: string
	accountId: string
	threadId: string | null
	providerThreadId: string | null
	toJson: string
	ccJson: string
	subject: string
	textBody: string
	htmlBody: string | null
	status: EmailOutboxStatus
	errorCode: string | null
	errorMessage: string | null
	gmailMessageId: string | null
	gmailThreadId: string | null
	createdAt: number
	updatedAt: number
}

type DBContact = {
	jid: string
	name: string | null
	notify: string | null
	verifiedName: string | null
	username: string | null
	phoneNumber: string | null
}

export const mkMessageKey = (key: {
	remoteJid?: string | null
	id?: string | null
	fromMe?: boolean | null
	participant?: string | null
}) => `${key.remoteJid || ''}|${key.id || ''}|${key.fromMe ? '1' : '0'}|${key.participant || ''}`

const clean = (value?: string | null) => {
	if (typeof value !== 'string') return null
	return value.trim().length ? value : null
}

const cleanPhone = (value?: string | null) => {
	if (typeof value !== 'string') return null
	const v = value.trim()
	return v.length ? v : null
}

export class MirrorDb {
	private db: DatabaseSync
	private upsertContactStmt: ReturnType<DatabaseSync['prepare']>
	private upsertChatStmt: ReturnType<DatabaseSync['prepare']>
	private upsertMessageStmt: ReturnType<DatabaseSync['prepare']>
	private updateMessageStmt: ReturnType<DatabaseSync['prepare']>
	private upsertMessageFromUpdateStmt: ReturnType<DatabaseSync['prepare']>
	private getContactByJidStmt: ReturnType<DatabaseSync['prepare']>
	private upsertJidMapStmt: ReturnType<DatabaseSync['prepare']>
	private getMappedJidStmt: ReturnType<DatabaseSync['prepare']>
	private updateDirectChatNameStmt: ReturnType<DatabaseSync['prepare']>
	private getChatNameByJidStmt: ReturnType<DatabaseSync['prepare']>

	constructor(dbPath: string) {
		mkdir(path.dirname(dbPath), { recursive: true }).catch(() => {})

		this.db = new DatabaseSync(dbPath)
		this.db.exec('PRAGMA journal_mode = WAL;')
		this.db.exec('PRAGMA foreign_keys = ON;')

		this.db.exec(`
			CREATE TABLE IF NOT EXISTS contacts (
				jid TEXT PRIMARY KEY,
				name TEXT,
				notify TEXT,
				verifiedName TEXT,
				username TEXT,
				phoneNumber TEXT,
				imgUrl TEXT,
				updatedAt INTEGER NOT NULL
			);

			CREATE TABLE IF NOT EXISTS jid_map (
				sourceJid TEXT PRIMARY KEY,
				targetJid TEXT NOT NULL,
				updatedAt INTEGER NOT NULL
			);

			-- Email mirror section (kept isolated from WhatsApp tables)
			CREATE TABLE IF NOT EXISTS email_accounts (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL,
				provider TEXT NOT NULL,
				email_address TEXT NOT NULL,
				oauth_token_ref TEXT,
				sync_cursor TEXT,
				last_sync_at INTEGER,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				UNIQUE(user_id, provider),
				UNIQUE(user_id, email_address)
			);

			CREATE TABLE IF NOT EXISTS email_threads (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL,
				account_id TEXT NOT NULL,
				provider_thread_id TEXT NOT NULL,
				derived_thread_key TEXT,
				subject TEXT NOT NULL DEFAULT '',
				participant_summary TEXT NOT NULL DEFAULT '',
				last_message_at INTEGER NOT NULL DEFAULT 0,
				last_cleaned_preview TEXT NOT NULL DEFAULT '',
				unread_count INTEGER NOT NULL DEFAULT 0,
				has_attachments INTEGER NOT NULL DEFAULT 0,
				source_labels_json TEXT,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				FOREIGN KEY(account_id) REFERENCES email_accounts(id) ON DELETE CASCADE,
				UNIQUE(account_id, provider_thread_id)
			);

			CREATE TABLE IF NOT EXISTS email_messages (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL,
				account_id TEXT NOT NULL,
				thread_id TEXT NOT NULL,
				provider_message_id TEXT NOT NULL,
				gmail_history_id TEXT,
				sender_name TEXT,
				sender_email TEXT NOT NULL,
				to_json TEXT NOT NULL DEFAULT '[]',
				cc_json TEXT NOT NULL DEFAULT '[]',
				sent_at INTEGER NOT NULL,
				direction TEXT NOT NULL,
				snippet TEXT,
				body_raw_html TEXT,
				body_raw_text TEXT,
				body_clean_text TEXT,
				has_attachments INTEGER NOT NULL DEFAULT 0,
				is_hidden_automated INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				FOREIGN KEY(account_id) REFERENCES email_accounts(id) ON DELETE CASCADE,
				FOREIGN KEY(thread_id) REFERENCES email_threads(id) ON DELETE CASCADE,
				UNIQUE(account_id, provider_message_id)
			);

			CREATE TABLE IF NOT EXISTS email_attachments (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL,
				account_id TEXT NOT NULL,
				message_id TEXT NOT NULL,
				provider_attachment_id TEXT NOT NULL,
				filename TEXT,
				mime_type TEXT,
				size_bytes INTEGER,
				cached_local_path TEXT,
				cached_at INTEGER,
				created_at INTEGER NOT NULL,
				FOREIGN KEY(account_id) REFERENCES email_accounts(id) ON DELETE CASCADE,
				FOREIGN KEY(message_id) REFERENCES email_messages(id) ON DELETE CASCADE,
				UNIQUE(message_id, provider_attachment_id)
			);

			CREATE INDEX IF NOT EXISTS idx_email_threads_account_last_message
				ON email_threads(account_id, last_message_at DESC);
			CREATE INDEX IF NOT EXISTS idx_email_messages_thread_sent_at
				ON email_messages(thread_id, sent_at ASC);
			CREATE INDEX IF NOT EXISTS idx_email_messages_account_history
				ON email_messages(account_id, gmail_history_id);
			CREATE INDEX IF NOT EXISTS idx_email_attachments_message
				ON email_attachments(message_id);

			-- WhatsApp send pipeline outbox (isolated)
			CREATE TABLE IF NOT EXISTS wa_outbox_messages (
				id TEXT PRIMARY KEY,
				client_request_id TEXT NOT NULL UNIQUE,
				chat_jid TEXT NOT NULL,
				text TEXT NOT NULL,
				quoted_message_key TEXT,
				status TEXT NOT NULL,
				error_code TEXT,
				error_message TEXT,
				wa_message_key TEXT,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_wa_outbox_status_updated
				ON wa_outbox_messages(status, updated_at DESC);
			CREATE INDEX IF NOT EXISTS idx_wa_outbox_chat_created
				ON wa_outbox_messages(chat_jid, created_at DESC);

			-- Gmail send pipeline outbox (isolated)
			CREATE TABLE IF NOT EXISTS email_outbox_messages (
				id TEXT PRIMARY KEY,
				client_request_id TEXT NOT NULL UNIQUE,
				account_id TEXT NOT NULL,
				thread_id TEXT,
				provider_thread_id TEXT,
				to_json TEXT NOT NULL DEFAULT '[]',
				cc_json TEXT NOT NULL DEFAULT '[]',
				subject TEXT NOT NULL DEFAULT '',
				text_body TEXT NOT NULL DEFAULT '',
				html_body TEXT,
				status TEXT NOT NULL,
				error_code TEXT,
				error_message TEXT,
				gmail_message_id TEXT,
				gmail_thread_id TEXT,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				FOREIGN KEY(account_id) REFERENCES email_accounts(id) ON DELETE CASCADE,
				FOREIGN KEY(thread_id) REFERENCES email_threads(id) ON DELETE SET NULL
			);
			CREATE INDEX IF NOT EXISTS idx_email_outbox_status_updated
				ON email_outbox_messages(status, updated_at DESC);
			CREATE INDEX IF NOT EXISTS idx_email_outbox_account_created
				ON email_outbox_messages(account_id, created_at DESC);

			CREATE TABLE IF NOT EXISTS chats (
				jid TEXT PRIMARY KEY,
				name TEXT,
				isGroup INTEGER NOT NULL DEFAULT 0,
				lastMessageTs INTEGER NOT NULL DEFAULT 0,
				lastMessageText TEXT NOT NULL DEFAULT '',
				lastMessageType TEXT NOT NULL DEFAULT '',
				unread INTEGER NOT NULL DEFAULT 0,
				updatedAt INTEGER NOT NULL
			);

			CREATE TABLE IF NOT EXISTS messages (
				messageKey TEXT PRIMARY KEY,
				remoteJid TEXT NOT NULL,
				keyId TEXT NOT NULL,
				fromMe INTEGER NOT NULL,
				participant TEXT,
				senderJid TEXT,
				messageTimestamp INTEGER NOT NULL,
				messageType TEXT,
				text TEXT NOT NULL DEFAULT '',
				status INTEGER,
				isDeleted INTEGER NOT NULL DEFAULT 0,
				mediaType TEXT,
				mediaMime TEXT,
				mediaPath TEXT,
				mediaThumbDataUri TEXT,
				rawContent TEXT,
				createdAt INTEGER NOT NULL,
				updatedAt INTEGER NOT NULL
			);
		`)

		this.ensureColumn('contacts', 'name', 'TEXT')
		this.ensureColumn('contacts', 'username', 'TEXT')
		this.ensureColumn('contacts', 'phoneNumber', 'TEXT')
		this.db.exec(`UPDATE chats SET name = NULL WHERE isGroup = 1 AND LOWER(TRIM(COALESCE(name, ''))) = 'group'`)

		this.upsertContactStmt = this.db.prepare(`
			INSERT INTO contacts (jid, name, notify, verifiedName, username, phoneNumber, imgUrl, updatedAt)
			VALUES (@jid, @name, @notify, @verifiedName, @username, @phoneNumber, @imgUrl, @updatedAt)
			ON CONFLICT(jid) DO UPDATE SET
				name = CASE
					WHEN excluded.name IS NOT NULL AND TRIM(excluded.name) != '' THEN excluded.name
					ELSE contacts.name
				END,
				notify = CASE
					WHEN excluded.notify IS NOT NULL AND TRIM(excluded.notify) != '' THEN excluded.notify
					ELSE contacts.notify
				END,
				verifiedName = CASE
					WHEN excluded.verifiedName IS NOT NULL AND TRIM(excluded.verifiedName) != '' THEN excluded.verifiedName
					ELSE contacts.verifiedName
				END,
				username = CASE
					WHEN excluded.username IS NOT NULL AND TRIM(excluded.username) != '' THEN excluded.username
					ELSE contacts.username
				END,
				phoneNumber = CASE
					WHEN excluded.phoneNumber IS NOT NULL AND TRIM(excluded.phoneNumber) != '' THEN excluded.phoneNumber
					ELSE contacts.phoneNumber
				END,
				imgUrl = COALESCE(excluded.imgUrl, contacts.imgUrl),
				updatedAt = excluded.updatedAt
		`)

		this.upsertChatStmt = this.db.prepare(`
			INSERT INTO chats (jid, name, isGroup, lastMessageTs, lastMessageText, lastMessageType, unread, updatedAt)
			VALUES (@jid, @name, @isGroup, @lastMessageTs, @lastMessageText, @lastMessageType, @unread, @updatedAt)
			ON CONFLICT(jid) DO UPDATE SET
				name = CASE
					WHEN excluded.name IS NOT NULL AND TRIM(excluded.name) != '' THEN excluded.name
					ELSE chats.name
				END,
				isGroup = CASE WHEN chats.isGroup = 1 THEN 1 ELSE excluded.isGroup END,
				lastMessageTs = MAX(chats.lastMessageTs, excluded.lastMessageTs),
				lastMessageText = CASE
					WHEN excluded.lastMessageTs >= chats.lastMessageTs THEN excluded.lastMessageText
					ELSE chats.lastMessageText
				END,
				lastMessageType = CASE
					WHEN excluded.lastMessageTs >= chats.lastMessageTs THEN excluded.lastMessageType
					ELSE chats.lastMessageType
				END,
				unread = chats.unread,
				updatedAt = excluded.updatedAt
		`)

		this.upsertMessageStmt = this.db.prepare(`
			INSERT INTO messages (
				messageKey, remoteJid, keyId, fromMe, participant, senderJid, messageTimestamp,
				messageType, text, status, isDeleted, mediaType, mediaMime, mediaPath,
				mediaThumbDataUri, rawContent, createdAt, updatedAt
			)
			VALUES (
				@messageKey, @remoteJid, @keyId, @fromMe, @participant, @senderJid, @messageTimestamp,
				@messageType, @text, @status, @isDeleted, @mediaType, @mediaMime, @mediaPath,
				@mediaThumbDataUri, @rawContent, @createdAt, @updatedAt
			)
			ON CONFLICT(messageKey) DO UPDATE SET
				messageTimestamp = MAX(messages.messageTimestamp, excluded.messageTimestamp),
				messageType = COALESCE(excluded.messageType, messages.messageType),
				text = CASE
					WHEN excluded.messageTimestamp >= messages.messageTimestamp THEN excluded.text
					ELSE messages.text
				END,
				status = COALESCE(excluded.status, messages.status),
				isDeleted = CASE
					WHEN excluded.isDeleted = 1 THEN 1
					ELSE messages.isDeleted
				END,
				mediaType = COALESCE(excluded.mediaType, messages.mediaType),
				mediaMime = COALESCE(excluded.mediaMime, messages.mediaMime),
				mediaPath = COALESCE(excluded.mediaPath, messages.mediaPath),
				mediaThumbDataUri = COALESCE(excluded.mediaThumbDataUri, messages.mediaThumbDataUri),
				rawContent = COALESCE(excluded.rawContent, messages.rawContent),
				updatedAt = excluded.updatedAt,
				senderJid = COALESCE(excluded.senderJid, messages.senderJid)
		`)

		this.updateMessageStmt = this.db.prepare(`
			UPDATE messages
			SET
				text = COALESCE(@text, text),
				status = COALESCE(@status, status),
				isDeleted = CASE
					WHEN @isDeleted IS NOT NULL THEN @isDeleted
					ELSE isDeleted
				END,
				mediaType = COALESCE(@mediaType, mediaType),
				mediaMime = COALESCE(@mediaMime, mediaMime),
				mediaPath = COALESCE(@mediaPath, mediaPath),
				mediaThumbDataUri = COALESCE(@mediaThumbDataUri, mediaThumbDataUri),
				rawContent = COALESCE(@rawContent, rawContent),
				updatedAt = @updatedAt
			WHERE messageKey = @messageKey
		`)

		this.upsertMessageFromUpdateStmt = this.db.prepare(`
			INSERT INTO messages (
				messageKey, remoteJid, keyId, fromMe, participant, senderJid, messageTimestamp,
				messageType, text, status, isDeleted, mediaType, mediaMime, mediaPath,
				mediaThumbDataUri, rawContent, createdAt, updatedAt
			)
			VALUES (@messageKey, @remoteJid, @keyId, @fromMe, @participant, @senderJid, @messageTimestamp,
				@messageType, @text, @status, @isDeleted, @mediaType, @mediaMime, @mediaPath,
				@mediaThumbDataUri, @rawContent, @createdAt, @updatedAt)
			ON CONFLICT(messageKey) DO NOTHING
		`)

		this.getContactByJidStmt = this.db.prepare(
			'SELECT jid, name, notify, verifiedName, username, phoneNumber FROM contacts WHERE jid = ? LIMIT 1'
		)
		this.upsertJidMapStmt = this.db.prepare(`
			INSERT INTO jid_map (sourceJid, targetJid, updatedAt)
			VALUES (@sourceJid, @targetJid, @updatedAt)
			ON CONFLICT(sourceJid) DO UPDATE SET
				targetJid = excluded.targetJid,
				updatedAt = excluded.updatedAt
		`)
		this.getMappedJidStmt = this.db.prepare('SELECT targetJid FROM jid_map WHERE sourceJid = ? LIMIT 1')
		this.updateDirectChatNameStmt = this.db.prepare(
			'UPDATE chats SET name = @name, updatedAt = @updatedAt WHERE jid = @jid AND isGroup = 0'
		)
		this.getChatNameByJidStmt = this.db.prepare('SELECT name, isGroup FROM chats WHERE jid = ? LIMIT 1')
	}

	private ensureColumn(tableName: string, columnName: string, type: string) {
		const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
		if (!rows.some(row => row.name === columnName)) {
			this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${type}`)
		}
	}

	private getContactByJid(jid: string): DBContact | null {
		const row = this.getContactByJidStmt.get(jid) as DBContact | undefined
		return row || null
	}

	private getMappedJid(jid: string): string | null {
		const row = this.getMappedJidStmt.get(jid) as { targetJid?: string } | undefined
		return row?.targetJid || null
	}

	private getNameFromContact(contact: DBContact | null): string | null {
		if (!contact) return null
		return clean(contact.name) || clean(contact.notify) || clean(contact.verifiedName) || clean(contact.username)
	}

	private getCandidateJids(jid: string): string[] {
		const normalized = jidNormalizedUser(jid)
		const mappedRaw = this.getMappedJid(jid)
		const mappedNormalizedSource = normalized ? this.getMappedJid(normalized) : null
		const mapped = mappedRaw || mappedNormalizedSource
		const mappedNormalized = mapped ? jidNormalizedUser(mapped) : ''
		return [...new Set([jid, normalized, mapped || '', mappedNormalized].filter(Boolean))]
	}

	resolveContactDisplay(jid?: string | null): string | null {
		if (!jid) return null
		const candidates = this.getCandidateJids(jid)
		for (const candidate of candidates) {
			const contactName = this.getNameFromContact(this.getContactByJid(candidate))
			if (contactName) return contactName
		}

		for (const candidate of candidates) {
			const decoded = jidDecode(candidate)
			if (!decoded?.user) continue
			if (decoded.server === 's.whatsapp.net' || decoded.server === 'c.us') {
				return decoded.user
			}
		}

		return null
	}

	private getReadableFallbackName(jid: string): string {
		return jid
	}

	needsGroupNameLookup(jid: string): boolean {
		if (!isJidGroup(jid)) return false
		const row = this.getChatNameByJidStmt.get(jid) as { name: string | null; isGroup: number } | undefined
		if (!row) return true
		const name = (row.name || '').trim().toLowerCase()
		if (!name) return true
		if (name === 'group') return true
		if (name === jid.toLowerCase()) return true
		const fallback = this.getReadableFallbackName(jid).toLowerCase()
		return name === fallback
	}

	private resolveBestChatName(jid: string, chatName?: string | null): string {
		const candidates = this.getCandidateJids(jid)
		for (const candidate of candidates) {
			const contactName = this.getNameFromContact(this.getContactByJid(candidate))
			if (contactName) return contactName
		}

		return clean(chatName) || this.getReadableFallbackName(jid)
	}

	upsertContact(contact: Partial<Contact> & { id: string }) {
		const now = Date.now()
		const normalized = jidNormalizedUser(contact.id)
		const phoneNumber = cleanPhone(contact.phoneNumber)
		const phoneJid = phoneNumber ? `${phoneNumber}@s.whatsapp.net` : null
		const rows = new Set([contact.id, normalized, phoneJid].filter((jid): jid is string => !!jid))

		for (const jid of rows) {
			this.upsertContactStmt.run({
				jid,
				name: clean(contact.name),
				notify: clean(contact.notify),
				verifiedName: clean(contact.verifiedName),
				username: clean(contact.username),
				phoneNumber,
				imgUrl: (contact as { imgUrl?: string | null }).imgUrl || null,
				updatedAt: now
			})
		}

		const preferredName = this.resolveBestChatName(contact.id)
		if (preferredName) {
			for (const jid of rows) {
				this.updateDirectChatNameStmt.run({ jid, name: preferredName, updatedAt: now })
			}
		}
	}

	upsertLidPnMapping(mapping: LIDMapping) {
		const lid = jidNormalizedUser(mapping.lid)
		const pn = jidNormalizedUser(mapping.pn)
		if (!lid || !pn) return
		const now = Date.now()
		this.upsertJidMapStmt.run({ sourceJid: lid, targetJid: pn, updatedAt: now })
		this.upsertJidMapStmt.run({ sourceJid: pn, targetJid: lid, updatedAt: now })

		const lidName = this.getNameFromContact(this.getContactByJid(lid))
		const pnName = this.getNameFromContact(this.getContactByJid(pn))
		const preferred = lidName || pnName
		if (preferred) {
			this.updateDirectChatNameStmt.run({ jid: lid, name: preferred, updatedAt: now })
			this.updateDirectChatNameStmt.run({ jid: pn, name: preferred, updatedAt: now })
		}
	}

	upsertChat(chat: Partial<Chat> & { id: string }, fallbackName?: string) {
		const jid = chat.id
		const raw = chat as any
		const explicitName = clean(raw.displayName) || clean(raw.name) || clean(raw.username) || clean(fallbackName)
		const name = this.resolveBestChatName(jid, explicitName)
		const lastMessageTs = Number(raw.conversationTimestamp || raw.lastMessageTimestamp || raw.lastMessageRecvTimestamp || 0)
		this.upsertChatStmt.run({
			jid,
			name,
			isGroup: isJidGroup(jid) ? 1 : 0,
			lastMessageTs,
			lastMessageText: raw.conversation || '',
			lastMessageType: '',
			unread: 0,
			updatedAt: Date.now()
		})
	}

	upsertMessage(row: MessageRecord & { messageTimestamp: number }) {
		const now = Date.now()
		this.upsertMessageStmt.run({
			messageKey: row.messageKey,
			remoteJid: row.remoteJid,
			keyId: row.keyId,
			fromMe: row.fromMe ? 1 : 0,
			participant: row.participant,
			senderJid: row.senderJid,
			messageTimestamp: row.messageTimestamp,
			messageType: row.messageType,
			text: row.text,
			status: row.status,
			isDeleted: row.isDeleted ? 1 : 0,
			mediaType: row.mediaType,
			mediaMime: row.mediaMime,
			mediaPath: row.mediaPath,
			mediaThumbDataUri: row.mediaThumbDataUri,
			rawContent: row.rawContent,
			createdAt: now,
			updatedAt: now
		})
		this.upsertChatStmt.run({
			jid: row.remoteJid,
			name: this.resolveBestChatName(row.remoteJid),
			isGroup: isJidGroup(row.remoteJid) ? 1 : 0,
			lastMessageTs: row.messageTimestamp,
			lastMessageText: row.text || '',
			lastMessageType: row.messageType || '',
			unread: 0,
			updatedAt: now
		})

		return this.getMessage(row.messageKey)
	}

	updateMessage(messageKey: string, patch: Partial<Pick<MessageRecord, 'text' | 'status' | 'mediaPath' | 'mediaType' | 'mediaMime' | 'mediaThumbDataUri' | 'rawContent' | 'isDeleted'>>) {
		this.updateMessageStmt.run({
			messageKey,
			text: patch.text ?? null,
			status: patch.status ?? null,
			isDeleted: patch.isDeleted === undefined ? null : patch.isDeleted ? 1 : 0,
			mediaType: patch.mediaType ?? null,
			mediaMime: patch.mediaMime ?? null,
			mediaPath: patch.mediaPath ?? null,
			mediaThumbDataUri: patch.mediaThumbDataUri ?? null,
			rawContent: patch.rawContent ?? null,
			updatedAt: Date.now()
		})
		return this.getMessage(messageKey)
	}

	upsertMessageFromUpdate(update: WAMessageUpdate) {
		const key = update.key
		const keyId = key.id || ''
		const messageKey = mkMessageKey(key)
		if (!messageKey) return null

		const now = Date.now()
		this.upsertMessageFromUpdateStmt.run({
			messageKey,
			remoteJid: key.remoteJid || '',
			keyId,
			fromMe: key.fromMe ? 1 : 0,
			participant: key.participant || null,
			senderJid: key.participant || key.remoteJid || null,
			messageTimestamp: Math.floor(now / 1000),
			messageType: update.update.message ? 'update' : null,
			text: update.update.message === null ? '[This message was deleted]' : '[Message update]',
			status: update.update.status || null,
			isDeleted: update.update.message === null ? 1 : 0,
			mediaType: null,
			mediaMime: null,
			mediaPath: null,
			mediaThumbDataUri: null,
			rawContent: JSON.stringify(update),
			createdAt: now,
			updatedAt: now
		})
		return this.getMessage(messageKey)
	}

	markMessagesDeleted(messageKey: string) {
		this.updateMessage(messageKey, { isDeleted: true, text: '[This message was deleted]' })
	}

	deleteAllMessagesForChat(jid: string) {
		this.db.prepare('DELETE FROM messages WHERE remoteJid = ?').run(jid)
	}

	getMessage(messageKey: string): MessageRecord | null {
		const row = this.db.prepare('SELECT * FROM messages WHERE messageKey = ?').get(messageKey) as
			| (DBMessage & { fromMe: number; isDeleted: number })
			| undefined
		if (!row) return null
		return {
			...row,
			fromMe: row.fromMe === 1,
			isDeleted: row.isDeleted === 1
		}
	}

	getMessageForWAKey(key: WAMessageKey): MessageRecord | null {
		return this.getMessage(mkMessageKey(key))
	}

	getMessageByMessageId(remoteJid: string, id: string): MessageRecord | null {
		const row = this.db
			.prepare('SELECT * FROM messages WHERE remoteJid = ? AND keyId = ? ORDER BY createdAt DESC LIMIT 1')
			.get(remoteJid, id) as (DBMessage & { fromMe: number; isDeleted: number }) | undefined
		if (!row) return null
		return {
			...row,
			fromMe: row.fromMe === 1,
			isDeleted: row.isDeleted === 1
		}
	}

	setMediaPath(messageKey: string, mediaPath: string | null) {
		this.updateMessage(messageKey, { mediaPath })
	}

	getChats(limit = 250): ChatRecord[] {
		const rows = this.db
			.prepare(
				`SELECT jid, name, isGroup, lastMessageTs, lastMessageText, lastMessageType, unread
				 FROM chats ORDER BY lastMessageTs DESC LIMIT ?`
			)
			.all(limit) as Array<
				{
					jid: string
					name: string | null
					isGroup: number
					lastMessageTs: number
					lastMessageText: string
					lastMessageType: string
					unread: number
				}
			>
		return rows.map(row => ({
			jid: row.jid,
			name: this.resolveBestChatName(row.jid, row.name),
			isGroup: row.isGroup === 1,
			lastMessageTs: row.lastMessageTs,
			lastMessageText: row.lastMessageText,
			lastMessageType: row.lastMessageType,
			unread: row.unread
		}))
	}

	getMessagesForChat(jid: string, limit = 200): MessageRecord[] {
		const rows = this.db
			.prepare(
				`SELECT * FROM (
					SELECT * FROM messages
					WHERE remoteJid = ?
					ORDER BY messageTimestamp DESC, createdAt DESC
					LIMIT ?
				) recent
				ORDER BY messageTimestamp ASC, createdAt ASC`
			)
			.all(jid, limit) as Array<DBMessage & { fromMe: number; isDeleted: number }>

		return rows.map(row => ({
			...row,
			fromMe: row.fromMe === 1,
			isDeleted: row.isDeleted === 1
		}))
	}

	upsertEmailAccount(row: EmailAccountRecord) {
		this.db
			.prepare(`
				INSERT INTO email_accounts (id, user_id, provider, email_address, oauth_token_ref, sync_cursor, last_sync_at, created_at, updated_at)
				VALUES (@id, @userId, @provider, @emailAddress, @oauthTokenRef, @syncCursor, @lastSyncAt, @createdAt, @updatedAt)
				ON CONFLICT(id) DO UPDATE SET
					email_address = excluded.email_address,
					oauth_token_ref = excluded.oauth_token_ref,
					sync_cursor = excluded.sync_cursor,
					last_sync_at = excluded.last_sync_at,
					updated_at = excluded.updated_at
			`)
			.run(row)
	}

	getEmailAccount(userId: string, provider: string): EmailAccountRecord | null {
		const row = this.db
			.prepare(
				'SELECT id, user_id, provider, email_address, oauth_token_ref, sync_cursor, last_sync_at, created_at, updated_at FROM email_accounts WHERE user_id = ? AND provider = ? LIMIT 1'
			)
			.get(userId, provider) as
			| {
					id: string
					user_id: string
					provider: string
					email_address: string
					oauth_token_ref: string | null
					sync_cursor: string | null
					last_sync_at: number | null
					created_at: number
					updated_at: number
			  }
			| undefined
		if (!row) return null
		return {
			id: row.id,
			userId: row.user_id,
			provider: row.provider,
			emailAddress: row.email_address,
			oauthTokenRef: row.oauth_token_ref,
			syncCursor: row.sync_cursor,
			lastSyncAt: row.last_sync_at,
			createdAt: row.created_at,
			updatedAt: row.updated_at
		}
	}

	updateEmailAccountSync(accountId: string, syncCursor: string | null, lastSyncAt: number) {
		this.db.prepare('UPDATE email_accounts SET sync_cursor = ?, last_sync_at = ?, updated_at = ? WHERE id = ?').run(syncCursor, lastSyncAt, Date.now(), accountId)
	}

	clearEmailDataForAccount(accountId: string) {
		this.db.prepare('DELETE FROM email_accounts WHERE id = ?').run(accountId)
	}

	upsertEmailThread(row: EmailThreadRecord) {
		this.db
			.prepare(`
				INSERT INTO email_threads (
					id, user_id, account_id, provider_thread_id, derived_thread_key, subject, participant_summary,
					last_message_at, last_cleaned_preview, unread_count, has_attachments, source_labels_json, created_at, updated_at
				)
				VALUES (
					@id, @userId, @accountId, @providerThreadId, @derivedThreadKey, @subject, @participantSummary,
					@lastMessageAt, @lastCleanedPreview, @unreadCount, @hasAttachments, @sourceLabelsJson, @createdAt, @updatedAt
				)
				ON CONFLICT(id) DO UPDATE SET
					subject = excluded.subject,
					participant_summary = excluded.participant_summary,
					last_message_at = excluded.last_message_at,
					last_cleaned_preview = excluded.last_cleaned_preview,
					unread_count = excluded.unread_count,
					has_attachments = excluded.has_attachments,
					source_labels_json = excluded.source_labels_json,
					updated_at = excluded.updated_at
			`)
			.run({ ...row, hasAttachments: row.hasAttachments ? 1 : 0 })
	}

	upsertEmailMessage(row: EmailMessageRecord) {
		this.db
			.prepare(`
				INSERT INTO email_messages (
					id, user_id, account_id, thread_id, provider_message_id, gmail_history_id,
					sender_name, sender_email, to_json, cc_json, sent_at, direction, snippet,
					body_raw_html, body_raw_text, body_clean_text, has_attachments, is_hidden_automated, created_at, updated_at
				)
				VALUES (
					@id, @userId, @accountId, @threadId, @providerMessageId, @gmailHistoryId,
					@senderName, @senderEmail, @toJson, @ccJson, @sentAt, @direction, @snippet,
					@bodyRawHtml, @bodyRawText, @bodyCleanText, @hasAttachments, @isHiddenAutomated, @createdAt, @updatedAt
				)
				ON CONFLICT(id) DO UPDATE SET
					sender_name = excluded.sender_name,
					sender_email = excluded.sender_email,
					to_json = excluded.to_json,
					cc_json = excluded.cc_json,
					sent_at = excluded.sent_at,
					direction = excluded.direction,
					snippet = excluded.snippet,
					body_raw_html = COALESCE(excluded.body_raw_html, email_messages.body_raw_html),
					body_raw_text = COALESCE(excluded.body_raw_text, email_messages.body_raw_text),
					body_clean_text = COALESCE(excluded.body_clean_text, email_messages.body_clean_text),
					has_attachments = excluded.has_attachments,
					is_hidden_automated = excluded.is_hidden_automated,
					updated_at = excluded.updated_at
			`)
			.run(row)
	}

	upsertEmailAttachment(row: EmailAttachmentRecord) {
		this.db
			.prepare(`
				INSERT INTO email_attachments (
					id, user_id, account_id, message_id, provider_attachment_id,
					filename, mime_type, size_bytes, cached_local_path, cached_at, created_at
				)
				VALUES (
					@id, @userId, @accountId, @messageId, @providerAttachmentId,
					@filename, @mimeType, @sizeBytes, @cachedLocalPath, @cachedAt, @createdAt
				)
				ON CONFLICT(id) DO UPDATE SET
					filename = COALESCE(excluded.filename, email_attachments.filename),
					mime_type = COALESCE(excluded.mime_type, email_attachments.mime_type),
					size_bytes = COALESCE(excluded.size_bytes, email_attachments.size_bytes)
			`)
			.run(row)
	}

	markEmailAttachmentCached(attachmentId: string, cachedLocalPath: string, cachedAt: number) {
		this.db
			.prepare('UPDATE email_attachments SET cached_local_path = ?, cached_at = ? WHERE id = ?')
			.run(cachedLocalPath, cachedAt, attachmentId)
	}

	getEmailThreads(userId: string, limit = 250): EmailThreadRecord[] {
		const rows = this.db
			.prepare(
				`SELECT id, user_id, account_id, provider_thread_id, derived_thread_key, subject, participant_summary,
						last_message_at, last_cleaned_preview, unread_count, has_attachments, source_labels_json, created_at, updated_at
				 FROM email_threads
				 WHERE user_id = ?
				 ORDER BY last_message_at DESC
				 LIMIT ?`
			)
			.all(userId, limit) as Array<any>
		return rows.map(row => ({
			id: row.id,
			userId: row.user_id,
			accountId: row.account_id,
			providerThreadId: row.provider_thread_id,
			derivedThreadKey: row.derived_thread_key,
			subject: row.subject,
			participantSummary: row.participant_summary,
			lastMessageAt: row.last_message_at,
			lastCleanedPreview: row.last_cleaned_preview,
			unreadCount: Number(row.unread_count || 0),
			hasAttachments: Number(row.has_attachments || 0) === 1,
			sourceLabelsJson: row.source_labels_json,
			createdAt: row.created_at,
			updatedAt: row.updated_at
		}))
	}

	getEmailThreadById(threadId: string): EmailThreadRecord | null {
		const row = this.db
			.prepare(
				`SELECT id, user_id, account_id, provider_thread_id, derived_thread_key, subject, participant_summary,
						last_message_at, last_cleaned_preview, unread_count, has_attachments, source_labels_json, created_at, updated_at
				 FROM email_threads WHERE id = ? LIMIT 1`
			)
			.get(threadId) as any
		if (!row) return null
		return {
			id: row.id,
			userId: row.user_id,
			accountId: row.account_id,
			providerThreadId: row.provider_thread_id,
			derivedThreadKey: row.derived_thread_key,
			subject: row.subject,
			participantSummary: row.participant_summary,
			lastMessageAt: row.last_message_at,
			lastCleanedPreview: row.last_cleaned_preview,
			unreadCount: Number(row.unread_count || 0),
			hasAttachments: Number(row.has_attachments || 0) === 1,
			sourceLabelsJson: row.source_labels_json,
			createdAt: row.created_at,
			updatedAt: row.updated_at
		}
	}

	getEmailMessagesForThread(threadId: string, limit = 500): EmailMessageRecord[] {
		const rows = this.db
			.prepare(
				`SELECT id, user_id, account_id, thread_id, provider_message_id, gmail_history_id,
						sender_name, sender_email, to_json, cc_json, sent_at, direction,
						snippet, body_raw_html, body_raw_text, body_clean_text,
						has_attachments, is_hidden_automated, created_at, updated_at
				 FROM email_messages
				 WHERE thread_id = ?
				 ORDER BY sent_at ASC, created_at ASC
				 LIMIT ?`
			)
			.all(threadId, limit) as Array<any>
		return rows.map(row => ({
			id: row.id,
			userId: row.user_id,
			accountId: row.account_id,
			threadId: row.thread_id,
			providerMessageId: row.provider_message_id,
			gmailHistoryId: row.gmail_history_id,
			senderName: row.sender_name,
			senderEmail: row.sender_email,
			toJson: row.to_json,
			ccJson: row.cc_json,
			sentAt: Number(row.sent_at),
			direction: row.direction,
			snippet: row.snippet,
			bodyRawHtml: row.body_raw_html,
			bodyRawText: row.body_raw_text,
			bodyCleanText: row.body_clean_text,
			hasAttachments: Number(row.has_attachments || 0) === 1 ? 1 : 0,
			isHiddenAutomated: Number(row.is_hidden_automated || 0) === 1 ? 1 : 0,
			createdAt: row.created_at,
			updatedAt: row.updated_at
		}))
	}

	getEmailMessageById(messageId: string): EmailMessageRecord | null {
		const row = this.db
			.prepare(
				`SELECT id, user_id, account_id, thread_id, provider_message_id, gmail_history_id,
						sender_name, sender_email, to_json, cc_json, sent_at, direction,
						snippet, body_raw_html, body_raw_text, body_clean_text,
						has_attachments, is_hidden_automated, created_at, updated_at
				 FROM email_messages WHERE id = ? LIMIT 1`
			)
			.get(messageId) as any
		if (!row) return null
		return {
			id: row.id,
			userId: row.user_id,
			accountId: row.account_id,
			threadId: row.thread_id,
			providerMessageId: row.provider_message_id,
			gmailHistoryId: row.gmail_history_id,
			senderName: row.sender_name,
			senderEmail: row.sender_email,
			toJson: row.to_json,
			ccJson: row.cc_json,
			sentAt: Number(row.sent_at),
			direction: row.direction,
			snippet: row.snippet,
			bodyRawHtml: row.body_raw_html,
			bodyRawText: row.body_raw_text,
			bodyCleanText: row.body_clean_text,
			hasAttachments: Number(row.has_attachments || 0) === 1 ? 1 : 0,
			isHiddenAutomated: Number(row.is_hidden_automated || 0) === 1 ? 1 : 0,
			createdAt: row.created_at,
			updatedAt: row.updated_at
		}
	}

	getEmailAttachmentById(attachmentId: string): EmailAttachmentRecord | null {
		const row = this.db
			.prepare(
				`SELECT id, user_id, account_id, message_id, provider_attachment_id, filename,
						mime_type, size_bytes, cached_local_path, cached_at, created_at
				 FROM email_attachments WHERE id = ? LIMIT 1`
			)
			.get(attachmentId) as any
		if (!row) return null
		return {
			id: row.id,
			userId: row.user_id,
			accountId: row.account_id,
			messageId: row.message_id,
			providerAttachmentId: row.provider_attachment_id,
			filename: row.filename,
			mimeType: row.mime_type,
			sizeBytes: row.size_bytes,
			cachedLocalPath: row.cached_local_path,
			cachedAt: row.cached_at,
			createdAt: row.created_at
		}
	}

	getEmailAttachmentsForMessage(messageId: string): EmailAttachmentRecord[] {
		const rows = this.db
			.prepare(
				`SELECT id, user_id, account_id, message_id, provider_attachment_id, filename,
						mime_type, size_bytes, cached_local_path, cached_at, created_at
				 FROM email_attachments WHERE message_id = ? ORDER BY created_at ASC`
			)
			.all(messageId) as Array<any>
		return rows.map(row => ({
			id: row.id,
			userId: row.user_id,
			accountId: row.account_id,
			messageId: row.message_id,
			providerAttachmentId: row.provider_attachment_id,
			filename: row.filename,
			mimeType: row.mime_type,
			sizeBytes: row.size_bytes,
			cachedLocalPath: row.cached_local_path,
			cachedAt: row.cached_at,
			createdAt: row.created_at
		}))
	}

	createWaOutboxMessage(row: Omit<WaOutboxMessageRecord, 'createdAt' | 'updatedAt'> & { createdAt?: number; updatedAt?: number }) {
		const createdAt = row.createdAt ?? Date.now()
		const updatedAt = row.updatedAt ?? createdAt
		this.db
			.prepare(
				`INSERT INTO wa_outbox_messages (
					id, client_request_id, chat_jid, text, quoted_message_key,
					status, error_code, error_message, wa_message_key, created_at, updated_at
				)
				VALUES (
					@id, @clientRequestId, @chatJid, @text, @quotedMessageKey,
					@status, @errorCode, @errorMessage, @waMessageKey, @createdAt, @updatedAt
				)
				ON CONFLICT(client_request_id) DO NOTHING`
			)
			.run({
				...row,
				createdAt,
				updatedAt,
				errorCode: row.errorCode ?? null,
				errorMessage: row.errorMessage ?? null,
				waMessageKey: row.waMessageKey ?? null
			})
		return this.getWaOutboxMessageByClientRequestId(row.clientRequestId)
	}

	updateWaOutboxMessageStatus(
		id: string,
		patch: Partial<Pick<WaOutboxMessageRecord, 'status' | 'errorCode' | 'errorMessage' | 'waMessageKey'>>
	) {
		this.db
			.prepare(
				`UPDATE wa_outbox_messages
				 SET
					status = COALESCE(@status, status),
					error_code = COALESCE(@errorCode, error_code),
					error_message = COALESCE(@errorMessage, error_message),
					wa_message_key = COALESCE(@waMessageKey, wa_message_key),
					updated_at = @updatedAt
				 WHERE id = @id`
			)
			.run({
				id,
				status: patch.status ?? null,
				errorCode: patch.errorCode ?? null,
				errorMessage: patch.errorMessage ?? null,
				waMessageKey: patch.waMessageKey ?? null,
				updatedAt: Date.now()
			})
		return this.getWaOutboxMessageById(id)
	}

	getWaOutboxMessageByClientRequestId(clientRequestId: string): WaOutboxMessageRecord | null {
		const row = this.db
			.prepare(
				`SELECT id, client_request_id, chat_jid, text, quoted_message_key, status, error_code,
					error_message, wa_message_key, created_at, updated_at
				 FROM wa_outbox_messages WHERE client_request_id = ? LIMIT 1`
			)
			.get(clientRequestId) as any
		if (!row) return null
		return {
			id: row.id,
			clientRequestId: row.client_request_id,
			chatJid: row.chat_jid,
			text: row.text,
			quotedMessageKey: row.quoted_message_key,
			status: row.status,
			errorCode: row.error_code,
			errorMessage: row.error_message,
			waMessageKey: row.wa_message_key,
			createdAt: row.created_at,
			updatedAt: row.updated_at
		}
	}

	getWaOutboxMessageById(id: string): WaOutboxMessageRecord | null {
		const row = this.db
			.prepare(
				`SELECT id, client_request_id, chat_jid, text, quoted_message_key, status, error_code,
					error_message, wa_message_key, created_at, updated_at
				 FROM wa_outbox_messages WHERE id = ? LIMIT 1`
			)
			.get(id) as any
		if (!row) return null
		return {
			id: row.id,
			clientRequestId: row.client_request_id,
			chatJid: row.chat_jid,
			text: row.text,
			quotedMessageKey: row.quoted_message_key,
			status: row.status,
			errorCode: row.error_code,
			errorMessage: row.error_message,
			waMessageKey: row.wa_message_key,
			createdAt: row.created_at,
			updatedAt: row.updated_at
		}
	}

	createEmailOutboxMessage(row: Omit<EmailOutboxMessageRecord, 'createdAt' | 'updatedAt'> & { createdAt?: number; updatedAt?: number }) {
		const createdAt = row.createdAt ?? Date.now()
		const updatedAt = row.updatedAt ?? createdAt
		this.db
			.prepare(
				`INSERT INTO email_outbox_messages (
					id, client_request_id, account_id, thread_id, provider_thread_id, to_json, cc_json,
					subject, text_body, html_body, status, error_code, error_message,
					gmail_message_id, gmail_thread_id, created_at, updated_at
				)
				VALUES (
					@id, @clientRequestId, @accountId, @threadId, @providerThreadId, @toJson, @ccJson,
					@subject, @textBody, @htmlBody, @status, @errorCode, @errorMessage,
					@gmailMessageId, @gmailThreadId, @createdAt, @updatedAt
				)
				ON CONFLICT(client_request_id) DO NOTHING`
			)
			.run({
				...row,
				createdAt,
				updatedAt,
				threadId: row.threadId ?? null,
				providerThreadId: row.providerThreadId ?? null,
				htmlBody: row.htmlBody ?? null,
				errorCode: row.errorCode ?? null,
				errorMessage: row.errorMessage ?? null,
				gmailMessageId: row.gmailMessageId ?? null,
				gmailThreadId: row.gmailThreadId ?? null
			})
		return this.getEmailOutboxMessageByClientRequestId(row.clientRequestId)
	}

	updateEmailOutboxMessageStatus(
		id: string,
		patch: Partial<Pick<EmailOutboxMessageRecord, 'status' | 'errorCode' | 'errorMessage' | 'gmailMessageId' | 'gmailThreadId'>>
	) {
		this.db
			.prepare(
				`UPDATE email_outbox_messages
				 SET
					status = COALESCE(@status, status),
					error_code = COALESCE(@errorCode, error_code),
					error_message = COALESCE(@errorMessage, error_message),
					gmail_message_id = COALESCE(@gmailMessageId, gmail_message_id),
					gmail_thread_id = COALESCE(@gmailThreadId, gmail_thread_id),
					updated_at = @updatedAt
				 WHERE id = @id`
			)
			.run({
				id,
				status: patch.status ?? null,
				errorCode: patch.errorCode ?? null,
				errorMessage: patch.errorMessage ?? null,
				gmailMessageId: patch.gmailMessageId ?? null,
				gmailThreadId: patch.gmailThreadId ?? null,
				updatedAt: Date.now()
			})
		return this.getEmailOutboxMessageById(id)
	}

	getEmailOutboxMessageByClientRequestId(clientRequestId: string): EmailOutboxMessageRecord | null {
		const row = this.db
			.prepare(
				`SELECT id, client_request_id, account_id, thread_id, provider_thread_id, to_json, cc_json,
					subject, text_body, html_body, status, error_code, error_message, gmail_message_id,
					gmail_thread_id, created_at, updated_at
				 FROM email_outbox_messages WHERE client_request_id = ? LIMIT 1`
			)
			.get(clientRequestId) as any
		if (!row) return null
		return {
			id: row.id,
			clientRequestId: row.client_request_id,
			accountId: row.account_id,
			threadId: row.thread_id,
			providerThreadId: row.provider_thread_id,
			toJson: row.to_json,
			ccJson: row.cc_json,
			subject: row.subject,
			textBody: row.text_body,
			htmlBody: row.html_body,
			status: row.status,
			errorCode: row.error_code,
			errorMessage: row.error_message,
			gmailMessageId: row.gmail_message_id,
			gmailThreadId: row.gmail_thread_id,
			createdAt: row.created_at,
			updatedAt: row.updated_at
		}
	}

	getEmailOutboxMessageById(id: string): EmailOutboxMessageRecord | null {
		const row = this.db
			.prepare(
				`SELECT id, client_request_id, account_id, thread_id, provider_thread_id, to_json, cc_json,
					subject, text_body, html_body, status, error_code, error_message, gmail_message_id,
					gmail_thread_id, created_at, updated_at
				 FROM email_outbox_messages WHERE id = ? LIMIT 1`
			)
			.get(id) as any
		if (!row) return null
		return {
			id: row.id,
			clientRequestId: row.client_request_id,
			accountId: row.account_id,
			threadId: row.thread_id,
			providerThreadId: row.provider_thread_id,
			toJson: row.to_json,
			ccJson: row.cc_json,
			subject: row.subject,
			textBody: row.text_body,
			htmlBody: row.html_body,
			status: row.status,
			errorCode: row.error_code,
			errorMessage: row.error_message,
			gmailMessageId: row.gmail_message_id,
			gmailThreadId: row.gmail_thread_id,
			createdAt: row.created_at,
			updatedAt: row.updated_at
		}
	}

	close() {
		this.db.close()
	}
}

export const getMessageTimestamp = (message: WAMessage): number => {
	const raw = Number(message.messageTimestamp || 0)
	return Number.isFinite(raw) && raw > 0 ? raw : Math.floor(Date.now() / 1000)
}
