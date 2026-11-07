export class PublicUrlError extends Error {
    constructor(code, message, status) {
        super(message);
        this.code = code;
        this.status = status;
        this.name = 'PublicUrlError';
    }
}
const CREDENTIAL_QUERY_KEY = /^(?:access_?token|auth(?:entication|orization)?|api_?key|cookie|credential|key|password|secret|signature|sig|token)$/i;
export function parsePublicHttpsUrl(value) {
    if (typeof value !== 'string' || value.length < 1 || value.length > 2_048 || /[\u0000-\u001f\u007f]/.test(value)) {
        throw new PublicUrlError('url.invalid', '公開HTTPS URLを2,048文字以内で指定してください。', 422);
    }
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new PublicUrlError('url.invalid', '有効な公開HTTPS URLを指定してください。', 422);
    }
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
        throw new PublicUrlError('url.invalid', '認証情報や独自Portを含まない公開HTTPS URLを指定してください。', 422);
    }
    // A name with trailing dots ("localhost.", "metadata.google.internal.") is the same name to DNS; judge it without them.
    const host = url.hostname.toLowerCase().replace(/\.+$/, '');
    const ipv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
    const ipv6 = host.includes(':') || host.startsWith('[');
    const forbiddenName = host === 'localhost'
        || host.endsWith('.localhost')
        || host.endsWith('.local')
        || host.endsWith('.internal')
        || host.endsWith('.test')
        || host.endsWith('.invalid');
    if (!host || !host.includes('.') || ipv4 || ipv6 || forbiddenName) {
        throw new PublicUrlError('url.ssrf-blocked', '公開DNS名ではないURLは診断できません。', 422);
    }
    for (const [key] of url.searchParams) {
        if (CREDENTIAL_QUERY_KEY.test(key)) {
            throw new PublicUrlError('url.invalid', '認証情報を示すQueryを含むURLは診断できません。', 422);
        }
    }
    if (host !== url.hostname)
        url.hostname = host;
    url.hash = '';
    return url;
}
/**
 * Whether an address that a public name resolved to is one a public fetch must not reach: loopback, private, link-local,
 * shared, multicast, reserved, documentation, the unspecified address, and IPv6 unique-local, link-local and the IPv4
 * forms embedded in IPv6 (mapped, NAT64 and 6to4) judged as IPv4. Anything that does not parse is treated as not public.
 */
export function isNonPublicAddress(value) {
    const address = value.trim().toLowerCase().replace(/^\[|\]$/g, '');
    const v4 = parseIpv4(address);
    if (v4)
        return nonPublicIpv4(v4);
    const v6 = parseIpv6(address);
    if (!v6)
        return true;
    const [a, b] = [v6[0], v6[1]];
    if (v6.every(part => part === 0))
        return true; // ::
    if (v6.slice(0, 7).every(part => part === 0) && v6[7] === 1)
        return true; // ::1
    // ::ffff:a.b.c.d (mapped), ::a.b.c.d (compatible), 64:ff9b::a.b.c.d (NAT64) carry an IPv4 address in the last 32 bits.
    const tail = [v6[6] >> 8, v6[6] & 0xff, v6[7] >> 8, v6[7] & 0xff];
    if (v6.slice(0, 5).every(part => part === 0) && (v6[5] === 0xffff || v6[5] === 0))
        return nonPublicIpv4(tail);
    if (a === 0x64 && b === 0xff9b)
        return nonPublicIpv4(tail);
    if (a === 0x2002)
        return nonPublicIpv4([b >> 8, b & 0xff, v6[2] >> 8, v6[2] & 0xff]); // 6to4
    if ((a & 0xfe00) === 0xfc00)
        return true; // fc00::/7 unique local
    if ((a & 0xffc0) === 0xfe80)
        return true; // fe80::/10 link local
    if ((a & 0xffc0) === 0xfec0)
        return true; // fec0::/10 site local (deprecated)
    if ((a & 0xff00) === 0xff00)
        return true; // multicast
    if (a === 0x2001 && b === 0x0db8)
        return true; // documentation
    if (a === 0x2001 && b < 0x0200)
        return true; // 2001::/23 IETF protocol assignments (Teredo and others)
    if (a === 0x0100 && v6[1] === 0 && v6[2] === 0 && v6[3] === 0)
        return true; // 100::/64 discard
    return (a & 0xe000) !== 0x2000; // only 2000::/3 is global unicast
}
function parseIpv4(value) {
    const parts = value.split('.');
    if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255))
        return null;
    return parts.map(Number);
}
function nonPublicIpv4([a, b, c]) {
    return a === 0 || a === 10 || a === 127 || a >= 224
        || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || (a === 192 && b === 0 && (c === 0 || c === 2))
        || (a === 192 && b === 88 && c === 99)
        || (a === 198 && (b === 18 || b === 19))
        || (a === 198 && b === 51 && c === 100)
        || (a === 203 && b === 0 && c === 113);
}
function parseIpv6(value) {
    if (!/^[0-9a-f:.]+$/.test(value) || !value.includes(':'))
        return null;
    let text = value;
    const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
    if (dotted) {
        const v4 = parseIpv4(dotted[1]);
        if (!v4)
            return null;
        text = `${text.slice(0, -dotted[1].length)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
    }
    const halves = text.split('::');
    if (halves.length > 2)
        return null;
    const read = (part) => part === '' ? [] : part.split(':');
    const head = read(halves[0]), tail = halves.length === 2 ? read(halves[1]) : [];
    if ([...head, ...tail].some(group => !/^[0-9a-f]{1,4}$/.test(group)))
        return null;
    const missing = 8 - head.length - tail.length;
    if (halves.length === 1 ? missing !== 0 : missing < 1)
        return null;
    return [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail].map(group => parseInt(group, 16));
}
