import { createHmac, timingSafeEqual } from 'node:crypto'

const stripeApi = 'https://api.stripe.com/v1'
const checkoutApi = stripeApi + '/checkout/sessions'
const subscriptionRef = /^sub_[a-zA-Z0-9_]{1,240}$/
const invoiceRef = /^in_[a-zA-Z0-9_]{1,240}$/
const seconds = value => Number.isSafeInteger(value) && value > 0 && value <= 8_640_000_000_000
const invalidEvent = () => new PaymentError(400, 'invalid_stripe_event')
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

  async function subscription(id, body) {
    if (!subscriptionRef.test(id)) throw invalidEvent()
    const response = await fetchImpl(stripeApi + '/subscriptions/' + id, {
      method: body ? 'POST' : 'GET', body, redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { Authorization: 'Bearer ' + secretKey, 'Stripe-Version': '2025-03-31.basil',
        ...(body && { 'Idempotency-Key': 'flap-membership-cancel:' + id }) },
    })
    if (!response.ok) throw new PaymentError(502, 'stripe_subscription_unavailable')
    const value = await response.json()
    if (value?.object !== 'subscription' || value.id !== id || value.livemode !== false) {
      throw new PaymentError(502, 'stripe_subscription_unavailable')
    }
    return value
  }

  return {
    async startCheckout({ orderId, amountMinor, title, currency = 'jpy', recurring = false }) {
      if (typeof orderId !== 'string' || !uuid.test(orderId) || !Number.isSafeInteger(amountMinor)
          || amountMinor < 50 || amountMinor > 10_000_000 || currency !== 'jpy'
          || typeof title !== 'string' || !title.trim() || title.length > 160) {
        throw new PaymentError(400, 'invalid_checkout')
      }
      const body = new URLSearchParams({
        mode: recurring ? 'subscription' : 'payment',
        client_reference_id: orderId,
        'payment_method_types[0]': 'card',
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': currency,
        'line_items[0][price_data][unit_amount]': String(amountMinor),
        'line_items[0][price_data][product_data][name]': title,
        success_url: origin + (recurring ? '/membership/orders/' : '/receive/orders/') + orderId,
        cancel_url: origin + '/',
      })
      if (recurring) {
        body.set('line_items[0][price_data][recurring][interval]', 'month')
        body.set('subscription_data[metadata][flap_membership_order]', orderId)
        body.set('metadata[flap_membership_order]', orderId)
      }
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

    async cancelMembership(subscriptionId, orderId) {
      const value = await subscription(subscriptionId, new URLSearchParams({ cancel_at_period_end: 'true' }))
      if (value.metadata?.flap_membership_order !== orderId || value.cancel_at_period_end !== true) {
        throw new PaymentError(502, 'stripe_subscription_unavailable')
      }
    },

    async resolveMembershipInvoice(invoice) {
      const value = await subscription(invoice.subscriptionId)
      const orderId = value.metadata?.flap_membership_order
      if (!uuid.test(orderId ?? '')) return null
      if (invoice.orderId && orderId !== invoice.orderId) throw invalidEvent()
      if (value.status !== 'active') return null
      return { ...invoice, orderId, kind: 'membership-paid' }
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
      const data = event.data?.object
      if (event.type === 'invoice.paid') {
        const details = data?.parent?.subscription_details
        const subscriptionId = details?.subscription ?? data?.subscription
        if (!subscriptionId) return null
        const orderId = details?.metadata?.flap_membership_order ?? data.subscription_details?.metadata?.flap_membership_order
        if (!uuid.test(orderId ?? '')) return null
        if (data.object !== 'invoice' || data.livemode !== false || !invoiceRef.test(data.id) || data.status !== 'paid' ||
            !subscriptionRef.test(subscriptionId) || data.currency !== 'jpy' || !['subscription_create','subscription_cycle'].includes(data.billing_reason) ||
            !Number.isSafeInteger(data.amount_paid) || data.amount_paid < 50 || data.amount_paid > 10_000_000 ||
            data.lines?.has_more !== false || data.lines.data?.length !== 1) throw invalidEvent()
        const line = data.lines.data[0]
        const item = line.parent?.subscription_item_details
        if ((item ? item.subscription !== subscriptionId || item.proration !== false : line.type !== 'subscription' || line.proration !== false) ||
            line.amount !== data.amount_paid || !seconds(line.period?.start) || !seconds(line.period?.end) ||
            line.period.end <= line.period.start || line.period.end - line.period.start > 32 * 86400) throw invalidEvent()
        return { kind: 'membership-invoice', orderId, subscriptionId, amountMinor: data.amount_paid,
          periodStart: line.period.start * 1000, periodEnd: line.period.end * 1000 }
      }
      if (event.type === 'customer.subscription.deleted') {
        const orderId = data?.metadata?.flap_membership_order
        if (!uuid.test(orderId ?? '')) return null
        if (data.object !== 'subscription' || data.livemode !== false || data.status !== 'canceled' ||
            !subscriptionRef.test(data.id) || !seconds(data.ended_at)) throw invalidEvent()
        return { kind: 'membership-ended', orderId, subscriptionId: data.id, endedAt: data.ended_at * 1000 }
      }
      if (event.type === 'checkout.session.expired') {
        const orderId = data?.metadata?.flap_membership_order
        if (!uuid.test(orderId ?? '')) return null
        if (data.object !== 'checkout.session' || data.livemode !== false || data.mode !== 'subscription' ||
            data.status !== 'expired' || data.client_reference_id !== orderId || !sessionRef.test(data.id)) throw invalidEvent()
        return { kind: 'membership-checkout-expired', orderId, sessionId: data.id }
      }
      if (!paymentEvents.has(event.type)) return null
      const session = data
      if (session?.mode === 'subscription' && session.client_reference_id === session.metadata?.flap_membership_order) return null
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
