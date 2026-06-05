# @openclaw/odooclaw

把 **Odoo ERP** 接到 **OpenClaw** 的插件：一个 **tool**（让 agent 调 Odoo JSON-RPC）+ 一个 **channel**（Odoo Discuss / Helpdesk 双向消息）+ 一个 **HTTP webhook** 入口（收 Odoo 推过来的消息，把回复发回去）。

> 适用 **OpenClaw ≥ 2026.3.24**（已在 `2026.5.6` / `2026.6.1` 上验证 install + load + 端到端收发）。
> 需要 **Node 22.19+** 或 Node 24。

---

## 一、安装（从 GitHub URL 一次性装好）

```bash
# 1) clone
git clone https://github.com/<your-org>/odooclaw-skill.git /tmp/odooclaw-skill
cd /tmp/odooclaw-skill

# 2) 装依赖并构建产物 dist/（openclaw.plugins install 会读 runtimeExtensions 指向的 dist/index.js）
npm install
npm run build

# 3) 装到 OpenClaw（--force 用于覆盖旧装）
openclaw plugins install . --force
```

装完应该看到：

```
[odooClaw] plugin loaded — provider: Odoo Discuss, url: ..., db: ..., uid: ...
```

立刻能查：

```bash
openclaw plugins inspect odooClaw         # Status: loaded
openclaw plugins doctor                   # No plugin issues detected
openclaw plugins list | grep odooClaw     # 看到一行
```

---

## 二、配置（写到 `~/.openclaw/openclaw.json`）

### 必填三段

把这三段合进 `~/.openclaw/openclaw.json`（其他字段保留）：

```jsonc
{
  "tools": {
    "profile": "coding",
    "alsoAllow": [
      "odooClaw-tool",
      "message"
    ]
  },
  "plugins": {
    "allow": [
      "odooClaw"
    ],
    "entries": {
      "odooClaw": {
        "enabled": true
      }
    }
  },
  "channels": {
    "odooClaw-channel": {
      "odoo": {
        "enabled": true,
        "url": "https://your-odoo.com/",
        "db": "your-db",
        "uid": 2,
        "apiKey": "your-odoo-api-key",
        "botPartnerId": 3,
        "webhookUrl": "https://your-public-host/omeclaw/webhook",
        "allowedSourceIps": []
      }
    }
  }
}
```

字段说明：

| 字段 | 必填 | 说明 |
|------|:---:|------|
| `tools.alsoAllow` | ✅ | 至少要包含 `odooClaw-tool`（让 agent 能调）和 `message`（让 agent 能回复到 Odoo channel）。`tools.profile: "coding"` 会**移除** `message` / `gateway` / `nodes` / `tts` / `agents_list`，必须用 `alsoAllow` 加回 `message`，否则 agent 收得到消息但回不出去。 |
| `plugins.allow` | ✅ | 显式声明这个插件被允许加载。 |
| `plugins.entries.odooClaw.enabled` | ✅ | 显式启用插件（不写就靠默认行为，可能不启用）。 |
| `channels.odooClaw-channel.odoo.enabled` | ✅ | 设为 `false` 时不注册 tool / channel / service / webhook。 |
| `channels.odooClaw-channel.odoo.url` | ✅ | Odoo 实例根地址。 |
| `channels.odooClaw-channel.odoo.db` | ✅ | Odoo 数据库名。 |
| `channels.odooClaw-channel.odoo.uid` | ✅ | Odoo 用户 ID（数字）。 |
| `channels.odooClaw-channel.odoo.apiKey` | ✅ | Odoo 17+ 在 user profile 里生成的 API Key（用作 password 替代品）。 |
| `channels.odooClaw-channel.odoo.botPartnerId` | ✅ | Bot 对应的 `res.partner` ID（消息会路由给这个 partner）。 |
| `channels.odooClaw-channel.odoo.webhookUrl` | ⚡ | Odoo 端 POST 消息过来的完整 URL。**Odoo 那一端要这么配**（Nginx 反代到 OpenClaw 的 `/odoo/webhook`）。不填默认等于 `${url}/odoo/webhook`。 |
| `channels.odooClaw-channel.odoo.allowedSourceIps` | ❌ | webhook 来源 IP 白名单，支持单 IP 和 CIDR。空数组 = 允许所有。 |
| `channels.odooClaw-channel.odoo.provider` | ❌ | channel provider，默认 `discuss`，可选 `helpdesk` 等。 |

