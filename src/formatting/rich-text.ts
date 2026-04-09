/* ──────────────────────────────────────────────────────────────────────────────
 * rich-text.ts — Telegram-style Markdown → HTML for Odoo Discuss
 *
 * Single-pass renderer. Trusts the AI's markdown; only converts what is
 * explicitly marked up. All inline styles use only Odoo-whitelisted CSS
 * properties (no overflow, box-shadow, etc.).
 * ────────────────────────────────────────────────────────────────────────── */

/* ── Style constants (Odoo html_sanitize safe) ── */

const S = {
  root: "line-height:1.6;font-size:14px;color:#1e293b;",
  h1: "margin:16px 0 8px 0;padding:0 0 4px 0;font-weight:700;font-size:20px;color:#0f172a;",
  h2: "margin:14px 0 6px 0;font-weight:700;font-size:17px;color:#0f172a;",
  h3: "margin:12px 0 4px 0;font-weight:700;font-size:15px;color:#334155;",
  p: "margin:6px 0;",
  ul: "margin:6px 0 10px 20px;padding:0;",
  ol: "margin:6px 0 10px 22px;padding:0;",
  li: "margin:4px 0;",
  code: "background-color:#f1f5f9;color:#334155;padding:1px 5px;border-radius:4px;font-family:Consolas,'Courier New',monospace;font-size:13px;",
  pre: "margin:8px 0 12px 0;padding:12px 14px;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-family:Consolas,'Courier New',monospace;font-size:13px;line-height:1.5;white-space:pre-wrap;",
  blockquote: "margin:8px 0;padding:8px 14px;border-left:3px solid #94a3b8;color:#475569;background-color:#f8fafc;border-radius:0 6px 6px 0;",
  hr: "margin:12px 0;border:none;border-top:1px solid #e2e8f0;",
  tableWrap: "margin:10px 0 14px 0;border:1px solid #e2e8f0;border-radius:8px;",
  table: "border-collapse:collapse;width:100%;font-size:13px;",
  th: "padding:8px 12px;border:1px solid #e2e8f0;background-color:#f1f5f9;text-align:left;font-weight:600;white-space:nowrap;",
  td: "padding:7px 12px;border:1px solid #e2e8f0;vertical-align:top;",
  trEven: "background-color:#ffffff;",
  trOdd: "background-color:#fafbfc;",
  link: "color:#2563eb;text-decoration:underline;",
  notice: (bg: string, border: string) =>
    `margin:8px 0 10px 0;padding:8px 12px;border-left:3px solid ${border};background-color:${bg};border-radius:0 6px 6px 0;`,
} as const;

/* ── Helpers ── */

