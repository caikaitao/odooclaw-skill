---
name: odoo-api
description: |
  MANDATORY for ALL business data questions. Call the odoo_api tool for:
  sales orders, purchases, invoices, inventory, contacts, products, employees, CRM leads.
  Trigger keywords: how many, count, list, find, check, total, summary, report.
  Also trigger when System message contains "Odoo DM from" or "Odoo message in".
  NEVER tell the user to check Odoo manually — always call odoo_api first.
  IMPORTANT: Always respond in the same language as the user's query.
metadata:
  openclaw:
    emoji: "🏢"
    always: true
    primaryEnv: ODOO_URL
---

# Odoo ERP Query

**CRITICAL RULE**: When the user asks about ANY business data (sales, purchases, inventory, invoices, contacts, products, employees, CRM), you MUST call the `odoo_api` tool IMMEDIATELY. Do NOT say you cannot access the system. Do NOT suggest the user check Odoo manually. Do NOT hallucinate results — call the tool and report what it returns.

Also call `odoo_api` when a System message contains "Odoo DM from" or "Odoo message in".

## How to Call `odoo_api`

### Count records
```json
{
  "model": "sale.order",
  "method": "search_count",
  "args": [[["create_date", ">=", "2026-03-01"], ["create_date", "<", "2026-04-01"]]]
}
```

### List records
```json
{
  "model": "sale.order",
  "method": "search_read",
  "args": [[["create_date", ">=", "2026-03-01"], ["create_date", "<", "2026-04-01"]]],
  "kwargs": { "fields": ["name", "partner_id", "amount_total", "state", "create_date"], "limit": 20, "order": "create_date desc" }
}
```

### Find contact
```json
{
  "model": "res.partner",
  "method": "name_search",
  "args": ["Acme"],
  "kwargs": { "limit": 5 }
}
```

## Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `model`   | ✅       | Odoo model name, e.g. `sale.order`, `purchase.order`, `res.partner` |
| `method`  | ✅       | Method: `search_read`, `search_count`, `create`, `write`, `unlink`, `name_search` |
| `args`    |          | Positional arguments array. Default `[]` |
| `kwargs`  |          | Keyword arguments object. Default `{}` |

## Common Models

| Model | Purpose | Key Fields |
|-------|---------|------------|
| `sale.order` | Sales orders | `name`, `partner_id`, `amount_total`, `state`, `date_order`, `create_date` |
| `purchase.order` | Purchase orders | `name`, `partner_id`, `amount_total`, `state`, `date_order` |
| `account.move` | Invoices / Bills | `name`, `partner_id`, `amount_total`, `move_type`, `state` |
| `res.partner` | Contacts | `name`, `email`, `phone`, `customer_rank`, `supplier_rank` |
| `product.product` | Products | `name`, `default_code`, `list_price`, `qty_available` |
| `stock.quant` | Inventory on-hand | `product_id`, `location_id`, `quantity` |
| `hr.employee` | Employees | `name`, `department_id`, `job_id` |
| `crm.lead` | CRM leads | `name`, `partner_id`, `expected_revenue`, `stage_id` |

## Domain Filter Syntax

- `[["field", "operator", value]]` — operators: `=`, `!=`, `>`, `>=`, `<`, `<=`, `in`, `not in`, `like`, `ilike`
- AND (default): `[["state", "=", "done"], ["partner_id", "=", 5]]`
- OR: `["|", ["state", "=", "draft"], ["state", "=", "sent"]]`

## Date Filtering

- **This month**: `[["create_date", ">=", "YYYY-MM-01"], ["create_date", "<", "YYYY-{MM+1}-01"]]`
- **Today**: `[["create_date", ">=", "YYYY-MM-DD"], ["create_date", "<", "YYYY-MM-{DD+1}"]]`

## Rules

- Call `odoo_api` first, then present results. No preamble.
- Always specify `fields` in kwargs. Use `limit` (10–20) and `order`.
- If `odoo_api` returns an error, report the specific error. Never say you cannot access the system.
