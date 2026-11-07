export const INITIAL_HTML_MIN_TEXT = 200;
export const INITIAL_HTML_SCRIPT_RATIO = 0.5;
export const INITIAL_HTML_MESSAGE = '初めの HTML に読める文がほとんどありません。検索や AI がそのまま読めず、反映が遅れることがあります。静的な HTML か、サーバー側で描く形にすると、毎回すべて読まれます。';
const MOUNT = /<(div|main|section|body)\b[^>]*\sid\s*=\s*["']?(root|app|__next|__nuxt|app-root|svelte|react-root|q-app)["']?[^>]*>((?:\s|<!--[\s\S]*?-->)*)<\/\1\s*>/giu;
const byteLength = (value) => new TextEncoder().encode(value).length;
export function readInitialHtml(html, base) {
    const total = Math.max(1, byteLength(html));
    let inlineBytes = 0, inlineScripts = 0, externalScripts = 0;
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)) {
        const attrs = match[1] ?? '';
        if (/\ssrc\s*=/iu.test(` ${attrs}`)) {
            externalScripts += 1;
            continue;
        }
        inlineScripts += 1;
        if (/\stype\s*=\s*["']?(?:application\/(?:ld\+)?json|importmap|speculationrules)/iu.test(` ${attrs}`))
            continue;
        inlineBytes += byteLength(match[2] ?? '');
    }
    const withoutHidden = html
        .replace(/<!--[\s\S]*?-->/gu, ' ')
        .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/giu, ' ');
    const head = /<head\b[\s\S]*?<\/head\s*>/iu;
    const body = /<body\b[^>]*>([\s\S]*)/iu.exec(withoutHidden.replace(head, ' '))?.[1] ?? withoutHidden.replace(head, ' ');
    const visible = body.replace(/<[^>]*>/gu, ' ').replace(/&nbsp;|&#160;/giu, ' ').replace(/&[a-z0-9#]+;/giu, 'x').replace(/\s+/gu, ' ').trim();
    let origin = null;
    try {
        origin = base ? new URL(base).origin : null;
    }
    catch {
        origin = null;
    }
    let internalLinks = 0;
    for (const match of withoutHidden.matchAll(/<a\b[^>]*\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/giu)) {
        const href = (match[1] ?? match[2] ?? match[3] ?? '').trim();
        if (!href || href.startsWith('#') || /^(?:mailto:|tel:|javascript:)/iu.test(href))
            continue;
        if (/^[a-z][a-z0-9+.-]*:|^\/\//iu.test(href)) {
            if (origin && href.startsWith(`${origin}/`))
                internalLinks += 1;
            continue;
        }
        internalLinks += 1;
    }
    MOUNT.lastIndex = 0;
    return {
        visibleTextLength: [...visible].length, inlineScripts, externalScripts,
        inlineScriptRatio: inlineBytes / total,
        emptyMount: MOUNT.test(withoutHidden.replace(head, ' ')),
        hasH1: /<h1\b[^>]*>(?:(?!<\/h1)[\s\S])*?[^\s<][\s\S]*?<\/h1\s*>/iu.test(withoutHidden),
        internalLinks,
    };
}
export function inspectInitialHtml(html, base) {
    const reading = readInitialHtml(html, base);
    const thin = reading.visibleTextLength < INITIAL_HTML_MIN_TEXT;
    const scripted = reading.inlineScripts + reading.externalScripts > 0;
    const hollow = reading.emptyMount || reading.inlineScriptRatio >= INITIAL_HTML_SCRIPT_RATIO || (scripted && !reading.hasH1 && reading.internalLinks === 0);
    const pass = !(thin && hollow);
    return { pass, reading, message: pass ? '' : INITIAL_HTML_MESSAGE };
}
