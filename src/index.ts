import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

import { getCfg } from "./config.ts";
import { handleOdooWebhookRequest, registerWebhookService, odooClawChannel } from "./channel/index.ts";
import { getProvider } from "./channel/providers/registry.ts";
import { registerOdooApiTool } from "./tools/odoo-api.ts";
import { setOdooRuntime } from "./runtime.ts";
import { setRpcLogger } from "./rpc.ts";

const plugin = {
  id: "odooClaw",
  name: "OdooClaw",
  description: "Odoo ERP API tool with AI skill and configurable channel integration (Discuss, Helpdesk, etc.)",
  configSchema: emptyPluginConfigSchema(),

  register(api: any) {
    setOdooRuntime(api.runtime);

    if (api.logger) {
      setRpcLogger({ info: (m) => api.logger!.info(m), error: (m) => api.logger!.error(m) });
    }

    registerOdooApiTool(api);
    api.registerChannel({ plugin: odooClawChannel as any });
    registerWebhookService(api);

    api.registerHttpRoute({
      path: "/odoo/webhook",
      match: "exact",
      auth: "plugin",
      replaceExisting: true,
      handler: async (req, res) => handleOdooWebhookRequest(api, req, res),
    });

    const cfg = getCfg(api);
    if (cfg) {
      const providerLabel = getProvider(cfg.provider).label;
      api.logger?.info(`[odooClaw] plugin loaded — provider: ${providerLabel}, url: ${cfg.url}, db: ${cfg.db}, uid: ${cfg.uid}`);
    } else {
      api.logger?.info(
        "[odooClaw] plugin loaded but Odoo config is INCOMPLETE. " +
          "Webhook ingress will not accept events until channels.odooClaw-channel (or ODOO_* env vars) are properly configured.",
      );
    }
  },
};

export default plugin;
