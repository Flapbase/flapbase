import { readFileSync } from 'node:fs'
export const good = readFileSync(new URL('../examples/cosmetics/index.html', import.meta.url), 'utf8')
export const url = 'https://example.com/cosmetics/'
export const now = new Date('2026-11-07T00:00:00.000Z')
export const coverage = { html: true, robots: true, sitemap: true, languageProfiles: true }
export function fetched(html = good, overrides = {}) {
  return { requestedUrl: url, robots: { status: 200, text: 'User-agent: *\nAllow: /' }, blockedByRobots: false,
    page: { url, status: 200, html, server: null, mitigated: false, redirected: false },
    checks: [], sitemap: { found: true }, llmsTxt: null, ...overrides }
}
export function scenarios() {
  return [
    ['cosmetics', fetched()],
    ['metadata', fetched(good.replace(/<title>[\s\S]*?<\/title>/u, '<title>短い</title>').replace(/<meta name="description"[^>]*>/u, ''))],
    ['empty-mount', fetched('<!doctype html><html lang="ja"><body><div id="root"></div><script src="/app.js"></script></body></html>')],
    ['bad-jsonld', fetched(good.replace('"@context"', 'broken'))],
    ['noindex', fetched(good.replace('</head>', '<meta name="robots" content="noindex"></head>'))],
    ['no-organization', fetched(good.replace('HealthAndBeautyBusiness', 'WebSite'))],
    ['search-blocked', fetched(good, { robots: { status: 200, text: 'User-agent: OAI-SearchBot\nDisallow: /\nUser-agent: GPTBot\nDisallow: /' } })],
    ['all-blocked', fetched(good, { robots: { status: 200, text: 'User-agent: *\nDisallow: /' }, page: null, blockedByRobots: true })],
    ['bot-challenge', fetched(good, { page: { url, status: 403, html: null, server: 'cloudflare', mitigated: true, redirected: false } })],
    ['sitemap-missing', fetched(good, { sitemap: { found: false } })],
    ['language-redirect', fetched(good.replace('lang="ja"', 'lang="en"').replace('</head>', `<link rel="alternate" hreflang="ja" href="${url}"></head>`),
      { page: { url: 'https://example.com/en/', status: 200, html: good.replace('lang="ja"', 'lang="en"').replace('</head>', `<link rel="alternate" hreflang="ja" href="${url}"></head>`), server: null, mitigated: false, redirected: true } })],
  ]
}
export function robotsCases() {
  const patterns = ['/', '/shop', '/shop*', '/*.pdf$', '/a*b*c$', '/.*[x]', '/abc$', '/*', '/*a*ab$']
  const paths = ['', '/', '/shop', '/shop/item', '/travel.pdf', '/travel.pdf?view=1', '/abc', '/a😀bc', '/.*[x]']
  return patterns.flatMap(pattern => paths.map(path => ({ pattern, path })))
}
