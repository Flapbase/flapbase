import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { businessCommand, businessStepInput, checkBusinessCloud, createCloudToolCaller, inspectBusiness, loadBusinessCatalog, runBusinessStep } from '../bin/business.js'
import { parseDigitalProductBase } from '../packages/self-host/digital-product-base.mjs'

const catalog = await loadBusinessCatalog()
const projectId = '11111111-1111-4111-8111-111111111111'
const keys = [
  'member-ai-course', 'standard-service', 'free-resource', 'recruitment', 'digital-product-sales',
  'organization-training', 'paid-membership', 'booking-service', 'event-registration', 'customer-sales', 'customer-support',
]

test('the packaged CLI lists all 11 businesses and their registered execution keys', async () => {
  const listed = JSON.parse(execFileSync(process.execPath, ['bin/flap.js', 'business', 'list', '--json', '--lang', 'ja'], { encoding: 'utf8' }))
  assert.deepEqual(listed.map(row => row.businessKey), keys)
  for (const business of listed) {
    assert.ok(business.executions.length > 0, business.businessKey)
    assert.ok(business.localWorkflow || business.localLaunch?.path, business.businessKey)
  }
  await assert.rejects(businessCommand(['inspect', '__proto__']), /事業キー/)
})

test('every business can select a registered first step through the pinned MCP contract', async () => {
  for (const key of keys) {
    const executionKey = Object.keys(inspectBusiness(catalog, key).executions)[0]
    const outcome = await runBusinessStep(catalog, async (name, request) => {
      assert.equal(name, 'business_workflow_step_run')
      assert.equal(request.projectId, projectId)
      assert.equal(request.definitionDigest, catalog.definitionDigest)
      return { ...request, result: { checked: true } }
    }, key, executionKey, { projectId, parameters: {} })
    assert.equal(outcome.businessKey, key)
  }
  assert.throws(() => businessStepInput(catalog, 'booking-service', 'order-support', { parameters: {} }), /実行キー/)
  assert.throws(() => businessStepInput(catalog, 'booking-service', 'booking-offers', {
    parameters: {}, results: { unknown: {} },
  }), /先行工程/)
  await assert.rejects(runBusinessStep(catalog, async (_, request) => ({
    ...request, projectId: '22222222-2222-4222-8222-222222222222', result: {},
  }), 'booking-service', 'booking-offers', { projectId, parameters: {} }), /一致する結果/)
})

test('the Cloud compatibility check requires all 11 exact execution catalogs and the digest', async () => {
  const remote = {
    businesses: catalog.definition.businesses, source: { digest: catalog.definitionDigest }, version: catalog.definition.version,
    executions: Object.fromEntries(keys.map(key => [key, inspectBusiness(catalog, key).executions])),
  }
  const read = async (name, input) => {
    assert.equal(name, 'app_template_get')
    assert.deepEqual(input, { templateId: 'business-app' })
    return { workflowCatalog: remote }
  }
  assert.deepEqual((await checkBusinessCloud(catalog, read)).businesses, keys)
  delete remote.executions['event-registration']
  await assert.rejects(checkBusinessCloud(catalog, read), /実行定義/)
  remote.source.digest = 'old'
  await assert.rejects(checkBusinessCloud(catalog, read), /一致しません/)
})

test('Cloud transport uses the existing MCP endpoint and refuses a redirect or mismatched result ID', async () => {
  const call = createCloudToolCaller('test-token', async (url, options) => {
    assert.equal(url, 'https://mcp.flapbase.com/mcp')
    assert.equal(options.redirect, 'error')
    assert.equal(options.headers.Authorization, 'Bearer test-token')
    const request = JSON.parse(options.body)
    assert.equal(request.method, 'tools/call')
    return new Response('event: message\ndata: ' + JSON.stringify({
      id: request.id, result: { structuredContent: { matched: true } },
    }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } })
  })
  assert.deepEqual(await call('app_template_get', {}), { matched: true })
  const wrong = createCloudToolCaller('test-token', async () => Response.json({ id: 900, result: { structuredContent: {} } }))
  await assert.rejects(wrong('app_template_get', {}), /結果/)
})

test('local-base uses the existing install contract for free resources, digital sales and support', async () => {
  for (const key of ['free-resource', 'digital-product-sales', 'customer-support']) {
    const value = await businessCommand(['local-base', key])
    assert.deepEqual(parseDigitalProductBase(value), value)
  }
  const recruitment = await businessCommand(['inspect', 'recruitment'])
  assert.equal(recruitment.localLaunch.path, '/recruitment')
  await assert.rejects(businessCommand(['local-base', 'recruitment']), /app_add_recruitment/)
  assert.equal((await businessCommand(['inspect', 'booking-service'])).localLaunch.path, '/booking')
  assert.equal((await businessCommand(['inspect', 'event-registration'])).localLaunch.path, '/booking')
  assert.equal((await businessCommand(['inspect', 'member-ai-course'])).localLaunch.path, '/training')
  assert.equal((await businessCommand(['inspect', 'organization-training'])).localLaunch.path, '/training')
  assert.equal((await businessCommand(['inspect', 'paid-membership'])).localLaunch.path, '/membership')
  await assert.rejects(businessCommand(['local-base', 'member-ai-course']), /\/training/)
})
