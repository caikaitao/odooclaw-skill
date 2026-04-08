import type { ClawdbotPluginApi } from "openclaw/plugin-sdk";

import type { OdooConfig, MaybeWrappedOdooConfig } from "./rpc.ts";

/**
 * Read and validate the Odoo config from plugin API or environment variables.
 *
 * Environment variables (if present) will override the plugin configuration:
 * - `ODOO_URL`
 * - `ODOO_DB`
 * - `ODOO_UID`
 * - `ODOO_PASSWORD`
 * - `ODOO_API_KEY`
 * - `ODOO_BOT_PARTNER_ID`
 * - `ODOO_PROVIDER`
 * - `ODOO_WEBHOOK_API_KEY`
 *
 * Auth: requires `url`, `db`, `uid`, (`password` | `apiKey`), `botPartnerId`.
 *
 * Returns `null` if the config is missing or incomplete.
 */
export function getCfg(api: ClawdbotPluginApi): OdooConfig | null {
  const raw = api.config?.channels?.["odooClaw-channel"] as MaybeWrappedOdooConfig | undefined;
  const cfgFromPlugin = raw?.odoo?.url ? raw.odoo : (raw || {});

  const url = process.env.ODOO_URL || cfgFromPlugin.url || "";
  const db = process.env.ODOO_DB || cfgFromPlugin.db;
  const uid = process.env.ODOO_UID ? parseInt(process.env.ODOO_UID, 10) : cfgFromPlugin.uid;
  const password = process.env.ODOO_PASSWORD || cfgFromPlugin.password;
  const apiKey = process.env.ODOO_API_KEY || cfgFromPlugin.apiKey;
  const botPartnerId = process.env.ODOO_BOT_PARTNER_ID ? parseInt(process.env.ODOO_BOT_PARTNER_ID, 10) : cfgFromPlugin.botPartnerId || 0;
  const provider = process.env.ODOO_PROVIDER || cfgFromPlugin.provider;
  const webhookApiKey = process.env.ODOO_WEBHOOK_API_KEY || cfgFromPlugin.webhookApiKey;
  const webhookUrl =
    process.env.ODOO_WEBHOOK_URL ||
    cfgFromPlugin.webhookUrl ||
    (url ? `${url.replace(/\/+$/, "")}/openclaw/webhook` : undefined);

  // All required fields must be present
  if (!url || !db || !uid || !botPartnerId) return null;
  if (!password && !apiKey) return null;

  return {
    url,
    db,
    uid,
    password,
    apiKey,
    botPartnerId,
    provider,
    webhookApiKey,
    webhookUrl,
  };
}
