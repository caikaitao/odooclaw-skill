# @openclaw/odooClaw

OdooClaw 是一个面向 OpenClaw 的 Odoo 插件包，把 **tool、skill、channel** 和 **Webhook 路由** 放在同一个目录里，安装后即可由 OpenClaw 扫描并接入。

## 目录职责

- `openclaw.plugin.json`：插件清单，告诉 OpenClaw 这个目录里有哪些 skill / channel / extension
- `src/index.ts`：唯一入口，负责注册 Odoo API tool、channel 和 webhook 路由
- `src/tools/odoo-api.ts`：Odoo JSON-RPC tool
- `src/skills/SKILL.md`：Odoo 业务问答 skill
- `src/channel/index.ts`：Webhook 归一化、路由、去重、防环、回复调度
- `src/channel/providers/`：通道 provider 抽象与 Discuss 实现
- `src/formatting/rich-text.ts`：Markdown / HTML 富文本输出
- `src/config.ts`：读取 `channels.odooClaw-channel`
- `src/rpc.ts`：Odoo JSON-RPC 认证与调用

## 安装

把整个 `odooClaw` 目录放到 OpenClaw 的扩展目录中，不要只拷贝单个文件。

推荐做法：

1. 让目录根部能看到 `openclaw.plugin.json`
2. 确认 `openclaw.plugin.json` 里的 `openclaw.extensions` 指向 `./src/index.ts`
3. 重启或重载 OpenClaw
4. 在技能列表里确认 `odooClaw-skill` 可见

## 配置

在 `~/.openclaw/openclaw.json` 中配置 `channels.odooClaw-channel`：

```json
{
  "channels": {
    "odooClaw-channel": {
      "odoo": {
        "enabled": true,
        "url": "https://your-odoo.com",
        "db": "mydb",
        "uid": 2,
        "apiKey": "your-api-key",
        "botPartnerId": 3,
        "webhookUrl": "https://your-odoo.com/odoo/webhook",
        "allowedSourceIps": ["10.0.0.0/8", "172.16.0.1"]
      }
    }
  }
}
```

## 行为

- `enabled` 默认为 `true`；设为 `false` 时不会注册 tool、channel、service 和 webhook 路由
- `allowedSourceIps` 可选；为空时允许所有来源 IP
- `allowedSourceIps` 支持单个 IP 和 CIDR，例如 `10.0.0.5`、`192.168.1.0/24`
- 白名单判断基于 webhook 请求的 `remoteAddress`
- 私聊消息默认进入业务问答链路
- 群聊只有在 @mention Bot 时才进入链路
- Odoo 回复会走富文本输出，支持 HTML / emoji / 表格
- 图片、PDF、Word、Excel 等附件会统一进入 webhook 的 `attachments[]`
- bot 自己发出的消息不会再次回流

## 验证

- 在 OpenClaw 的 skills 列表里看到 `odooClaw-skill`
- 在 Odoo Discuss 私聊里发业务问题，确认会调用 `odooClaw-tool`
- 群聊里 @OpenClaw，确认只有 mention 才触发
- 回复里包含表格、emoji、链接时，确认 Odoo Discuss 能正常渲染
- 重放同一 webhook，确认不会重复回复

## 故障排查

- 插件未加载：确认扩展目录里是整个仓库，而不是单个文件
- `odooClaw-skill` 不显示：确认 OpenClaw 读到的是当前这份扩展目录
- Odoo 收不到回复：检查 webhook API key 和 `/odoo/webhook`
- 回复内容没渲染成富文本：确认发送时走的是 HTML
