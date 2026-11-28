import dns from 'node:dns/promises';
import net from 'node:net';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata',
]);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let num = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    num = (num << 8) | octet;
  }
  return num >>> 0;
}

function isPrivateIpv4(ip: string): boolean {
  const num = ipv4ToInt(ip);
  if (num === null) return true;

  const first = (num >>> 24) & 0xff;
  const second = (num >>> 16) & 0xff;

  if (first === 0) return true; // 0.0.0.0/8
  if (first === 10) return true; // 10.0.0.0/8
  if (first === 127) return true; // 127.0.0.0/8 loopback
  if (first === 169 && second === 254) return true; // 169.254.0.0/16 link-local / metadata
  if (first === 172 && second >= 16 && second <= 31) return true; // 172.16.0.0/12
  if (first === 192 && second === 168) return true; // 192.168.0.0/16
  if (first === 100 && second >= 64 && second <= 127) return true; // 100.64.0.0/10 CGNAT
  if (first >= 224) return true; // multicast & reserved
  return false;
}

export function isPrivateIpAddress(ip: string): boolean {
  const clean = ip.trim().toLowerCase();
  const kind = net.isIP(clean);
  if (kind === 4) {
    return isPrivateIpv4(clean);
  }
  if (kind === 6) {
    if (clean === '::' || clean === '::1') return true;
    // IPv4-mapped IPv6 addresses like ::ffff:127.0.0.1
    if (clean.startsWith('::ffff:')) {
      const mapped = clean.slice('::ffff:'.length);
      if (net.isIP(mapped) === 4) {
        return isPrivateIpv4(mapped);
      }
    }
    // Unique local (fc00::/7) and link-local (fe80::/10)
    if (clean.startsWith('fc') || clean.startsWith('fd')) return true;
    if (clean.startsWith('fe8') || clean.startsWith('fe9') || clean.startsWith('fea') || clean.startsWith('feb')) {
      return true;
    }
    return false;
  }
  return true;
}

export function parseAndValidateExternalUrl(
  rawUrl: string
): { ok: true; url: URL } | { ok: false; reason: string } {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { ok: false, reason: 'URL is required.' };
  }
  const trimmed = rawUrl.trim();
  if (trimmed.length > 2048) {
    return { ok: false, reason: 'URL exceeds maximum length.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'Malformed URL.' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Only HTTPS external URLs are permitted.' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'URLs with embedded credentials are not allowed.' };
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) {
    return { ok: false, reason: 'URL hostname is missing.' };
  }

  if (
    BLOCKED_HOSTNAMES.has(host) ||
    host.endsWith('.local') ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal')
  ) {
    return { ok: false, reason: 'Private or local network hosts are not allowed.' };
  }

  if (net.isIP(host) !== 0 && isPrivateIpAddress(host)) {
    return { ok: false, reason: 'Private or loopback IP addresses are not allowed.' };
  }

  return { ok: true, url: parsed };
}

export async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  const checked = parseAndValidateExternalUrl(rawUrl);
  if (!checked.ok) {
    throw new Error(checked.reason);
  }

  const host = checked.url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) === 0) {
    const records = await dns.lookup(host, { all: true });
    if (!records || records.length === 0) {
      throw new Error('Could not resolve external host.');
    }
    for (const rec of records) {
      if (isPrivateIpAddress(rec.address)) {
        throw new Error('Resolved host points to a private or restricted IP address.');
      }
    }
  }

  return checked.url;
}

export function sanitizeText(value: unknown, maxLen = 200): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLen);
}

export function sanitizeUpc(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const digits = String(value).replace(/\D/g, '');
  if (digits.length === 11) return `0${digits}`;
  return digits.slice(0, 14);
}
