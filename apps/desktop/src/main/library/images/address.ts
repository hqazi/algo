/**
 * Which hosts and addresses a linked image may come from (T23, SPEC §15.4):
 * public unicast only. Anything that can reach this machine or the local
 * network is refused: loopback, private, link-local, carrier-grade NAT,
 * multicast, unspecified, reserved, and IPv6 forms that carry an IPv4
 * address (mapped, compatible, NAT64, 6to4) are judged by that address.
 */
import { isIP } from 'node:net';

/** `[a, b, prefix bits]`: an IPv4 range as its first address and length. */
const V4_BLOCKED: [number, number][] = [
  [0x00000000, 8], // 0.0.0.0/8 "this network", unspecified
  [0x0a000000, 8], // 10/8 private
  [0x64400000, 10], // 100.64/10 carrier-grade NAT
  [0x7f000000, 8], // 127/8 loopback
  [0xa9fe0000, 16], // 169.254/16 link-local
  [0xac100000, 12], // 172.16/12 private
  [0xc0000000, 24], // 192.0.0/24 protocol assignments
  [0xc0000200, 24], // 192.0.2/24 documentation
  [0xc0a80000, 16], // 192.168/16 private
  [0xc6120000, 15], // 198.18/15 benchmarking
  [0xc6336400, 24], // 198.51.100/24 documentation
  [0xcb007100, 24], // 203.0.113/24 documentation
  [0xe0000000, 4], // 224/4 multicast
  [0xf0000000, 4], // 240/4 reserved, broadcast
];

function v4Number(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = n * 256 + Number(p);
  }
  return n;
}

function v4Blocked(n: number): boolean {
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) >>> 0 === base;
  });
}

/** The eight 16-bit groups of an IPv6 address, or `null`. */
function v6Groups(ip: string): number[] | null {
  let s = ip;
  let tail: number[] = [];
  const dotted = /:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (dotted) {
    const n = v4Number(dotted[1]!);
    if (n === null) return null;
    tail = [n >>> 16, n & 0xffff];
    s = s.slice(0, dotted.index);
    if (s.endsWith(':')) s = `${s}:`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parse = (h: string) => (h ? h.split(':').map((g) => parseInt(g, 16)) : []);
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  const fill = 8 - tail.length - head.length - rest.length;
  if (halves.length === 1 && fill !== 0) return null;
  if (fill < 0) return null;
  const out = [...head, ...Array<number>(halves.length === 2 ? fill : 0).fill(0), ...rest, ...tail];
  if (out.length !== 8 || out.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  return out;
}

const embeddedV4 = (hi: number, lo: number): number => ((hi << 16) >>> 0) + lo;

function v6Blocked(g: number[]): boolean {
  const zeroUpTo = (k: number) => g.slice(0, k).every((x) => x === 0);
  // ::, ::1, ::a.b.c.d (compatible), ::ffff:a.b.c.d (mapped), ::ffff:0:a.b.c.d (translated)
  if (zeroUpTo(5) && (g[5] === 0 || g[5] === 0xffff)) {
    if (g[5] === 0 && g[6] === 0) return true; // :: and ::1 (and ::/112)
    return v4Blocked(embeddedV4(g[6]!, g[7]!));
  }
  if (zeroUpTo(4) && g[4] === 0xffff && g[5] === 0) return v4Blocked(embeddedV4(g[6]!, g[7]!));
  // 64:ff9b::/96 NAT64 and 64:ff9b:1::/48 local-use NAT64
  if (g[0] === 0x64 && g[1] === 0xff9b) return g[2] !== 0 || v4Blocked(embeddedV4(g[6]!, g[7]!));
  // 2002::/16 6to4: the IPv4 address is in groups 1–2
  if (g[0] === 0x2002) return v4Blocked(embeddedV4(g[1]!, g[2]!));
  // 2001::/32 Teredo (embeds a hidden IPv4 client), 2001:db8::/32 documentation
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return true;
  // 100::/64 discard
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true;
  const top = g[0]!;
  if ((top & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local (private)
  if ((top & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((top & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (old)
  if ((top & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  // Only global unicast (2000::/3) is public.
  return (top & 0xe000) !== 0x2000;
}

/**
 * True when `ip` is not a public unicast address (or is not an address at
 * all). Brackets and an IPv6 zone (`%eth0`, always link-local) are refused.
 */
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const n = v4Number(ip);
    return n === null || v4Blocked(n);
  }
  if (kind === 6) {
    if (ip.includes('%')) return true;
    const g = v6Groups(ip.toLowerCase());
    return g === null || v6Blocked(g);
  }
  return true;
}

/** A URL's host name as an address or name to check: no brackets, no trailing dot, lower case. */
export function bareHost(hostname: string): string {
  let h = hostname.toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  while (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}

/** Names that always mean this machine or the local network, before any lookup. */
export function isLocalName(host: string): boolean {
  const h = bareHost(host);
  if (!h || !h.includes('.')) return isIP(h) === 0; // `localhost`, `printer`, …
  return (
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h.endsWith('.home.arpa') ||
    h.endsWith('.lan')
  );
}
