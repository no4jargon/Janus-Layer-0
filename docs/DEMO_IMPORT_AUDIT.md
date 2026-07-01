# Demo Import Audit (`Baileys/demo` -> `chai`)

Status: active
Last updated: 2026-05-02

Source audited: `/Users/anujshah/Desktop/Projects/Baileys/demo`

## Objective

Import useful prototype logic into `chai` while preserving product constraints:
- desktop-first
- local-first
- privacy-first
- no hosted server-side message storage

## Import decisions

## 1) DB model + persistence

Source:
- `demo/db.ts`

Decision:
- **Imported with refactor — complete for v1 mirror surface.**

Imported now:
- email mirror schema -> `packages/db/migrations/002_email_mirror.sql`
- whatsapp mirror schema -> `packages/db/migrations/003_whatsapp_mirror.sql`
- whatsapp send outbox -> `packages/db/migrations/004_wa_outbox.sql`
- email send outbox -> `packages/db/migrations/002_email_mirror.sql`
- typed repositories: `createEmailStore`, `createWhatsAppStore`, `createConnectorStateStore` in `packages/db/src/`

Still ahead:
- compaction / pruning of mirrored history
- shared cluster + AI output tables (Phase 3)

## 2) Gmail mirror sync

Source:
- `demo/email.ts`

Decision:
- **Imported with refactor — complete.**

Imported now:
- OAuth connect flow (desktop local 127.0.0.1 callback)
- token persistence + refresh
- profile fetch
- thread fetch + message normalization
- body cleanup + heuristic automation filtering
- mirror upserts into email tables via `EmailStore`
- attachment metadata persistence + cached fetch via `getAttachmentContent`

Lives in:
- `packages/connectors-gmail/src/{oauth,message-normalizer,gmail-connector}.ts`

Still ahead:
- incremental sync cursor (currently re-pulls last 7 days)
- attachment download/save UX in renderer

## 3) Gmail send pipeline

Source:
- `demo/email-send.ts`

Decision:
- **Imported with refactor — complete.**

Imported now:
- typed `GmailSendService` with outbox dedupe by `clientRequestId`
- thread-aware reply (resolves `In-Reply-To` / `References` from Gmail metadata API)
- structured outbox status updates (`queued`, `sending`, `sent`, `failed`) via `EmailStore`
- IPC at `chai:gmail:send`

Lives in:
- `packages/connectors-gmail/src/gmail-send-service.ts`

Still ahead:
- compose UX in the renderer

## 4) WhatsApp pairing + mirror

Source:
- `demo/whatsapp-send.ts`
- `demo/server.ts` (Baileys socket lifecycle)

Decision:
- **Imported with refactor — complete for v1 mirror + send.**

Imported now:
- Baileys socket lifecycle behind `createWhatsAppConnector`
- QR codes streamed to renderer through Electron IPC events
- persistent multi-file auth state under `<keystore>/whatsapp-session/`
- reconnect with exponential backoff, logout detection
- history.set / chats.upsert / contacts.upsert / messages.upsert / messages.update / messages.delete handlers mirror into `WhatsAppStore`
- `createWhatsAppSendService` ports the prototype outbox + `sock.sendMessage` flow
- IPC at `chai:whatsapp:send`

Lives in:
- `packages/connectors-whatsapp/src/{whatsapp-connector,whatsapp-send-service,message-parser}.ts`

Still ahead:
- chat browser + send UX in renderer
- group metadata enrichment loop (prototype hydrated subjects on demand)

## 5) Core server glue (`demo/server.ts`)

Decision:
- **Not imported as HTTP/WS server.**

Reason:
- The prototype's HTTP+WebSocket server is a development affordance. In the desktop runtime, the renderer talks to the main process directly via Electron `contextBridge` + `ipcRenderer`/`ipcMain`, removing the need for an in-process HTTP server.

What was kept from `server.ts`:
- the WhatsApp event handler logic was distilled into `whatsapp-connector.ts`
- the Gmail sync orchestration logic was distilled into `gmail-connector.ts`
- the Gmail OAuth callback runs as an ephemeral 127.0.0.1 server inside `runDesktopOAuth`

## 6) AI workflow extraction (`demo/llm/extract_workflow.py`, `demo/server.ts` Ollama call)

Decision:
- **Imported with refactor — complete.**

Imported now:
- TypeScript `createWorkflowExtractor` in `@chai/ai/src/ollama.ts`
- Workflow prompt and `WORKFLOW_CATEGORIES` constants ported verbatim
- Renderer AI panel: cluster picker + lookback hours pickers + run-for-cluster + run-for-all-clusters + progress bar + collated output rendering
- AI outputs persisted to `ai_outputs` table via IPC `chai:ai:save-output`

Lives in:
- `packages/ai/src/{ollama,workflow-prompt}.ts`
- `packages/ui/src/AiPanel.tsx`
- `packages/ui/src/lib/workflow-output.ts`

The Python `extract_workflow.py` script is kept as a reference; it is not invoked at runtime.

## 7) Renderer UX (`demo/public/{index.html,app.js,style.css}`)

Decision:
- **Imported with refactor — complete (Phase 3 cluster + AI port).**

Imported now:
- 3-pane layout (sidebar + thread + AI panel) ported as React components in `packages/ui/src/{App,Workspace,AiPanel}.tsx`
- CSS ported verbatim into `packages/ui/src/styles.css` (extra block for migration recovery screen appended)
- Tabs (WhatsApp / Email / Clusters) + More-channels carousel + coming-soon banner
- Multi-select with Cmd-click + Shift-click range; Create Cluster button (random color from prototype palette)
- Cluster grouping view in the Clusters tab
- Composer (WhatsApp Enter-to-send, Email reply/new mode toggle with To/Cc/Subject)
- AI panel cluster picker + lookback hours pickers + run buttons
- Cheat codes (`wipeclusters`, Cmd/Ctrl+E)
- Mobile back button + responsive layout
- QR pairing block (renders QR via `api.qrserver.com` image — same as demo)

What changed vs the demo:
- Cluster state moved from `localStorage` to the DB (`clusters` + `cluster_members`)
- HTTP/WebSocket calls replaced with `window.chaiApi.*` Electron IPC
- Email attachment links replaced with an Electron save-dialog flow

## Next extraction batches

1. Build a settings / onboarding screen (Phase 3 polish).
2. Add cluster rename + recolor UX (right-click menu).
3. Phase 4 packaging + updater scaffolding.
