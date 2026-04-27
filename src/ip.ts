import type { IncomingMessage } from "node:http";

function isValidIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every(part => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255 && part === num.toString();
  });
}

function ipToLong(ip: string): number | null {
  if (!isValidIpv4(ip)) return null;
  const parts = ip.split(".");
  return (
    (parseInt(parts[0], 10) << 24) +
    (parseInt(parts[1], 10) << 16) +
    (parseInt(parts[2], 10) << 8) +
    parseInt(parts[3], 10)
  );
}

function isValidCidr(cidr: string): boolean {
  const [subnet, bitsStr] = cidr.split("/");
  const bits = parseInt(bitsStr, 10);
  return isValidIpv4(subnet) && Number.isFinite(bits) && bits >= 0 && bits <= 32;
}

function isIpInCidr(ip: string, cidr: string): boolean {
  if (!isValidCidr(cidr)) return false;
  if (!isValidIpv4(ip)) return false;

  const [subnet, bitsStr] = cidr.split("/");
  const bits = parseInt(bitsStr, 10);
  const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;

  const ipLong = ipToLong(ip);
  const subnetLong = ipToLong(subnet);
  if (ipLong === null || subnetLong === null) return false;

  return ((ipLong >>> 0) & mask) === ((subnetLong >>> 0) & mask);
}

function normalizeIp(ip: string): string {
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

function isExactIpMatch(left: string, right: string): boolean {
  return normalizeIp(left) === normalizeIp(right);
}

export function matchesAllowedIp(clientIp: string, patterns: string[]): boolean {
  const normalized = normalizeIp(clientIp);
  if (!normalized) return false;

  for (const pattern of patterns) {
    const p = pattern.trim();
    if (!p) continue;
    if (p.includes("/")) {
      if (isIpInCidr(normalized, p)) return true;
      continue;
    }
    if (isExactIpMatch(normalized, p)) {
      return true;
    }
  }
  return false;
}

export function resolveClientIp(req: IncomingMessage): string | null {
  const remoteAddress = normalizeIp(req.socket?.remoteAddress || "");
  return remoteAddress || null;
}

