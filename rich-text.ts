/* ── Style constants ── */

const STYLES = {
  root: "line-height:1.65;font-size:14px;color:#0f172a;",
  heading: (size: number) => `margin:14px 0 10px 0;padding:0 0 6px 0;font-weight:800;font-size:${size}px;border-bottom:1px solid #e5e7eb;letter-spacing:.1px;`,
  paragraph: "margin:8px 0 14px 0;",
  ul: "margin:8px 0 14px 18px;padding:0;",
  ol: "margin:8px 0 14px 20px;padding:0;",
  li: "margin:6px 0;padding-left:2px;",
  inlineCode: "background:#eef2ff;color:#3730a3;padding:2px 6px;border-radius:6px;font-family:Consolas,monospace;font-size:12px;",
  tableWrapper: "margin:12px 0 16px 0;overflow-x:auto;border:1px solid #e5e7eb;border-radius:12px;",
  table: "border-collapse:collapse;width:100%;font-size:13px;background:#fff;",
  th: "padding:10px 12px;border:1px solid #e5e7eb;background:#f8fafc;text-align:left;font-weight:700;white-space:nowrap;",
  td: "padding:9px 12px;border:1px solid #e5e7eb;vertical-align:top;",
  trEven: "background:#ffffff;",
  trOdd: "background:#fbfdff;",
  notice: (extra: string) => `margin:10px 0 14px 0;padding:10px 12px;border-radius:10px;${extra}`,
} as const;

