import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
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
import { createFreeDownloadStore, sha } from './free-download.mjs'
import { createStoreLifecycle } from './lifecycle.mjs'
import { createStripePayment } from './payment.mjs'
import { startArtifactTestPostgres } from './postgres-fixture.mjs'
import { createSelfHostedServer } from './server.mjs'
import { setupProject } from './setup.mjs'
import { renderProduct } from './store-http.mjs'
import { businessCommand } from '../../bin/business.js'

const listen = async (server, port = 0) => {
  server.listen(port, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections?.() })

test('monthly membership uses confirmed paid periods, prevents duplicate subscriptions and stops access after cancellation', { timeout: 20_000 }, async () => {
  const db = await startArtifactTestPostgres()
  const pool = createSelfHostedAuthPool(db.connection)
  const directory = await mkdtemp(join(tmpdir(), 'flap-membership-pg-'))
  let server, mcp
  try {
    const probe = createServer()
    const port = await listen(probe)
    await close(probe)
    const origin = 'http://127.0.0.1:' + port
    const projectId = randomUUID()
    const initial = Math.floor(Date.now() / 1000)
    const end = initial + 29*86400
    const extended = end + 30*86400
    let timestamp = initial * 1000
    const store = await createFreeDownloadStore({ pool, projectId, directory, renderProduct, clock: () => timestamp })
    const lifecycle = createStoreLifecycle({ store, projectId })
    const adapter = createBetterAuthAdapter(pool,{ origin, issuer:'urn:flapbase:self-host:monthly', secret:randomUUID() })
    const secret = 'whsec_membership_fixture'
    const token = randomUUID()
    const delegation = { tokenDigest: sha('Bearer ' + token) }
    const subscriptions = new Map()
    let checkoutCalls = 0, cancellations = 0
    const payment = createStripePayment({ origin, secretKey:'sk_test_membership_fixture', webhookSecret:secret,
      fetchImpl: async (endpoint, init) => {
        if (endpoint.endsWith('/checkout/sessions')) {
          checkoutCalls++
          const orderId = init.body.get('client_reference_id')
          assert.equal(init.body.get('mode'), 'subscription')
          assert.equal(init.body.get('line_items[0][price_data][recurring][interval]'), 'month')
          assert.equal(init.body.get('success_url'), origin+'/membership/orders/'+orderId)
          assert.equal(init.body.get('subscription_data[metadata][flap_membership_order]'), orderId)
          const id = 'cs_test_'+orderId.replaceAll('-','')
          return Response.json({ id, livemode:false, client_reference_id:orderId, url:'https://checkout.stripe.com/c/pay/'+id })
        }
        const id = endpoint.split('/').at(-1)
        const subscription = subscriptions.get(id)
        assert.ok(subscription)
        if (init.method === 'POST') {
          assert.equal(init.body.get('cancel_at_period_end'), 'true')
          subscription.cancel_at_period_end = true
          cancellations++
        }
        return Response.json(subscription)
      },
    })
    server = createSelfHostedServer({ origin, pool, adapter, store, lifecycle, payment, delegation })
    await listen(server, port)
    const get = (path, cookie) => fetch(origin+path,{headers:cookie ? {cookie} : {},redirect:'manual'})
    const post = (path, body, cookie) => fetch(origin+path,{method:'POST',headers:{origin,'content-type':'application/json',...(cookie && {cookie})},body:JSON.stringify(body)})
    async function register(name) {
      const joined = await post('/api/auth/sign-up/email',{ name, email:name+'@example.test', password:randomUUID() })
      assert.equal(joined.status,204)
      const cookie = joined.headers.getSetCookie().find(item => item.startsWith('better-auth.session_token=')).split(';')[0]
      return { cookie, ...(await (await get('/auth/context',cookie)).json()) }
    }
    const owner = await register('owner'), buyer = await register('buyer'), other = await register('other')
    delegation.principalId = owner.principalId
    await setupProject(pool,{ownerId:owner.principalId,projectId,name:'月額会員'})
    assert.equal((await businessCommand(['inspect','paid-membership'])).localLaunch.path,'/membership')
    const fields = { title:'会員プラン', description:'月額プランのご案内', content:'会員だけが読める限定記事', amountMinor:1500 }
    mcp = new Client({name:'flap-membership-test',version:'1.0.0'})
    await mcp.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./mcp.mjs',import.meta.url))],
      env:{FLAP_ORIGIN:origin,FLAP_STORE_AGENT_TOKEN:token}}))
    const draft = await mcp.callTool({ name:'product_draft_save', arguments:{
      title:fields.title, description:fields.description, membershipContent:fields.content,
    }})
    assert.equal(draft.isError,undefined)
    assert.match(await (await get('/membership',owner.cookie)).text(),/会員だけが読める限定記事/)
    assert.equal((await get('/membership',other.cookie)).status,403)
    assert.equal((await mcp.callTool({ name:'membership_publish',arguments:{} })).isError,true)
    const offers = '/api/membership/v1/offers'
    assert.equal((await post(offers,fields,other.cookie)).status,403)
    const offerReply = await post(offers,fields,owner.cookie)
    assert.equal(offerReply.status,201)
    const offer = await offerReply.json()
    const publicSite = await (await get(offer.purchaseUrl)).text()
    assert.match(publicSite,/1,500円／月/)
    assert.match(publicSite,/入会する/)
    assert.doesNotMatch(publicSite,/会員だけが読める限定記事/)
    const checkout = (item, actor) => post('/api/commerce/own-site/v1/checkout',{listingId:item.listingId,revisionId:item.listingRevisionId},actor.cookie)
    const reservation = await (await checkout(offer,buyer)).json()
    assert.equal(checkoutCalls,1)
    assert.match(await (await get(reservation.receiptUrl,buyer.cookie)).text(),/入金待ち/)
    assert.equal((await get(reservation.receiptUrl,other.cookie)).status,404)
    const orderId = reservation.orderId
    const subscriptionId = 'sub_membership_test'
    const subscription = {id:subscriptionId, object:'subscription', livemode:false, status:'active', metadata:{flap_membership_order:orderId}}
    subscriptions.set(subscriptionId, subscription)
    const webhook = (type, object, valid = true) => {
      const now = Math.floor(Date.now()/1000)
      const body = JSON.stringify({id:'evt_'+randomUUID().replaceAll('-',''),object:'event',livemode:false,type,data:{object}})
      const digest = createHmac('sha256',secret).update(now+'.'+body).digest('hex')
      return fetch(origin+'/api/store/payment/webhook',{method:'POST',headers:{'stripe-signature':'t='+now+',v1='+(valid ? digest : '0'.repeat(64))},body})
    }
    const invoice = (start,finish,amount=1500) => ({id:'in_membership_test',object:'invoice',livemode:false,status:'paid',currency:'jpy',
      amount_paid:amount,billing_reason:start===initial?'subscription_create':'subscription_cycle',
      parent:{subscription_details:{subscription:subscriptionId,metadata:subscription.metadata}},
      lines:{has_more:false,data:[{amount,parent:{subscription_item_details:{subscription:subscriptionId,proration:false}},period:{start,end:finish}}]}})
    assert.equal((await webhook('invoice.paid',invoice(initial,end),false)).status,400)
    assert.equal((await webhook('invoice.paid',invoice(initial,end,1501))).status,409)
    subscription.status = 'incomplete'
    assert.equal((await webhook('invoice.paid',invoice(initial,end))).status,200)
    assert.match(await (await get(reservation.receiptUrl,buyer.cookie)).text(),/入金待ち/)
    subscription.status = 'active'
    assert.equal((await webhook('invoice.paid',invoice(initial,end))).status,200)
    assert.equal((await webhook('invoice.paid',invoice(initial,end))).status,200)
    assert.match(await (await get(reservation.receiptUrl,buyer.cookie)).text(),/会員だけが読める限定記事/)
    assert.equal((await get('/receive/orders/'+orderId+'/download',buyer.cookie)).status,404)
    assert.equal((await checkout(offer,buyer).then(response=>response.json())).orderId,orderId)
    assert.equal(checkoutCalls,1)

    timestamp = end * 1000
    assert.doesNotMatch(await (await get(reservation.receiptUrl,buyer.cookie)).text(),/会員だけが読める限定記事/)
    assert.equal((await checkout(offer,buyer)).status,409)
    assert.equal((await webhook('invoice.paid',invoice(end,extended))).status,200)
    assert.equal((await webhook('invoice.paid',invoice(initial,end))).status,200)
    assert.equal((await store.membershipOrder(buyer.principalId,orderId)).periodEnd,extended*1000)
    assert.match(await (await get(reservation.receiptUrl,buyer.cookie)).text(),/会員だけが読める限定記事/)

    const cancel = '/api/membership/v1/orders/'+orderId+'/cancel'
    assert.equal((await post(cancel,{},other.cookie)).status,404)
    assert.equal((await post(cancel,{},buyer.cookie)).status,200)
    assert.equal((await post(cancel,{},buyer.cookie)).status,200)
    assert.equal(cancellations,1)
    const endingPage = await (await get(reservation.receiptUrl,buyer.cookie)).text()
    assert.match(endingPage,/期間末で退会/)
    assert.match(endingPage,/会員だけが読める限定記事/)
    assert.match(await (await get('/membership',owner.cookie)).text(),/期間末で退会/)

    const roster = project => mcp.callTool({name:'membership_roster_list',arguments:{projectId:project}})
    const listed = JSON.parse((await roster(projectId)).content[0].text)
    assert.deepEqual(listed.items.map(item=>[item.id,item.status,item.cancelAtPeriodEnd]),[[orderId,'ending',true]])
    assert.equal((await roster(randomUUID())).isError,true)
    timestamp = extended * 1000
    assert.doesNotMatch(await (await get(reservation.receiptUrl,buyer.cookie)).text(),/会員だけが読める限定記事/)
    assert.equal((await webhook('customer.subscription.deleted',{...subscription,status:'canceled',ended_at:extended})).status,200)
    assert.equal((await webhook('invoice.paid',invoice(end,extended))).status,200)
    assert.equal((await store.membershipOrder(buyer.principalId,orderId)).state,'cancelled')
    const resubscribe = await checkout(offer,buyer).then(response=>response.json())
    assert.notEqual(resubscribe.orderId,orderId)
    assert.equal(checkoutCalls,2)
    const abandoned = { id:'cs_test_'+resubscribe.orderId.replaceAll('-',''), object:'checkout.session', livemode:false,
      mode:'subscription',status:'expired',metadata:{flap_membership_order:resubscribe.orderId},client_reference_id:resubscribe.orderId }
    assert.equal((await webhook('checkout.session.expired',abandoned)).status,200)
    const retry = await checkout(offer,buyer).then(response=>response.json())
    assert.notEqual(retry.orderId,resubscribe.orderId)
    assert.equal(checkoutCalls,3)
  } finally {
    try { await mcp?.close(); if(server) await close(server); await pool.end() }
    finally { await db.close(); await rm(directory,{recursive:true,force:true}) }
  }
})