function esc(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Inline markdown: code, bold, italic, links */
function inline(text: string): string {
  let s = esc(text);
  // inline code (must be first — content inside backticks should not be further processed)
  s = s.replace(/`([^`]+)`/g, `<code style="${S.code}">$1</code>`);
  // links [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
    const safeHref = esc(String(href).trim());
    const safeLabel = inlineText(label);
    return `<a href="${safeHref}" style="${S.link}">${safeLabel}</a>`;
  });
  // bold **text** or __text__
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__(.+?)__/g, "<strong>$1</strong>");
  // italic *text*
  s = s.replace(/\*(?!\s)([^*]+?)\*(?!\*)/g, "<em>$1</em>");
  // strikethrough ~~text~~
  s = s.replace(/~~(.+?)~~/g, "<del>$1</del>");
  return s;
}

function inlineText(text: string): string {
  return esc(text);
}
/* ── Block detection helpers ── */

function isHorizontalRule(line: string): boolean {
  const t = line.trim();
  return /^[-*_]{3,}$/.test(t) && !/\S/.test(t.replace(/[-*_]/g, ""));
}

function isMarkdownTable(lines: string[], idx: number): boolean {
  if (idx + 1 >= lines.length) return false;
  const header = lines[idx]?.trim() ?? "";
  const sep = lines[idx + 1]?.trim() ?? "";
  return /^\|.+\|$/.test(header) && /^\|?[\s:-]+(?:\|[\s:-]+)+\|?$/.test(sep);
}

function parseTableRow(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
}

function tableToHtml(lines: string[], idx: number): { html: string; next: number } {
  const headers = parseTableRow(lines[idx]);
  let i = idx + 2; // skip header + separator
  const rows: string[][] = [];
  while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
    rows.push(parseTableRow(lines[i]));
    i++;
  }
  const thead = `<tr>${headers.map((c) => `<th style="${S.th}">${inline(c)}</th>`).join("")}</tr>`;
  const tbody = rows
    .map(
      (row, ri) =>
        `<tr style="${ri % 2 === 0 ? S.trEven : S.trOdd}">${row.map((c) => `<td style="${S.td}">${inline(c)}</td>`).join("")}</tr>`,
    )
    .join("");
  return {
    html: `<div style="${S.tableWrap}"><table style="${S.table}"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`,
    next: i,
  };
}

/** Detect pipe-separated list items and convert to table.
 * Handles both keyed (`供应商：Ready Mat`) and plain (`Ready Mat`) segments.
 * Pattern: `- P00013 | Ready Mat | $6,936 | 已确认采购 | 2026-03-24`
 * Also: `P00013｜供应商：Ready Mat｜金额：USD 6,936｜状态：已采购｜日期：2026-03-24`
 */
function tryPipeRecordTable(lines: string[], idx: number): { html: string; next: number } | null {
  const parsed: Array<{ id: string; segs: string[]; keyed: Record<string, string> | null }> = [];
  let segCount = 0;

  let i = idx;
  while (i < lines.length) {
    const text = (lines[i] || "").trim();
    if (!text) break;

    // strip list bullet prefix
    const rowText = text.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
    const segments = rowText.split(/\s*[｜|]\s*/).map((p) => p.trim()).filter((p) => p);
    if (segments.length < 3) break;

    const id = segments[0];
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) break;

    // first row sets expected column count
    if (segCount === 0) segCount = segments.length;
    if (segments.length !== segCount) break;

    // try keyed format (key：value)
    const keyed: Record<string, string> = {};
    let allKeyed = true;
    for (let j = 1; j < segments.length; j++) {
      const kv = segments[j].match(/^([^:：]{1,40})[:：]\s*(.+)$/);
      if (kv && kv[1].trim() && kv[2].trim()) {
        keyed[kv[1].trim()] = kv[2].trim();
      } else {
        allKeyed = false;
        break;
      }
    }

    parsed.push({ id, segs: segments.slice(1), keyed: allKeyed ? keyed : null });
    i++;
  }

  if (parsed.length < 2) return null;

  const isKeyed = parsed.every((r) => r.keyed !== null);

  let thead: string;
  let tbody: string;

  if (isKeyed) {
    // keyed mode: use key names as headers
    const keys = Array.from(new Set(parsed.flatMap((r) => Object.keys(r.keyed!))));
    thead = `<tr>${["📋 单号", ...keys].map((k) => `<th style="${S.th}">${esc(k)}</th>`).join("")}</tr>`;
    tbody = parsed
      .map((row, ri) => {
        const cells = [esc(row.id), ...keys.map((k) => inline(row.keyed![k] ?? "-"))];
        return `<tr style="${ri % 2 === 0 ? S.trEven : S.trOdd}">${cells.map((c) => `<td style="${S.td}">${c}</td>`).join("")}</tr>`;
      })
      .join("");
  } else {
    // plain mode: auto-guess headers from content
    const colCount = parsed[0].segs.length;
    const headers = ["📋 单号"];
    for (let ci = 0; ci < colCount; ci++) {
      const samples = parsed.map((r) => r.segs[ci] || "");
      if (samples.every((s) => /^\d{4}-\d{2}-\d{2}/.test(s))) { headers.push("📅 日期"); continue; }
      if (samples.every((s) => /^[\$￥]?[\d,.]+$/.test(s))) { headers.push("💰 金额"); continue; }
      if (samples.every((s) => /^(purchase|draft|done|cancel|sent|confirmed|已确认采购|已采购|草稿|完成|取消)/i.test(s))) { headers.push("📌 状态"); continue; }
      if (ci === 0 && samples.some((s) => /[a-zA-Z\u4e00-\u9fff]/.test(s) && !/^\d/.test(s))) { headers.push("🏢 供应商"); continue; }
      headers.push(`列${ci + 2}`);
    }
    thead = `<tr>${headers.map((h) => `<th style="${S.th}">${esc(h)}</th>`).join("")}</tr>`;
    tbody = parsed
      .map((row, ri) => {
        const cells = [esc(row.id), ...row.segs.map((s) => inline(s))];
        return `<tr style="${ri % 2 === 0 ? S.trEven : S.trOdd}">${cells.map((c) => `<td style="${S.td}">${c}</td>`).join("")}</tr>`;
      })
      .join("");
  }

  return {
    html: `<div style="${S.tableWrap}"><table style="${S.table}"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`,
    next: i,
  };
}

/** Detect dash-separated list items and convert to table.
 * Pattern: `- P00013 — Ready Mat — 6,936.00 — purchase — 2026-03-24`
 * All items must have the same number of segments.
 */
function tryDashListTable(lines: string[], idx: number): { html: string; next: number } | null {
  const rows: string[][] = [];
  let segCount = 0;

  let i = idx;
  while (i < lines.length) {
    const text = (lines[i] || "").trim();
    // must be a list item
    if (!/^\s*[-*•]\s+/.test(text) && !/^\s*\d+[.)]\s+/.test(text)) break;

    const body = text.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
    // split by ` — ` or ` - ` (with spaces around dash)
    const segs = body.split(/\s+[—–-]\s+/).map((s) => s.trim());
    if (segs.length < 3) break;
    // first row sets the expected column count
    if (segCount === 0) segCount = segs.length;
    if (segs.length !== segCount) break;
    // first segment should look like an ID (alphanumeric)
    if (rows.length === 0 && !/^[A-Za-z0-9]/.test(segs[0])) break;

    rows.push(segs);
    i++;
  }

  if (rows.length < 3) return null;

  // auto-guess header labels based on content patterns
  const headers = rows[0].map((_, ci) => {
    const samples = rows.map((r) => r[ci] || "");
    if (ci === 0 && samples.every((s) => /^[A-Za-z]{1,6}\d+$/.test(s))) return "📋 单号";
    if (samples.every((s) => /^\d{4}-\d{2}-\d{2}/.test(s))) return "📅 日期";
    if (samples.every((s) => /^[\d,.]+$/.test(s))) return "💰 金额";
    if (samples.every((s) => /^(purchase|draft|done|cancel|sent|confirmed|已采购|草稿|完成|取消)/i.test(s))) return "📌 状态";
    // fallback: if all look like names/text
    if (ci === 1) return "🏢 供应商";
    return `列${ci + 1}`;
  });

  const thead = `<tr>${headers.map((h) => `<th style="${S.th}">${esc(h)}</th>`).join("")}</tr>`;
  const tbody = rows
    .map(
      (row, ri) =>
        `<tr style="${ri % 2 === 0 ? S.trEven : S.trOdd}">${row.map((c) => `<td style="${S.td}">${inline(c)}</td>`).join("")}</tr>`,
    )
    .join("");

  return {
    html: `<div style="${S.tableWrap}"><table style="${S.table}"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`,
    next: i,
  };
}

/** Detect key-value line: `**Key**: Value` or `- **Key**: Value` */
function parseKV(line: string): { key: string; value: string } | null {
  const m = line.match(/^\s*(?:[-*•]\s*)?\*\*([^*]{1,30})\*\*\s*[:：]\s*(.+)$/);
  if (!m) return null;
  const key = m[1].trim();
  const value = m[2].trim();
  if (!key || !value) return null;
  return { key, value };
}

/** Build a 2-column table from 3+ consecutive key-value lines */
function tryKVTable(lines: string[], idx: number): { html: string; next: number } | null {
  const pairs: Array<{ key: string; value: string }> = [];
  let i = idx;
  while (i < lines.length) {
    const kv = parseKV(lines[i]);
    if (!kv) break;
    pairs.push(kv);
    i++;
  }
  if (pairs.length < 3) return null;
  const thead = `<tr><th style="${S.th}">Field</th><th style="${S.th}">Value</th></tr>`;
  const tbody = pairs
    .map(
      (p, ri) =>
        `<tr style="${ri % 2 === 0 ? S.trEven : S.trOdd}"><td style="${S.td}"><strong>${esc(p.key)}</strong></td><td style="${S.td}">${inline(p.value)}</td></tr>`,
    )
    .join("");
  return {
    html: `<div style="${S.tableWrap}"><table style="${S.table}"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`,
    next: i,
  };
}

/** Notice style — only triggers on explicit emoji prefix */
function noticeStyle(line: string): string | null {
  if (/^✅/.test(line)) return S.notice("#ecfdf5", "#10b981");
  if (/^🎉/.test(line)) return S.notice("#ecfdf5", "#10b981");
  if (/^⚠️?/.test(line) && /^⚠/.test(line)) return S.notice("#fffbeb", "#f59e0b");
  if (/^❌/.test(line)) return S.notice("#fef2f2", "#ef4444");
  if (/^ℹ️?/.test(line) && /^ℹ/.test(line)) return S.notice("#eff6ff", "#3b82f6");
  if (/^💡/.test(line)) return S.notice("#eff6ff", "#3b82f6");
  if (/^🔔/.test(line)) return S.notice("#fffbeb", "#f59e0b");
  return null;
}

/** Add contextual emoji to heading text if not already present */
function decorateHeading(text: string): string {
  // already has emoji at start — don't double up
  if (/^[\u{1F300}-\u{1FAF8}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]/u.test(text)) return text;

  const t = text.toLowerCase();
  // business domain keywords
  if (/结论|总结|summary|conclusion/i.test(t)) return `📊 ${text}`;
  if (/采购|purchase|po\b|rfq/i.test(t)) return `📦 ${text}`;
  if (/销售|sale|so\b/i.test(t)) return `🧾 ${text}`;
  if (/明细|detail|清单|列表|list/i.test(t)) return `📋 ${text}`;
  if (/分析|analysis|统计|stat/i.test(t)) return `📈 ${text}`;
  if (/供应商|vendor|supplier|partner|客户|contact/i.test(t)) return `👤 ${text}`;
  if (/发票|invoice|bill|账单/i.test(t)) return `💰 ${text}`;
  if (/库存|inventory|stock|仓库/i.test(t)) return `📦 ${text}`;
  if (/提醒|reminder|注意|warning|notice/i.test(t)) return `⚠️ ${text}`;
  if (/成功|success|完成|done/i.test(t)) return `✅ ${text}`;
  if (/错误|error|失败|fail/i.test(t)) return `❌ ${text}`;
  if (/下一步|next|后续|建议|suggest|recommend/i.test(t)) return `👉 ${text}`;
  if (/配置|config|设置|setting/i.test(t)) return `⚙️ ${text}`;
  if (/帮助|help|说明|guide/i.test(t)) return `💡 ${text}`;
  // generic fallback
  return `📌 ${text}`;
}

/* ── Main export ── */

export function formatOdooRichText(text: string): string {
  const src = String(text || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!src) return "<div> </div>";

  const lines = src.split("\n");
  const out: string[] = [`<div style="${S.root}">`];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();

    // ── blank line ──
    if (!line) { i++; continue; }

    // ── fenced code block ──
    const fenceMatch = line.match(/^(`{3,})([\w-]*)$/);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      const lang = fenceMatch[2];
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].trim().startsWith(fence)) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing fence
      const langLabel = lang ? `<div style="margin:0 0 4px 0;font-size:11px;color:#94a3b8;font-weight:600;">${esc(lang)}</div>` : "";
      out.push(`<div style="${S.pre}">${langLabel}<code>${esc(codeLines.join("\n"))}</code></div>`);
      continue;
    }

    // ── horizontal rule ──
    if (isHorizontalRule(line)) {
      out.push(`<hr style="${S.hr}"/>`);
      i++;
      continue;
    }

    // ── markdown table ──
    if (isMarkdownTable(lines, i)) {
      const t = tableToHtml(lines, i);
      out.push(t.html);
      i = t.next;
      continue;
    }

    // ── pipe style records (P000xx｜供应商：...)
    const prt = tryPipeRecordTable(lines, i);
    if (prt) {
      out.push(prt.html);
      i = prt.next;
      continue;
    }

    // ── key-value table (3+ consecutive **Key**: Value) ──
    const kvt = tryKVTable(lines, i);
    if (kvt) {
      out.push(kvt.html);
      i = kvt.next;
      continue;
    }

    // ── headings ──
    const h3 = line.match(/^###\s+(.+)$/);
    const h2 = !h3 ? line.match(/^##\s+(.+)$/) : null;
    const h1 = !h3 && !h2 ? line.match(/^#\s+(.+)$/) : null;
    if (h3) { out.push(`<div style="${S.h3}">${inline(decorateHeading(h3[1]))}</div>`); i++; continue; }
    if (h2) { out.push(`<div style="${S.h2}">${inline(decorateHeading(h2[1]))}</div>`); i++; continue; }
    if (h1) { out.push(`<div style="${S.h1}">${inline(decorateHeading(h1[1]))}</div>`); i++; continue; }

    // ── bold-only line as pseudo-heading (e.g. **最近采购单**) ──
    const boldOnly = line.match(/^\*\*(.+)\*\*$/);
    if (boldOnly) {
      out.push(`<div style="${S.h2}">${inline(decorateHeading(boldOnly[1]))}</div>`);
      i++;
      continue;
    }

    // ── blockquote ──
    if (/^>\s?/.test(line)) {
      const bqLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        bqLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<div style="${S.blockquote}">${bqLines.map((l) => inline(l)).join("<br/>")}</div>`);
      continue;
    }

    // ── dash-separated list → table (- P00013 — Ready Mat — ...) ──
    // ── OR pipe-separated list → table (- P00013 | Ready Mat | ...) ──
    if (/^[-*•]\s+/.test(line) || /^\d+[.)]\s+/.test(line)) {
      const prt2 = tryPipeRecordTable(lines, i);
      if (prt2) {
        out.push(prt2.html);
        i = prt2.next;
        continue;
      }
      const dlt = tryDashListTable(lines, i);
      if (dlt) {
        out.push(dlt.html);
        i = dlt.next;
        continue;
      }
    }

    // ── unordered list ──
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      out.push(`<ul style="${S.ul}">${items.map((it) => `<li style="${S.li}">${inline(it)}</li>`).join("")}</ul>`);
      continue;
    }

    // ── ordered list ──
    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      out.push(`<ol style="${S.ol}">${items.map((it) => `<li style="${S.li}">${inline(it)}</li>`).join("")}</ol>`);
      continue;
    }

    // ── paragraph (collect consecutive non-special lines) ──
    const block: string[] = [line];
    i++;
    while (i < lines.length) {
      const next = (lines[i] || "").trim();
      if (
        !next ||
        isMarkdownTable(lines, i) ||
        /^#{1,3}\s+/.test(next) ||
        /^[-*]\s+/.test(next) ||
        /^\d+[.)]\s+/.test(next) ||
        /^>\s?/.test(next) ||
        /^`{3,}/.test(next) ||
        isHorizontalRule(next) ||
        parseKV(next)
      ) break;
      block.push(next);
      i++;
    }

    const joined = block.map((b) => inline(b)).join("<br/>");
    // single-line notice check
    const ns = block.length === 1 ? noticeStyle(block[0]) : null;
    if (ns) {
      out.push(`<div style="${ns}">${joined}</div>`);
    } else {
      out.push(`<p style="${S.p}">${joined}</p>`);
    }
  }

  out.push("</div>");
  return out.join("");
}

/* ── Inbound HTML → plain text ── */

/**
 * Strip HTML tags and decode entities from Odoo message body.
 * Also removes `@BotName` mention patterns.
 */
export function cleanOdooBody(html: string): string {
  let text = (html || "").replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
  text = text.replace(/@[\w\-_.]+\s*/g, "");
  return text.replace(/\s+/g, " ").trim();
}
