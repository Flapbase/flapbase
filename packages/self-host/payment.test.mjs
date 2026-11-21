import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'
import { createStripePayment, PaymentError } from './payment.mjs'

const origin = 'http://127.0.0.1:5264'
const secretKey = 'sk_test_reference_only'
const webhookSecret = 'whsec_reference_only'
const orderId = 'f97f3678-7de2-4e23-890b-5ef185c92365'
const sessionId = 'cs_test_reference_checkout'
const url = 'https://checkout.stripe.com/c/pay/' + sessionId
const seconds = 1_800_000_000
const makePayment = options => createStripePayment({ origin, secretKey, webhookSecret, now: () => seconds * 1000, ...options })

function signature(body, timestamp = seconds) {
  return 't=' + timestamp + ',v1=' + createHmac('sha256', webhookSecret).update(timestamp + '.').update(body).digest('hex')
}

function signedEvent(type, props = {}, eventProps = {}) {
  const body = Buffer.from(JSON.stringify({
    id: 'evt_reference_event', object: 'event', livemode: false, type,
    data: { object: {
      id: sessionId, object: 'checkout.session', mode: 'payment', status: 'complete', livemode: false,
      client_reference_id: orderId, amount_total: 500, currency: 'jpy', payment_status: 'paid', ...props,
    } },
    ...eventProps,
  }))
  return [body, signature(body)]
}

test('starts Checkout with an order-bound idempotency key and a price from the order', async () => {
  let calls = 0
  const payment = makePayment({
    fetchImpl: async (endpoint, request) => {
      calls += 1
      assert.equal(endpoint, 'https://api.stripe.com/v1/checkout/sessions')
      assert.equal(request.headers['Idempotency-Key'], orderId)
      assert.equal(request.redirect, 'error')
      assert.equal(request.body.get('success_url'), origin + '/receive/orders/' + orderId)
      assert.equal(request.body.get('mode'), 'payment')
      assert.equal(request.body.get('client_reference_id'), orderId)
      assert.equal(request.body.get('line_items[0][price_data][unit_amount]'), '500')
      assert.equal(request.body.get('line_items[0][price_data][currency]'), 'jpy')
      return Response.json({ id: sessionId, url, livemode: false, client_reference_id: orderId })
    },
  })
  assert.deepEqual(await payment.startCheckout({ orderId, amountMinor: 500, title: '資料' }), { sessionId, url })
  await assert.rejects(payment.startCheckout({ orderId, amountMinor: 0, title: '資料' }), { status: 400 })
  assert.equal(calls, 1)
  const wrongHost = makePayment({ fetchImpl: async () => Response.json({
    id: sessionId, url: 'https://checkout.stripe.com.example.test/', livemode: false, client_reference_id: orderId,
  }) })
  await assert.rejects(wrongHost.startCheckout({ orderId, amountMinor: 500, title: '資料' }), { status: 502 })
  assert.throws(() => makePayment({ secretKey: 'sk_live_reference_only' }), /test key/)
})

test('verifies exact bytes and returns only completed paid test Checkout events', () => {
  const { verifyWebhook } = makePayment()
  const [body, header] = signedEvent('checkout.session.completed')
  assert.deepEqual(verifyWebhook(body, 'v1=' + '0'.repeat(64) + ',' + header), {
    eventId: 'evt_reference_event', sessionId, orderId, amountMinor: 500, currency: 'jpy',
  })
  assert.equal(verifyWebhook(...signedEvent('checkout.session.completed', { payment_status: 'unpaid' })), null)
  assert.equal(verifyWebhook(...signedEvent('payment_intent.succeeded')), null)
  assert.equal(verifyWebhook(...signedEvent('checkout.session.async_payment_succeeded')).orderId, orderId)
  for (const [payload, auth] of [
    [Buffer.concat([body, Buffer.from(' ')]), header],
    [body, signature(body, seconds - 301)],
    [body, signature(body, seconds + 301)],
    [body, 't=' + seconds + ',' + header],
    signedEvent('checkout.session.completed', { currency: 'usd' }),
    signedEvent('checkout.session.completed', {}, { livemode: true }),
    signedEvent('checkout.session.completed', {}, { account: 'acct_other' }),
  ]) {
    assert.throws(() => verifyWebhook(payload, auth), error => error instanceof PaymentError && error.status === 400)
  }
})
