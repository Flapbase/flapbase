import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { stripTypeScriptTypes } from 'node:module'
import assert from 'node:assert/strict'
import { scenarios, robotsCases, now } from '../tests/helpers.js'
import { inspectChecks } from '../packages/site-check/src/checks.js'
import { runPublicDiagnosis, organizationNames } from '../packages/site-check/src/public-read.js'
import { parseRobotsTxt, robotsAllows } from '../packages/site-check/src/robots.js'

const args = process.argv.slice(2)
const rootIndex = args.indexOf('--source-root')
if (rootIndex < 0 || !args[rootIndex + 1]) throw new Error('--source-root で照合元のソースを指定してください。')
const root = resolve(args[rootIndex + 1])
const hashes = {}
async function source(path, ts = true) {
  const value = await readFile(resolve(root, path), 'utf8')
  hashes[path] = createHash('sha256').update(value).digest('hex')
  return ts ? stripTypeScriptTypes(value, { mode: 'strip' }) : value
}
const data = value => `data:text/javascript;base64,${Buffer.from(value).toString('base64')}`
const robots = data(await source('packages/website-diagnosis-contract/src/robots.ts'))
const initial = data(await source('packages/website-diagnosis-contract/src/initial-html.ts'))
const rules = data((await source('packages/website-diagnosis-contract/src/rules.ts')).replaceAll("'./initial-html.js'", JSON.stringify(initial)))
const seo = data(await source('packages/web-publication-seo-audit/src/index.js', false))
let worker = await source('cloudflare/flap-website-seo-audit/src/index.ts')
worker = worker.replace(/from '@flapbase\/web-publication-seo-audit'/u, `from ${JSON.stringify(seo)}`)
  .replace(/from '@flapbase\/website-diagnosis-contract'/u, `from ${JSON.stringify(rules)}`)
// These two wire constants belong to the adapter; the pure inspection does not use them.
worker = worker.replace(/\bWEBSITE_SEO_CLI_INVOCATION_VERSION\s*,/u, '').replace(/\bWEBSITE_SEO_CLI_RESULT_VERSION\s*,/u, '')
worker = `const WEBSITE_SEO_CLI_INVOCATION_VERSION = 'website-seo-cli-invocation/v1';
const WEBSITE_SEO_CLI_RESULT_VERSION = 'website-seo-cli-result/v1';\n${worker}`
const cloudSeo = await import(data(worker))
const cloudRead = await import(data((await source('packages/website-diagnosis-contract/src/public-diagnosis.ts')).replaceAll("'./robots.js'", JSON.stringify(robots))))
const records = []
for (const [name, fetched] of scenarios()) {
  const html = fetched.page?.html
  const url = fetched.page?.url ?? fetched.requestedUrl
  const checks = html ? inspectChecks(html, url) : []
  fetched.checks = checks
  if (html) {
    const result = cloudSeo.inspectWebsiteSeo({ normalizedUrl: url, html, snapshotRef: 'artifact://fixture/page',
      snapshotDigest: `sha256:${createHash('sha256').update(html).digest('hex')}`, contentType: 'text/html' }, now.toISOString())
    assert.deepEqual(checks.map(({ key, pass }) => ({ key, pass })), result.observations.map(item => ({ key: item.semanticRef.slice('website.seo.'.length), pass: item.outcome === 'pass' })))
    assert.deepEqual(checks.flatMap(check => check.findings.map(issue => ({ code: issue.code, message: issue.message }))).sort((a, b) => a.code.localeCompare(b.code)),
      result.findings.map(item => ({ code: item.ruleRef.slice('web-publication-seo/'.length, -3), message: item.summary })).sort((a, b) => a.code.localeCompare(b.code)))
  }
  const cloudResult = cloudRead.runPublicDiagnosis(fetched, now)
  const expected = { issues: cloudResult.issues.filter(item => item.stage === 'read'), rows: cloudResult.rows.filter(item => item.stage === 'read') }
  const local = runPublicDiagnosis(fetched, now)
  assert.deepEqual({ issues: local.issues, rows: local.rows }, expected)
  const organization = html ? cloudRead.organizationNames(html) : null
  if (html) assert.deepEqual(organizationNames(html), organization)
  records.push({ name, checks: checks.map(({ key, pass }) => ({ key, pass })), organization, ...expected })
}
const cloudRobots = await import(robots)
const robotsRecords = robotsCases().map(({ pattern, path }) => {
  const text = `User-agent: *\nDisallow: ${pattern}`
  const allowed = cloudRobots.robotsAllows(cloudRobots.parseRobotsTxt(text), 'Googlebot', path)
  assert.equal(robotsAllows(parseRobotsTxt(text), 'Googlebot', path), allowed)
  return { pattern, path, allowed }
})
const reference = { generatedAt: now.toISOString(), sources: hashes, records, robotsRecords }
if (args.includes('--write-fixtures')) await writeFile(new URL('../tests/fixtures/cloud-reference.json', import.meta.url), JSON.stringify(reference, null, 2) + '\n')
else {
  const saved = JSON.parse(await readFile(new URL('../tests/fixtures/cloud-reference.json', import.meta.url), 'utf8'))
  assert.deepEqual(reference, saved)
}
console.log(JSON.stringify({ status: 'pass', scenarios: records.length, robotsCases: robotsRecords.length, sourceFiles: Object.keys(hashes).length }))