/* ── Helpers ── */

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatInlineMarkdown(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, `<code style="${STYLES.inlineCode}">$1</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__(.+?)__/g, "<strong>$1</strong>");
  s = s.replace(/\*(?!\s)([^*]+?)\*/g, "<em>$1</em>");
  return s;
}

function getNoticeStyle(text: string): string | null {
  const lower = text.toLowerCase();
  if (/^(✅|🎉|🟢)/.test(text) || /success|completed|created|confirmed|成功|完成|已创建|已确认/i.test(lower)) {
    return "background:#ecfdf3;border-left:4px solid #16a34a;";
  }
  if (/^(⚠️|⚠)/.test(text) || /reminder|notice|warning|提醒|注意|警告/i.test(lower)) {
    return "background:#fffbeb;border-left:4px solid #d97706;";
  }
  if (/^(❌)/.test(text) || /error|failure|exception|错误|失败|异常/i.test(lower)) {
    return "background:#fef2f2;border-left:4px solid #dc2626;";
  }
  if (/^(ℹ️)/.test(text) || /tip|description|information|提示|说明|信息/i.test(lower)) {
    return "background:#eff6ff;border-left:4px solid #2563eb;";
  }
  return null;
}

function guessEmojiTitle(text: string): { emoji: string; title: string } | null {
  const first = text.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || "";
  if (!first) return null;

  const lowerText = text.toLowerCase();
  const lowerFirst = first.toLowerCase();

  if (/error|错误/i.test(lowerFirst)) return { emoji: "❌", title: first.replace(/^(❌)/, "").trim() };
  if (/warning|警告/i.test(lowerFirst)) return { emoji: "⚠️", title: first.replace(/^(⚠️|⚠)/, "").trim() };
  if (/purchase|rfq|po|采购|订单/i.test(lowerText)) return { emoji: "📦", title: first };
  if (/sale order|\bso\b|销售/i.test(lowerText)) return { emoji: "🧾", title: first };
  if (/invoice|bill|发票|账单/i.test(lowerText)) return { emoji: "💰", title: first };
  if (/partner|supplier|vendor|联系人|供应商|客户/i.test(lowerText)) return { emoji: "👤", title: first };
  if (/success|成功/i.test(lowerFirst)) return { emoji: "✅", title: first };
  if (/list|search|show|查询|列表|显示/i.test(lowerFirst)) return { emoji: "🔎", title: first };
  return { emoji: "✨", title: first };
}

function parseKeyValueLine(line: string): { key: string; value: string } | null {
  const m = line.match(/^\s*(?:[-*•]\s*)?(?:\*\*)?([^:：]{1,24}?)(?:\*\*)?\s*[:：]\s*(.+)\s*$/);
  if (!m) return null;
  const key = m[1].trim();
  const value = m[2].trim();
  if (!key || !value) return null;
  if (/^(http|https):\/\//i.test(key)) return null;
  return { key, value };
}

function looksLikeDivider(line: string): boolean {
  return /^[-=]{3,}$/.test(line.trim());
}

function parseListHeader(line: string): string | null {
  const trimmed = line.trim();
  const numbered = trimmed.match(/^\d+[.)]\s+(.+)$/);
  if (numbered) return numbered[1].trim();
  const bulleted = trimmed.match(/^[-*]\s+(.+)$/);
  if (bulleted) return bulleted[1].trim();
  return null;
}

function tryBuildRecordTable(src: string[], startIndex: number): { lines: string[]; nextIndex: number } | null {
  const records: Array<{ title: string; fields: Record<string, string> }> = [];
  let i = startIndex;

  while (i < src.length) {
    while (i < src.length && !src[i].trim()) i += 1;
    if (i >= src.length) break;

    const title = parseListHeader(src[i]);
    if (!title) break;
    i += 1;

    const fields: Record<string, string> = {};
    while (i < src.length) {
      const line = src[i].trim();
      if (!line) {
        i += 1;
        break;
      }
      if (parseListHeader(line)) break;
      const kv = parseKeyValueLine(line);
      if (!kv) break;
      fields[kv.key] = kv.value;
      i += 1;
    }

    if (Object.keys(fields).length < 2) break;
    records.push({ title, fields });
  }

  if (records.length < 2) return null;

  const keyOrder: string[] = [];
  for (const record of records) {
    for (const key of Object.keys(record.fields)) {
      if (!keyOrder.includes(key)) keyOrder.push(key);
    }
  }
  const usefulKeys = keyOrder.filter((key) => records.filter((r) => r.fields[key]).length >= 2).slice(0, 5);
  if (usefulKeys.length < 2) return null;

  const tableLines = [
    `| Item | ${usefulKeys.join(" | ")} |`,
    `| ${["---", ...usefulKeys.map(() => "---")].join(" | ")} |`,
    ...records.map((record) => `| ${record.title} | ${usefulKeys.map((key) => record.fields[key] || "-").join(" | ")} |`),
    "",
  ];

  return { lines: tableLines, nextIndex: i };
}

function isMarkdownTable(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) return false;
  const header = lines[index]?.trim() || "";
  const sep = lines[index + 1]?.trim() || "";
  return /^\|.+\|$/.test(header) && /^\|?[\s:-]+(?:\|[\s:-]+)+\|?$/.test(sep);
}

function parseTableRow(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function markdownTableToHtml(lines: string[], index: number): { html: string; nextIndex: number } {
  const headerCells = parseTableRow(lines[index]);
  let i = index + 2;
  const bodyRows: string[][] = [];
  while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
    bodyRows.push(parseTableRow(lines[i]));
    i += 1;
  }

  const thead = `<tr>${headerCells.map((c) => `<th style="${STYLES.th}">${formatInlineMarkdown(c)}</th>`).join("")}</tr>`;
  const tbody = bodyRows.map((row, rowIndex) => `<tr style="${rowIndex % 2 === 0 ? STYLES.trEven : STYLES.trOdd}">${row.map((c) => `<td style="${STYLES.td}">${formatInlineMarkdown(c)}</td>`).join("")}</tr>`).join("");
  return {
    html: `<div style="${STYLES.tableWrapper}"><table style="${STYLES.table}"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`,
    nextIndex: i,
  };
}

/* ── Preprocessing ── */

function preprocessForOdooRichText(text: string): string {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return normalized;

  const src = normalized.split("\n");
  const out: string[] = [];
  let i = 0;
  let injectedTitle = false;

  const titleGuess = guessEmojiTitle(normalized);
  if (titleGuess) {
    out.push(`## ${titleGuess.emoji} ${titleGuess.title}`);
    injectedTitle = true;
  }

  while (i < src.length) {
    const raw = src[i] ?? "";
    const line = raw.trim();

    if (!line) {
      out.push("");
      i += 1;
      continue;
    }

    if (looksLikeDivider(line)) {
      i += 1;
      continue;
    }

    if (injectedTitle && i === 0 && titleGuess && line === titleGuess.title) {
      i += 1;
      continue;
    }

    if (isMarkdownTable(src, i)) {
      out.push(src[i], src[i + 1]);
      i += 2;
      while (i < src.length && /^\|.+\|$/.test(src[i].trim())) {
        out.push(src[i]);
        i += 1;
      }
      out.push("");
      continue;
    }

    const recordTable = tryBuildRecordTable(src, i);
    if (recordTable) {
      out.push(...recordTable.lines);
      i = recordTable.nextIndex;
      continue;
    }

    const kvRows: Array<{ key: string; value: string }> = [];
    let j = i;
    while (j < src.length) {
      const parsed = parseKeyValueLine(src[j]);
      if (!parsed) break;
      kvRows.push(parsed);
      j += 1;
    }
    if (kvRows.length >= 2) {
      out.push("| Field | Value |", "| --- | --- |");
      for (const row of kvRows) {
        out.push(`| ${row.key} | ${row.value} |`);
      }
      out.push("");
      i = j;
      continue;
    }

    const numbered = line.match(/^(\d+)[.)]\s+(.+)$/);
    if (numbered) {
      out.push(`${numbered[1]}. ${numbered[2]}`);
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const body = line.replace(/^[-*]\s+/, "");
      if (!/^(✅|📌|👉|🔹|▫️|•)/.test(body)) {
        out.push(`- 👉 ${body}`);
      } else {
        out.push(`- ${body}`);
      }
      i += 1;
      continue;
    }

    if (/^(Next|You can also|Next step|Can continue|Can execute|下一步|你也可以|后续操作)/i.test(line)) {
      out.push(`### 👉 ${line}`);
      i += 1;
      continue;
    }

    out.push(line);
    i += 1;
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* ── Main export ── */

