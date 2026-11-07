import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile, writeFile, mkdtemp, rm, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { check, formatReport, buildReport, inspectChecks } from '../packages/site-check/src/index.js'
import { localizeReport } from '../packages/site-check/src/language.js'
import { now, scenarios, coverage } from './helpers.js'

const run = (args, LANG = 'C') => spawnSync(process.execPath, ['bin/flap.js', ...args], {
  encoding: 'utf8', env: { ...process.env, LANG },
})
const input = ['check', 'examples/travel-broken']
for (const lang of ['en', 'ja']) test(`CLI broken example: ${lang}`, async () => {
  const fixture = lang === 'ja' ? 'travel-broken-output.txt' : 'travel-broken-output-en.txt'
  const expected = await readFile(new URL(`./fixtures/${fixture}`, import.meta.url), 'utf8')
  const result = run([...input, '--lang', lang], lang === 'ja' ? 'en_US.UTF-8' : 'ja_JP.UTF-8')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  assert.equal(result.stdout, expected)
  assert.equal(formatReport(await check('examples/travel-broken', { now }), { lang }), expected)
  const readme = await readFile('README.md', 'utf8')
  const [english, japanese] = readme.split('## 日本語')
  assert.ok((lang === 'en' ? english : japanese).includes(expected.split('\n').slice(0, 3).join('\n')))
})

test('LANG default and explicit override, including help', () => {
  for (const [locale, lang] of [['ja_JP.UTF-8', 'ja'], ['ja', 'ja'], ['en_US.UTF-8', 'en'], ['C', 'en'], ['', 'en'], ['fr_FR.UTF-8', 'en']]) {
    assert.equal(run(input, locale).stdout, run([...input, '--lang', lang], locale).stdout)
    assert.match(run(['--help'], locale).stdout, lang === 'ja' ? /^使い方:/u : /^Usage:/u)
  }
  assert.match(run(['check', '--help', '--lang', 'en'], 'ja_JP.UTF-8').stdout, /^Usage:/u)
  assert.match(run(['check', '--help', '--lang', 'ja']).stdout, /^使い方:/u)
})

test('invalid or missing language and translated errors retain the JSON shape', () => {
  for (const option of [['--lang'], ['--lang', 'fr'], ['--lang', '--json']]) {
    const result = run([...input, ...option, '--json'])
    assert.equal(result.status, 1)
    assert.deepEqual(JSON.parse(result.stdout), { version: 'flapbase.site-check-error/v1', error: {
      code: 'input.invalid', message: 'Use --lang en or --lang ja.',
    } })
  }
  for (const [lang, message] of [['en', 'The file or folder was not found.'], ['ja', '指定したファイルかフォルダが見つかりません。']]) {
    const result = run(['check', 'examples/does-not-exist.html', '--lang', lang, '--json'])
    assert.equal(result.status, 1)
    assert.deepEqual(JSON.parse(result.stdout).error, { code: 'ENOENT', message })
    assert.match(run(['check', 'https://127.0.0.1', '--lang', lang]).stderr, lang === 'en' ? /^Check failed:/u : /^点検できません:/u)
  }
})

// Only prose may vary: all keys, types, IDs, codes, causes and observed evidence must survive.
const shape = value => Array.isArray(value) ? value.map(shape) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item)])) : typeof value

test('JSON changes prose only and localization does not mutate the report', async () => {
  const ja = JSON.parse(run([...input, '--json', '--lang', 'ja']).stdout)
  const en = JSON.parse(run([...input, '--json', '--lang', 'en']).stdout)
  assert.deepEqual(shape(en), shape(ja))
  assert.deepEqual(en.findings.map(item => [item.id, item.code, item.cause, item.pages]), ja.findings.map(item => [item.id, item.code, item.cause, item.pages]))
  assert.equal(en.findings[0].title, 'The publish folder contains .env')
  for (let i = 0; i < ja.reports.length; i++) {
    assert.deepEqual(en.reports[i].publication.values, ja.reports[i].publication.values)
    assert.deepEqual(en.reports[i].publication.facts.map(fact => fact.evidence), ja.reports[i].publication.facts.map(fact => fact.evidence))
  }
  const report = await check('examples/travel-broken', { now })
  const original = structuredClone(report)
  const english = localizeReport(report, 'en')
  assert.deepEqual(localizeReport(english, 'ja'), original)
  formatReport(report, { lang: 'en' })
  assert.deepEqual(report, original)
})

