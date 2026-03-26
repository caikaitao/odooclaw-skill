/**
 * Shared Odoo RPC layer for odoo-tools plugin.
 *
 * Supports two authentication modes:
 * 1. **API Key (Preferred)** — `apiKey` via `/api/` REST endpoint (Odoo 17+, Bearer token)
 * 2. **Legacy JSON-RPC (Fallback)** — `db` + `uid` + `password` via `/jsonrpc` endpoint
 *    (deprecated in Odoo 19, scheduled for removal in Odoo 20)
 *
 * When `cfg.apiKey` is set the `/api/` REST path is preferred;
 * legacy `/jsonrpc` is only used when no API key is available.
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
  // Prefer API Key auth (/api/ endpoint) when apiKey is available.
  // /jsonrpc is deprecated in Odoo 19 and scheduled for removal in Odoo 20.
  if (cfg.apiKey) return "apikey";
  // Fall back to legacy JSON-RPC only when password (not apiKey) is the sole credential.
  if (cfg.db && cfg.uid && cfg.password) return "legacy";
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

/* ── Debug logger (set externally) ── */

let _rpcLogger: { info: (msg: string) => void; error: (msg: string) => void } | null = null;

export function setRpcLogger(logger: { info: (msg: string) => void; error: (msg: string) => void } | null) {
  _rpcLogger = logger;
}

/* ── /api/ 404 cache: once we know /api/ is not available, skip it ── */
let _apiEndpointUnavailable = false;

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
  _rpcLogger?.info(`[odoo_rpc] legacy #${currentRpcId} POST ${baseUrl}/jsonrpc → ${model}.${method} args=${JSON.stringify(args).slice(0, 300)}`);
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
    _rpcLogger?.info(`[odoo_rpc] legacy #${currentRpcId} OK (result type: ${typeof json.result}, isArray: ${Array.isArray(json.result)}, length: ${Array.isArray(json.result) ? json.result.length : 'n/a'})`);
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
  const baseUrl = cfg.url.trim().replace(/\/+$/, "");
  const endpoint = `${baseUrl}/api/${model}/${method}`;

  const body = JSON.stringify({ args, kwargs });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
        // Fix for "Session expired (invalid CSRF token)":
        // Explicitly telling Odoo to ignore session-based CSRF.
        "X-Openerp-Session-Id": "",
      },
      body,
      signal: controller.signal,
    });

    if (!resp.ok) {
      if (resp.status === 401) {
        throw new Error(`Odoo API Unauthorized (401): Invalid API Key or missing permissions.`);
      }
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
 * - **REST (Preferred)** — Uses `/api/{model}/{method}` with Bearer token when `apiKey` is present (Odoo 17+).
 * - **Legacy (Fallback)** — Uses `/jsonrpc` with `execute_kw` when only `password` is available (deprecated in Odoo 19).
 *
 * If the REST endpoint returns 404 and legacy credentials are available, falls back to legacy automatically.
 */
export async function odooRpc(
  cfg: OdooConfig,
  model: string,
  method: string,
  args: any[] = [],
  kwargs: Record<string, any> = {},
): Promise<any> {
  const mode = resolveAuthMode(cfg);
  const hasLegacyCreds = !!(cfg.db && cfg.uid && (cfg.password || cfg.apiKey));
  _rpcLogger?.info(`[odoo_rpc] odooRpc called: mode=${mode} model=${model} method=${method} apiCached404=${_apiEndpointUnavailable} hasLegacyCreds=${hasLegacyCreds}`);
  console.log(`[odoo_rpc] odooRpc called: mode=${mode} model=${model} method=${method} apiCached404=${_apiEndpointUnavailable}`);

  if (mode === "apikey") {
    // If /api/ previously returned 404 and we have legacy credentials, skip /api/ entirely
    if (_apiEndpointUnavailable && hasLegacyCreds) {
      _rpcLogger?.info(`[odoo_rpc] skipping /api/ (cached 404) → using legacy /jsonrpc for ${model}.${method}`);
      return await odooRpcLegacy(cfg, model, method, args, kwargs);
    }
    try {
      return await odooRpcApiKey(cfg, model, method, args, kwargs);
    } catch (err: any) {
      // Fallback to legacy JSON-RPC if /api/ returns 404 (pre-17 Odoo without REST support)
      // but only when we have full legacy credentials available.
      if (err.message.includes("(404)") && hasLegacyCreds) {
        _apiEndpointUnavailable = true;
        _rpcLogger?.info(`[odoo_rpc] /api/ returned 404 — caching and falling back to legacy /jsonrpc for ${model}.${method}`);
        console.log(`[odoo_rpc] /api/ returned 404 — caching, will use legacy /jsonrpc from now on`);
        return await odooRpcLegacy(cfg, model, method, args, kwargs);
      }
      _rpcLogger?.error(`[odoo_rpc] ❌ apikey call failed: ${err.message}`);
      console.log(`[odoo_rpc] ❌ apikey call failed: ${err.message}`);
      throw err;
    }
  }
  return await odooRpcLegacy(cfg, model, method, args, kwargs);
}
