import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { check, checkFile } from '../packages/site-check/src/index.js'
import { checkUrl } from '../packages/site-check/src/input.js'
import { buildReport, describeProfile, formatReport } from '../packages/site-check/src/report.js'
import { inspectChecks } from '../packages/site-check/src/checks.js'
import { good, url, now, fetched, coverage } from './helpers.js'

test('ファイルとフォルダを読み、HTML と robots と sitemap を点検する', async () => {
  const report = await check('examples/cosmetics/index.html', { now })
  assert.equal(report.checks.length, 11)
  assert.ok(report.checks.every(item => item.pass))
  assert.deepEqual(report.coverage, { html: true, robots: true, sitemap: true, languageProfiles: false })
  assert.equal(report.rows.find(item => item.key === 'language').tone, 'na')
  const folder = await check('examples/cosmetics', { now })
  assert.equal(folder.reports.length, 1)
  assert.deepEqual(folder.reports[0], report)
})
test('欠けた補助ファイルと送信時の言語を推定しない', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flap-input-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'index.html'), good)
  const report = await checkFile(join(dir, 'index.html'), { now })
  assert.equal(report.coverage.robots, false)
  assert.equal(report.coverage.sitemap, false)
  assert.ok(report.crawlers.every(item => item.allowed === null))
  assert.equal(report.rows.find(item => item.key === 'search-crawlers').value, '未確認')
})
test('フォルダ入力では公開用ルートにない補助ファイルを見つける', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flap-root-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'index.html'), good)
  const result = await check(dir, { now })
  assert.equal(result.reports[0].coverage.robots, true)
  assert.equal(result.reports[0].coverage.sitemap, true)
  assert.ok(result.reports[0].issues.some(issue => issue.key === 'sitemap-missing'))
})
test('base-url で canonical のずれを見つける', async () => {
  const report = await check('examples/cosmetics', { baseUrl: 'https://example.com/other/', now })
  assert.equal(report.reports[0].checks.find(item => item.key === 'canonical').pass, false)
})
test('大きなファイルを読む前に拒否する', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flap-large-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'large.html'), Buffer.alloc(1024 * 1024 + 1))
  await assert.rejects(check(join(dir, 'large.html')), { code: 'file.too-large' })
})
test('空フォルダを拒否する', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flap-empty-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await assert.rejects(check(dir), { code: 'folder.empty' })
})
test('HTML のファイル数に上限を置く', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flap-count-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  for (let i = 0; i < 101; i++) await writeFile(join(dir, `${i}.html`), good)
  await assert.rejects(check(dir), { code: 'folder.too-large' })
})
test('フォルダ外の symlink のサイトマップを読まない', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flap-symlink-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(join(dir, 'site'))
  await writeFile(join(dir, 'index.html'), good)
  await writeFile(join(dir, 'sitemap.xml'), '<urlset></urlset>')
  await symlink(join(dir, 'sitemap.xml'), join(dir, 'site/sitemap.xml'))
  await writeFile(join(dir, 'site/index.html'), good)
  const report = await checkFile(join(dir, 'site/index.html'))
  assert.equal(report.coverage.sitemap, false)
})

function reader(routes) {
  const calls = []
  return { calls, read: async (address, options = {}) => {
    const target = new URL(address)
    if (options.beforeRequest) await options.beforeRequest(target)
    calls.push({ address, language: options.language })
    const response = routes(target, options)
    return { url: target.href, status: 200, text: good, headers: { 'content-type': 'text/html' }, redirected: false, ...response }
  } }
}
const routes = (target, options) => target.pathname === '/robots.txt' ? { text: 'User-agent: *\nAllow: /', headers: { 'content-type': 'text/plain' } }
  : target.pathname === '/sitemap.xml' ? { text: '<urlset></urlset>', headers: { 'content-type': 'application/xml' } }
    : { text: options.language === 'en' ? good.replace('lang="ja"', 'lang="en"') : good }

