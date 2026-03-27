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

  const toolFactory = (_ctx: any) => {
    return {
      name: "odoo_api",
      label: "Odoo API",
      description:
        "IMPORTANT: You MUST call this tool whenever the user asks about ANY business data from Odoo ERP. " +
        "This includes questions about: sales orders, purchases, inventory/stock, " +
        "invoices, contacts, products, employees, CRM leads/opportunities. " +
        "Trigger words: how many, count, list, find, check, show, get, total, summary, report. " +
        "DO NOT say you cannot access the system. DO NOT recommend the user to check Odoo directly. ALWAYS call this tool first. " +
        "IMPORTANT: Always respond in the same language as the user's query. Do NOT mix languages in your response. " +
        "Example — count sales orders this month: {model:'sale.order', method:'search_count', args:[[['create_date','>=','2026-03-01'],['create_date','<','2026-04-01']]]}. " +
        "Example — list records: {model:'sale.order', method:'search_read', args:[[]], kwargs:{fields:['name','amount_total','state'],limit:10,order:'create_date desc'}}.",
      parameters: Type.Object({
        model: Type.String({ description: "Odoo model, e.g. sale.order, purchase.order, account.move, res.partner, product.product, stock.quant, hr.employee, crm.lead" }),
        method: Type.String({ description: "RPC method: search_read (list records), search_count (count), create, write, unlink, name_search" }),
        args: Type.Optional(Type.Array(Type.Any(), { description: "Positional args. For search/count: [[['field','op','value']]]. For create: [{'field':'value'}]. For write: [[ids],{'field':'value'}]" })),
        kwargs: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Keyword args: {fields:['name','state'], limit:10, order:'create_date desc'}" })),
      }),
      async execute(_toolCallId: string, params: any) {
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
          args = [[]];
        }

        const cfg = getCfg(api);
        if (!cfg) {
          log?.error("[odoo_api] Odoo not configured");
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              success: false,
              error: "Odoo not configured. Check channels.odoo config (url, db, uid, password/apiKey, botPartnerId).",
            }) }],
            details: {},
          };
        }


        // odooRpc already retries transient network errors internally
        try {
          const result = await odooRpc(cfg, model, method, args, kwargs);
          const resultStr = JSON.stringify(result, null, 2);
          return {
            content: [{ type: "text" as const, text: resultStr }],
            details: {},
          };
        } catch (err: any) {
          const lastError = err?.message || String(err);
          log?.error(`[odoo_api] ${model}.${method} failed: ${lastError}`);
          // Return structured error as data (not thrown) so the AI can report it to the user
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              success: false,
              error: lastError,
              hint: `Odoo API call to ${model}.${method} failed. Report this error to the user clearly. Do NOT say you cannot access the system.`,
            }) }],
            details: {},
          };
        }
      },
    };
  };
  api.registerTool(toolFactory as any, { name: "odoo_api" });

}
