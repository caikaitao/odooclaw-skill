import type { ChannelProvider, InboundMessage, ResolvedChannel } from "./types.js";
import type { OdooConfig } from "../rpc.js";
import { odooRpc } from "../rpc.js";

/**
 * Odoo Discuss provider — polls `discuss.channel` messages via `mail.message`.
 */
export const discussProvider: ChannelProvider = {
  id: "discuss",
  label: "Odoo Discuss",

  async fetchNewMessages(cfg: OdooConfig, cursor: number): Promise<InboundMessage[]> {
    const msgs = await odooRpc(cfg, "mail.message", "search_read", [[
      ["id", ">", cursor],
      ["model", "=", "discuss.channel"],
      ["message_type", "in", ["comment", "email"]],
    ]], {
      fields: ["id", "body", "author_id", "partner_ids", "res_id", "date"],
      order: "id asc",
      limit: 20,
    });
    return (msgs ?? []).map((m: any) => ({
      id: m.id,
      body: m.body ?? "",
      authorId: m.author_id ?? null,
      partnerIds: m.partner_ids ?? [],
      channelId: m.res_id,
      date: m.date,
    }));
  },

  async sendMessage(cfg: OdooConfig, channelId: number, text: string, isHtml = false): Promise<void> {
    await odooRpc(cfg, "discuss.channel", "openclaw_post_bot_message", [[channelId], text], {
      author_partner_id: cfg.botPartnerId,
      is_html: isHtml,
    });
  },

  async resolveChannel(cfg: OdooConfig, channelId: number): Promise<ResolvedChannel | null> {
    const channels = await odooRpc(cfg, "discuss.channel", "search_read", [[
      ["id", "=", channelId],
    ]], {
      fields: ["id", "name", "channel_type"],
      limit: 1,
    });
    const ch = channels?.[0];
    if (!ch) return null;
    return {
      id: ch.id,
      name: ch.name,
      type: ch.channel_type === "chat" ? "dm" : "group",
      isPrivate: ch.channel_type === "chat",
    };
  },

  shouldRespond(channel: ResolvedChannel, msg: InboundMessage, cfg: OdooConfig): boolean {
    if (channel.isPrivate) return true;
    return msg.partnerIds.includes(cfg.botPartnerId);
  },
};
