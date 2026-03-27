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

/* ── Filter: framework / system diagnostic messages ── */

const SYSTEM_DIAGNOSTIC_PATTERNS = [
  /Gateway restart update skipped/i,
  /openclaw\s+doctor/i,
  /Run:\s*openclaw\s/i,
];

/** Returns true when the text looks like an internal framework diagnostic that should not be forwarded to Odoo. */
function isSystemDiagnostic(text: string): boolean {
  return SYSTEM_DIAGNOSTIC_PATTERNS.some((p) => p.test(text));
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

      if (isSystemDiagnostic(text)) return { ok: true }; // silently drop framework diagnostics

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

  const body = core.channel.reply.formatInboundEnvelope({
    channel: provider.label,
    from: fromLabel,
    timestamp: msg.date ? Date.parse(msg.date) : undefined,
    body: bodyText,
    chatType,
    sender: { name: authorName, id: authorId },
  });

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
      if (isSystemDiagnostic(text)) return; // silently drop framework diagnostics
      const chunks = core.channel.text.chunkMarkdownTextWithMode(text, textLimit, chunkMode);
      for (const chunk of chunks.length > 0 ? chunks : [text]) {
        if (!chunk) continue;
        await provider.sendMessage(cfg, channelId, formatFn(chunk), true);
      }
    },
    onError: (err: unknown, info: { kind: string }) => {
      api.logger?.error(`odoo ${info.kind} reply failed: ${String(err)}`);
    },
  });

  await core.channel.reply.dispatchReplyFromConfig({
    ctx: ctxPayload,
    cfg: api.config,
    dispatcher,
    replyOptions,
  });
  markDispatchIdle();
}

/* ── Polling service ── */

let lastMessageId = 0;
let pollingTimer: ReturnType<typeof setTimeout> | null = null;

/** Default polling interval in ms. */
const DEFAULT_POLL_INTERVAL_MS = 3000;

/** Whether the polling loop has been started at least once. */
let pollingStarted = false;

/** Max polling interval after consecutive errors (exponential backoff cap). */
const MAX_BACKOFF_MS = 60_000;

/** Consecutive error counter for backoff. */
let consecutiveErrors = 0;

export function registerPollingService(api: ClawdbotPluginApi) {
  savedApi = api;

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
    if (!cfg) {
      (api.logger as any)?.warn?.(
        "odoo-channel: config incomplete — polling skipped. " +
        "Ensure channels.odoo has url, db, uid, botPartnerId, and password/apiKey.",
      ) ?? api.logger?.info(
        "odoo-channel: config incomplete — polling skipped. " +
        "Ensure channels.odoo has url, db, uid, botPartnerId, and password/apiKey.",
      );
      return;
    }

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
        if (sentMessageIds.has(msg.id)) continue;

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

  const startPolling = async () => {
    if (pollingStarted) return;
    pollingStarted = true;
    api.logger?.info("odoo-channel: starting polling service");
    await poll();
    schedulePoll();
  };

  const stopPolling = () => {
    if (pollingTimer) {
      clearTimeout(pollingTimer);
      pollingTimer = null;
    }
    pollingStarted = false;
    consecutiveErrors = 0;
    api.logger?.info("odoo-channel: polling service stopped");
  };

  // Register as a managed service so the framework can stop it gracefully.
  api.registerService({
    id: "odoo-poller",
    start: startPolling,
    stop: stopPolling,
  });

  // Auto-start: kick off polling immediately if config is available,
  // so we don't depend solely on the framework calling start().
  const cfg = getCfg(api);
  if (cfg) {
    api.logger?.info("odoo-channel: auto-starting polling (config detected)");
    startPolling();
  } else {
    api.logger?.info(
      "odoo-channel: polling registered but not auto-started (config missing). " +
      "Waiting for framework to call start() or for config to become available.",
    );
  }
}
