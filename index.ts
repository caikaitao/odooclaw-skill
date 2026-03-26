import type { ClawdbotPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

import { setOdooRuntime } from "./runtime.js";
import { getCfg } from "./config.js";
import { registerOdooApiTool } from "./tools/odoo-api.js";
import { odooPlugin, registerPollingService } from "./channel.js";
import { getProvider } from "./providers/registry.js";

const plugin = {
  id: "odoo-tools",
  name: "Odoo ERP Tools + Channel",
  description: "Odoo ERP API tool with AI skill and configurable channel integration (Discuss, Helpdesk, etc.)",
  configSchema: emptyPluginConfigSchema(),

  register(api: ClawdbotPluginApi) {
    setOdooRuntime(api.runtime);

    // ── Skill: register odoo_api tool ──
    registerOdooApiTool(api);

    // ── Channel: register Odoo channel + polling service ──
    api.registerChannel({ plugin: odooPlugin as any });
    registerPollingService(api);

    const cfg = getCfg(api);
    const providerLabel = cfg ? getProvider(cfg.provider).label : "Discuss (default)";
    api.logger?.info(`odoo-tools plugin loaded (odoo_api tool + skill + channel provider: ${providerLabel})`);
  },
};

export default plugin;
