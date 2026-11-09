import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectChecks, WEBSITE_SEO_RULES } from '../packages/site-check/src/index.js'
import { inspectInitialHtml } from '../packages/site-check/src/initial-html.js'
import { good, url } from './helpers.js'

const bad = {
  doctype: good.replace('<!doctype html>', ''),
  html: good.replace('lang="ja"', ''),
  charset: good.replace('<meta charset="utf-8">', ''),
  viewport: good.replace('width=device-width', 'width=900'),
  title: good.replace(/<title>[\s\S]*?<\/title>/u, '<title></title>'),
  description: good.replace(/<meta name="description"[^>]*>/u, ''),
  canonical: good.replace(url, 'https://other.example.org/'),
  h1: good.replace(/<h1>[\s\S]*?<\/h1>/u, ''),
  jsonld: good.replace('"@context"', 'broken'),
  'initial-html': '<!doctype html><html lang="ja"><body><div id="root"></div><script src="/app.js"></script></body></html>',
  robots: good.replace('</head>', '<meta name="robots" content="noindex"></head>'),
}
for (const rule of WEBSITE_SEO_RULES) {
  const key = rule.semanticRef.slice('website.seo.'.length)
  test(`${key}: 正しい例を通す`, () => assert.equal(inspectChecks(good, url).find(check => check.key === key).pass, true))
  test(`${key}: 問題のある例を見つける`, () => {
    const result = inspectChecks(bad[key], url).find(check => check.key === key)
    assert.equal(result.pass, false)
    assert.ok(result.findings.length > 0)
    assert.equal(result.ruleRef, rule.ruleRef)
  })
}
for (const [key, html, code] of [
  ['title', good.replace('</head>', '<title>別のタイトルです</title></head>'), 'title.count'],
  ['title', good.replace(/<title>[\s\S]*?<\/title>/u, '<title>短い</title>'), 'title.length'],
  ['description', good.replace(/name="description" content="[^"]*"/u, 'name="description" content="短い"'), 'description.length'],
  ['jsonld', good.replace(/<script[\s\S]*?<\/script>/u, '<script type="application/ld+json">null</script>'), 'jsonld.shape'],
  ['canonical', good.replace(url, '/cosmetics/'), 'canonical.invalid'],
]) test(`境界と形式: ${code}`, () => assert.ok(inspectChecks(html, url).find(check => check.key === key).findings.some(issue => issue.code === code)))

test('本文をサーバーで描いたページは script が多くても通す', () => {
  assert.equal(inspectInitialHtml(`<body><p>${'旅の紹介'.repeat(60)}</p><script>${'x'.repeat(3000)}</script></body>`).pass, true)
})
test('script がない短い静的 HTML は Cloud と同じく通す', () => assert.equal(inspectInitialHtml('<body><h1>旅</h1></body>').pass, true))
test('script・style・コメントを本文として数えない', () => {
  const result = inspectInitialHtml(`<body><div id="app"></div><!-- ${'旅'.repeat(400)} --><style>${'x'.repeat(300)}</style><script>${'x'.repeat(1000)}</script></body>`)
  assert.equal(result.pass, false)
  assert.equal(result.reading.visibleTextLength, 0)
})
