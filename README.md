# @openclaw/odoo-tools

通用 Odoo ERP 插件，集 **API 工具**、**AI Skill** 和 **消息渠道** 于一体，为 OpenClaw 提供完整的 Odoo 集成能力。

## ✨ 功能

### 🔧 Skill — `odoo_api` 工具
- 通过 JSON-RPC 或 API Key 调用**任意** Odoo 模型方法（search_read、create、write、unlink 等）
- 自动注入 AI Skill（`SKILL.md`），指导 AI 正确使用 Odoo API（常用模型、Domain 语法、最佳实践）

### 💬 Channel — Odoo 消息渠道
- **可配置 Provider 架构** — 默认对接 Odoo Discuss，可扩展支持 Helpdesk、Live Chat 等
- **入站**：轮询 Odoo 获取新消息，转发给 AI 处理
- **出站**：AI 回复自动格式化为富文本 HTML 发回 Odoo
- **私聊**直接响应，**群组**被 @mention 时响应
- **指数退避**：连续错误时自动增加轮询间隔（3s → 60s cap）

### 🔐 双认证模式
- **Legacy JSON-RPC** — `db` + `uid` + `password` 通过 `/jsonrpc` 端点
- **API Key** — `apiKey` 通过 `/api/` REST 端点（Odoo 17+，Bearer token）
- 请求超时保护（默认 30 秒）、并发安全（自增 RPC ID）

## 📦 项目结构

```
odooclaw-skill/
├── index.ts                  # 插件入口 — 注册 tool + channel + polling
├── rpc.ts                    # Odoo RPC（Legacy + API Key 双认证）
├── config.ts                 # 配置读取与校验
├── runtime.ts                # 运行时上下文
├── channel.ts                # Channel 注册 + 轮询服务 + 入站消息处理
├── rich-text.ts              # Markdown → Odoo 富文本 HTML 转换
├── tools/
│   └── odoo-api.ts           # odoo_api 工具注册
├── providers/
│   ├── types.ts              # ChannelProvider 接口定义
│   ├── discuss.ts            # Odoo Discuss Provider（默认）
│   └── registry.ts           # Provider 注册表
├── skills/
│   └── odoo-api/
│       └── SKILL.md          # AI Skill 提示词
├── openclaw.plugin.json      # 插件清单
└── README.md
```

## 🚀 安装

将 `odooclaw-skill` 目录放入 OpenClaw 扩展目录：

```bash
# 全局安装
mkdir -p ~/.openclaw/extensions
cp -r odooclaw-skill ~/.openclaw/extensions/

# 或符号链接（开发模式）
ln -s /path/to/odooclaw-skill ~/.openclaw/extensions/odooclaw-skill
```

> 💡 合并后只需安装**一个**插件，无需额外安装 `odooclaw-shared` 或 `odooclaw-channel`。

## ⚙️ 配置

在 `~/.openclaw/openclaw.json` 中添加 `channels.odoo` 配置：

### Legacy 认证（db + uid + password）

```json
{
  "channels": {
    "odoo": {
      "enabled": true,
      "url": "https://your-odoo.com",
      "db": "mydb",
      "uid": 2,
      "password": "your-password",
      "botPartnerId": 3
    }
  }
}
```

### API Key 认证（Odoo 17+，推荐）

```json
{
  "channels": {
    "odoo": {
      "enabled": true,
      "url": "https://your-odoo.com",
      "apiKey": "your-odoo-api-key",
      "botPartnerId": 3
    }
  }
}
```

> 💡 当 `apiKey` 存在时自动使用 API Key 模式，`db`、`uid`、`password` 可省略。

### 使用其他 Provider

```json
{
  "channels": {
    "odoo": {
      "url": "https://your-odoo.com",
      "apiKey": "your-api-key",
      "botPartnerId": 3,
      "provider": "helpdesk"
    }
  }
}
```

不配置 `provider` 时默认为 `"discuss"`。

### 配置参数说明

| 参数 | Legacy 模式 | API Key 模式 | 类型 | 说明 |
|------|:-----------:|:------------:|------|------|
| `url` | ✅ 必填 | ✅ 必填 | string | Odoo 实例地址 |
| `db` | ✅ 必填 | ❌ 不需要 | string | Odoo 数据库名称 |
| `uid` | ✅ 必填 | ❌ 不需要 | number | Odoo 用户 ID |
| `password` | ✅ 必填 | ❌ 不需要 | string | Odoo 用户密码 |
| `apiKey` | ❌ 不需要 | ✅ 必填 | string | Odoo API Key |
| `botPartnerId` | ✅ 必填 | ✅ 必填 | number | Bot 的 `res.partner` ID |
| `webhookSecret` | ❌ 可选 | ❌ 可选 | string | 预留：Webhook 入站 |
| `provider` | ❌ 可选 | ❌ 可选 | string | Channel Provider（默认 `"discuss"`） |

### 🌍 环境变量支持

除了在 `openclaw.json` 中配置外，你还可以通过环境变量来设置 Odoo 参数。环境变量具有**更高优先级**，会覆盖配置文件中的同名设置。

