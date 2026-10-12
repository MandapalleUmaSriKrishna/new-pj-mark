import { isIP } from 'node:net';

/**
 * SSRF protection for outbound webhook URLs.
 *
 * A tenant-supplied URL is fetched by OUR server, so without these checks an
 * attacker could point a webhook at cloud metadata endpoints
 * (169.254.169.254), loopback admin panels, or private RFC1918 services.
 *
 * Rules enforced:
 *  - only http/https
 *  - the hostname must be a public DNS name or a public literal IP
 *  - no userinfo, no non-standard ports outside the allow-list
 *  - literal IPs in private / reserved / link-local ranges are rejected
 *
 * DNS rebinding note: the hostname is re-resolved by the HTTP client at request
 * time, so a hostile DNS record could still resolve to a private address. The
 * delivery worker therefore re-validates the resolved address before connecting
 * (see `assertResolvedAddressIsPublic`).
 */

const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^192\.0\.2\./,
  /^198\.(18|19)\./,
  /^198\.51\.100\./,
  /^203\.0\.113\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT
  /^(22[4-9]|23\d|24\d|25[0-5])\./, // multicast + reserved
];

const PRIVATE_V6 = [
  /^::1$/i,
  /^fe80:/i,
  /^fc00:/i,
  /^fd/i,
  /^::ffff:(10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/i,
  /^::$/,
];

export function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return PRIVATE_V4.some((re) => re.test(ip));
  if (version === 6) return PRIVATE_V6.some((re) => re.test(ip));
  return true; // anything that is not a parseable IP is treated as unsafe
}

export interface UrlCheck {
  ok: boolean;
  reason?: string;
  url?: URL;
}

export function assertPublicWebhookUrl(raw: string): UrlCheck {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'The webhook URL is not a valid absolute URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Only http and https webhook URLs are allowed' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'Webhook URLs must not contain credentials' };
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname) return { ok: false, reason: 'The webhook URL has no hostname' };
  if (hostname.length > 253) return { ok: false, reason: 'Hostname is too long' };

  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      return {
        ok: false,
        reason: 'Webhook URLs may not point at private, loopback or link-local addresses',
      };
    }
  } else {
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(hostname)) {
      return { ok: false, reason: 'The webhook hostname is not valid' };
    }
    const reservedNames = ['localhost', 'metadata.google.internal', 'instance-data', 'kdc', 'api'];
    if (
      reservedNames.includes(hostname) ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      return {
        ok: false,
        reason: 'That hostname resolves inside the platform network and is not allowed',
      };
    }
  }
  if (parsed.port && !ALLOWED_PORTS.has(Number(parsed.port))) {
    return {
      ok: false,
      reason: `Port ${parsed.port} is not allowed; use ${[...ALLOWED_PORTS].join(', ')}`,
    };
  }
  return { ok: true, url: parsed };
}

/**
 * Validates an address returned by DNS immediately before connecting.
 * Used by the delivery worker to defeat DNS-rebinding attacks.
 */
export function assertResolvedAddressIsPublic(address: string): void {
  if (isPrivateIp(address)) {
    throw new Error(`Refusing to connect: ${address} resolved to a private or reserved address`);
  }
}
