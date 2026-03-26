import type { ClawdbotPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";

import { odooRpc } from "../rpc.ts";
import { getCfg } from "../config.ts";

export function registerOdooApiTool(api: ClawdbotPluginApi) {
  const log = api.logger;

  if (!api.registerTool) {
    log?.error("[odoo_api] ❌ api.registerTool is undefined — tool will NOT be available");
    return;
  }

  log?.info("[odoo_api] 🔧 registering odoo_api tool...");

  // Pre-check config at registration time (informational only)
  const cfgAtRegister = getCfg(api);
  if (cfgAtRegister) {
    log?.info(`[odoo_api] ✅ config OK at register time: url=${cfgAtRegister.url} db=${cfgAtRegister.db} uid=${cfgAtRegister.uid} botPartnerId=${cfgAtRegister.botPartnerId} authMode=${cfgAtRegister.apiKey ? "apiKey" : "legacy"}`);
  } else {
    log?.warn("[odoo_api] ⚠️ config is NULL at register time — tool will return config error when called");
  }

  // Use factory function so we get diagnostic logs each time resolvePluginTools
  // instantiates the tool for an agent turn.
  const toolFactory = (_ctx: any) => {
    log?.info(`[odoo_api] 🏭 factory called! Tool being included in agent tool list.`);
    console.log(`[odoo_api] 🏭 factory called! (console.log fallback)`);
    return {
      name: "odoo_api",
      label: "Odoo API",
      description: "Call any Odoo model method via JSON-RPC or API Key. Use for search_read, create, write, unlink, button_confirm, or any other Odoo model method.",
      parameters: Type.Object({
        model: Type.String({ description: "Odoo model name, e.g. purchase.order, sale.order, res.partner, account.move, product.product" }),
        method: Type.String({ description: "Method name, e.g. search_read, create, write, unlink, button_confirm, name_search" }),
        args: Type.Optional(Type.Array(Type.Any(), { description: "Positional arguments. For search_read: [domain]. For create: [{ field: value }]. For write: [[ids], { field: value }]." })),
        kwargs: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Keyword arguments. For search_read: { fields: [...], limit: N, order: '...' }." })),
      }),
      async execute(_toolCallId: string, params: any) {
        log?.info(`[odoo_api] 🚀 execute called! toolCallId=${_toolCallId} params=${JSON.stringify(params)}`);

        const { model, method, args = [], kwargs = {} } = params as {
          model: string;
          method: string;
          args?: any[];
          kwargs?: Record<string, any>;
        };

        const cfg = getCfg(api);
        if (!cfg) {
          log?.error("[odoo_api] ❌ getCfg returned null — Odoo not configured");
          log?.error(`[odoo_api]    api.config?.channels?.odoo = ${JSON.stringify(api.config?.channels?.odoo)}`);
          log?.error(`[odoo_api]    ODOO_URL=${process.env.ODOO_URL || "(not set)"} ODOO_DB=${process.env.ODOO_DB || "(not set)"} ODOO_UID=${process.env.ODOO_UID || "(not set)"} ODOO_BOT_PARTNER_ID=${process.env.ODOO_BOT_PARTNER_ID || "(not set)"}`);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              success: false,
              error: "Odoo not configured. Check channels.odoo config (url, db, uid, password/apiKey, botPartnerId).",
            }) }],
            details: {},
          };
        }

        log?.info(`[odoo_api] 📡 calling odooRpc: ${model}.${method} args=${JSON.stringify(args).slice(0, 200)} kwargs=${JSON.stringify(kwargs).slice(0, 200)}`);
        log?.info(`[odoo_api]    config: url=${cfg.url} db=${cfg.db} uid=${cfg.uid} authMode=${cfg.apiKey ? "apiKey" : "legacy"}`);

        // Retry with exponential backoff for transient failures
        const MAX_RETRIES = 2;
        let lastError: string = "";
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            const result = await odooRpc(cfg, model, method, args, kwargs);
            const resultStr = JSON.stringify(result, null, 2);
            log?.info(`[odoo_api] ✅ success! ${model}.${method} returned ${resultStr.length} chars (preview: ${resultStr.slice(0, 300)})`);
            return {
              content: [{ type: "text" as const, text: resultStr }],
              details: {},
            };
          } catch (err: any) {
            lastError = err?.message || String(err);
            log?.error(`[odoo_api] ❌ attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${lastError}`);
            const isTransient =
              lastError.includes("fetch failed") ||
              lastError.includes("ECONNREFUSED") ||
              lastError.includes("ETIMEDOUT") ||
              lastError.includes("ECONNRESET") ||
              lastError.includes("socket hang up") ||
              lastError.includes("aborted");
            if (isTransient && attempt < MAX_RETRIES) {
              log?.info(`[odoo_api] 🔄 transient error, retrying in ${1000 * Math.pow(2, attempt)}ms...`);
              await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
              continue;
            }
            break;
          }
        }

        log?.error(`[odoo_api] ❌ all retries exhausted. Final error: ${lastError}`);
        // Return structured error as data (not thrown) so the AI can report it to the user
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            success: false,
            error: lastError,
            hint: `Odoo API call to ${model}.${method} failed. Report this error to the user clearly. Do NOT say you cannot access the system.`,
          }) }],
          details: {},
        };
      },
    };
  };
  api.registerTool(toolFactory as any, { name: "odoo_api" });

  log?.info("[odoo_api] ✅ odoo_api tool registered successfully");
}
