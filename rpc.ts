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

const DEFAULT_TIMEOUT_MS = 45_000;

/* ── Retry config for transient failures ── */

const RPC_MAX_RETRIES = 2;
const RPC_RETRY_BASE_MS = 800;

/** Patterns that indicate a transient / retriable network issue. */
const TRANSIENT_PATTERNS = [
  "fetch failed",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ECONNRESET",
  "ENOTFOUND",
  "socket hang up",
  "aborted",
  "network",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
];

function isTransientError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return TRANSIENT_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

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
 * Automatically retries on transient network errors (up to RPC_MAX_RETRIES times).
 */
export async function odooRpc(
  cfg: OdooConfig,
  model: string,
  method: string,
  args: any[] = [],
  kwargs: Record<string, any> = {},
): Promise<any> {
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= RPC_MAX_RETRIES; attempt++) {
    try {
      return await odooRpcLegacy(cfg, model, method, args, kwargs);
    } catch (err: any) {
      lastErr = err;
      const msg = err?.message || String(err);
      if (attempt < RPC_MAX_RETRIES && isTransientError(msg)) {
        const delay = RPC_RETRY_BASE_MS * Math.pow(2, attempt);
        _rpcLogger?.info(`[odoo_rpc] transient error, retry ${attempt + 1}/${RPC_MAX_RETRIES} in ${delay}ms: ${msg}`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