export function formatOdooRichText(text: string): string {
  const normalized = preprocessForOdooRichText(text);
  if (!normalized) return "<div> </div>";

  const lines = normalized.split("\n");
  const parts: string[] = [`<div class="openclaw-rich" style="${STYLES.root}">`];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i] ?? "";
    const line = raw.trim();

    if (!line) {
      i += 1;
      continue;
    }

    if (isMarkdownTable(lines, i)) {
      const table = markdownTableToHtml(lines, i);
      parts.push(table.html);
      i = table.nextIndex;
      continue;
    }

    const h3 = line.match(/^###\s+(.+)$/);
    const h2 = line.match(/^##\s+(.+)$/);
    const h1 = line.match(/^#\s+(.+)$/);
    if (h3 || h2 || h1) {
      const textValue = h3?.[1] || h2?.[1] || h1?.[1] || line;
      const size = h1 ? 20 : h2 ? 18 : 16;
      parts.push(`<div style="${STYLES.heading(size)}">${formatInlineMarkdown(textValue)}</div>`);
      i += 1;
      continue;
    }

    if (/^([-*])\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i += 1;
      }
      parts.push(`<ul style="${STYLES.ul}">${items.map((item) => `<li style="${STYLES.li}">${formatInlineMarkdown(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i += 1;
      }
      parts.push(`<ol style="${STYLES.ol}">${items.map((item) => `<li style="${STYLES.li}">${formatInlineMarkdown(item)}</li>`).join("")}</ol>`);
      continue;
    }

    const block: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const next = (lines[i] || "").trim();
      if (!next || isMarkdownTable(lines, i) || /^#{1,3}\s+/.test(next) || /^[-*]\s+/.test(next) || /^\d+[.)]\s+/.test(next)) break;
      block.push(next);
      i += 1;
    }

    const joined = block.join("<br/>");
    const noticeStyle = block.length === 1 ? getNoticeStyle(block[0]) : null;
    if (noticeStyle) {
      parts.push(`<div style="${STYLES.notice(noticeStyle)}">${formatInlineMarkdown(joined)}</div>`);
    } else {
      parts.push(`<p style="${STYLES.paragraph}">${formatInlineMarkdown(joined)}</p>`);
    }
  }

  parts.push("</div>");
  return parts.join("");
}

/**
 * Strip HTML tags and decode entities from Odoo message body.
 * Also removes `@BotName` mention patterns.
 */
export function cleanOdooBody(html: string): string {
  // 1. Remove all HTML tags
  let text = (html || "").replace(/<[^>]+>/g, " ");

  // 2. Decode standard entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));

  // 3. Remove @mentions (consistent with Odoo plugin's _strip_mention)
  // Odoo wraps mentions in <a class="o_mail_redirect">@Name</a> — after HTML
  // tag stripping (step 1), mentions become bare "@Name " tokens.
  // Only strip the single @-word; do NOT consume subsequent words, otherwise
  // pure-English messages like "@Bot hello world" get entirely eaten.
  text = text.replace(/@[\w\-_.]+\s*/g, "");

  // 4. Final cleanup
  return text.replace(/\s+/g, " ").trim();
}