| 环境变量 | 对应配置项 | 说明 |
|----------|------------|------|
| `ODOO_URL` | `url` | Odoo 实例地址 |
| `ODOO_DB` | `db` | Odoo 数据库名称 |
| `ODOO_UID` | `uid` | Odoo 用户 ID |
| `ODOO_PASSWORD` | `password` | Odoo 用户密码 |
| `ODOO_API_KEY` | `apiKey` | Odoo API Key |
| `ODOO_BOT_PARTNER_ID` | `botPartnerId` | Bot 的 `res.partner` ID |
| `ODOO_PROVIDER` | `provider` | Channel Provider |
| `ODOO_WEBHOOK_SECRET` | `webhookSecret` | Webhook 密钥 |

**使用示例：**

```bash
export ODOO_URL="https://your-odoo.com"
export ODOO_API_KEY="your-api-key"
export ODOO_BOT_PARTNER_ID=3
openclaw start
```

### 如何获取 API Key

1. 登录 Odoo → 右上角用户头像 → **My Profile**
2. 滚动到 **Account Security** 区域
3. 点击 **New API Key**，输入描述后生成
4. 复制生成的 Key 填入配置

## 🔌 Provider 架构

插件使用 **ChannelProvider** 接口抽象不同的 Odoo 消息源：

```typescript
interface ChannelProvider {
  id: string;
  label: string;
  fetchNewMessages(cfg, cursor): Promise<InboundMessage[]>;
  sendMessage(cfg, channelId, text, isHtml?): Promise<void>;
  resolveChannel(cfg, channelId): Promise<ResolvedChannel | null>;
  shouldRespond(channel, msg, cfg): boolean;
  formatOutbound?(text: string): string;    // 可选
  initCursor?(cfg): Promise<number>;        // 可选
}
```

### 内置 Provider

| Provider | 说明 | 数据源 |
|----------|------|--------|
| `discuss` | Odoo Discuss（默认） | `discuss.channel` + `mail.message` |

### 添加自定义 Provider

1. 在 `providers/` 下创建新文件（如 `helpdesk.ts`）
2. 实现 `ChannelProvider` 接口的 5 个必选方法
3. 在 `providers/registry.ts` 中注册

示例（Helpdesk）：

```typescript
// providers/helpdesk.ts
import type { ChannelProvider } from "./types.js";
import { odooRpc } from "../rpc.js";

export const helpdeskProvider: ChannelProvider = {
  id: "helpdesk",
  label: "Odoo Helpdesk",
  async fetchNewMessages(cfg, cursor) {
    const msgs = await odooRpc(cfg, "mail.message", "search_read", [[
      ["id", ">", cursor],
      ["model", "=", "helpdesk.ticket"],
      ["message_type", "in", ["comment", "email"]],
    ]], { fields: ["id", "body", "author_id", "partner_ids", "res_id", "date"], order: "id asc", limit: 20 });
    return (msgs ?? []).map((m: any) => ({
      id: m.id, body: m.body ?? "", authorId: m.author_id ?? null,
      partnerIds: m.partner_ids ?? [], channelId: m.res_id, date: m.date,
    }));
  },
  async sendMessage(cfg, channelId, text) {
    await odooRpc(cfg, "helpdesk.ticket", "message_post", [[channelId]], { body: text, message_type: "comment" });
  },
  async resolveChannel(cfg, channelId) {
    const tickets = await odooRpc(cfg, "helpdesk.ticket", "search_read",
      [[["id", "=", channelId]]], { fields: ["id", "name"], limit: 1 });
    const t = tickets?.[0];
    if (!t) return null;
    return { id: t.id, name: t.name, type: "ticket", isPrivate: false };
  },
  shouldRespond() { return true; },
};
```

## 📊 消息流程

```
用户在 Odoo Discuss 发消息
        ↓
  轮询检测到新消息（channel.ts）
        ↓
  Provider 获取消息 → 解析渠道 → 判断是否响应
        ↓
  OpenClaw AI 处理消息
        ↓
  AI 需要操作 Odoo 数据时 → odoo_api 工具执行 RPC
        ↓
  AI 生成回复
        ↓
  Provider 发送回复（rich-text.ts 格式化为 HTML）
        ↓
  用户在 Odoo 中收到回复
```

## 🔍 故障排查

| 问题 | 解决方案 |
|------|----------|
| 插件未加载 | 确认 `openclaw.plugin.json` 在扩展目录中 |
| 连接失败 | 检查 `url` 可访问（不带尾部 `/`），确认认证参数正确 |
| Bot 不回复 | 确认 `botPartnerId` 正确，Bot 需要是 Discuss 频道成员 |
| 群组中不回复 | 消息中需 @mention Bot |
| 连接超时 | 默认 30s 超时，检查网络和 Odoo 服务器 |
| 轮询错误频繁 | 日志搜索 `odoo-channel polling error`，连续错误会触发指数退避 |

## 📌 已知限制与未来计划

- **消息游标不持久化**：`lastMessageId` 存储在内存中，服务重启后从最新消息开始。未来计划通过 plugin-sdk 的 json-store 持久化。
- **多 Provider 并行**：当前每个实例只能配置一个 Provider。未来计划支持 `providers` 数组配置，同时轮询多个消息源。
- **模型/方法白名单**：`odoo_api` 工具允许调用任意模型方法，建议在生产环境中考虑限制。
