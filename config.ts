import type { ClawdbotPluginApi } from "openclaw/plugin-sdk";

import type { OdooConfig, MaybeWrappedOdooConfig } from "./rpc.js";

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
 * - `ODOO_WEBHOOK_SECRET`
 *
 * Supports two auth modes:
 * - **Legacy** — requires `url`, `db`, `uid`, `password`, `botPartnerId`
 * - **API Key** — requires `url`, `apiKey`, `botPartnerId`
 *
 * Returns `null` if the config is missing or incomplete.
 */
export function getCfg(api: ClawdbotPluginApi): OdooConfig | null {
  const raw = api.config?.channels?.odoo as MaybeWrappedOdooConfig | undefined;
  const cfgFromPlugin = raw?.odoo?.url ? raw.odoo : (raw || {});

  // Merge with environment variables
  const cfg: OdooConfig = {
    url: process.env.ODOO_URL || cfgFromPlugin.url || "",
    db: process.env.ODOO_DB || cfgFromPlugin.db,
    uid: process.env.ODOO_UID ? parseInt(process.env.ODOO_UID, 10) : cfgFromPlugin.uid,
    password: process.env.ODOO_PASSWORD || cfgFromPlugin.password,
    apiKey: process.env.ODOO_API_KEY || cfgFromPlugin.apiKey,
    botPartnerId: process.env.ODOO_BOT_PARTNER_ID ? parseInt(process.env.ODOO_BOT_PARTNER_ID, 10) : cfgFromPlugin.botPartnerId || 0,
    provider: process.env.ODOO_PROVIDER || cfgFromPlugin.provider,
    webhookSecret: process.env.ODOO_WEBHOOK_SECRET || cfgFromPlugin.webhookSecret,
  };

  if (!cfg.url || !cfg.botPartnerId) return null;

  // API Key mode — only need url + apiKey + botPartnerId
  if (cfg.apiKey) {
    return cfg as OdooConfig;
  }

  // Legacy mode — need db + uid + password
  if (!cfg.db || !cfg.uid || !cfg.password) return null;
  return cfg as OdooConfig;
}