写完验证：

```bash
openclaw config validate                       # 整个 config 走 schema 校验
openclaw plugins doctor                        # 插件侧 / channelConfigs 校验
```

### (可选) 用环境变量代替文件配置

启动 OpenClaw 之前 export 这些变量，**优先级高于文件配置**：

| 环境变量 | 对应配置项 |
|----------|------------|
| `ODOO_ENABLED` | `enabled`（`0`/`false`/`no`/`off` 表示禁用） |
| `ODOO_URL` | `url` |
| `ODOO_DB` | `db` |
| `ODOO_UID` | `uid` |
| `ODOO_API_KEY` | `apiKey` |
| `ODOO_BOT_PARTNER_ID` | `botPartnerId` |
| `ODOO_PROVIDER` | `provider` |
| `ODOO_WEBHOOK_URL` | `webhookUrl` |
| `ODOO_ALLOWED_SOURCE_IPS` | `allowedSourceIps`（逗号分隔） |

适合 Docker / 容器 / CI 场景。

---

## 三、Odoo 端要做什么

1. **建一个 bot 用户**：
   - `Settings → Users & Companies → Users → New`
   - 记下 `res.users.id` → 这就是 `uid`
   - 记下 `res.partner.id` → 这就是 `botPartnerId`
2. **给那个用户生成 API Key**：
   - 登录 bot 用户 → 右上角头像 → `My Profile → Account Security → New API Key`
   - 复制出来 → 填到 `apiKey`
3. **把 webhook 挂到 Odoo**：
   - 看你 Odoo 上跑的是什么 webhook 桥（`omeclaw_bot` / `mail_bot` / 自研 HTTP controller 都行）
   - 配置它在收到新 `mail.message` 时 POST 到 `${webhookUrl}`（**Odoo 端配置的 URL**，可以是 Nginx 反代的公开地址，比如 `https://your-public-host/omeclaw/webhook`）
   - Nginx / 反代层把 `/omeclaw/webhook` 转到 OpenClaw gateway 的 `/odoo/webhook`（插件内硬编码的入站路径）
4. **测试连通**：从 Odoo 一侧用 curl 打一下 `webhookUrl`，看 OpenClaw 日志有没有收到 `odooClaw-channel webhook: new message ...`

---

## 四、行为 / 协议

- **入站**：Odoo → POST 到 `${webhookUrl}` → 反代到 OpenClaw `/odoo/webhook` → 插件做归一化 / 去重 / 防环 → 路由到 `main` agent → 调 `odooClaw-tool` 查数据
- **出站**：agent 用 `message` tool 发回 → 插件通过 Odoo JSON-RPC 写回 Discuss 频道
- **私聊 / 群聊**：私聊直接响应；群聊只有 @mention bot 时才响应
- **回复渲染**：HTML / emoji / 表格都走富文本
- **附件**：图片 / PDF / Word / Excel 统一进 webhook 的 `attachments[]`
- **去重**：同一 `idempotencyKey` / `messageId` 只处理一次
- **防环**：bot 自己发出去的消息 id 进 set，回流时丢弃
- **白名单**：`allowedSourceIps` 非空时按 `remoteAddress` 校验
- **认证**：webhook header `X-API-Key` 必须等于 `apiKey`（同源认证，避免 Odoo 之外的人也能 POST）

---

## 五、端到端验证

```bash
# 1) 插件侧
openclaw plugins inspect odooClaw     # Status: loaded
openclaw plugins doctor               # No plugin issues detected

# 2) 触发 Odoo → OpenClaw
# 在 Odoo Discuss 里给 bot partner 发一条业务问题，比如 "本月销售订单总数？"

# 3) 看 OpenClaw gateway 日志（openclaw gateway run 或 journalctl -u openclaw-gateway）
# 应该出现：
#   [plugins] odooClaw-channel webhook: new message ch=N provider=discuss from=<姓名>: <消息>
#   [agents]  ... 调 odooClaw-tool 查数据 ...
#   [plugins] odooClaw-channel webhook: reply sent ...

# 4) 看 Odoo Discuss，bot 的富文本回复应该出现在频道里
```

---

## 六、升级 / 卸载

```bash
# 升级：拉最新代码、重新 build、重新装
cd /tmp/odooclaw-skill
git pull
npm install
npm run build
openclaw plugins update odooClaw

# 卸载
openclaw plugins uninstall odooClaw
```

---

