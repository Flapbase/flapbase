import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFreeProduct } from '../examples/cloud-starter/cloud.mjs'
import { buildSite } from '../examples/cloud-starter/site.mjs'

const id = 'd44fd1bf-d190-539a-a84a-61660caddd7c'
const valid = { listingId: id, priceYen: 0, kind: 'download', title: '資料', description: '準備の順序' }

test('the local preview renders without contacting Cloud and escapes edited content', async () => {
  const html = await buildSite({title:'<img src=x onerror=alert(1)>',description:'例',productId:null}, () => {
    assert.fail('Local preview contacted Cloud')
  })
  assert.match(html, /<h1>&lt;img /)
  assert.doesNotMatch(html, /href="https:\/\/flap.page/)
})

test('the configured starter reads public product data and hands off only to the canonical public page', async () => {
  const html = await buildSite({title:'資料',description:'',productId:id}, async (url, request) => {
    if (request.method === 'HEAD') {
      assert.equal(url, 'https://flap.page/products/' + id)
      assert.equal(request.redirect, 'manual')
      return new Response(null,{headers:{'content-type':'text/html; charset=utf-8'}})
    }
    assert.equal(url, 'https://api.flapbase.com/api/commerce/own-site/v1/products/' + id)
    assert.deepEqual(request.headers, { accept: 'application/json' })
    assert.equal(request.redirect, 'manual')
    return Response.json({...valid,buyerEmail:'synthetic@example.test'})
  })
  assert.match(html, new RegExp('href="https://flap.page/products/' + id + '"'))
  assert.match(html, /Flap ID/)
  assert.match(html, /準備の順序/)
  assert.doesNotMatch(html, /synthetic@example.test/)
})

test('unpublished, paid, and mismatched products cannot be advertised as a free download', async () => {
  await assert.rejects(readFreeProduct(id, async () => new Response(null,{status:404})), /lookup failed/)
  await assert.rejects(readFreeProduct(id, async () => Response.json({...valid,priceYen:500})), /published free download/)
  await assert.rejects(readFreeProduct(id, async () => Response.json({...valid,listingId:'another'})), /published free download/)
  await assert.rejects(readFreeProduct(id, async (_url,init) =>
    init.method === 'HEAD' ? new Response(null,{status:404}) : Response.json(valid)), /Publish the product page/)
  await assert.rejects(readFreeProduct('https://example.test/', () => assert.fail('Invalid IDs cannot be fetched')), /Invalid product ID/)
})
