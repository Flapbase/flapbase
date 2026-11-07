import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, mkdir, rm, symlink, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { inspectPublication, groupFindings, compareValues, parseFacts, finding } from '../packages/site-check/src/publication.js'
import { checkBusinessLinks } from '../packages/site-check/src/links.js'
import { check, compareBaseline, formatReport } from '../packages/site-check/src/index.js'
import { checkUrl } from '../packages/site-check/src/input.js'
import { readHtml } from '../packages/site-check/src/html.js'
import { scanRelease } from '../scripts/check-release.mjs'
import { good, now } from './helpers.js'

const url = 'https://example.com/'
const inspect = (body, facts) => inspectPublication(`<!doctype html><html><body>${body}</body></html>`, url, facts)
async function folder(t) {
  const dir = await mkdtemp(join(tmpdir(), 'flap-publication-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}
for (const [key, pass, fail] of [
  ['price', '<h2>料金</h2><p>12,000円</p>', '<script>const price="12,000円"</script>'],
  ['area', '<h2>対応地域</h2><p>東京都港区</p>', '<template><p>対応地域: 東京都</p></template>'],
  ['booking', '<a href="/book">予約する</a>', '<p hidden>予約方法: 電話</p>'],
]) test(`${key}: 初めの HTML の事実の正しい例と欠けた例`, () => {
  const result = inspect(pass, [key])
  assert.equal(result.facts[0].found, true)
  assert.ok(result.facts[0].evidence[0].line > 0)
  assert.equal(inspect(fail, [key]).facts[0].found, false)
  assert.equal(inspect(fail, [key]).findings[0].code, `fact.${key}.missing`)
})
for (const [key, json] of [
  ['price', { '@type': 'Offer', price: 12000, priceCurrency: 'JPY' }],
  ['area', { areaServed: [{ '@type': 'Place', name: '東京都港区' }] }],
  ['booking', { '@type': 'ReserveAction', target: 'https://example.com/book' }],
]) test(`${key}: JSON-LD の事実を読む`, () => {
  const result = inspect(`<script type="application/ld+json">${JSON.stringify(json)}</script>`, [key])
  assert.equal(result.facts[0].found, true)
  assert.equal(result.facts[0].evidence[0].source, 'jsonld')
  assert.equal(inspect('<script type="application/ld+json">invalid</script>', [key]).facts[0].found, false)
})
test('任意の facts を選択し、未知の指定を拒否する', () => {
  assert.deepEqual(parseFacts('price, booking,price'), ['price', 'booking'])
  for (const value of ['', 'other', 'price,']) assert.throws(() => parseFacts(value))
  assert.deepEqual(inspect('<p>12,000円</p>', ['price']).facts.map(item => item.key), ['price'])
})
test('コメント、style、hidden、aria-hidden の本文を事実として読まない', () => {
  const result = inspect('<!-- <p>12,000円</p> --><style>.x{content:"12,000円"}</style><p style="display:none">12,000円</p><div aria-hidden="true"><p>12,000円</p></div>', ['price'])
  assert.equal(result.facts[0].found, false)
})
test('属性内の > と文字参照、行番号、base を読む', () => {
  const publication = inspectPublication('<html>\n<head><base href="https://example.com/travel/"></head>\n<body><a aria-label="予約 > 申し込み" href="book?a=1&amp;b=2">予約</a><p>料金: &#165;12,000</p></body></html>', url)
  assert.equal(publication.links[0].line, 3)
  assert.equal(publication.links[0].destination, 'https://example.com/travel/book?a=1&b=2')
  assert.equal(publication.facts[0].found, true)
})
test('深すぎる HTML を上限で止める', () => {
  assert.throws(() => readHtml('<div>'.repeat(129)), { code: 'file.html-complex' })
})
for (const [field, a, b, c] of [
  ['price', '<p>料金: 12,000円</p>', '<p>Price: ¥12000</p>', '<p>Price: ¥13500</p>'],
  ['days', '<p>営業日: 月〜金</p>', '<p>Opening days: Monday-Friday</p>', '<p>営業日: 土日</p>'],
  ['address', '<p>住所: 東京都港区海岸1-2-3</p>', '<p>Address: 東京都 港区 海岸1-2-3</p>', '<p>住所: 東京都港区海岸9-9-9</p>'],
  ['phone', '<p>電話: 03-1234-5678</p>', '<p>Phone: +81 3-1234-5678</p>', '<p>電話: 03-9876-5432</p>'],
]) test(`${field}: 頁・言語で一致する例と食い違う例`, () => {
  const first = inspectPublication(a, url)
  assert.equal(compareValues([first, inspectPublication(b, url + 'en/')]).length, 0)
  const mismatch = compareValues([first, inspectPublication(c, url + 'en/')])
  assert.equal(mismatch.length, 1)
  assert.equal(mismatch[0].code, `consistency.${field}`)
  assert.equal(mismatch[0].evidence.length, 2)
})
for (const [field, html, object, different] of [
  ['price', '<p>料金: 12,000円</p>', { price: 12000, priceCurrency: 'JPY' }, { price: 13000, priceCurrency: 'JPY' }],
  ['days', '<p>営業日: 月〜金</p>', { openingHours: 'Mo-Fr 09:00-18:00' }, { dayOfWeek: ['Saturday', 'Sunday'] }],
  ['address', '<p>住所: 東京都港区海岸1-2-3</p>', { address: { addressRegion: '東京都', addressLocality: '港区', streetAddress: '海岸1-2-3' } }, { address: '東京都港区海岸9-9-9' }],
  ['phone', '<p>電話: 03-1234-5678</p>', { telephone: '03-1234-5678' }, { telephone: '03-9876-5432' }],
]) test(`${field}: 画面と構造化データを両方並べる`, () => {
  const sample = data => inspect(`${html}<script type="application/ld+json">${JSON.stringify(data)}</script>`)
  assert.equal(compareValues([sample(object)]).length, 0)
  const result = compareValues([sample(different)])
  assert.equal(result[0].code, `consistency.${field}`)
  assert.deepEqual(result[0].evidence.map(item => item.source), ['html', 'jsonld'])
})
test('別の商品名が明示された料金は食い違いにしない', () => {
  const a = inspect('<p data-fact="price" data-subject="化粧水">2,000円</p>')
  const b = inspect('<p data-fact="price" data-subject="乳液">3,000円</p>')
  assert.equal(compareValues([a, b]).length, 0)
})
for (const [name, good, bad] of [
  ['script', '<script src="https://cdn.example.com/a.js"></script>', '<script src="http://cdn.example.com/a.js"></script>'],
  ['image', '<img src="/a.png">', '<img srcset="https://example.com/a.png 1x, http://example.com/b.png 2x">'],
  ['stylesheet', '<link rel="stylesheet" href="/a.css">', '<link rel="stylesheet" href="http://cdn.example.com/a.css">'],
  ['inline CSS', '<p style="background:url(https://example.com/a.png)">旅</p>', '<style>@import "http://example.com/a.css";</style>'],
]) test(`HTTP 資源 ${name}: 安全な例と事故の例`, () => {
  assert.equal(inspect(good).findings.some(item => item.code === 'publication.mixed-content'), false)
  assert.equal(inspect(bad).findings.some(item => item.code === 'publication.mixed-content'), true)
})
test('スマホと desktop のリンク、フォーム、formaction、行を拾う', async t => {
  const root = await folder(t)
  await writeFile(join(root, 'booking.html'), '<p id="book">旅の予約</p>')
  const publication = inspect('<nav class="desktop"><a href="booking.html#book">予約する</a></nav>\n<nav class="mobile"><a href="old.html">お問い合わせ</a></nav><form action="booking.html"><button formaction="old.html">購入する</button></form>')
  await checkBusinessLinks([publication], { root, siteUrl: url })
  assert.deepEqual(publication.links.map(link => link.status), ['ok', 'broken', 'ok', 'broken'])
  assert.equal(publication.links[1].line, 2)
  assert.equal(publication.links[0].localPath, 'booking.html')
  assert.equal(groupFindings(publication.findings.filter(item => item.code === 'business-link.broken')).length, 1)
})
test('ローカルの相対先・directory index・存在しない fragment・外部・symlink を確かめる', async t => {
  const root = await folder(t)
  await mkdir(join(root, 'book'))
  await writeFile(join(root, 'book/index.html'), '<p id="here">予約</p>')
  await symlink('/etc/hosts', join(root, 'outside.html'))
  const publication = inspect('<a href="book/">予約</a><a href="book/#missing">予約</a><a href="outside.html">予約</a><a href="https://other.example.com/">予約</a><a href="mailto:hello@example.com">お問い合わせ</a><button>購入</button>')
  await checkBusinessLinks([publication], { root, siteUrl: url })
  assert.deepEqual(publication.links.map(link => link.status), ['ok', 'broken', 'broken', 'unchecked', 'unchecked', 'broken'])
})
test('URL の最後の転送先と HTTP エラーを記録する', async () => {
  const publication = inspect('<a href="/book">予約</a><a href="/missing">問い合わせ</a><a href="/book">Book</a>')
  let calls = 0
  await checkBusinessLinks([publication], { read: async address => {
    calls++
    return { url: address.endsWith('/book') ? url + 'final' : address, status: address.endsWith('/missing') ? 404 : 200 }
  } })
  assert.equal(calls, 2)
  assert.equal(publication.links[0].finalUrl, url + 'final')
  assert.equal(publication.links[1].httpStatus, 404)
  assert.equal(publication.links[1].status, 'broken')
})
test('URL の転送に robots の確認を渡し、拒否・時間切れ・上限を記録する', async () => {
  const publication = inspect('<a href="/blocked">予約</a><a href="/timeout">予約</a><a href="/limit">予約</a>')
  const permission = () => {}
  await checkBusinessLinks([publication], { limit: 2, permission, read: async (address, options) => {
    assert.equal(options.beforeRequest, permission)
    throw Object.assign(new Error('stop'), { code: address.endsWith('blocked') ? 'url.ssrf-blocked' : 'url.timeout' })
  } })
  assert.deepEqual(publication.links.map(link => link.status), ['broken', 'unchecked', 'unchecked'])
  assert.equal(publication.links[2].reason, 'リンク点検の件数上限')
})
test('言語指定の応答どうしの料金を比較する', async () => {
  const read = async (address, options = {}) => {
    const target = new URL(address)
    return { url: address, status: 200, redirected: false, headers: { 'content-type': target.pathname === '/robots.txt' ? 'text/plain' : 'text/html' },
      text: target.pathname === '/robots.txt' ? 'User-agent: *\nAllow: /' : good.replace('</body>', `<p>料金: ${options.language === 'en' ? '13,000' : '12,000'}円</p></body>`) }
  }
  const result = await checkUrl(url, { read, now })
  const mismatch = result.findings.find(item => item.code === 'consistency.price')
  assert.ok(mismatch.evidence.some(item => item.profile === 'en'))
  assert.equal(result.publication.variants.length, 2)
})
test('.env・.git・鍵の名前と内容を検出し、値を出力しない', async t => {
  const root = await folder(t)
  await writeFile(join(root, 'index.html'), good)
  assert.equal((await check(root, { now })).findings.some(item => item.code.startsWith('publication.')), false)
  await writeFile(join(root, '.env.production'), 'PRIVATE_VALUE=fictional')
  await mkdir(join(root, '.git'))
  await writeFile(join(root, 'server.key'), 'fictional')
  const marker = '-----BEGIN ' + 'PRIVATE KEY-----'
  await writeFile(join(root, 'backup.txt'), marker + '\nfictional')
  const result = await check(root, { now })
  for (const code of ['publication.env', 'publication.git', 'publication.private-key']) assert.ok(result.findings.some(item => item.code === code))
  assert.equal(result.findings.find(item => item.code === 'publication.private-key').pageCount, 2)
  assert.equal(JSON.stringify(result).includes('PRIVATE_VALUE'), false)
  assert.equal(JSON.stringify(result).includes(marker), false)
})
test('同じ原因をまとめ、異なる原因は別の件にする', () => {
  const sample = (cause, page) => finding('sample', cause, '問題', '直す', [{ page, value: '問題' }])
  const result = groupFindings([sample('head', 'a.html'), sample('head', 'b.html'), sample('body', 'c.html')])
  assert.equal(result.length, 2)
  assert.equal(result.find(item => item.cause === 'head').pageCount, 2)
})
test('再点検で直った所・新しい所・継続を頁ごとに分ける', () => {
  const report = (a, b) => ({ version: 'flapbase.site-check/v1', source: { kind: 'file' }, findings: groupFindings([
    ...a.map(page => finding('a', 'cause', '問題a', '直す', [{ page }])),
    ...b.map(page => finding('b', 'other', '問題b', '直す', [{ page }])),
  ]) })
  const delta = compareBaseline(report(['b', 'c'], ['x']), report(['a', 'b'], []))
  assert.deepEqual(delta.fixed[0].pages, ['a'])
  assert.deepEqual(delta.continuing[0].pages, ['b'])
  assert.equal(delta.introduced.length, 2)
  assert.equal(compareBaseline(report(['a'], []), report([], [])).introduced.length, 1)
  assert.equal(compareBaseline(report([], []), report(['a'], [])).fixed.length, 1)
  assert.throws(() => compareBaseline(report([], []), { version: 'other' }))
})
test('壊した旅の例の全文を固定し、共通 noindex を1件にまとめる', async () => {
  const report = await check('examples/travel-broken', { now })
  const snapshot = await readFile(new URL('./fixtures/travel-broken-output.txt', import.meta.url), 'utf8')
  assert.equal(formatReport(report), snapshot)
  const noindex = report.findings.find(item => item.code === 'html.robots.noindex')
  assert.deepEqual(noindex.pages, ['en/index.html', 'index.html', 'rates.html'])
  assert.equal(noindex.pageCount, 3)
  assert.ok(noindex.evidence.every(item => item.line === 7))
  assert.equal(report.reports.find(item => item.pagePath === 'rates.html').publication.facts[0].found, false)
  const readme = await readFile('README.md', 'utf8')
  const excerpt = snapshot.split('\n').slice(0, 3).join('\n')
  assert.equal(readme.split(excerpt).length - 1, 2)
})
test('CLI の baseline と facts を実行し、JSON とテキストの差分を確かめる', async t => {
  const root = await folder(t)
  await cp('examples/travel-broken', join(root, 'site'), { recursive: true })
  const run = (...args) => spawnSync(process.execPath, ['bin/flap.js', 'check', join(root, 'site'), ...args], { encoding: 'utf8' })
  const initial = run('--json', '--facts', 'price')
  assert.equal(initial.status, 0, initial.stdout)
  const baseline = join(root, 'before.json')
  await writeFile(baseline, initial.stdout)
  await rm(join(root, 'site/.env'))
  await writeFile(join(root, 'site/old-contact.html'), good)
  const result = run('--baseline', baseline, '--facts', 'price', '--json')
  assert.equal(result.status, 0, result.stdout)
  const delta = JSON.parse(result.stdout).difference
  assert.ok(delta.fixed.some(item => item.code === 'publication.env'))
  assert.ok(delta.fixed.some(item => item.code === 'business-link.broken'))
  assert.ok(delta.continuing.length)
  assert.match(run('--baseline', baseline, '--facts', 'price').stdout, /直った所:/u)
  assert.equal(run('--baseline', baseline, '--facts', 'area', '--json').status, 1)
  assert.equal(run('--baseline', '--json').status, 1)
})
test('固定の .env だけを公開検査の例として許可する', async t => {
  const root = await folder(t)
  await mkdir(join(root, 'examples/travel-broken'), { recursive: true })
  const path = join(root, 'examples/travel-broken/.env')
  await writeFile(path, 'EXAMPLE_ONLY=not-a-secret\n')
  assert.equal((await scanRelease(root)).status, 'pass')
  await writeFile(path, 'VALUE=other')
  assert.equal((await scanRelease(root)).status, 'fail')
})

test('料金を含む見出しと末端の div を読み、ラベルだけでは事実にしない', () => {
  assert.equal(inspect('<h2>料金: 12,000円</h2>', ['price']).facts[0].found, true)
  assert.equal(inspect('<div>料金: 12,000円</div>', ['price']).facts[0].found, true)
  assert.equal(inspect('<h2>対応地域</h2>', ['area']).facts[0].found, false)
  assert.equal(inspect('<h1>旅を予約する</h1><p>旅のご案内です。</p>', ['booking']).facts[0].found, false)
})
test('入れ子の本文を重複した住所にせず、商品の対象を引き継ぐ', () => {
  const publication = inspect('<div><p>住所: 東京都港区海岸1-2-3</p><p>電話: 03-1234-5678</p></div><div data-subject="化粧水"><p>2,000円</p></div>')
  assert.equal(publication.values.filter(item => item.field === 'address').length, 1)
  assert.equal(publication.values.find(item => item.field === 'price').subject, '化粧水')
})
test('定休日の裏返しと営業日が一致する例、異なる例を比較する', () => {
  const first = inspect('<p>営業日: 月〜金</p>')
  assert.equal(compareValues([first, inspectPublication('<p>定休日: 土日</p>', url + 'days')]).length, 0)
  assert.equal(compareValues([first, inspectPublication('<p>定休日: 月火</p>', url + 'days')]).length, 1)
})
test('画像 alt の文言とフォームを指定したボタンを読む', () => {
  const publication = inspect('<a href="book"><img alt="Book a trip" src="/book.png"></a><form id="booking" action="book"></form><button form="booking">予約する</button>')
  assert.equal(publication.links[0].label, 'Book a trip')
  assert.equal(publication.links[2].destination, url + 'book')
})
test('電話リンクの画面にある電話番号を比較する', () => {
  const first = inspect('<a href="tel:03-1234-5678">03-1234-5678</a>')
  const second = inspectPublication('<a href="tel:03-9876-5432">03-9876-5432</a>', url + 'phone')
  assert.equal(compareValues([first, second])[0].code, 'consistency.phone')
})
test('POST 用フォームが GET を許さないときは未確認とする', async () => {
  const publication = inspect('<form action="book" method="post"><button>予約する</button></form>')
  await checkBusinessLinks([publication], { read: async address => ({ url: address, status: 405 }) })
  assert.ok(publication.links.every(link => link.status === 'unchecked'))
  assert.equal(publication.findings.some(item => item.code === 'business-link.broken'), false)
})
test('前の v0.1 の JSON と不正な baseline を区別する', async () => {
  const report = await check('examples/travel-broken/index.html', { now })
  const old = JSON.parse(JSON.stringify(report))
  delete old.findings; delete old.publication; delete old.factsRequested
  const delta = compareBaseline(report, old)
  assert.ok(delta.continuing.some(item => item.code === 'html.robots.noindex'))
  assert.throws(() => compareBaseline(report, { version: 'flapbase.site-check/v1', findings: [{}] }), /findings/u)
})

test('値のない構造化データと宛先のない予約ボタンを事実にしない', () => {
  const result = inspect('<script type="application/ld+json">{"@type":"ReserveAction","price":{}}</script><button>予約する</button>')
  assert.equal(result.facts.find(item => item.key === 'booking').found, false)
  assert.equal(result.facts.find(item => item.key === 'price').found, false)
})
test('壊れた fragment はリンクの問題として返す', async t => {
  const root = await folder(t)
  await writeFile(join(root, 'index.html'), '<p>旅</p>')
  const publication = inspect('<a href="/#%xx">予約する</a>')
  await checkBusinessLinks([publication], { root, siteUrl: url })
  assert.equal(publication.links[0].status, 'broken')
})

test('特定の言語で欠けた事実の根拠に言語指定を残す', async () => {
  const read = async (address, options = {}) => ({ url: address, status: 200, redirected: false,
    headers: { 'content-type': address.endsWith('/robots.txt') ? 'text/plain' : 'text/html' },
    text: address.endsWith('/robots.txt') ? 'User-agent: *\nAllow: /' : good.replace('</body>', options.language === 'en' ? '</body>' : '<p>料金: 12,000円</p></body>') })
  const report = await checkUrl(url, { read, now, facts: ['price'] })
  const issue = report.findings.find(item => item.code === 'fact.price.missing')
  assert.equal(issue.evidence[0].profile, 'en')
})