## 七、故障排查

| 现象 | 排查 |
|------|------|
| `openclaw plugins install .` 报 "missing valid openclaw.plugin.json" | manifest 损坏。`cat openclaw.plugin.json | jq` 验一下 JSON。 |
| `inspect` 显示 `Status: missing-manifest` 或 `Status: error` | `dist/` 没生成。`npm run build` 后再装。 |
| `inspect` 没列 `channel: odooClaw-channel` | manifest 里 `channels` 和 `channelConfigs` 的 id 不一致，或者 `channelConfigs.<id>.schema` 校验失败。`openclaw plugins doctor` 看具体错误。 |
| 日志里 `[odooClaw] plugin loaded but Odoo config is INCOMPLETE` | `channels.odooClaw-channel.odoo` 里缺 `url` / `db` / `uid` / `apiKey` / `botPartnerId` 任一字段。补全后重启 gateway。 |
| Odoo 推消息过来，OpenClaw 收到但**没回复** | `tools.alsoAllow` 缺 `message`（被 `profile: "coding"` 移除了）。补上后 `openclaw config validate`。 |
| Odoo 端报 `failed to send webhook: timed out` | OpenClaw 收到消息了，但回复没写回 Odoo。可能是 `apiKey` 不对 / `botPartnerId` 不是 Discuss 里的 partner / Odoo 端 bot 进程没有发消息权限。看 OpenClaw 日志和 Odoo 端 bot 日志。 |
| Odoo 端报 `401 Unauthorized` | `X-API-Key` header 不匹配。`apiKey` 重新生成后再填。 |
| Odoo 端报 `403 Forbidden` | `allowedSourceIps` 拒了。把 Odoo 出站 IP 加进白名单。 |
| `config set` 被 `size-drop` 拒绝 | OpenClaw 保护 config 不被缩小覆盖。直接编辑 `~/.openclaw/openclaw.json`，或者用 `openclaw config get` 备份当前内容后整体重写。 |
| 同一个 webhook 被处理两次 | `seenWebhookKeys` 在内存里，gateway 重启会清；正常运行时不应该重复。如果重复，看 Odoo 端是不是 retry 触发的。 |

---

## 八、OpenClaw 兼容版本

| OpenClaw | 是否支持 |
|----------|:--------:|
| 2026.6.1 | ✅ 已验证 |
| 2026.5.6.x | ✅ 已验证（`>=2026.3.24` 即可） |
| 2026.3.24+ | ✅ 兼容（`openclaw.compat.minGatewayVersion` 声明的最低版本） |
| 2025.x | ❌ 旧的 `ClawdbotPluginApi` 接口，**不兼容** |

`openclaw.plugin.json` 里声明的 `openclaw.compat.minGatewayVersion: 2026.3.24`，低于这个版本的 OpenClaw 会拒绝 install。`package.json` 里 `dependencies.openclaw: ">=2026.3.24"` 也是同一基线。

---

## 九、目录结构

```
odooclaw-skill/
├── openclaw.plugin.json    # 插件清单（contracts / channelConfigs / activation）
├── package.json            # 元数据 + openclaw.extensions + scripts.build/prepare
├── tsconfig.json           # src/ → dist/ 编译配置
├── README.md               # 本文件
├── .gitignore
├── src/
│   ├── index.ts            # definePluginEntry 入口，注册 tool / channel / service / webhook 路由
│   ├── config.ts           # 读 channels.odooClaw-channel.odoo + 环境变量
│   ├── rpc.ts              # Odoo JSON-RPC 认证 + 调用
│   ├── runtime.ts          # 运行时上下文句柄
│   ├── ip.ts               # IP / CIDR 白名单匹配
│   ├── tools/
│   │   └── odoo-api.ts     # odooClaw-tool（agent 用来调 Odoo）
│   ├── channel/
│   │   ├── index.ts        # Webhook 归一化 / 路由 / 去重 / 防环 / 出站
│   │   └── providers/
│   │       ├── types.ts    # ChannelProvider 接口
│   │       ├── discuss.ts  # 默认 provider（Odoo Discuss）
│   │       └── registry.ts # provider 查找
│   ├── formatting/
│   │   └── rich-text.ts    # Markdown / HTML 富文本输出
│   └── skills/
│       └── SKILL.md        # 给 agent 的 Odoo 业务问答提示词
└── dist/                   # `npm run build` 产物，安装时被 openclaw.plugins install 读
```
