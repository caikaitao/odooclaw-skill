import type { OdooConfig } from "../../rpc.ts";

/* ── Normalized inbound message ── */

export interface InboundMessage {
  id: number;
  body: string;
  authorId: [number, string] | null;
  partnerIds: number[];
  channelId: number;
  date?: string;
  content?: WebhookContent;
  attachments?: WebhookAttachment[];
}

/* ── Attachment payload ── */

export interface WebhookAttachment {
  filename?: string;
  url?: string;
}

/* ── Rich content payload ── */

export interface WebhookContent {
  text?: string;
  html?: string;
  markdown?: string;
  format?: "html" | "markdown" | "plain" | (string & {});
}

/* ── Webhook event contracts ── */

export interface OdooWebhookChannel {
  id: number;
  name?: string;
  type: "dm" | "group" | "ticket" | "livechat" | "chat" | (string & {});
  isPrivate: boolean;
}

export interface OdooWebhookAuthor {
  partnerId: number | null;
  name?: string;
}

export interface OdooWebhookBot {
  partnerId?: number;
  name?: string;
}

export interface OdooWebhookEvent {
  source?: "odoo" | "openclaw" | (string & {});
  eventType?: string;
  messageId: number;
  timestamp?: string | number;
  triggerType?: "dm" | "group" | (string & {});
  channel: OdooWebhookChannel;
  author: OdooWebhookAuthor;
  bot?: OdooWebhookBot;
  message: WebhookContent;
  content?: WebhookContent;
  attachments?: WebhookAttachment[];
  mention?: { mentioned: boolean };
  idempotencyKey?: string;
}

export interface OpenClawReplyWebhookEvent {
  source: "openclaw";
  eventType: "message.reply" | string;
  messageId: string;
  timestamp: string;
  channel: OdooWebhookChannel;
  author: OdooWebhookAuthor;
  bot: OdooWebhookBot;
  content: WebhookContent;
  attachments?: WebhookAttachment[];
  idempotencyKey?: string;
}

/* ── Resolved channel metadata ── */

export interface ResolvedChannel {
  id: number;
  name?: string;
  /** Semantic type used for routing: "dm", "group", "ticket", "livechat", etc. */
  type: "dm" | "group" | "ticket" | "livechat" | (string & {});
  isPrivate: boolean;
}

/* ── Channel provider contract ── */

/**
 * A `ChannelProvider` encapsulates all backend-specific logic for one
 * Odoo channel source (Discuss, Helpdesk, Live Chat, …).
 *
 * The webhook entrypoint in `src/channel/index.ts` delegates to these methods
 * so that adding a new backend requires only a new provider file.
 */
export interface ChannelProvider {
  /** Unique provider identifier, e.g. "discuss", "helpdesk". */
  id: string;
  /** Human-readable label shown in logs and UI. */
  label: string;
  /** Send a text (or HTML) reply to the given channel / record. */
  sendMessage(cfg: OdooConfig, channelId: number, text: string, isHtml?: boolean): Promise<void>;
  /**
   * Decide whether the bot should respond to this message.
   * Typical checks: is it a DM? was the bot @mentioned?
   */
  shouldRespond(channel: ResolvedChannel, msg: InboundMessage, cfg: OdooConfig): boolean;
  /**
   * Optional outbound formatter.
   * When absent the default `formatOdooRichText` is used.
   */
  formatOutbound?(text: string): string;
}
