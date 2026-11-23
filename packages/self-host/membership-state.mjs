export function membershipState(order, now = Date.now()) {
  if (order.endedAt !== undefined || order.status === 'cancelled') return 'cancelled'
  if (order.status === 'pending') return 'pending'
  if (order.status !== 'paid' || !(order.paidFrom <= now && now < order.paidThrough)) return 'expired'
  return order.cancelAtPeriodEnd ? 'ending' : 'active'
}

export const canReadMembership = (order, now) => ['active', 'ending'].includes(membershipState(order, now))

export function membershipEvent(order, event) {
  if (event.kind === 'membership-checkout-expired') {
    if (order.paymentSession !== event.sessionId) return null
    return order.status === 'pending' ? { ...order, status: 'cancelled' } : order
  }
  if (order.subscriptionId && order.subscriptionId !== event.subscriptionId) return null
  if (event.kind === 'membership-ended') {
    return { ...order, subscriptionId: event.subscriptionId, endedAt: order.endedAt ?? event.endedAt, status: 'cancelled' }
  }
  if (order.endedAt !== undefined || order.status === 'cancelled' || order.paidThrough >= event.periodEnd) return order
  const paidFrom = order.paidThrough >= event.periodStart ? Math.min(order.paidFrom, event.periodStart) : event.periodStart
  return { ...order, subscriptionId: event.subscriptionId, paidFrom, paidThrough: event.periodEnd, status: 'paid' }
}
