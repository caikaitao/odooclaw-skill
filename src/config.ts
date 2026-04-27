import type { ClawdbotPluginApi } from "openclaw/plugin-sdk";

import type { OdooConfig, MaybeWrappedOdooConfig } from "./rpc.ts";

/**
 * Read and validate the Odoo config from plugin API or environment variables.
 *
 * Environment variables (if present) will override the plugin configuration:
 * - `ODOO_URL`
 * - `ODOO_DB`
 * - `ODOO_UID`
 * - `ODOO_API_KEY`
 * - `ODOO_BOT_PARTNER_ID`
 * - `ODOO_PROVIDER`
 *
 * Auth: requires `url`, `db`, `uid`, `apiKey`, `botPartnerId`.
 *
 * Returns `null` if the config is missing or incomplete.
 */
export function isOdooClawEnabled(api: ClawdbotPluginApi): boolean {
  const raw = api.config?.channels?.["odooClaw-channel"] as MaybeWrappedOdooConfig | undefined;
  const cfgFromPlugin = raw?.odoo ? raw.odoo : (raw || {});
  return process.env.ODOO_ENABLED
    ? !["0", "false", "no", "off"].includes(process.env.ODOO_ENABLED.trim().toLowerCase())
    : cfgFromPlugin.enabled !== false;
}

export function getCfg(api: ClawdbotPluginApi): OdooConfig | null {
  const raw = api.config?.channels?.["odooClaw-channel"] as MaybeWrappedOdooConfig | undefined;
  const cfgFromPlugin = raw?.odoo ? raw.odoo : (raw || {});

  const url = process.env.ODOO_URL || cfgFromPlugin.url || "";
  const db = process.env.ODOO_DB || cfgFromPlugin.db;
  const uid = process.env.ODOO_UID ? parseInt(process.env.ODOO_UID, 10) : cfgFromPlugin.uid;
  const apiKey = process.env.ODOO_API_KEY || cfgFromPlugin.apiKey;
  const botPartnerId = process.env.ODOO_BOT_PARTNER_ID ? parseInt(process.env.ODOO_BOT_PARTNER_ID, 10) : cfgFromPlugin.botPartnerId || 0;
  const provider = process.env.ODOO_PROVIDER || cfgFromPlugin.provider;
  const enabled = isOdooClawEnabled(api);
  const webhookUrl =
    process.env.ODOO_WEBHOOK_URL ||
    cfgFromPlugin.webhookUrl ||
    (url ? `${url.replace(/\/+$/, "")}/odoo/webhook` : undefined);
  const allowedSourceIps = (process.env.ODOO_ALLOWED_SOURCE_IPS
    ? process.env.ODOO_ALLOWED_SOURCE_IPS.split(",")
    : Array.isArray(cfgFromPlugin.allowedSourceIps)
      ? cfgFromPlugin.allowedSourceIps
      : []
  ).filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  if (api.logger) {
    allowedSourceIps.forEach(pattern => {
      const trimmed = pattern.trim();
      if (!trimmed.includes("/")) return;
      const [subnet, bitsStr] = trimmed.split("/");
      const bits = parseInt(bitsStr, 10);
      if (!subnet || !Number.isFinite(bits) || bits < 0 || bits > 32) {
        api.logger!.warn(`[odooClaw] invalid CIDR in allowedSourceIps: ${trimmed}`);
      }
    });
  }

  // All required fields must be present
  if (!url || !db || !uid || !botPartnerId) return null;
  if (!apiKey) return null;

  return {
    url,
    db,
    uid,
    apiKey,
    botPartnerId,
    provider,
    webhookUrl,
    enabled,
    allowedSourceIps,
  };
}
