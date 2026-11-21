import { createHmac, timingSafeEqual } from 'node:crypto'

const checkoutApi = 'https://api.stripe.com/v1/checkout/sessions'
const acceptanceWindow = 300
const paymentEvents = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded'])
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const sessionRef = /^cs_test_[a-zA-Z0-9_]{1,240}$/
const eventRef = /^evt_[a-zA-Z0-9_]{1,240}$/

export class PaymentError extends Error {
  constructor(status, code) {
    super(code)
    this.status = status
  }
}

function validSignature(body, header, secret, clock) {
  if (typeof header !== 'string' || header.length > 8192 || !Buffer.isBuffer(body)) return false
  const fields = header.split(',').map(part => part.trim())
  const timestamps = fields.filter(part => part.startsWith('t='))
  if (timestamps.length !== 1 || !/^t=[1-9][0-9]{0,11}$/.test(timestamps[0])) return false
  const timestamp = timestamps[0].slice(2)
  if (Math.abs(Math.floor(clock() / 1000) - Number(timestamp)) > acceptanceWindow) return false
  const expected = createHmac('sha256', secret).update(timestamp + '.').update(body).digest()
  return fields.some(part => /^v1=[0-9a-f]{64}$/i.test(part) && timingSafeEqual(expected, Buffer.from(part.slice(3), 'hex')))
}

export function createStripePayment({ secretKey, webhookSecret, origin, fetchImpl = fetch, now = Date.now }) {
  const url = new URL(origin)
  if (url.origin !== origin || url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('The Stripe reference adapter requires an HTTP loopback origin')
  }
  if (typeof secretKey !== 'string' || !/^(sk|rk)_test_[A-Za-z0-9_]+$/.test(secretKey)
      || typeof webhookSecret !== 'string' || !/^whsec_[A-Za-z0-9_]+$/.test(webhookSecret)) {
    throw new Error('The Stripe reference adapter requires a test key and webhook signing secret')
  }

  return {
    async startCheckout({ orderId, amountMinor, title, currency = 'jpy' }) {
      if (typeof orderId !== 'string' || !uuid.test(orderId) || !Number.isSafeInteger(amountMinor)
          || amountMinor < 50 || amountMinor > 10_000_000 || currency !== 'jpy'
          || typeof title !== 'string' || !title.trim() || title.length > 160) {
        throw new PaymentError(400, 'invalid_checkout')
      }
      const body = new URLSearchParams({
        mode: 'payment',
        client_reference_id: orderId,
        'payment_method_types[0]': 'card',
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': currency,
        'line_items[0][price_data][unit_amount]': String(amountMinor),
        'line_items[0][price_data][product_data][name]': title,
        success_url: origin + '/receive/orders/' + orderId,
        cancel_url: origin + '/',
      })
      try {
        const response = await fetchImpl(checkoutApi, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + secretKey, 'Idempotency-Key': orderId },
          body,
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        })
        if (!response.ok) throw new PaymentError(502, 'stripe_checkout_unavailable')
        const session = await response.json()
        const destination = new URL(session.url)
        if (session.livemode !== false || !sessionRef.test(session.id) || session.client_reference_id !== orderId
            || destination.origin !== 'https://checkout.stripe.com' || destination.username || destination.password) {
          throw new PaymentError(502, 'invalid_stripe_checkout')
        }
        return { sessionId: session.id, url: destination.href }
      } catch (error) {
        if (error instanceof PaymentError) throw error
        throw new PaymentError(502, 'stripe_checkout_unavailable')
      }
    },

    verifyWebhook(rawBody, signature) {
      if (!validSignature(rawBody, signature, webhookSecret, now)) throw new PaymentError(400, 'invalid_stripe_signature')
      let event
      try {
        event = JSON.parse(rawBody.toString('utf8'))
      } catch {
        throw new PaymentError(400, 'invalid_stripe_event')
      }
      if (event?.object !== 'event' || event.livemode !== false || event.account || event.context
          || !eventRef.test(event.id) || typeof event.type !== 'string') {
        throw new PaymentError(400, 'invalid_stripe_event')
      }
      if (!paymentEvents.has(event.type)) return null
      const session = event.data?.object
      if (session?.object !== 'checkout.session' || session.livemode !== false || session.mode !== 'payment'
          || session.status !== 'complete' || !sessionRef.test(session.id)
          || !uuid.test(session.client_reference_id) || session.currency !== 'jpy'
          || !Number.isSafeInteger(session.amount_total) || session.amount_total < 50 || session.amount_total > 10_000_000) {
        throw new PaymentError(400, 'invalid_stripe_event')
      }
      if (session.payment_status === 'unpaid' && event.type === 'checkout.session.completed') return null
      if (session.payment_status !== 'paid') throw new PaymentError(400, 'invalid_stripe_event')
      return {
        eventId: event.id,
        sessionId: session.id,
        orderId: session.client_reference_id,
        amountMinor: session.amount_total,
        currency: session.currency,
      }
    },
  }
}