test('URL は robots を先に読み、言語ごとの実測値を返す', async () => {
  const { read, calls } = reader((target, options) => {
    const response = routes(target, options)
    return target.pathname === '/cosmetics/' && !options.language ? { ...response, text: good.replace('lang="ja"', 'lang="en"') } : response
  })
  const report = await checkUrl(url, { read, now })
  assert.ok(calls[0].address.endsWith('/robots.txt'))
  assert.deepEqual(report.profiles.map(item => item.language), ['en', 'ja', 'en'])
  assert.ok(report.issues.some(item => item.key === 'language-variants'))
})
test('言語指定なしで日本語、英語指定で英語を返すページは修正の対象にしない', async () => {
  const { read } = reader(routes)
  const report = await checkUrl(url, { read, now })
  assert.ok(!report.issues.some(item => item.key === 'language-variants'))
})
test('robots が拒否したページは取得しない', async () => {
  const { read, calls } = reader(() => ({ text: 'User-agent: *\nDisallow: /', headers: { 'content-type': 'text/plain' } }))
  const report = await checkUrl(url, { read, now })
  assert.equal(calls.length, 1)
  assert.equal(report.checks.length, 0)
  assert.ok(report.issues.some(item => item.key === 'robots-blocks-us'))
})
test('補助ファイルの私的転送も握りつぶさない', async () => {
  const { read } = reader((target, options) => {
    if (target.pathname === '/sitemap.xml') throw Object.assign(new Error('拒否'), { code: 'url.ssrf-blocked' })
    return routes(target, options)
  })
  await assert.rejects(checkUrl(url, { read }), { code: 'url.ssrf-blocked' })
})
test('HTML でない応答を拒否する', async () => {
  const { read } = reader((target, options) => target.pathname === '/cosmetics/' ? { headers: { 'content-type': 'application/json' }, text: '{}' } : routes(target, options))
  await assert.rejects(checkUrl(url, { read }), { code: 'url.not-html' })
})
test('未確認の言語応答を変化なしにしない', () => {
  const data = fetched(); data.checks = inspectChecks(good, url)
  const report = buildReport(data, { source: { kind: 'url', input: url }, coverage, now,
    profiles: [describeProfile('default', data.page), describeProfile('ja', null)] })
  assert.equal(report.rows.find(item => item.key === 'language').tone, 'na')
})
test('結果の型と修正順序を JSON でも保持する', () => {
  const data = fetched(good.replace('</head>', '<meta name="robots" content="noindex"></head>'), { sitemap: { found: false } })
  data.checks = inspectChecks(data.page.html, url)
  const report = JSON.parse(JSON.stringify(buildReport(data, { source: { kind: 'file', input: 'site.html' }, coverage, now })))
  assert.equal(report.version, 'flapbase.site-check/v1')
  assert.equal(report.ruleSetVersion, 'web-publication-seo/v1')
  assert.equal(report.checkedAt, now.toISOString())
  assert.equal(report.checks.length, 11)
  assert.deepEqual(report.issues.map(item => item.priority), [1, 2])
  assert.deepEqual(report.issues.map(item => item.key), ['noindex', 'sitemap-missing'])
  for (const issue of report.issues) for (const key of ['title', 'why', 'fix', 'stage', 'part']) assert.equal(typeof issue[key], 'string')
  for (const check of report.checks) assert.equal(typeof check.pass, 'boolean')
})
test('端末の制御文字を人向け表示で実行しない', () => {
  const data = fetched(); data.checks = inspectChecks(good, url)
  const report = buildReport(data, { source: { kind: 'file', input: 'site.html' }, coverage, now })
  report.url += '\u001b[2J'
  assert.equal(formatReport(report).includes('\u001b'), false)
})
test('CLI の JSON とエラーの形', () => {
  const cli = resolve('bin/flap.js')
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
  const success = run('check', 'examples/cosmetics/index.html', '--json')
  assert.equal(success.status, 0); assert.equal(success.stderr, '')
  assert.equal(JSON.parse(success.stdout).checks.length, 11)
  const failure = run('check', 'https://127.0.0.1', '--json')
  assert.equal(failure.status, 1)
  assert.equal(JSON.parse(failure.stdout).error.code, 'url.ssrf-blocked')
  const badOption = run('check', 'examples/cosmetics/index.html', '--missing', '--json')
  assert.equal(badOption.status, 1)
  assert.equal(JSON.parse(badOption.stdout).version, 'flapbase.site-check-error/v1')
})
