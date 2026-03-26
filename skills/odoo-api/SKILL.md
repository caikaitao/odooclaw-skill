---
name: odoo-api
description: |
  Odoo ERP API tool for querying and managing business data via JSON-RPC.
  Activate when user mentions Odoo, ERP, purchase orders, sales, invoices, partners, products, or inventory.
metadata:
  { "openclaw": { "emoji": "🏢", "requires": { "config": ["channels.odoo"] } } }
---

# Odoo API Tool

Single tool `odoo_api` — calls any Odoo model method via legacy JSON-RPC.

## Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `model`   | ✅       | Odoo model name, e.g. `purchase.order`, `sale.order`, `res.partner` |
| `method`  | ✅       | Method name, e.g. `search_read`, `create`, `write`, `unlink`, `button_confirm` |
| `args`    |          | Positional arguments array. Default `[]` |
| `kwargs`  |          | Keyword arguments object. Default `{}` |

## Common Operations

### Query Records (search_read)

```json
{
  "model": "purchase.order",
  "method": "search_read",
  "args": [[["state", "=", "purchase"]]],
  "kwargs": { "fields": ["name", "partner_id", "amount_total", "state"], "limit": 10, "order": "create_date desc" }
}
```

### Create Record

```json
{
  "model": "res.partner",
  "method": "create",
  "args": [{ "name": "New Supplier", "supplier_rank": 1 }]
}
```

### Update Record

```json
{
  "model": "purchase.order",
  "method": "write",
  "args": [[42], { "notes": "Updated by AI" }]
}
```

### Delete Record

```json
{
  "model": "res.partner",
  "method": "unlink",
  "args": [[99]]
}
```

### Execute Action (e.g. confirm order)

```json
{
  "model": "purchase.order",
  "method": "button_confirm",
  "args": [[42]]
}
```

### Name Search (fuzzy lookup)

```json
{
  "model": "res.partner",
  "method": "name_search",
  "args": ["Acme"],
  "kwargs": { "limit": 5 }
}
```

## Common Models

| Model | Purpose | Key Fields |
|-------|---------|------------|
| `purchase.order` | Purchase orders | `name`, `partner_id`, `amount_total`, `state`, `order_line`, `date_order` |
| `purchase.order.line` | PO lines | `product_id`, `product_qty`, `price_unit`, `price_subtotal`, `order_id` |
| `sale.order` | Sales orders | `name`, `partner_id`, `amount_total`, `state`, `order_line` |
| `sale.order.line` | SO lines | `product_id`, `product_uom_qty`, `price_unit`, `price_subtotal` |
| `account.move` | Invoices / Bills | `name`, `partner_id`, `amount_total`, `move_type`, `state`, `payment_state` |
| `account.move.line` | Journal items | `name`, `account_id`, `debit`, `credit`, `balance` |
| `res.partner` | Contacts | `name`, `email`, `phone`, `customer_rank`, `supplier_rank`, `country_id` |
| `product.product` | Products (variant) | `name`, `default_code`, `list_price`, `standard_price`, `qty_available` |
| `product.template` | Products (template) | `name`, `default_code`, `list_price`, `type`, `categ_id` |
| `stock.picking` | Stock transfers | `name`, `partner_id`, `state`, `scheduled_date`, `picking_type_id` |
| `stock.move` | Stock moves | `product_id`, `product_uom_qty`, `quantity`, `state` |
| `stock.quant` | Inventory on-hand | `product_id`, `location_id`, `quantity`, `reserved_quantity` |
| `mrp.production` | Manufacturing | `name`, `product_id`, `product_qty`, `state` |
| `hr.employee` | Employees | `name`, `department_id`, `job_id`, `work_email` |
| `project.task` | Tasks | `name`, `project_id`, `user_ids`, `stage_id`, `date_deadline` |
| `crm.lead` | CRM leads | `name`, `partner_id`, `expected_revenue`, `stage_id`, `probability` |

## Domain Filter Syntax

- **Basic**: `[["field", "operator", value]]`
- **Operators**: `=`, `!=`, `>`, `>=`, `<`, `<=`, `in`, `not in`, `like`, `ilike`, `=like`, `=ilike`
- **AND** (default): `[["state", "=", "done"], ["partner_id", "=", 5]]`
- **OR**: `["|", ["state", "=", "draft"], ["state", "=", "sent"]]`
- **NOT**: `["!", ["active", "=", false]]`
- **Nested OR+AND**: `["|", "&", ["a", "=", 1], ["b", "=", 2], ["c", "=", 3]]` → `(a=1 AND b=2) OR c=3`

## Best Practices

- **Always specify `fields`** in kwargs to limit returned data — never fetch all fields.
- **Use `limit`** for search_read to avoid returning thousands of records. Start with 10-20.
- **Use `offset`** with `limit` for pagination.
- **Use `order`** to sort results, e.g. `"create_date desc"`, `"name asc"`.
- **Many2one fields** return `[id, "Display Name"]` arrays — use `field[0]` for the ID.
- **One2many / Many2many fields** return arrays of IDs — fetch details with a separate search_read if needed.
- **Check `state` values** before performing actions — e.g. only confirm orders in `draft` state.
- **Use `name_search`** for quick fuzzy lookups instead of complex domain filters.
- When creating order lines, include `order_id` to link them to the parent order.
