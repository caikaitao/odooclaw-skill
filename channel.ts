import type { ClawdbotPluginApi } from "openclaw/plugin-sdk";

import type { OdooConfig } from "./rpc.ts";
import type { ChannelProvider, InboundMessage, ResolvedChannel } from "./providers/types.ts";
import { odooRpc } from "./rpc.ts";
import { getCfg } from "./config.ts";
import { getOdooRuntime } from "./runtime.ts";
import { formatOdooRichText, cleanOdooBody } from "./rich-text.ts";
import { getProvider } from "./providers/registry.ts";

/* ── Tracking sent message IDs for reliable bot-echo filtering ── */

const sentMessageIds = new Set<number>();
const SENT_IDS_MAX = 500;

export function trackSentMessageId(id: number) {
  sentMessageIds.add(id);
  if (sentMessageIds.size > SENT_IDS_MAX) {
    const first = sentMessageIds.values().next().value;
    if (first !== undefined) sentMessageIds.delete(first);
  }
}

/* ── Saved plugin API reference for outbound ── */

let savedApi: ClawdbotPluginApi | null = null;

/* ── Channel plugin definition ── */

export const odooPlugin = {
  id: "odoo",
  meta: {
    id: "odoo",
    label: "Odoo Channel",
    selectionLabel: "Odoo Channel (local deploy)",
    docsPath: "/channels/odoo",
    blurb: "Odoo channel plugin supporting DMs and group channels via configurable providers (Discuss, Helpdesk, etc.).",
    aliases: ["odoo", "odoo-discuss"],
  },
  capabilities: {
    chatTypes: ["direct", "group"],
  },
  config: {
    listAccountIds: (cfg: any) => {
      const channelCfg = cfg?.channels?.odoo;
      return channelCfg ? ["default"] : [];
    },
    resolveAccount: (cfg: any, accountId: string) => {
      const channelCfg = cfg?.channels?.odoo;
      return channelCfg ? { accountId, ...(channelCfg.odoo || channelCfg) } : null;
    },
  },
  outbound: {
    deliveryMode: "direct",
    sendText: async ({ text, to }: { text: string; to: string }) => {
      if (!savedApi) return { ok: false, error: "Odoo plugin API not initialized" };
      const cfg = getCfg(savedApi);
      if (!cfg) return { ok: false, error: "Odoo not configured" };

      const match = to.match(/^(?:channel|chat|group):(\d+)$/) ?? to.match(/^(\d+)$/);
      if (!match) return { ok: false, error: `Invalid 'to' format: ${to}` };

      const channelId = parseInt(match[1], 10);
      const provider = getProvider(cfg.provider);
      await provider.sendMessage(cfg, channelId, text);
      return { ok: true };
    },
  },
};

/* ── Inbound: route to agent session ── */

