import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRobotsTxt, robotsAllows, robotsNamesAgent } from '../packages/site-check/src/robots.js'
import { buildReport } from '../packages/site-check/src/report.js'
import { organizationNames, redirectedAwayFromLanguage } from '../packages/site-check/src/public-read.js'
import { inspectChecks } from '../packages/site-check/src/checks.js'
import { fetched, coverage, good, url, now } from './helpers.js'

for (const [name, text, agent, path, expected] of [
  ['空なら許可', '', 'GPTBot', '/', true],
  ['全体を止める', 'User-agent: *\nDisallow: /', 'OAI-SearchBot', '/', false],
  ['学習用だけを止める', 'User-agent: GPTBot\nDisallow: /', 'OAI-SearchBot', '/', true],
  ['学習用の拒否', 'User-agent: GPTBot\nDisallow: /', 'GPTBot', '/', false],
  ['長い Allow', 'User-agent: *\nDisallow: /\nAllow: /shop', 'Bingbot', '/shop/item', true],
  ['同じ長さの Allow', 'User-agent: *\nDisallow: /shop\nAllow: /shop', 'Bingbot', '/shop', true],
  ['末尾とワイルドカード', 'User-agent: *\nDisallow: /*.pdf$', 'Googlebot', '/travel.pdf', false],
  ['末尾以外', 'User-agent: *\nDisallow: /*.pdf$', 'Googlebot', '/travel.pdf?view=1', true],
  ['特定名の優先', 'User-agent: *\nDisallow: /\nUser-agent: GPTBot\nAllow: /', 'GPTBot', '/', true],
  ['空の Disallow', 'User-agent: *\nDisallow:', 'Googlebot', '/', true],
]) test(`robots: ${name}`, () => assert.equal(robotsAllows(parseRobotsTxt(text), agent, path), expected))

test('検索用と学習用を別々に返す', () => {
  const data = fetched(good, { robots: { status: 200, text: 'User-agent: GPTBot\nDisallow: /' } })
  data.checks = inspectChecks(good, url)
  const report = buildReport(data, { source: { kind: 'url', input: url }, coverage, now })
  assert.equal(report.crawlers.find(item => item.name === 'GPTBot').allowed, false)
  assert.equal(report.crawlers.find(item => item.name === 'OAI-SearchBot').allowed, true)
  assert.ok(!report.issues.some(item => item.key === 'search-crawlers-blocked'))
})
test('名前の指定と * を区別する', () => assert.equal(robotsNamesAgent(parseRobotsTxt('User-agent: *\nDisallow: /'), 'OAI-SearchBot'), false))
test('多くのワイルドカードで長い本文の取得を止めない', () => {
  const robots = parseRobotsTxt(`User-agent: *\nDisallow: /${'*a'.repeat(80)}b`)
  assert.equal(robotsAllows(robots, 'Googlebot', '/' + 'a'.repeat(2000)), true)
})
test('組織の構造化データを読む', () => assert.equal(organizationNames(good).found, true))
test('WebSite だけでは組織の情報にしない', () => assert.equal(organizationNames(good.replace('HealthAndBeautyBusiness', 'WebSite')).found, false))
test('別言語への転送を読む', () => {
  const html = `<html lang="en"><link rel="alternate" hreflang="ja" href="${url}"></html>`
  assert.deepEqual(redirectedAwayFromLanguage(html, url), { from: 'ja', to: 'en' })
  assert.equal(redirectedAwayFromLanguage(html.replace('lang="en"', 'lang="ja"'), url), null)
})
