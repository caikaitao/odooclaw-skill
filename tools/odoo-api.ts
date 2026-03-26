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
      description:
        "IMPORTANT: You MUST call this tool whenever the user asks about ANY business data from Odoo ERP. " +
        "This includes questions about: sales orders (销售订单), purchases (采购订单), inventory/stock (库存), " +
        "invoices (发票), contacts (联系人), products (产品), employees (员工), CRM leads/opportunities. " +
        "Trigger words: how many, count, list, find, check, show, get, 多少, 查询, 列出, 查看, 有几个, 这个月, 本月. " +
        "DO NOT say you cannot access the system. DO NOT recommend the user to check Odoo directly. ALWAYS call this tool first. " +
        "Example — count sales orders this month: {model:'sale.order', method:'search_count', args:[[['create_date','>=','2026-03-01'],['create_date','<','2026-04-01']]]}. " +
        "Example — list records: {model:'sale.order', method:'search_read', args:[[]], kwargs:{fields:['name','amount_total','state'],limit:10,order:'create_date desc'}}.",
      parameters: Type.Object({
        model: Type.String({ description: "Odoo model, e.g. sale.order, purchase.order, account.move, res.partner, product.product, stock.quant, hr.employee, crm.lead" }),
        method: Type.String({ description: "RPC method: search_read (list records), search_count (count), create, write, unlink, name_search" }),
        args: Type.Optional(Type.Array(Type.Any(), { description: "Positional args. For search/count: [[['field','op','value']]]. For create: [{'field':'value'}]. For write: [[ids],{'field':'value'}]" })),
        kwargs: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Keyword args: {fields:['name','state'], limit:10, order:'create_date desc'}" })),
      }),
      async execute(_toolCallId: string, params: any) {
        console.log(`[odoo_api] 🚀 execute called! toolCallId=${_toolCallId} params=${JSON.stringify(params)}`);
        log?.info(`[odoo_api] 🚀 execute called! toolCallId=${_toolCallId} params=${JSON.stringify(params)}`);

        let { model, method, args = [], kwargs = {} } = params as {
          model: string;
          method: string;
          args?: any[];
          kwargs?: Record<string, any>;
        };

        // Auto-fix: search methods require domain as first positional arg.
        // If LLM passes empty args, default to [[]] (match all records).
        const SEARCH_METHODS = ["search", "search_read", "search_count", "name_search"];
        if (SEARCH_METHODS.includes(method) && args.length === 0) {
          log?.info(`[odoo_api] 🔧 auto-fix: ${method} called with empty args, defaulting to domain=[]`);
          args = [[]];
        }

        const cfg = getCfg(api);
        if (!cfg) {
          console.log("[odoo_api] ❌ getCfg returned null — Odoo not configured");
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
            console.log(`[odoo_api] ✅ success! ${model}.${method} returned ${resultStr.length} chars`);
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

        console.log(`[odoo_api] ❌ all retries exhausted. Final error: ${lastError}`);
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
