export {
  createGmailConnector,
  type GmailConnector,
  type GmailConnectorOptions,
  type GmailRuntimeStatus,
  type GmailSyncSummary,
} from './gmail-connector.js';
export {
  createGmailSendService,
  type GmailSendService,
  type GmailSendServiceOptions,
  type SendEmailInput,
} from './gmail-send-service.js';
export {
  GMAIL_SCOPE,
  parseOauthConfig,
  type GmailOAuthConfig,
  type GmailToken,
} from './oauth.js';
