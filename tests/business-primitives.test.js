import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeSlots, withoutAllDay, zonedInstant } from '../packages/booking-slots/src/slots.js'
import { eligibleForScenario, matchesDeliveryCondition, stepDueAt, validateDeliveryCondition } from '../packages/step-delivery/src/step-delivery.js'

const time = Date.parse
const day = { from: time('2026-11-09T15:00:00Z'), to: time('2026-11-10T15:00:00Z'), now: time('2026-11-01T00:00:00Z'), occupied: [], busy: [] }
const rules = {
  timeZone: 'Asia/Tokyo', weeklyHours: { 2: [['09:00', '12:00'], ['13:00', '15:00']] }, exceptions: [],
  durationMinutes: 60, startStepMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, minNoticeMinutes: 0, horizonDays: 60,
}
test('booking candidates respect exceptions, buffers, occupied periods and valid step sizes', () => {
  const occupied = [[time('2026-11-10T01:00:00Z'), time('2026-11-10T02:00:00Z')]]
  assert.deepEqual(computeSlots({ ...rules, bufferAfterMinutes: 30 }, { ...day, occupied }).map(value => value.slice(11, 16)), [
    '02:00', '04:00', '04:30', '05:00',
  ])
  assert.deepEqual(computeSlots({ ...rules, exceptions: [{ date: '2026-11-10', hours: [] }] }, day), [])
  assert.throws(() => computeSlots({ ...rules, startStepMinutes: 0 }, day), RangeError)
  assert.equal(new Date(zonedInstant('2026-03-08', '09:00', 'America/New_York')).toISOString(), '2026-03-08T13:00:00.000Z')
  assert.deepEqual(withoutAllDay([[day.from, day.to], ...occupied], rules.timeZone), occupied)
})

test('step delivery validates segments, limits enrollment to approved scenarios and computes the schedule', () => {
  const condition = validateDeliveryCondition({ type: 'all', conditions: [
    { field: 'source', op: 'eq', value: 'free-resource' },
    { field: 'attributes.score', op: 'gte', value: 10 },
  ] })
  const contact = { id: 'contact', source: 'free-resource', attributes: { score: 12 }, erased: false }
  const event = { workspaceId: 'workspace', contactId: contact.id, kind: 'form' }
  const scenario = { workspaceId: event.workspaceId, state: 'active', trigger: { kind: 'form' }, segment: condition, approvedBy: 'owner', digest: 'pin' }
  assert.equal(matchesDeliveryCondition(contact, condition), true)
  assert.equal(eligibleForScenario(scenario, event, contact), true)
  assert.equal(eligibleForScenario({ ...scenario, approvedBy: undefined }, event, contact), false)
  assert.equal(eligibleForScenario(scenario, event, { ...contact, erased: true }), false)
  assert.throws(() => validateDeliveryCondition({ field: 'price', op: 'gte', value: 1 }), /invalid_request/)
  assert.equal(stepDueAt('2026-11-23T02:00:00.000Z', { waitDays: 2 }), '2026-11-25T02:00:00.000Z')
})
