import { parseRobotsTxt, robotsAllows, robotsNamesAgent, } from './robots.js';
export const PUBLIC_DIAGNOSIS_VERSION = 'flapbase.public-diagnosis/v1';
export const DIAGNOSIS_FETCH_AGENT = 'Flapbase-Site-Diagnosis';
export const DIAGNOSIS_STAGES = ['read', 'tell', 'connect'];
export const DIAGNOSIS_STAGE_LABEL = { read: '読める', tell: '伝わる', connect: 'つながる' };
export const DIAGNOSIS_PART_LABEL = { site: 'サイト診断', ai: '事業の AI 可視性' };
export const CRAWLERS_VERSION = '2026-11-07';
export const DIAGNOSIS_CRAWLERS = Object.freeze([
    { name: 'Googlebot', owner: 'Google', kind: 'search' },
    { name: 'Bingbot', owner: 'Microsoft', kind: 'search' },
    { name: 'OAI-SearchBot', owner: 'OpenAI', kind: 'search' },
    { name: 'Claude-SearchBot', owner: 'Anthropic', kind: 'search' },
    { name: 'PerplexityBot', owner: 'Perplexity', kind: 'search' },
    { name: 'ChatGPT-User', owner: 'OpenAI', kind: 'user' },
    { name: 'Claude-User', owner: 'Anthropic', kind: 'user' },
    { name: 'Perplexity-User', owner: 'Perplexity', kind: 'user' },
    { name: 'GPTBot', owner: 'OpenAI', kind: 'training' },
    { name: 'ClaudeBot', owner: 'Anthropic', kind: 'training' },
    { name: 'Google-Extended', owner: 'Google', kind: 'training' },
]);
const ISSUE_ORDER = [
    'page-blocked', 'robots-blocks-us', 'noindex', 'robots-disallow-all', 'search-crawlers-blocked', 'language-redirect', 'initial-html',
    'page-basics', 'page-technical', 'jsonld-unreadable', 'sitemap-missing',
];
const ISSUE_TEXT = {
    'page-blocked': { stage: 'read', part: 'ai', ai: true, title: '自動で読む相手を、bot 対策で止めています', why: 'こちらからの読み取りが止められました。検索や AI のクローラーも同じように止められている見込みがあります。', fix: 'bot 対策・WAF の設定で、検索と AI の検索のクローラーを止めていないかを確かめます。' },
    'robots-blocks-us': { stage: 'read', part: 'site', ai: false, title: 'robots.txt で、このページを読めないように指定しています', why: 'robots.txt が、自動で読む相手にこのページを読まないよう求めているため、中身を診断していません。', fix: '検索に出したいページなら、robots.txt の Disallow を外します。' },
    noindex: { stage: 'read', part: 'site', ai: false, title: '検索から外す指示（noindex）が入っています', why: 'このページは検索結果に出ません。', fix: '検索に出したいページから noindex を外します。' },
    'robots-disallow-all': { stage: 'read', part: 'site', ai: false, title: 'robots.txt で、サイト全体を締め出しています', why: 'どの検索のクローラーにも、サイト全体を読まないよう求めています。', fix: 'robots.txt の「Disallow: /」を外し、見せたくない所だけを指定します。' },
    'search-crawlers-blocked': { stage: 'read', part: 'ai', ai: true, title: 'AI の検索のクローラーを、robots.txt で止めています', why: '', fix: '止めている名前の組から Disallow を外します。学習用のクローラー（GPTBot・ClaudeBot など）は、止めたままにできます。' },
    'language-redirect': { stage: 'read', part: 'ai', ai: true, title: '言語を指定しない読み手を、別の言語のページへ転送しています', why: '', fix: '言語の指定がないときは転送せず、もとのページを返します。別の言語へは、読み手が言語を指定したときだけ転送します。' },
    'initial-html': { stage: 'read', part: 'ai', ai: true, title: '初めの HTML に、ページの文がほとんどありません', why: 'ブラウザで描く作りのため、検索や AI が最初に読む HTML に文がありません。', fix: '静的な HTML にするか、サーバー側で描いて、文を HTML に入れます。' },
    'page-basics': { stage: 'read', part: 'site', ai: false, title: '', why: '', fix: '' },
    'page-technical': { stage: 'read', part: 'site', ai: false, title: '', why: '', fix: '' },
    'jsonld-unreadable': { stage: 'read', part: 'ai', ai: true, title: '構造化データが読めません', why: 'JSON-LD の書き方に誤りがあり、検索エンジンや AI が読み取れません。', fix: 'JSON として正しい形に直します。' },
    'sitemap-missing': { stage: 'read', part: 'site', ai: false, title: 'sitemap.xml が見つかりません', why: '検索のクローラーが、サイトのページの一覧を受け取れません。', fix: 'sitemap.xml を置き、robots.txt に Sitemap の行を書きます。' },
};
const BASIC_LABEL = { title: 'ページの題', description: 'ページの説明', h1: 'いちばん大きな見出し', canonical: '正規の URL' };
const TECH_LABEL = { html: 'ページの言語', charset: '文字コード', doctype: '文書の種類の宣言', viewport: 'スマホの表示' };
// ---------------------------------------------------------------------------
// HTML から決まりで読むもの
// ---------------------------------------------------------------------------
const noComments = (html) => html.replace(/<!--[\s\S]*?-->/gu, ' ');
const decode = (value) => value.replace(/&nbsp;|&#160;/giu, ' ').replace(/&amp;/giu, '&').replace(/&lt;/giu, '<').replace(/&gt;/giu, '>').replace(/&quot;/giu, '"').replace(/&#0*39;|&apos;/giu, "'");
const textOf = (value) => decode(value.replace(/<[^>]*>/gu, ' ')).replace(/\s+/gu, ' ').trim();
const attr = (tag, name) => {
    const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'iu').exec(tag);
    return match ? decode(match[1] ?? match[2] ?? match[3] ?? '').trim() : null;
};
export function anchorsOf(html) {
    const out = [];
    for (const match of noComments(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/giu)) {
        const href = attr(match[1] ?? '', 'href');
        if (href)
            out.push({ href, text: textOf(`${match[2] ?? ''} ${attr(match[1] ?? '', 'aria-label') ?? ''}`) });
        if (out.length >= 500)
            break;
    }
    return out;
}
const ORG_TYPE = /^(?:Organization|Corporation|LocalBusiness|Store|OnlineStore|Restaurant|HealthAndBeautyBusiness|BeautySalon|ClothingStore|TravelAgency|LodgingBusiness|Hotel|ProfessionalService|NGO|EducationalOrganization)$/u;
export function organizationNames(html) {
    const names = new Set();
    let found = false;
    const visit = (node, depth) => {
        if (depth > 6 || !node || typeof node !== 'object')
            return;
        if (Array.isArray(node)) {
            for (const item of node.slice(0, 50))
                visit(item, depth + 1);
            return;
        }
        const record = node;
        const types = (Array.isArray(record['@type']) ? record['@type'] : [record['@type']]).filter((item) => typeof item === 'string');
        if (types.some(type => ORG_TYPE.test(type))) {
            found = true;
            if (typeof record.name === 'string' && record.name.trim() && record.name.length <= 120)
                names.add(record.name.trim());
        }
        for (const [key, value] of Object.entries(record))
            if (key !== '@type' && value && typeof value === 'object')
                visit(value, depth + 1);
    };
    for (const match of noComments(html).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)) {
        if (!/\stype\s*=\s*["']?application\/ld\+json/iu.test(` ${match[1] ?? ''}`))
            continue;
        try {
            visit(JSON.parse(match[2] ?? ''), 0);
        }
        catch { /* 読めない塊は jsonld の点検が数える */ }
    }
    return { found, names: [...names] };
}
function htmlLang(html) {
    const tag = /<html\b[^>]*>/iu.exec(html)?.[0];
    return tag ? attr(tag, 'lang')?.toLowerCase() ?? null : null;
}
export function redirectedAwayFromLanguage(html, requestedUrl) {
    const requested = normalizedUrl(requestedUrl);
    if (!requested)
        return null;
    const lang = htmlLang(html);
    for (const match of noComments(html).matchAll(/<link\b[^>]*>/giu)) {
        const tag = match[0];
        if (attr(tag, 'rel')?.toLowerCase() !== 'alternate')
            continue;
        const hreflang = attr(tag, 'hreflang')?.toLowerCase(), href = attr(tag, 'href');
        if (!hreflang || !href || normalizedUrl(href, requestedUrl) !== requested)
            continue;
        if (hreflang === 'x-default' || !lang || !lang.startsWith(hreflang.split('-')[0]))
            return { from: hreflang, to: lang };
    }
    return null;
}
function normalizedUrl(value, base) {
    try {
        const url = new URL(value, base);
        url.hash = '';
        return `${url.origin}${url.pathname.replace(/\/+$/u, '') || '/'}${url.search}`;
    }
    catch {
        return null;
    }
}
const LANGUAGE_NAME = { ja: '日本語', en: '英語', zh: '中国語', ko: '韓国語', fr: 'フランス語', de: 'ドイツ語', es: 'スペイン語' };
const languageName = (lang) => (lang && LANGUAGE_NAME[lang.split('-')[0]]) ?? '別の言語';
const disallowsAll = (robots) => !robotsAllows(robots, '*', '/') && robots.groups.some(group => group.agents.includes('*'));
// ---------------------------------------------------------------------------
// 診断（決まった処理だけ）
// ---------------------------------------------------------------------------
export function runPublicDiagnosis(fetched, now = new Date()) {
    const issues = new Map();
    const rows = [];
    const add = (key, override = {}) => issues.set(key, { key, ...ISSUE_TEXT[key], ...override });
    const row = (key, stage, part, label, value, tone) => rows.push({ key, stage, part, label, value, tone });
    const robots = fetched.robots && fetched.robots.status >= 200 && fetched.robots.status < 300 ? parseRobotsTxt(fetched.robots.text) : null;
    const path = (() => { try {
        const url = new URL(fetched.requestedUrl);
        return `${url.pathname}${url.search}`;
    }
    catch {
        return '/';
    } })();
    const page = fetched.page, html = page?.html ?? null;
    // --- 読める（サイト診断） ---
    if (fetched.blockedByRobots) {
        add('robots-blocks-us');
        row('page', 'read', 'site', 'このページ', 'robots.txt で止めている', 'bad');
    }
    if (robots && disallowsAll(robots))
        add('robots-disallow-all');
    row('robots', 'read', 'site', 'robots.txt', !fetched.robots ? '読めなかった' : robots ? (disallowsAll(robots) ? 'サイト全体を締め出している' : '全体を許している') : 'ない（すべて許す）', robots && disallowsAll(robots) ? 'bad' : fetched.robots ? 'ok' : 'na');
    const check = (key) => fetched.checks.find(item => item.key === key);
    if (html) {
        if (check('robots') && !check('robots').pass)
            add('noindex');
        row('noindex', 'read', 'site', '検索から外す指示', check('robots')?.pass === false ? 'ある' : 'なし', check('robots')?.pass === false ? 'bad' : 'ok');
        const failedBasics = Object.keys(BASIC_LABEL).filter(key => check(key)?.pass === false);
        if (failedBasics.length)
            add('page-basics', { title: `${failedBasics.map(key => BASIC_LABEL[key]).join('・')}を直すとよい`, why: '検索結果や共有のときに、ページの内容が正しく伝わりにくくなります。', fix: '題は8〜70文字、説明は30〜160文字ほどで1つずつ、いちばん大きな見出しは1つ、正規の URL はそのページ自身を書きます。' });
        row('basics', 'read', 'site', '題・説明・見出し', failedBasics.length ? `${failedBasics.map(key => BASIC_LABEL[key]).join('・')}を直す` : 'そろっている', failedBasics.length ? 'mid' : 'ok');
        const failedTech = Object.keys(TECH_LABEL).filter(key => check(key)?.pass === false);
        if (failedTech.length)
            add('page-technical', { title: `${failedTech.map(key => TECH_LABEL[key]).join('・')}の設定がありません`, why: 'ブラウザや検索エンジンが、ページを正しく読み取れないことがあります。', fix: '<!doctype html>、html の lang、charset、viewport の width=device-width を、ページの先頭に書きます。' });
        row('technical', 'read', 'site', '言語・文字コード・スマホの表示', failedTech.length ? `${failedTech.map(key => TECH_LABEL[key]).join('・')}がない` : 'そろっている', failedTech.length ? 'mid' : 'ok');
    }
    if (fetched.sitemap) {
        if (!fetched.sitemap.found)
            add('sitemap-missing');
        row('sitemap', 'read', 'site', 'sitemap.xml', fetched.sitemap.found ? 'ある' : 'ない', fetched.sitemap.found ? 'ok' : 'mid');
    }
    // --- 読める（事業の AI 可視性） ---
    if (page && !html && (page.mitigated || page.status === 403 || page.status === 429 || page.status === 503)) {
        add('page-blocked');
        row('reader', 'read', 'ai', 'こちらからの読み取り', 'bot 対策で止められた', 'bad');
    }
    else if (html)
        row('reader', 'read', 'ai', 'こちらからの読み取り', '止められなかった', 'ok');
    if (robots) {
        const blocked = (kinds) => DIAGNOSIS_CRAWLERS.filter(item => (kinds).includes(item.kind) && !robotsAllows(robots, item.name, path));
        const search = blocked(['search', 'user']), training = blocked(['training']);
        // サイト全体の締め出しは、上の robots-disallow-all で出す。名前を挙げて止めているときだけ、AI の検索の問題にする。
        const named = search.filter(item => robotsNamesAgent(robots, item.name));
        if (named.length)
            add('search-crawlers-blocked', { why: `${named.map(item => item.name).join('・')} を締め出しているので、AI の検索や答えを作るときに、このサイトの中身が読まれません。` });
        row('search-crawlers', 'read', 'ai', '検索用のクローラー', search.length ? (search.length === DIAGNOSIS_CRAWLERS.filter(item => item.kind !== 'training').length ? 'すべて止めている' : '一部を止めている') : '止めていない', search.length ? 'bad' : 'ok');
        row('training-crawlers', 'read', 'ai', '学習用のクローラー', training.length ? '学習には使わせない設定' : '止めていない', training.length ? 'na' : 'ok');
    }
    else {
        row('search-crawlers', 'read', 'ai', '検索用のクローラー', '止めていない', 'ok');
    }
    if (html && page) {
        const away = page.redirected ? redirectedAwayFromLanguage(html, fetched.requestedUrl) : null;
        if (away) {
            add('language-redirect', { why: `言語を指定しない読み手には、${languageName(away.to)}のページが返ります。AI のクローラーの多くは言語を指定しないので、もとのページではなく${languageName(away.to)}のページを読んでいる見込みが高いです。` });
            row('language', 'read', 'ai', '読む相手で中身が変わらないか', `${languageName(away.to)}のページへ転送`, 'bad');
        }
        else
            row('language', 'read', 'ai', '読む相手で中身が変わらないか', '変わらない', 'ok');
        const initial = check('initial-html');
        if (initial?.pass === false)
            add('initial-html');
        row('initial-html', 'read', 'ai', '初めの HTML の中身', initial?.pass === false ? '文がほとんどない' : '文がある', initial?.pass === false ? 'bad' : 'ok');
        const jsonld = check('jsonld');
        if (jsonld?.pass === false && /application\/ld\+json/iu.test(html))
            add('jsonld-unreadable');
    }
    if (page?.server && /cloudflare/iu.test(page.server))
        row('cloudflare', 'read', 'ai', 'Cloudflare', '管理画面で AI のクローラーを止める設定も確かめる', 'na');
    const stageIndex = (stage) => DIAGNOSIS_STAGES.indexOf(stage);
    const ordered = [...issues.values()].sort((a, b) => stageIndex(a.stage) - stageIndex(b.stage) || ISSUE_ORDER.indexOf(a.key) - ISSUE_ORDER.indexOf(b.key));
    return { version: PUBLIC_DIAGNOSIS_VERSION, url: page?.url ?? fetched.requestedUrl, checkedAt: now.toISOString(), issues: ordered, rows, };
}
export function sitemapLocation(robots, origin) {
    for (const value of robots?.sitemaps ?? []) {
        try {
            const url = new URL(value);
            if (url.origin === origin)
                return url.href;
        }
        catch { /* 次へ */ }
    }
    return `${origin}/sitemap.xml`;
}
export { parseRobotsTxt, robotsAllows };
