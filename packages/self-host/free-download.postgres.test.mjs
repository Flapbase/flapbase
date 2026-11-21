import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHmac, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { startArtifactTestPostgres } from './postgres-fixture.mjs'
import { createBetterAuthAdapter, createSelfHostedAuthPool } from './auth.mjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import { createStripePayment } from './payment.mjs'
import { createStoreLifecycle } from './lifecycle.mjs'
import { createFreeDownloadStore, sha } from './free-download.mjs'
import { createSelfHostedServer } from './server.mjs'
import { renderProduct } from './store-http.mjs'
import { setupProject } from './setup.mjs'

const listen = (server, port=0) => new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(port, '127.0.0.1', () => resolve(server.address().port))
})
const close = server => new Promise(resolve => {
  server.close(resolve)
  server.closeAllConnections?.()
})
test('self-host completes the digital product lifecycle through external MCP and signed test payments', { timeout: 35_000 }, async () => {
  const db = await startArtifactTestPostgres({ encoding:'UTF8' })
  const pool = createSelfHostedAuthPool(db.connection)
  const directory = await mkdtemp(join(tmpdir(), 'flap-store-test-'))
  let server
  try {
    const probe = createServer()
    const port = await listen(probe)
    await close(probe)
    const origin = 'http://127.0.0.1:' + port
    const projectId = randomUUID()
    const store = await createFreeDownloadStore({ pool, projectId, directory,
      renderProduct: product => renderProduct({ ...product, leadEnabled: true }) })
    const emails = []
    const lifecycle = createStoreLifecycle({ store, projectId, sendEmail: async email => { emails.push(email) } })
    const signingSecret = 'whsec_local_only'
    const payment = createStripePayment({ origin, secretKey: 'sk_test_local_only', webhookSecret: signingSecret,
      fetchImpl: async (_, request) => {
        const orderId = request.body.get('client_reference_id')
        const id = 'cs_test_' + orderId.replaceAll('-', '')
        assert.equal(request.headers['Idempotency-Key'], orderId)
        return Response.json({ id, url: 'https://checkout.stripe.com/c/pay/' + id, livemode: false, client_reference_id: orderId })
      },
    })
    const token = randomUUID() + randomUUID()
    const delegation = { tokenDigest: sha('Bearer ' + token) }
    const adapter = createBetterAuthAdapter(pool, { origin, issuer:'urn:flapbase:self-host:free-test', secret:randomUUID() })
    server = createSelfHostedServer({ origin, pool, adapter, store, lifecycle, payment, delegation })
    await listen(server, port)
    const get = (path, cookie) => fetch(origin + path, {headers:cookie ? {cookie} : {}})
    const post = (path, body, cookie, sender=origin) => fetch(origin + path, {
      method:'POST', headers:{ origin:sender, 'content-type':'application/json', ...(cookie ? {cookie} : {}) }, body:JSON.stringify(body),
    })
    async function register(name) {
      const response = await post('/api/auth/sign-up/email',{name,email:name+'@example.test',password:randomUUID()})
      assert.equal(response.status,204)
      const cookie = response.headers.getSetCookie().find(value => value.startsWith('better-auth.session_token=')).split(';')[0]
      const context = await get('/auth/context',cookie)
      assert.equal(context.status,200)
      return { cookie, ...(await context.json()) }
    }
    const owner = await register('owner'), buyer = await register('buyer'), other = await register('other')
    delegation.principalId = owner.principalId
    const projectSetup = { ownerId:owner.principalId, projectId, name:'資料配布' }
    assert.equal(await setupProject(pool, projectSetup), projectId)
    assert.equal(await setupProject(pool, projectSetup), projectId)
    await assert.rejects(setupProject(pool, { ...projectSetup, ownerId:buyer.principalId }), /Project already exists/)
    const [{ workspace_id:workspace }] = await db.sql.query('SELECT workspace_id FROM platform.projects WHERE project_id=$1', [projectId])
    const baseFile = fileURLToPath(new URL('./digital-product.base', import.meta.url))
    const definition = JSON.parse(await readFile(baseFile, 'utf8'))
    const install = async principalId => {
      const { stdout } = await promisify(execFile)(process.execPath, [
        fileURLToPath(new URL('./install-base.mjs', import.meta.url)), baseFile,
      ], { env: { FLAP_AUTH_DATABASE_URL: db.connection, FLAP_STORE_OWNER_ID: principalId,
        FLAP_STORE_PROJECT_ID: projectId, FLAP_STORE_DATA_DIR: directory } })
      return JSON.parse(stdout)
    }
    await assert.rejects(install(buyer.principalId))
    const installation = await install(owner.principalId)
    assert.deepEqual(installation.base, definition)
    assert.deepEqual(await install(owner.principalId), installation)
    const storePage = await get('/store', owner.cookie)
    assert.match(await storePage.text(), /はじめての制作ガイド/)
    const conflicting = { ...definition, presentation: { ...definition.presentation, heading: '別の案内' } }
    await assert.rejects(lifecycle.installBase(owner.principalId, conflicting), { status: 409 })
    await assert.rejects(lifecycle.installBase(owner.principalId, { ...definition, projectId }), { status: 400 })
    const publish = (title,content, cookie=owner.cookie, listingId) => post('/api/store/publish',{
      ...(listingId?{listingId}:{}),title,description:'<script>unsafe</script>',fileName:'資料.txt',content:Buffer.from(content).toString('base64'),
    },cookie)
    assert.equal((await publish('権限外','bad',buyer.cookie)).status,403)
    const created = await publish('資料 第1版','first')
    assert.equal(created.status,201,await created.clone().text())
    const first = await created.json()
    const publicPage = await get(first.purchaseUrl)
    assert.equal(publicPage.status,200)
    const markup = await publicPage.text()
    assert.match(markup,/資料 第1版/)
    assert.doesNotMatch(markup,/<script>unsafe/)
    const checkout = (item,cookie,sender) => post('/api/commerce/own-site/v1/checkout',{
      listingId:item.listingId,revisionId:item.listingRevisionId,
    },cookie,sender)
    assert.equal((await checkout(first)).status,401)
    assert.equal((await checkout(first,buyer.cookie,'https://wrong.example.test')).status,403)
    const receipts = await Promise.all([checkout(first,buyer.cookie),checkout(first,buyer.cookie)])
    assert.deepEqual(receipts.map(r=>r.status),[201,201])
    const [one,replay] = await Promise.all(receipts.map(r=>r.json()))
    assert.equal(one.orderId,replay.orderId)
    assert.equal((await get(one.receiptUrl,other.cookie)).status,404)
    const download = one.receiptUrl+'/download'
    assert.equal((await get(download)).status,401)
    assert.equal(await (await get(download,buyer.cookie)).text(),'first')

    const released = await publish('資料 第2版','second',owner.cookie,first.listingId)
    assert.equal(released.status,201,await released.clone().text())
    const second = await released.json()
    assert.equal(second.purchaseUrl,first.purchaseUrl)
    assert.match(await (await get(first.purchaseUrl)).text(),/資料 第2版/)
    assert.equal(await (await get(download,buyer.cookie)).text(),'first')
    assert.equal((await checkout(first,other.cookie)).status,409)
    const next = await (await checkout(second,buyer.cookie)).json()
    assert.notEqual(next.orderId,one.orderId)
    assert.equal(await (await get(next.receiptUrl+'/download',buyer.cookie)).text(),'second')
    assert.equal((await get('/store',buyer.cookie)).status,403)
    const orders = await get('/store',owner.cookie)
    assert.equal(orders.status,200)
    const page = await orders.text()
    assert.ok(page.includes(`href="${first.purchaseUrl}"`))
    assert.equal((page.match(/無料申込/g)??[]).length,2)
    assert.match(page,/資料 第1版/)
    assert.match(page,/資料 第2版/)
    const mcp = new Client({ name: 'flap-reference-client', version: '1.0.0' })
    const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./mcp.mjs', import.meta.url))],
      env: { FLAP_ORIGIN: origin, FLAP_STORE_AGENT_TOKEN: token } })
    await mcp.connect(transport)
    try {
      async function tool(name, args = {}) {
        const result = await mcp.callTool({ name, arguments: args })
        assert.equal(result.isError, undefined, JSON.stringify(result))
        return JSON.parse(result.content[0].text)
      }
      const tools = await mcp.listTools()
      assert.ok(tools.tools.some(t => t.name === 'follow_up_draft_save'))
      assert.ok(!tools.tools.some(t => t.name === 'publish'))
      await tool('product_draft_save', { title: '制作キット', description: '案内を受け取れます' })
      assert.deepEqual(await install(owner.principalId), installation)
      await tool('follow_up_draft_save', { subject: '制作キットのお知らせ', body: '商品ページをご確認ください' })
      const pendingDraft = await (await get('/store', owner.cookie)).text()
      assert.match(pendingDraft, /value="制作キット"/)
      assert.equal((await post('/api/store/agent', { name: 'operations_summary', arguments: {} })).status, 401)

      const product = await (await post('/api/store/publish', {
        title: '制作キット', description: '案内を受け取れます', amountMinor: 500, fileName: 'キット.txt',
        content: Buffer.from('paid kit').toString('base64'),
      }, owner.cookie)).json()
      assert.match(await (await get(product.purchaseUrl)).text(), /500円/)
      const lead = { listingId: product.listingId, email: 'buyer@example.test', consent: true }
      assert.equal((await post('/api/store/lead', { ...lead, consent: false }, buyer.cookie)).status, 400)
      assert.equal((await post('/api/store/lead', lead, buyer.cookie)).status, 201)
      assert.equal((await post('/api/store/lead', lead, buyer.cookie)).status, 201)
      assert.equal((await tool('operations_summary')).leads, 1)
      const admin = await (await get('/store', owner.cookie)).text()
      assert.match(admin, /制作キットのお知らせ/)
      const leadId = /data-lead="([^"]+)"/.exec(admin)[1]
      const followUp = { leadId, subject: '制作キットのお知らせ', body: '商品ページをご確認ください' }
      assert.equal((await post('/api/store/follow-up', followUp, buyer.cookie)).status, 403)
      assert.deepEqual(await (await post('/api/store/follow-up', followUp, owner.cookie)).json(), { status: 'sent' })
      assert.deepEqual(await (await post('/api/store/follow-up', followUp, owner.cookie)).json(), { status: 'sent' })
      assert.equal(emails.length, 1)
      assert.equal(emails[0].to, lead.email)
      assert.equal((await post('/unsubscribe', { leadId })).status, 200)
      assert.equal((await post('/api/store/follow-up', followUp, owner.cookie)).status, 403)

      const reserved = await (await checkout(product, buyer.cookie)).json()
      assert.match(reserved.checkoutUrl, /^https:\/\/checkout\.stripe\.com/)
      assert.deepEqual(await tool('order_support_get', { projectId, orderId: reserved.orderId }), {
        orderId: reserved.orderId, title: '制作キット', paymentStatus: 'pending', downloadEligible: false, purchaseInquiryId: null,
      })
      assert.equal((await mcp.callTool({ name: 'order_support_get', arguments: { projectId: randomUUID(), orderId: reserved.orderId } })).isError, true)
      assert.equal((await get(reserved.receiptUrl, buyer.cookie)).status, 409)
      assert.equal((await get(reserved.receiptUrl + '/download', buyer.cookie)).status, 409)
      const notification = amount => JSON.stringify({ id: 'evt_trial', object: 'event', type: 'checkout.session.completed', livemode: false,
        data: { object: { object: 'checkout.session', livemode: false, mode: 'payment', status: 'complete', payment_status: 'paid',
          id: 'cs_test_' + reserved.orderId.replaceAll('-', ''), client_reference_id: reserved.orderId, amount_total: amount, currency: 'jpy' } } })
      async function webhook(amount, valid = true) {
        const raw = notification(amount)
        const t = Math.floor(Date.now() / 1000)
        const sig = createHmac('sha256', signingSecret).update(t + '.' + raw).digest('hex')
        return fetch(origin + '/api/store/payment/webhook', { method: 'POST', headers: { 'stripe-signature': 't=' + t + ',v1=' + (valid ? sig : '0'.repeat(64)) }, body: raw })
      }
      assert.equal((await webhook(500, false)).status, 400)
      assert.equal((await webhook(501)).status, 409)
      assert.equal((await webhook(500)).status, 200)
      assert.equal((await webhook(500)).status, 200)
      assert.equal((await tool('order_support_get', { projectId, orderId: reserved.orderId })).downloadEligible, true)
      assert.equal((await get(reserved.receiptUrl + '/download', other.cookie)).status, 404)
      assert.equal(await (await get(reserved.receiptUrl + '/download', buyer.cookie)).text(), 'paid kit')
      const support = { orderId: reserved.orderId, body: 'キットの使い方を教えてください' }
      assert.equal((await post('/api/store/support', support, other.cookie)).status, 404)
      const opened = await (await post('/api/store/support', support, buyer.cookie)).json()
      const [request] = await tool('support_requests_list')
      assert.equal(request.requestId, opened.requestId)
      const details = await tool('support_request_get', opened)
      assert.equal(details.product.title, '制作キット')
      assert.equal(details.received, true)
      const scopedSupport = {projectId, orderId:reserved.orderId}
      const orderRequests = await tool('support_requests_list', scopedSupport)
      assert.equal(orderRequests.requests[0].version,1)
      assert.equal(orderRequests.requests[0].body,support.body)
      const draft = {...scopedSupport,...opened,expectedVersion:1,body:'最初にキット内の案内をご覧ください。'}
      assert.deepEqual(await tool('support_reply_draft_save',draft),{requestId:opened.requestId,version:2})
      assert.deepEqual(await tool('support_reply_draft_save',draft),{requestId:opened.requestId,version:2})
      assert.equal((await mcp.callTool({name:'support_reply_draft_save',arguments:{...draft,body:'古い版の返信'}})).isError,true)
      assert.match(await (await get('/store', owner.cookie)).text(), /最初にキット内の案内をご覧ください/)
      assert.deepEqual(await tool('operations_summary'), { projectId, leads: 1, followUps: 1, orders: 3, downloads: 3, supportPending: 0 })
      await db.sql.query("UPDATE platform.workspace_members SET status='revoked',revoked_at=now() WHERE workspace_id=$1 AND principal_id=$2", [workspace, owner.principalId])
      assert.equal((await mcp.callTool({ name: 'operations_summary', arguments: {} })).isError, true)
    } finally {
      await mcp.close()
    }
    assert.equal((await post('/api/auth/sign-out',{},buyer.cookie)).status,204)
    assert.equal((await get(download,buyer.cookie)).status,401)
  } finally {
    try { if(server) await close(server); await pool.end() }
    finally { await db.close(); await rm(directory,{recursive:true,force:true}) }
  }
})
