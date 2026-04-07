import type { ClawdbotPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";

import { odooRpc } from "../rpc.ts";
import { getCfg, getTimezone, getDateContext } from "../config.ts";

export function registerOdooApiTool(api: ClawdbotPluginApi) {
  const log = api.logger;

  if (!api.registerTool) {
    log?.error("[odoo_api] ❌ api.registerTool is undefined — tool will NOT be available");
    return;
  }

  const toolFactory = (_ctx: any) => {
    return {
      name: "odoo_api",
      label: "Business Data API",
      description:
        "⚠️ SILENT-UNTIL-DATA — THIS IS THE #1 RULE AND OVERRIDES EVERYTHING ELSE: " +
        "Do NOT produce ANY text output before you have called this tool and received real data back. " +
        "This means: NO title, NO heading, NO greeting, NO 'Fetching...', NO 'Loading...', NO 'Checking...', " +
        "NO skeleton, NO template, NO draft, NO outline — ABSOLUTELY NOTHING before the tool call returns. " +
        "Your FIRST action must be a tool call. Your FIRST text to the user must contain REAL data from the tool response. " +
        "If you write even one word before calling the tool, you have violated this rule. " +
        "IMPORTANT: You MUST call this tool whenever the user asks about ANY business data from the ERP system. " +
        "This includes questions about: sales orders, purchases, inventory/stock, " +
        "invoices, contacts, products, employees, CRM leads/opportunities. " +
        "Trigger words: how many, count, list, find, check, show, get, total, summary, report. " +
        "DO NOT say you cannot access the system. DO NOT recommend the user to check any external system directly. ALWAYS call this tool first. " +
        "IMPORTANT: Always respond in the same language as the user's query. Do NOT mix languages in your response. " +
        "BRANDING RULE (applies ONLY to your final user-facing reply text, NOT to tool calls or internal reasoning): " +
        "NEVER mention 'Odoo', 'Odoo ERP', or any internal system name in the text you show to the user. " +
        "You MUST still call this tool (odoo_api) by its exact name when making tool calls — the branding rule does not prevent tool usage. " +
        "In your reply text, refer to the data source as 'the system', 'ERP', or 'business system' if you must reference it at all. " +
        "ERROR HANDLING RULE: If the tool returns an error or fails, do NOT expose raw error messages, stack traces, " +
        "debug info, session IDs, file paths, or technical failure details to the user. " +
        "Instead, reply with a friendly message like 'Unable to retrieve data at this time, please try again later.' " +
        "Never show messages containing 'Agent failed', 'session file locked', 'pid=', or any internal system diagnostics. " +
        "CURRENCY RULE: NEVER hardcode or assume a currency symbol (no €, $, ¥, £, etc.). " +
        "When displaying monetary amounts, read the actual currency from the data (e.g. include 'currency_id' in fields). " +
        "If the data does not contain currency info, show the raw number only (e.g. '12,800' not '€12,800'). " +
        "OUTPUT FORMAT — applies to ALL responses (interactive AND scheduled/Cron): " +
        "Do NOT use Markdown syntax (no **, no ##, no |---|, no ```). " +
        "Many channels deliver to native mobile apps where Markdown does not render and shows raw symbols. " +
        "Instead, follow the Universal App-Friendly Format below: " +
        "1) TITLE LINE: one emoji + title in CAPS, then a blank line (e.g. '📦 DELIVERY ALERT\\n'). " +
        "2) SUMMARY BLOCK: key metrics on separate lines, each prefixed with an emoji icon " +
        "(e.g. '🔢 Total Orders: 5\\n💰 Total Revenue: 12,800\\n📈 vs Yesterday: +15%'). " +
        "3) DETAIL LIST: number each item on its own card-style block. " +
        "Put EACH field on a SEPARATE line with an emoji prefix for readability on narrow mobile screens. " +
        "Separate items with a blank line. Example:\n" +
        "'1️⃣ SO-00123\n" +
        "   👤 Alice\n" +
        "   💰 3,200\n" +
        "   📌 Pending\n" +
        "\n" +
        "2️⃣ SO-00124\n" +
        "   👤 Bob\n" +
        "   💰 1,500\n" +
        "   ✅ Done'. " +
        "4) FOOTER: a thin divider '──────────' then a short status line. Do NOT include any timestamp or time zone in the footer. " +
        "Example: '──────────\n✅ Report complete — 5 items found'. " +
        "5) Use ⚠️ for warnings/critical items, ✅ for healthy/done, 📉 for decline, 📈 for growth. " +
        "6) Keep each line under 60 chars when possible for mobile readability. " +
        "Include relevant statuses, amounts, and responsible persons. " +
        "TIMEZONE RULE: Every tool response includes a '_dateContext' object with pre-computed UTC date boundaries " +
        "(todayStartUtc, todayEndUtc, yesterdayStartUtc, yesterdayEndUtc) already converted from the business timezone. " +
        "When filtering by 'today' or 'yesterday', ALWAYS use these pre-computed values directly in your domain filters. " +
        "Do NOT compute dates yourself. Do NOT use server local time. " +
        "Example — today's sales: {model:'sale.order', method:'search_count', args:[[['create_date','>=',_dateContext.todayStartUtc],['create_date','<',_dateContext.todayEndUtc]]]}. " +
        "Example — list records: {model:'sale.order', method:'search_read', args:[[]], kwargs:{fields:['name','amount_total','state'],limit:10,order:'create_date desc'}}. " +
        "Remember: the user should NEVER see the word 'Odoo' or any internal system identifier in your final reply text. " +
        "But you MUST still call the odoo_api tool whenever business data is needed — the branding rule only affects your displayed text, not your tool calls. " +
        "FINAL REMINDER — SILENT-UNTIL-DATA: produce ZERO text before the tool call. Call the tool → get data → then write your reply. No exceptions.",
      parameters: Type.Object({
        model: Type.String({ description: "ERP model, e.g. sale.order, purchase.order, account.move, res.partner, product.product, stock.quant, hr.employee, crm.lead" }),
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
              error: "ERP system not configured. Please check the connection settings.",
              userMessage: "Unable to retrieve data at this time. Please contact your administrator.",
            }) }],
            details: {},
          };
        }


        // odooRpc already retries transient network errors internally
        const tz = getTimezone(api);
        const dateCtx = getDateContext(tz);

        try {
          const result = await odooRpc(cfg, model, method, args, kwargs);
          // Inject date context so AI can reference pre-computed boundaries
          const payload = { _dateContext: dateCtx, data: result };
          const resultStr = JSON.stringify(payload, null, 2);
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
              hint: "Do NOT expose this error to the user. Instead reply with a friendly message: 'Unable to retrieve data at this time, please try again later.' Never mention Odoo, internal errors, or system details.",
            }) }],
            details: {},
          };
        }
      },
    };
  };
  api.registerTool(toolFactory as any, { name: "odoo_api" });

}
