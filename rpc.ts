/**
 * Shared Odoo RPC layer for odoo-tools plugin.
 *
 * Uses **Legacy JSON-RPC** authentication — `db` + `uid` + (`password` | `apiKey`) via `/jsonrpc` endpoint.
 * When `apiKey` is provided it is used as the password substitute (Odoo 17+ API Key feature).
 */

/* ── Validated config ── */

/** Validated Odoo config. */
export interface OdooConfig {
  url: string;

  /** Odoo database name. */
  db: string;
  /** Odoo user ID. */
  uid: number;
  /** Odoo user password. */
  password?: string;
  /** Odoo API Key — used as password substitute when provided. */
  apiKey?: string;

  /* ── Common ── */
  botPartnerId: number;
  /** Reserved for future webhook-based inbound. */
  webhookSecret?: string;
  /** Channel provider id — defaults to "discuss" when omitted. */
  provider?: string;
}

/** Raw config shape before validation — all fields optional. */
export interface RawOdooConfig {
  url?: string;
  db?: string;
  uid?: number;
  password?: string;
  apiKey?: string;
  botPartnerId?: number;
  webhookSecret?: string;
  provider?: string;
}

export type MaybeWrappedOdooConfig = RawOdooConfig & { odoo?: RawOdooConfig };

/* ── Auth validation ── */

/** Check whether the config has enough fields for JSON-RPC authentication. */
export function validateAuth(cfg: OdooConfig): { ok: true } | { ok: false; error: string } {
  if (!cfg.db) return { ok: false, error: "db is required for authentication" };
  if (cfg.uid == null) return { ok: false, error: "uid is required for authentication" };
  if (!cfg.password && !cfg.apiKey) return { ok: false, error: "password or apiKey is required for authentication" };
  return { ok: true };
}

/* ── Debug logger (set externally) ── */

let _rpcLogger: { info: (msg: string) => void; error: (msg: string) => void } | null = null;

export function setRpcLogger(logger: { info: (msg: string) => void; error: (msg: string) => void } | null) {
  _rpcLogger = logger;
}

/* ── JSON-RPC id counter ── */

let rpcId = 0;

/* ── Default request timeout (ms) ── */

const DEFAULT_TIMEOUT_MS = 30_000;

/* ── Legacy JSON-RPC (`/jsonrpc` — db + uid + password/apiKey) ── */

async function odooRpcLegacy(
  cfg: OdooConfig,
  model: string,
  method: string,
  args: any[] = [],
  kwargs: Record<string, any> = {},
): Promise<any> {
  const currentRpcId = ++rpcId;
  const body = JSON.stringify({
    jsonrpc: "2.0",
    method: "call",
    id: currentRpcId,
    params: {
      service: "object",
      method: "execute_kw",
      args: [cfg.db, cfg.uid, cfg.apiKey || cfg.password, model, method, args, kwargs],
    },
  });

  const baseUrl = cfg.url.trim().replace(/\/+$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const resp = await fetch(`${baseUrl}/jsonrpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Openerp-Session-Id": "",
      },
      body,
      signal: controller.signal,
    });

    const json = (await resp.json()) as any;
    if (json.error) {
      const errMsg = json.error.data?.message || json.error.message;
      _rpcLogger?.error(`[odoo_rpc] legacy #${currentRpcId} ERROR: ${errMsg}`);
      throw new Error(`Odoo RPC error: ${errMsg}`);
    }
    return json.result;
  } finally {
    clearTimeout(timeout);
  }
}

/* ── Public API ── */

/**
 * Call an Odoo model method via Legacy JSON-RPC (`/jsonrpc`).
 *
 * Uses `db` + `uid` + (`password` or `apiKey`) for authentication.
 */
export async function odooRpc(
  cfg: OdooConfig,
  model: string,
  method: string,
  args: any[] = [],
  kwargs: Record<string, any> = {},
): Promise<any> {
  return await odooRpcLegacy(cfg, model, method, args, kwargs);
}
