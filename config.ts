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
 * - `ODOO_WEBHOOK_SECRET`
 * - `ODOO_TIMEZONE` — IANA timezone for date calculations (default: America/Los_Angeles)
 *
 * Auth: requires `url`, `db`, `uid`, (`password` | `apiKey`), `botPartnerId`.
 *
 * Returns `null` if the config is missing or incomplete.
 */
export function getCfg(api: ClawdbotPluginApi): OdooConfig | null {
  const raw = api.config?.channels?.odoo as MaybeWrappedOdooConfig | undefined;
  const cfgFromPlugin = raw?.odoo?.url ? raw.odoo : (raw || {});

  const url = process.env.ODOO_URL || cfgFromPlugin.url || "";
  const db = process.env.ODOO_DB || cfgFromPlugin.db;
  const uid = process.env.ODOO_UID ? parseInt(process.env.ODOO_UID, 10) : cfgFromPlugin.uid;
  const password = process.env.ODOO_PASSWORD || cfgFromPlugin.password;
  const apiKey = process.env.ODOO_API_KEY || cfgFromPlugin.apiKey;
  const botPartnerId = process.env.ODOO_BOT_PARTNER_ID ? parseInt(process.env.ODOO_BOT_PARTNER_ID, 10) : cfgFromPlugin.botPartnerId || 0;
  const provider = process.env.ODOO_PROVIDER || cfgFromPlugin.provider;
  const webhookSecret = process.env.ODOO_WEBHOOK_SECRET || cfgFromPlugin.webhookSecret;

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
    webhookSecret,
  };
}

/** Default IANA timezone for business-date calculations. */
const DEFAULT_TZ = "America/Los_Angeles";

/** Read the configured business timezone. */
export function getTimezone(api: ClawdbotPluginApi): string {
  const raw = api.config?.channels?.odoo as MaybeWrappedOdooConfig | undefined;
  const cfgFromPlugin = raw?.odoo?.url ? (raw.odoo as Record<string, unknown>) : ((raw || {}) as Record<string, unknown>);
  return (process.env.ODOO_TIMEZONE as string) || (cfgFromPlugin.timezone as string) || DEFAULT_TZ;
}

/**
 * Compute "today" and "yesterday" date boundaries in UTC for a given IANA timezone.
 * Returns ISO date-time strings ready for Odoo domain filters.
 */
export function getDateContext(tz: string): {
  timezone: string;
  todayLocal: string;
  yesterdayLocal: string;
  todayStartUtc: string;
  todayEndUtc: string;
  yesterdayStartUtc: string;
  yesterdayEndUtc: string;
} {
  const now = new Date();

  // Format a Date in the target tz to get the local date string (YYYY-MM-DD)
  const localDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: tz });

  const todayLocal = localDate(now);

  // Yesterday / tomorrow in local tz
  const yesterdayLocal = localDate(new Date(now.getTime() - 86_400_000));
  const tomorrowLocal = localDate(new Date(now.getTime() + 86_400_000));

  // Convert "YYYY-MM-DD 00:00:00 in tz" to a UTC datetime string for Odoo filters.
  // Uses Intl.DateTimeFormat.formatToParts for reliable offset calculation.
  const midnightUtc = (dateStr: string): string => {
    const [y, m, d] = dateStr.split("-").map(Number);
    // Use noon UTC as a reference to avoid DST-boundary edge cases
    const refUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
      hour12: false,
    }).formatToParts(refUtc);

    const v = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
    // Reconstruct what the reference UTC instant looks like in the target tz
    const localAsUtcMs = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour") === 24 ? 0 : v("hour"), v("minute"), v("second"));
    const offsetMs = localAsUtcMs - refUtc.getTime();
    // Midnight local in UTC = midnight-of-target-date minus the tz offset
    const utcMs = Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMs;
    return new Date(utcMs).toISOString().replace("T", " ").slice(0, 19);
  };

  return {
    timezone: tz,
    todayLocal,
    yesterdayLocal,
    todayStartUtc: midnightUtc(todayLocal),
    todayEndUtc: midnightUtc(tomorrowLocal),
    yesterdayStartUtc: midnightUtc(yesterdayLocal),
    yesterdayEndUtc: midnightUtc(todayLocal),
  };
}
