import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createSelfHostedAuthPool } from './auth.mjs'
import { createBooking } from './booking.mjs'
import { startArtifactTestPostgres } from './postgres-fixture.mjs'
import { setupBookingSchema, setupProject } from './setup.mjs'

function startsIn(days, hour) {
  const date = new Date(Date.now() + days * 86_400_000)
  date.setUTCHours(hour, 0, 0, 0)
  return date.toISOString()
}

const hours = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [index + 1, [['09:00', '17:00']]]))
const host = { displayName: '受付担当', timeZone: 'Etc/UTC', weeklyHours: hours }
const offer = title => ({ title, durationMinutes: 30, capacity: 1, minNoticeMinutes: 0 })

test('the generated booking SQL handles individual reservations and events in separate Projects', { timeout: 20_000 }, async () => {
  const fixture = await startArtifactTestPostgres()
  const pool = createSelfHostedAuthPool(fixture.connection)
  try {
    await setupBookingSchema(pool)
    await setupBookingSchema(pool)
    const [owner, customer, second, third] = await Promise.all(['owner', 'customer', 'second', 'third'].map(async name => {
      const [{ principal_id }] = await fixture.sql.query(
        "INSERT INTO identity.principals(principal_kind,email,created_by) VALUES('human',$1,'booking-test') RETURNING principal_id",
        [name + '@example.test'],
      )
      return principal_id
    }))
    const projectId = randomUUID(), otherProjectId = randomUUID()
    await setupProject(pool, { ownerId: owner, projectId, name: '予約サービス' })
    const [{ workspace_id: workspace }] = await fixture.sql.query('SELECT workspace_id FROM platform.projects WHERE project_id=$1', [projectId])
    await fixture.sql.query(
      "INSERT INTO platform.projects(project_id,workspace_id,name,slug,created_by_principal_id) VALUES($1,$2,'別Project','event',$3)",
      [otherProjectId, workspace, owner],
    )
    const booking = createBooking({ pool, projectId })
    const event = createBooking({ pool, projectId: otherProjectId })
    const save = async (service, menu) => (await service.saveOffer(owner, { host, offer: menu, idempotencyKey: randomUUID() })).offerId
    await assert.rejects(booking.saveOffer(customer, { host, offer: offer('無権限'), idempotencyKey: randomUUID() }), { status: 403 })
    const consultation = await save(booking, offer('オンライン相談'))
    const meeting = await save(event, { ...offer('説明会'), capacity: 2 })
    const from = startsIn(2, 9), to = startsIn(2, 17)
    assert.ok((await booking.slots(consultation, from, to)).available.includes(from))
    await assert.rejects(event.slots(consultation, from, to), { status: 404 })
    const initial = { startsAt: from, idempotencyKey: randomUUID() }
    const { bookingId } = await booking.reserve(customer, consultation, initial)
    assert.equal((await booking.reserve(customer, consultation, initial)).bookingId, bookingId)
    await assert.rejects(booking.reserve(customer, consultation, { ...initial, startsAt: startsIn(2, 10) }), { status: 409 })
    assert.ok(!(await booking.slots(consultation, from, to)).available.includes(from))
    await assert.rejects(booking.customerBooking(second, bookingId), { status: 404 })
    assert.deepEqual(await event.records(owner, bookingId), [])
    await assert.rejects(booking.recordOutcome(owner, bookingId, 'attended'), { status: 409 })
    const moved = await booking.reschedule(customer, bookingId, startsIn(2, 10))
    assert.equal(moved.bookingId, bookingId)
    assert.equal((await booking.reserve(customer, consultation, initial)).bookingId, bookingId)
    assert.ok((await booking.slots(consultation, from, to)).available.includes(from))
    await save(booking, { ...offer('オンライン相談 改訂版'), offerId: consultation, durationMinutes: 45 })
    const original = await booking.customerBooking(customer, bookingId)
    assert.equal(original.offerRevision, 1)
    assert.equal(+new Date(original.endsAt) - +new Date(original.startsAt), 30 * 60_000)
    assert.equal((await booking.cancel(customer, bookingId)).cancelled, true)
    assert.equal((await booking.cancel(customer, bookingId)).cancelled, false)

    const eventTime = startsIn(3, 9)
    for (const attendee of [customer, second]) {
      assert.equal((await event.reserve(attendee, meeting, { startsAt: eventTime, idempotencyKey: randomUUID() })).paymentRequired, false)
    }
    await assert.rejects(event.reserve(third, meeting, { startsAt: eventTime, idempotencyKey: randomUUID() }), { status: 409 })
    const all = await event.records(owner)
    assert.equal(all.length, 2)
    const [record] = all
    await fixture.sql.query("UPDATE platform.bookings SET starts_at=now()-interval '1 hour', ends_at=now()-interval '30 minutes', block_start=now()-interval '1 hour',block_end=now()-interval '30 minutes' WHERE booking_id=$1", [record.id])
    const checked = await event.recordOutcome(owner, record.id, 'attended')
    assert.equal(checked.changed, true)
    assert.equal((await event.recordOutcome(owner, record.id, 'attended')).changed, false)
    assert.equal((await event.records(owner, record.id))[0].outcome, 'attended')
    await assert.rejects(booking.recordOutcome(owner, record.id, 'no_show'), { status: 404 })
    await fixture.sql.query("UPDATE identity.principals SET status='suspended' WHERE principal_id=$1", [customer])
    await assert.rejects(booking.reserve(customer, consultation, initial), { status: 403 })
    const notices = await fixture.sql.query('SELECT kind FROM platform.booking_notices WHERE booking_id=$1', [record.id])
    assert.ok(notices.some(notice => notice.kind === 'booking.confirmed'))
  } finally {
    await pool.end()
    await fixture.close()
  }
})
