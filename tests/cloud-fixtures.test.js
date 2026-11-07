import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { scenarios, now } from './helpers.js'
import { inspectChecks } from '../packages/site-check/src/checks.js'
import { runPublicDiagnosis, organizationNames } from '../packages/site-check/src/public-read.js'
import { parseRobotsTxt, robotsAllows } from '../packages/site-check/src/robots.js'

const reference = JSON.parse(readFileSync(new URL('./fixtures/cloud-reference.json', import.meta.url), 'utf8'))
for (const [name, fetched] of scenarios()) test(`Cloud と同じ入力と結果: ${name}`, () => {
  const html = fetched.page?.html
  fetched.checks = html ? inspectChecks(html, fetched.page.url) : []
  const result = runPublicDiagnosis(fetched, now)
  const expected = reference.records.find(item => item.name === name)
  assert.ok(expected)
  assert.deepEqual(fetched.checks.map(({ key, pass }) => ({ key, pass })), expected.checks)
  assert.deepEqual(result.issues, expected.issues)
  assert.deepEqual(result.rows, expected.rows)
  assert.deepEqual(html ? organizationNames(html) : null, expected.organization)
})
test('robots.txt のワイルドカードは Cloud と同じ判定を返す', () => {
  for (const { pattern, path, allowed } of reference.robotsRecords) {
    assert.equal(robotsAllows(parseRobotsTxt(`User-agent: *\nDisallow: ${pattern}`), 'Googlebot', path), allowed)
  }
})