async function handleInboundMessage(
  api: ClawdbotPluginApi,
  cfg: OdooConfig,
  msg: InboundMessage,
  channel: ResolvedChannel,
  provider: ChannelProvider,
) {
  const core = getOdooRuntime();
  const channelId = msg.channelId;
  api.logger?.info(`odoo-channel: handleInbound start messageId=${msg.id} channelId=${channelId} provider=${provider.id}`);

  const isPrivateChat = channel.isPrivate;
  const authorId = String(msg.authorId?.[0] ?? "unknown");
  const authorName = msg.authorId?.[1] ?? "Unknown User";
  const peerId = String(channelId);
  const resolvedRoute = core.channel.routing.resolveAgentRoute({
    cfg: api.config,
    channel: "odoo",
    accountId: "default",
    peer: {
      kind: isPrivateChat ? "dm" : "group",
      id: peerId,
    },
    messageText: isPrivateChat ? cleanOdooBody(msg.body) : null,
  });
  const agentId = resolvedRoute?.agentId || "main";
  const accountId = resolvedRoute?.accountId || "default";
  const sessionKey = `agent:${agentId}:odoo:${isPrivateChat ? "dm" : "group"}:${peerId}`;
  api.logger?.info(`odoo-channel: HARD ROUTE sessionKey=${sessionKey} agentId=${agentId} peerId=${peerId} private=${isPrivateChat}`);
  const chatType = isPrivateChat ? "direct" : "group";
  const to = isPrivateChat ? `chat:${channelId}` : `channel:${channelId}`;
  const fromLabel = isPrivateChat ? authorName : `${channel.name || `channel-${channelId}`} / ${authorName}`;
  const bodyText = cleanOdooBody(msg.body);

  core.system.enqueueSystemEvent(
    isPrivateChat
      ? `Odoo DM from ${authorName}: ${bodyText.slice(0, 160)}`
      : `Odoo message in ${channel.name || channelId} from ${authorName}: ${bodyText.slice(0, 160)}`,
    {
      sessionKey,
      contextKey: `odoo:message:${channelId}:${msg.id}`,
    },
  );
  api.logger?.info(`odoo-channel: system event enqueued messageId=${msg.id}`);

  const body = core.channel.reply.formatInboundEnvelope({
    channel: provider.label,
    from: fromLabel,
    timestamp: msg.date ? Date.parse(msg.date) : undefined,
    body: `${bodyText}\n[odoo message id: ${msg.id} channel: ${channelId}]`,
    chatType,
    sender: { name: authorName, id: authorId },
  });
  api.logger?.info(`odoo-channel: inbound envelope built messageId=${msg.id}`);

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: bodyText,
    CommandBody: bodyText,
    From: isPrivateChat ? `odoo:${authorId}` : `odoo:channel:${channelId}`,
    To: to,
    SessionKey: sessionKey,
    AccountId: accountId,
    ChatType: chatType,
    ConversationLabel: fromLabel,
    GroupSubject: !isPrivateChat ? (channel.name || `channel-${channelId}`) : undefined,
    SenderName: authorName,
    SenderId: authorId,
    Provider: "odoo",
    Surface: "odoo",
    MessageSid: String(msg.id),
    Timestamp: msg.date ? Date.parse(msg.date) : undefined,
    WasMentioned: !isPrivateChat ? msg.partnerIds.includes(cfg.botPartnerId) : undefined,
    OriginatingChannel: "odoo",
    OriginatingTo: to,
  });
  api.logger?.info(`odoo-channel: inbound context finalized messageId=${msg.id}`);

  if (isPrivateChat) {
    const storePath = core.channel.session.resolveStorePath(api.config?.session?.store, {
      agentId: agentId,
    });
    await core.channel.session.updateLastRoute({
      storePath,
      sessionKey,
      deliveryContext: {
        channel: "odoo",
        to,
        accountId: accountId,
      },
    });
    api.logger?.info(`odoo-channel: last route updated messageId=${msg.id}`);
  }

  const textLimit = core.channel.text.resolveTextChunkLimit(api.config, "odoo", "default", {
    fallbackLimit: 4000,
  });
  const chunkMode = core.channel.text.resolveChunkMode(api.config, "odoo", "default");
  const formatFn = provider.formatOutbound ?? formatOdooRichText;
  const { dispatcher, replyOptions, markDispatchIdle } = core.channel.reply.createReplyDispatcherWithTyping({
    humanDelay: core.channel.reply.resolveHumanDelayConfig(api.config, agentId),
    deliver: async (payload: { text?: string }) => {
      const text = payload.text ?? "";
      api.logger?.info(`odoo-channel: deliver invoked messageId=${msg.id} textLen=${text.length} channelId=${channelId}`);
      const chunks = core.channel.text.chunkMarkdownTextWithMode(text, textLimit, chunkMode);
      for (const chunk of chunks.length > 0 ? chunks : [text]) {
        if (!chunk) continue;
        api.logger?.info(`odoo-channel: sending chunk messageId=${msg.id} chunkLen=${chunk.length}`);
        await provider.sendMessage(cfg, channelId, formatFn(chunk), true);
      }
      api.logger?.info(`odoo-channel: delivered reply to ${to}`);
    },
    onError: (err: unknown, info: { kind: string }) => {
      api.logger?.error(`odoo ${info.kind} reply failed: ${String(err)}`);
    },
  });
  api.logger?.info(`odoo-channel: dispatcher created messageId=${msg.id}`);

  await core.channel.reply.dispatchReplyFromConfig({
    ctx: ctxPayload,
    cfg: api.config,
    dispatcher,
    replyOptions,
  });
  api.logger?.info(`odoo-channel: dispatch complete messageId=${msg.id}`);
  markDispatchIdle();
}

