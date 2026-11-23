import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createBetterAuthAdapter, createSelfHostedAuthPool } from './auth.mjs'
import { createCaseService } from './cases.mjs'
import { createCasesPublication } from './cases-publication.mjs'
import { sha } from './free-download.mjs'
import { startArtifactTestPostgres } from './postgres-fixture.mjs'
import { createSelfHostedServer } from './server.mjs'
import { setupCaseSchema, setupProject } from './setup.mjs'

async function listen(server, port = 0) {
  server.listen(port, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}
const close = server => new Promise(resolve => {
  server.close(resolve)
  server.closeAllConnections?.()
})

test('local standard service and sales run from reviewed publication through customer and MCP operations', { timeout: 30_000 }, async () => {
  const fixture = await startArtifactTestPostgres()
  const pool = createSelfHostedAuthPool(fixture.connection)
  const directory = await mkdtemp(join(tmpdir(), 'flap-cases-http-'))
  let server, mcp
  try {
    await setupCaseSchema(pool)
    const probe = createServer()
    const port = await listen(probe)
    await close(probe)
    const origin = 'http://127.0.0.1:' + port
    const token = randomUUID() + randomUUID()
    const casesDelegation = { tokenDigest: sha('Bearer ' + token) }
    const previews = new Map()
    const adapter = createBetterAuthAdapter(pool, { origin, issuer: 'urn:flapbase:local:cases-test', secret: randomUUID(),
      sendVerificationEmail: async ({user,url}) => { previews.set(user.email,url) } })
    const first = { projectId: randomUUID(), businessKey: 'standard-service' }
    const second = { projectId: randomUUID(), businessKey: 'customer-sales' }
    const start = async ({ projectId, businessKey }) => {
      const service = createCaseService({ pool, projectId })
      const cases = await createCasesPublication({ service, directory, businessKey })
      server = createSelfHostedServer({ origin, pool, adapter, cases, casesDelegation })
      await listen(server, port)
    }
    await start(first)
    const request = (path, init) => fetch(new URL(path, origin), init)
    const get = (path, cookie) => request(path, { headers: { connection: 'close', ...(cookie ? { cookie } : {}) } })
    const post = (path, body, cookie) => request(path, { method:'POST', body: JSON.stringify(body), headers: {
      origin, connection:'close', 'content-type':'application/json', ...(cookie ? { cookie } : {}),
    } })
    const json = async (response, expected=200) => {
      assert.equal(response.status, expected, await response.clone().text())
      return response.json()
    }
    async function register(name) {
      const email = name + '@example.test'
      const response = await post('/api/auth/sign-up/email', { name, email, password: randomUUID() })
      assert.equal(response.status, 204)
      const cookie = response.headers.getSetCookie().find(value => value.startsWith('better-auth.session_token=')).split(';')[0]
      return { email, cookie, ...await json(await get('/auth/context', cookie)) }
    }
    const owner = await register('case-owner')
    const buyer = await register('customer')
    const outsider = await register('outsider')
    casesDelegation.principalId = owner.principalId
    await setupProject(pool, { projectId:first.projectId, ownerId:owner.principalId, name:'顧客ポータル' })
    await setupProject(pool, { projectId:second.projectId, ownerId:owner.principalId, name:'営業管理' })
    const operate = (action, fields) => post('/api/cases/' + action, fields, owner.cookie)
    const publish = async heading => {
      const initial = await json(await operate('draft', { heading, introduction:'仮原稿' }))
      const candidate = await json(await operate('draft', { heading, introduction:'確認済みの受付' }))
      assert.equal((await operate('publish', { digest: initial.digest })).status, 409)
      return json(await operate('publish', { digest:candidate.digest }))
    }

    assert.equal((await get('/service')).status, 404)
    const publication = await publish('制作サポート')
    assert.equal(publication.appBase.modules[0].kind, 'customer-portal')
    assert.match(await (await get('/service')).text(), /確認済みの受付/)
    const fields = { name:'お客様', email:buyer.email, message:'依頼の詳細', idempotencyKey:randomUUID() }
    const { inquiryId } = await json(await post('/api/cases/intake', fields),201)
    assert.match(await (await get('/cases',owner.cookie)).text(), /依頼の詳細/)
    assert.equal((await get('/cases',outsider.cookie)).status, 404)

    mcp = new Client({ name:'local-cases-test', version:'1.0.0' })
    await mcp.connect(new StdioClientTransport({ command: process.execPath,
      args:[fileURLToPath(new URL('./mcp.mjs',import.meta.url))], env:{FLAP_ORIGIN:origin,FLAP_CASES_AGENT_TOKEN:token} }))
    const tool = async (projectId,name,args) => {
      const reply = await mcp.callTool({name,arguments:{projectId,...args}})
      assert.ok(!reply.isError,reply.content[0]?.text)
      return JSON.parse(reply.content[0].text)
    }
    const inbox = await tool(first.projectId,'inbox_list',{})
    assert.equal(inbox.inquiries[0].id,inquiryId)
    assert.doesNotMatch(JSON.stringify(inbox),/依頼の詳細|@example/)
    const { caseId } = await tool(first.projectId,'deal_create_from_inquiry',{inquiryId,idempotencyKey:randomUUID()})
    const version = (await tool(first.projectId,'deal_get',{caseId})).deal.version
    const managing = await get('/cases/' + caseId,owner.cookie)
    assert.equal(managing.status,200)
    assert.match(await managing.text(), /見積を保存/)
    const { quoteId } = await json(await operate('quote',{caseId,title:'制作サポート',amount:10000,idempotencyKey:randomUUID()}))
    await json(await operate('send-quote',{caseId,quoteId}))
    const { requestId } = await json(await operate('ask',{caseId,title:'希望日を教えてください',idempotencyKey:randomUUID()}))
    const { actionId } = await json(await operate('deliver',{caseId,title:'成果の案内',notice:'確認用の成果物',idempotencyKey:randomUUID()}))
    const path = '/service/portal/' + caseId
    assert.equal((await get(path,buyer.cookie)).status,404)
    assert.equal((await post('/api/auth/send-verification-email',{email:buyer.email,callbackURL:path},buyer.cookie)).status,204)
    const verification = new URL(previews.get(buyer.email))
    assert.equal(verification.origin,origin)
    assert.equal((await request(verification,{headers:{cookie:buyer.cookie,connection:'close'},redirect:'manual'})).status,302)
    const visible = await get(path,buyer.cookie)
    assert.equal(visible.status,200,await visible.clone().text())
    assert.match(await visible.text(),/確認用の成果物/)
    assert.equal((await get(path,outsider.cookie)).status,404)
    assert.equal((await post('/api/cases/answer-quote',{caseId,quoteId,decision:'accept'},outsider.cookie)).status,404)
    assert.equal((await json(await post('/api/cases/answer-quote',{caseId,quoteId,decision:'accept'},buyer.cookie))).status,'accepted')
    assert.equal((await json(await post('/api/cases/answer-request',{caseId,requestId,reply:'来月を希望します'},buyer.cookie))).answered,true)
    assert.equal((await json(await post('/api/cases/receive',{caseId,actionId},buyer.cookie))).status,'received')
    await tool(first.projectId,'deal_status_update',{caseId,expectedVersion:version,status:'ordered',idempotencyKey:randomUUID()})
    assert.match(await (await get('/cases/' + caseId,owner.cookie)).text(),/来月を希望します/)
    await publish('制作サポート 改訂')
    await close(server)
    server = null
    await start(first)
    assert.match(await (await get(path,buyer.cookie)).text(),/承認済み/)

    await close(server)
    server = null
    await start(second)
    const sales = await publish('営業の受付')
    assert.equal(sales.appBase,undefined)
    const intake = await json(await post('/api/cases/intake',{...fields,idempotencyKey:randomUUID()}),201)
    const sale = await tool(second.projectId,'deal_create_from_inquiry',{inquiryId:intake.inquiryId,idempotencyKey:randomUUID()})
    const planned = await json(await operate('update',{caseId:sale.caseId,expectedVersion:1,status:'estimating',dueOn:'2027-01-30',nextAction:'商談する',assigneeId:owner.principalId,idempotencyKey:randomUUID()}))
    assert.equal(planned.dueOn,'2027-01-30')
    await tool(second.projectId,'deal_status_update',{caseId:sale.caseId,expectedVersion:planned.version,status:'lost',idempotencyKey:randomUUID()})
    const person = (await tool(second.projectId,'inbox_list',{})).inquiries[0].contactId
    assert.equal((await tool(second.projectId,'customer_get',{contactId:person})).inquiries[0].stage,'lost')
    assert.equal((await mcp.callTool({name:'deal_get',arguments:{projectId:second.projectId,caseId}})).isError,true)
    assert.doesNotMatch(await (await get('/cases/' + sale.caseId,owner.cookie)).text(),/納品を登録/)
  } finally {
    await mcp?.close()
    if (server?.listening) await close(server)
    await pool.end()
    await fixture.close()
    await rm(directory,{recursive:true,force:true})
  }
})
