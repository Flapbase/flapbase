import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createSelfHostedAuthPool } from './auth.mjs'
import { createCaseService } from './cases.mjs'
import { startArtifactTestPostgres } from './postgres-fixture.mjs'
import { setupCaseSchema, setupProject } from './setup.mjs'

test('inquiry, deal and service operations reuse the SQL registry with a Project boundary', { timeout: 20_000 }, async () => {
  const fixture = await startArtifactTestPostgres()
  const pool = createSelfHostedAuthPool(fixture.connection)
  const person = async address => (await fixture.sql.query(
    "INSERT INTO identity.principals(principal_kind,email,created_by) VALUES('human',$1,'local-cases-test') RETURNING principal_id",
    [address],
  ))[0].principal_id
  try {
    await setupCaseSchema(pool)
    await setupCaseSchema(pool)
    const [owner, customer, stranger] = await Promise.all(['owner', 'customer', 'other'].map(name => person(name + '@example.test')))
    const projectId = randomUUID(), otherProjectId = randomUUID()
    await setupProject(pool, { ownerId: owner, projectId, name: '受付と顧客対応' })
    const [{ workspace_id: workspace }] = await fixture.sql.query('SELECT workspace_id FROM platform.projects WHERE project_id=$1', [projectId])
    await fixture.sql.query(
      "INSERT INTO platform.projects(project_id,workspace_id,name,slug,created_by_principal_id,visibility) VALUES($1,$2,'別Project','other',$3,'workspace')",
      [otherProjectId, workspace, owner],
    )
    const service = createCaseService({ pool, projectId })
    const other = createCaseService({ pool, projectId: otherProjectId })
    const request = { name: '顧客', email: 'Customer@Example.test', message: '作業を依頼したい', idempotencyKey: randomUUID() }
    const { inquiryId } = await service.receive(request)
    assert.equal((await service.receive(request)).inquiryId, inquiryId)
    await assert.rejects(service.receive({ ...request, message: '別の依頼' }), { status: 409 })
    await other.receive({ ...request, idempotencyKey: randomUUID() })
    assert.equal((await fixture.sql.query('SELECT count(*)::int AS n FROM platform.contacts WHERE workspace_id=$1', [workspace]))[0].n, 1)
    assert.equal((await service.queue(owner)).inquiries[0].message, request.message)
    await assert.rejects(service.queue(stranger), { status: 404 })
    const conversion = { inquiryId, title: 'サービスの依頼', idempotencyKey: randomUUID() }
    await assert.rejects(other.convert(owner, conversion), { status: 404 })
    const { caseId } = await service.convert(owner, conversion)
    assert.equal((await service.convert(owner, { ...conversion, idempotencyKey: randomUUID() })).caseId, caseId)
    const initial = await service.read(owner, caseId)
    assert.equal(initial.version, 1)
    assert.equal(initial.status, 'received')
    const work = { caseId, expectedVersion: 1, values: { status: 'estimating', dueOn: '2027-01-30', nextAction: '見積を作る', assigneeId: owner }, idempotencyKey: randomUUID() }
    const estimating = await service.update(owner, work)
    assert.equal(estimating.version, 2)
    assert.equal(estimating.nextAction, '見積を作る')
    assert.deepEqual(await service.update(owner, work), estimating)
    await assert.rejects(service.update(owner, { ...work, idempotencyKey: randomUUID() }), { status: 409 })
    await assert.rejects(other.read(owner, caseId), { status: 404 })
    const quote = { lines: [{ name: '定型サービス', quantity: 1, unitPrice: 10000, taxRate: 10 }], idempotencyKey: randomUUID() }
    const { quoteId } = await service.saveQuote(owner, caseId, quote)
    await assert.rejects(service.answerQuote(customer, caseId, quoteId, 'accept'), { status: 404 })
    assert.equal((await service.sendQuote(owner, caseId, quoteId)).sent, true)
    await assert.rejects(service.answerQuote(stranger, caseId, quoteId, 'accept'), { status: 404 })
    await assert.rejects(other.answerQuote(customer, caseId, quoteId, 'accept'), { status: 404 })
    assert.equal((await service.answerQuote(customer, caseId, quoteId, 'accept')).status, 'accepted')
    assert.equal((await service.answerQuote(customer, caseId, quoteId, 'decline')).status, 'accepted')
    const [{ total }] = await fixture.sql.query('SELECT total::int FROM platform.case_quotes WHERE quote_id=$1', [quoteId])
    assert.equal(total, 11000)
    const ordered = await service.update(owner, { caseId, expectedVersion: 2, values: { status: 'ordered' }, idempotencyKey: randomUUID() })
    assert.equal(ordered.version, 3)
    const outcome = await fixture.sql.query('SELECT stage FROM platform.inquiries WHERE inquiry_id=$1', [inquiryId])
    assert.equal(outcome[0].stage, 'won')
    const delivered = await service.deliver(owner, caseId, { title: '納品', notice: '作業を完了しました', idempotencyKey: randomUUID() })
    await assert.rejects(other.receiveDelivery(customer, caseId, delivered.actionId), { status: 404 })
    assert.equal((await service.receiveDelivery(customer, caseId, delivered.actionId)).status, 'received')
    assert.equal((await service.receiveDelivery(customer, caseId, delivered.actionId)).duplicate, true)
    assert.deepEqual((await service.read(owner, caseId)).history.map(item => item.to), ['received', 'estimating', 'ordered'])
  } finally {
    await pool.end()
    await fixture.close()
  }
})