test('baseline works across both languages, including fixed findings', async t => {
  const root = await mkdtemp(join(tmpdir(), 'flap-language-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await cp('examples/travel-broken', join(root, 'site'), { recursive: true })
  for (const before of ['en', 'ja']) {
    const baseline = join(root, `${before}.json`)
    await writeFile(baseline, run(['check', join(root, 'site'), '--json', '--lang', before]).stdout)
  }
  await rm(join(root, 'site/.env'))
  for (const before of ['en', 'ja']) for (const after of ['en', 'ja']) {
    const args = ['check', join(root, 'site'), '--baseline', join(root, `${before}.json`), '--lang', after]
    const result = run([...args, '--json'])
    assert.equal(result.status, 0, result.stderr)
    const delta = JSON.parse(result.stdout).difference
    assert.equal(delta.fixed.length, 1)
    assert.equal(delta.introduced.length, 0)
    assert.equal(delta.continuing.length, 6)
    assert.equal(delta.fixed[0].title, after === 'en' ? 'The publish folder contains .env' : '公開用フォルダに .env が混ざっています')
    assert.match(run(args).stdout, after === 'en' ? /Fixed: 1/u : /直った所: 1 件/u)
  }
})

test('all failed basics and generated issue text are translated', async t => {
  const root = await mkdtemp(join(tmpdir(), 'flap-language-basics-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'index.html'), '<html><body><div id="root"></div><script src="app.js"></script></body></html>')
  const report = await check(root, { now })
  const en = localizeReport(report, 'en')
  const japanese = /[ぁ-んァ-ヶ一-龠]/u
  for (const page of en.reports) {
    for (const check of page.checks) {
      assert.doesNotMatch(check.label, japanese)
      for (const issue of check.findings) assert.doesNotMatch(issue.message, japanese)
    }
    for (const issue of page.issues) for (const key of ['title', 'why', 'fix']) assert.doesNotMatch(issue[key], japanese)
    for (const row of page.rows) for (const key of ['label', 'value']) assert.doesNotMatch(row[key], japanese)
  }
  for (const finding of en.findings) for (const key of ['title', 'fix']) assert.doesNotMatch(finding[key], japanese)
  assert.deepEqual(localizeReport(en, 'ja'), report)
  const page = report.reports[0]
  delete page.findings
  assert.doesNotMatch(formatReport(page, { lang: 'en' }), japanese)
})

test('URL language profiles and crawler reasons use English prose', async () => {
  const { checkUrl } = await import('../packages/site-check/src/input.js')
  const { good } = await import('./helpers.js')
  const read = async (address, options = {}) => ({ url: address, status: 200, redirected: false,
    headers: { 'content-type': address.endsWith('/robots.txt') ? 'text/plain' : 'text/html' },
    text: address.endsWith('/robots.txt') ? 'User-agent: OAI-SearchBot\nDisallow: /'
      : good.replace('<html lang="ja">', `<html lang="${options.language === 'ja' ? 'ja' : 'en'}">`),
  })
  const report = await checkUrl('https://example.com/', { read, now })
  const en = localizeReport(report, 'en')
  assert.ok(en.issues.some(issue => issue.key === 'language-variants'))
  assert.ok(en.issues.some(issue => issue.key === 'search-crawlers-blocked'))
  for (const issue of en.issues) for (const key of ['title', 'why', 'fix']) assert.doesNotMatch(issue[key], /[ぁ-んァ-ヶ一-龠]/u)
  assert.deepEqual(localizeReport(en, 'ja'), report)
})

for (const [name, fetched] of scenarios()) test(`English diagnosis: ${name}`, () => {
  if (fetched.page?.html) fetched.checks = inspectChecks(fetched.page.html, fetched.requestedUrl)
  const report = buildReport(fetched, { source: { kind: 'url', input: fetched.requestedUrl }, coverage, now })
  const en = localizeReport(report, 'en')
  for (const issue of en.issues) for (const key of ['title', 'why', 'fix']) assert.doesNotMatch(issue[key], /[ぁ-んァ-ヶ一-龠]/u)
  assert.doesNotMatch(formatReport(report, { lang: 'en' }), /[ぁ-んァ-ヶ一-龠]/u)
  assert.deepEqual(localizeReport(en, 'ja'), report)
})
