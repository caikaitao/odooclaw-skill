/**
 * Shared Odoo RPC layer for odooclaw plugins.
 *
 * Supports two authentication modes:
 * 1. **Legacy JSON-RPC** — `db` + `uid` + `password` via `/jsonrpc` endpoint
 * 2. **API Key** — `apiKey` via `/api/` REST endpoint (Odoo 17+, Bearer token)
 *
 * When `cfg.apiKey` is set the API-key path is used automatically;
 * otherwise the legacy path is used as a fallback.
 */

/* ── Validated config ── */

/** Validated Odoo config — at least one auth method must be present. */
export interface OdooConfig {
  url: string;

  /* ── Legacy auth (JSON-RPC) ── */
  /** Odoo database name. Required for legacy auth. */
  db?: string;
  /** Odoo user ID. Required for legacy auth. */
  uid?: number;
  /** Odoo user password. Required for legacy auth. */
  password?: string;

  /* ── API Key auth (Odoo 17+ /api/ endpoint) ── */
  /** Odoo API Key for Bearer-token authentication. */
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

/* ── Auth mode helpers ── */

export type AuthMode = "apikey" | "legacy";

/** Determine which auth mode to use based on config fields. */
export function resolveAuthMode(cfg: OdooConfig): AuthMode {
  if (cfg.apiKey) return "apikey";
  return "legacy";
}

/** Check whether the config has enough fields for the resolved auth mode. */
export function validateAuth(cfg: OdooConfig): { ok: true } | { ok: false; error: string } {
  const mode = resolveAuthMode(cfg);
  if (mode === "apikey") {
    if (!cfg.apiKey) return { ok: false, error: "apiKey is required for API Key auth" };
    return { ok: true };
  }
  // legacy
  if (!cfg.db) return { ok: false, error: "db is required for legacy auth" };
  if (cfg.uid == null) return { ok: false, error: "uid is required for legacy auth" };
  if (!cfg.password) return { ok: false, error: "password is required for legacy auth" };
  return { ok: true };
}

/* ── JSON-RPC id counter ── */

let rpcId = 0;

/* ── Default request timeout (ms) ── */

const DEFAULT_TIMEOUT_MS = 30_000;

/* ── Legacy JSON-RPC (`/jsonrpc` — db + uid + password) ── */

async function odooRpcLegacy(
  cfg: OdooConfig,
  model: string,
  method: string,
  args: any[] = [],
  kwargs: Record<string, any> = {},
): Promise<any> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    method: "call",
    id: ++rpcId,
    params: {
      service: "object",
      method: "execute_kw",
      args: [cfg.db, cfg.uid, cfg.password, model, method, args],
      kwargs,
    },
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const resp = await fetch(`${cfg.url}/jsonrpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });

    const json = (await resp.json()) as any;
    if (json.error) {
      throw new Error(`Odoo RPC error: ${json.error.data?.message || json.error.message}`);
    }
    return json.result;
  } finally {
    clearTimeout(timeout);
  }
}

/* ── API Key auth (`/api/` — Bearer token, Odoo 17+) ── */

/**
 * Call an Odoo model method via the `/api/{model}/{method}` REST endpoint
 * using Bearer-token (API Key) authentication.
 *
 * Odoo 17+ exposes model methods at:
 *   POST /api/{model}/{method}
 * with body: { "args": [...], "kwargs": {...} }
 */
async function odooRpcApiKey(
  cfg: OdooConfig,
  model: string,
  method: string,
  args: any[] = [],
  kwargs: Record<string, any> = {},
): Promise<any> {
  const endpoint = `${cfg.url}/api/${model}/${method}`;

  const body = JSON.stringify({ args, kwargs });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body,
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Odoo API error (${resp.status}): ${text || resp.statusText}`);
    }

    const json = await resp.json();
    // The /api/ endpoint returns the result directly (or wrapped in { result: ... })
    return json?.result !== undefined ? json.result : json;
  } finally {
    clearTimeout(timeout);
  }
}

/* ── Public API ── */

/**
 * Call an Odoo model method.
 *
 * Automatically selects the appropriate transport:
 * - **API Key** (`cfg.apiKey` set) → `/api/{model}/{method}` with Bearer token
 * - **Legacy** (otherwise) → `/jsonrpc` with `execute_kw`
 */
export async function odooRpc(
  cfg: OdooConfig,
  model: string,
  method: string,
  args: any[] = [],
  kwargs: Record<string, any> = {},
): Promise<any> {
  const mode = resolveAuthMode(cfg);
  if (mode === "apikey") {
    return await odooRpcApiKey(cfg, model, method, args, kwargs);
  }
  return await odooRpcLegacy(cfg, model, method, args, kwargs);
}