/* ── Polling service ── */

let lastMessageId = 0;
let pollingTimer: ReturnType<typeof setTimeout> | null = null;

/** Default polling interval in ms. */
const DEFAULT_POLL_INTERVAL_MS = 3000;

/** Max polling interval after consecutive errors (exponential backoff cap). */
const MAX_BACKOFF_MS = 60_000;

/** Consecutive error counter for backoff. */
let consecutiveErrors = 0;

export function registerPollingService(api: ClawdbotPluginApi) {
  savedApi = api;

  api.registerService({
    id: "odoo-poller",
    start: async () => {
      api.logger?.info("odoo-channel: starting polling service");

      const getInterval = () => {
        if (consecutiveErrors === 0) return DEFAULT_POLL_INTERVAL_MS;
        return Math.min(DEFAULT_POLL_INTERVAL_MS * Math.pow(2, consecutiveErrors), MAX_BACKOFF_MS);
      };

      const schedulePoll = () => {
        if (pollingTimer) clearTimeout(pollingTimer);
        pollingTimer = setTimeout(async () => {
          await poll();
          schedulePoll();
        }, getInterval());
      };

      const poll = async () => {
        const cfg = getCfg(api);
        if (!cfg) return;

        const provider = getProvider(cfg.provider);

        try {
          if (lastMessageId === 0) {
            if (provider.initCursor) {
              lastMessageId = await provider.initCursor(cfg);
            } else {
              const msgs = await odooRpc(cfg, "mail.message", "search_read", [[]], {
                fields: ["id"],
                limit: 1,
                order: "id desc",
              });
              lastMessageId = msgs?.[0]?.id ?? 0;
            }
            api.logger?.info(`odoo-channel: initialized cursor lastMessageId=${lastMessageId} provider=${provider.id}`);
            consecutiveErrors = 0;
            return;
          }

          const newMsgs = await provider.fetchNewMessages(cfg, lastMessageId);
          consecutiveErrors = 0;

          if (!newMsgs?.length) return;

          for (const msg of newMsgs) {
            lastMessageId = Math.max(lastMessageId, msg.id);

            if (msg.authorId?.[0] === cfg.botPartnerId) continue;
            if (sentMessageIds.has(msg.id)) {
              api.logger?.info(`odoo-channel: skipping tracked sent message messageId=${msg.id}`);
              continue;
            }

            const bodyText = cleanOdooBody(msg.body);
            if (!bodyText) continue;

            const channel = await provider.resolveChannel(cfg, msg.channelId);
            if (!channel) continue;
            if (!provider.shouldRespond(channel, msg, cfg)) continue;

            api.logger?.info(
              `odoo-channel: new message ch=${msg.channelId} provider=${provider.id} from=${msg.authorId?.[1] ?? "unknown"}: ${bodyText.slice(0, 80)}`,
            );

            await handleInboundMessage(api, cfg, msg, channel, provider);
          }
        } catch (e: any) {
          consecutiveErrors += 1;
          api.logger?.error(`odoo-channel polling error (attempt ${consecutiveErrors}, next in ${getInterval()}ms): ${e?.stack || e?.message || e}`);
        }
      };

      await poll();
      schedulePoll();
    },
    stop: () => {
      if (pollingTimer) {
        clearTimeout(pollingTimer);
        pollingTimer = null;
      }
      consecutiveErrors = 0;
      api.logger?.info("odoo-channel: polling service stopped");
    },
  });
}
