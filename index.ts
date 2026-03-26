import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ClawdbotPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

import { setOdooRuntime } from "./runtime.ts";
import { getCfg } from "./config.ts";
import { registerOdooApiTool } from "./tools/odoo-api.ts";
import { odooPlugin, registerPollingService } from "./channel.ts";
import { getProvider } from "./providers/registry.ts";
import { setRpcLogger } from "./rpc.ts";

const plugin = {
  id: "odoo-tools",
  name: "Odoo ERP Tools + Channel",
  description: "Odoo ERP API tool with AI skill and configurable channel integration (Discuss, Helpdesk, etc.)",
  configSchema: emptyPluginConfigSchema(),

  register(api: ClawdbotPluginApi) {
    setOdooRuntime(api.runtime);

    // ── Wire up RPC debug logger ──
    if (api.logger) {
      setRpcLogger({ info: (m) => api.logger!.info(m), error: (m) => api.logger!.error(m) });
    }

    // ── Skill: verify SKILL.md exists ──
    const pluginDir = path.dirname(fileURLToPath(import.meta.url));
    const skillMdPath = path.join(pluginDir, "skills", "odoo-api", "SKILL.md");
    const skillExists = fs.existsSync(skillMdPath);
    console.log(`[odoo-tools] 📋 SKILL.md exists: ${skillExists} (path: ${skillMdPath})`);
    api.logger?.info(`[odoo-tools] 📋 SKILL.md exists: ${skillExists} (path: ${skillMdPath})`);
    if (skillExists) {
      const skillContent = fs.readFileSync(skillMdPath, "utf-8");
      const hasAlways = skillContent.includes('"always": true') || skillContent.includes("'always': true") || skillContent.includes("always: true");
      console.log(`[odoo-tools] 📋 SKILL.md size: ${skillContent.length} bytes, has always=true: ${hasAlways}`);
      api.logger?.info(`[odoo-tools] 📋 SKILL.md size: ${skillContent.length} bytes, has always=true: ${hasAlways}`);
    }

    // ── Skill: register odoo_api tool ──
    registerOdooApiTool(api);

    // ── Channel: register Odoo channel + polling service ──
    api.registerChannel({ plugin: odooPlugin as any });
    registerPollingService(api);

    const cfg = getCfg(api);
    const providerLabel = cfg ? getProvider(cfg.provider).label : "Discuss (default)";
    console.log(`[odoo-tools] ✅ plugin loaded (odoo_api tool + skill + channel provider: ${providerLabel})`);
    api.logger?.info(`[odoo-tools] ✅ plugin loaded (odoo_api tool + skill + channel provider: ${providerLabel})`);
  },
};

export default plugin;
