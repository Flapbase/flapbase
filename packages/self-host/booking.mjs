import { computeSlots } from '../booking-slots/src/slots.js'
import { forbidden, invalid, missing, sha, StoreError, storeId } from './free-download.mjs'
import { transaction } from './setup.mjs'

const day = 86_400_000
const conflict = () => new StoreError(409, 'booking_conflict')

function instant(value) {
  const date = typeof value === 'string' ? new Date(value) : new Date(NaN)
  if (!Number.isFinite(date.getTime())) throw invalid()
  return date
}

function requiredId(value) {
  if (!storeId(value)) throw invalid()
  return value
}

const scopedKey = values => sha(JSON.stringify(values))
const result = async (db, sql, values) => (await db.query(sql, values)).rows[0]?.result
const evaluatedErrors = new Map([
  ['BOOKING_NOT_FOUND', missing],
  ['BOOKING_FORBIDDEN', forbidden],
  ['BOOKING_SLOT_TAKEN', conflict],
  ['BOOKING_SLOT_UNAVAILABLE', conflict],
  ['BOOKING_STATE_INVALID', conflict],
  ['BOOKING_INPUT_INVALID', invalid],
  ['BOOKING_HOST_REQUIRED', invalid],
  ['BOOKING_PAYMENT_UNAVAILABLE', invalid],
])

export function createBooking({ pool, projectId }) {
  requiredId(projectId)

  const run = fn => transaction(pool, fn).catch(error => {
    const translated = evaluatedErrors.get(error.message)
    throw translated ? translated() : error
  })

  async function operator(client, actor) {
    const { rows: [project] } = await client.query(`
      SELECT p.workspace_id
      FROM platform.projects p
      WHERE p.project_id = $1 AND p.status = 'active' AND platform.booking_member($2,p.workspace_id)
        AND (p.created_by_principal_id = $2 OR EXISTS (
          SELECT 1 FROM platform.project_memberships m WHERE m.project_id=p.project_id AND m.principal_id = $2
            AND m.status='active' AND m.revoked_at IS NULL AND m.member_role IN ('owner','editor')
        ))
    `, [projectId, actor])
    if (!project) throw forbidden()
    return project.workspace_id
  }

  async function offerInProject(client, offerId) {
    const { rows: [scope] } = await client.query(`
      SELECT o.workspace_id FROM platform.booking_offers o JOIN platform.projects p ON p.project_id=o.project_id
      JOIN platform.booking_offer_revisions r ON r.offer_id=o.offer_id AND r.revision=o.revision
      WHERE o.offer_id=$1 AND o.project_id=$2 AND p.status='active' AND r.price_amount=0 AND o.status='active'
      FOR SHARE OF o
    `, [requiredId(offerId), projectId])
    if (!scope) throw missing()
    return scope.workspace_id
  }

  async function customer(client, actor, requiresEmail = false) {
    const { rowCount } = await client.query(`
      SELECT 1 FROM identity.principals WHERE principal_id=$1 AND principal_kind='human' AND status='active'
        AND (NOT $2::boolean OR email IS NOT NULL)
    `, [actor, requiresEmail])
    if (!rowCount) throw forbidden()
  }

  async function bookingInProject(client, bookingId) {
    const { rowCount } = await client.query(`
      SELECT 1 FROM platform.bookings b JOIN platform.projects p USING (project_id)
      WHERE booking_id=$1 AND b.project_id=$2 AND p.status='active' AND b.amount=0
    `, [requiredId(bookingId), projectId])
    if (!rowCount) throw missing()
  }

  async function saveOffer(actor, input) {
    // Use the shared booking operations. The local host accepts free reservations.
    return run(async client => {
      const workspaceId = await operator(client, actor)
      const { host, offer, idempotencyKey } = input
      if (!host || !offer || !storeId(idempotencyKey)) throw invalid()
      await result(client, 'SELECT platform.booking_host_save($1,$2,$3::jsonb) AS result', [actor, workspaceId, {
        displayName: host.displayName, timeZone: host.timeZone, weeklyHours: host.weeklyHours, exceptions: host.exceptions,
        calendarCheck: 'best_effort',
      }])
      if (offer.offerId) await offerInProject(client, offer.offerId)
      const saved = await result(client, 'SELECT platform.booking_offer_save($1,$2,$3::jsonb) AS result', [actor, workspaceId, {
        offerId: offer.offerId, title: offer.title, description: offer.description, priceAmount: 0, status: 'active',
        durationMinutes: offer.durationMinutes, startStepMinutes: offer.startStepMinutes, minNoticeMinutes: offer.minNoticeMinutes,
        capacity: offer.capacity, meetingKind: 'none', sendCalendarInvite: false,
        idempotencyKey: scopedKey([projectId, actor, idempotencyKey]),
      }])
      await client.query('SELECT platform.booking_offer_project_set($1,$2,$3,$4)', [actor, workspaceId, saved.offerId, projectId])
      return saved
    })
  }

  function slots(offerId, fromDate, toDate) {
    const from = instant(fromDate)
    const to = instant(toDate)
    if (to <= from || to - from > 31 * day) throw invalid()
    return run(async client => {
      await offerInProject(client, offerId)
      const data = await result(client, 'SELECT platform.booking_offer_public($1,$2,$3) AS result', [offerId, from, to])
      if (!data) throw missing()
      const { offer, host, occupied } = data
      const available = computeSlots({
        ...offer, timeZone: host.timeZone, weeklyHours: offer.weeklyHours ?? host.weeklyHours, exceptions: host.exceptions,
      }, { from: from.getTime(), to: to.getTime(), now: Date.now(), occupied: occupied.map(item => item.map(Date.parse)), busy: [] })
      return { offer, timeZone: host.timeZone, available }
    })
  }

  function reserve(actor, offerId, { startsAt, idempotencyKey }) {
    const start = instant(startsAt).toISOString()
    requiredId(idempotencyKey)
    return run(async client => {
      await customer(client, actor, true)
      const workspaceId = await offerInProject(client, offerId)
      const key = scopedKey(['booking.hold', projectId, actor, idempotencyKey])
      const fingerprint = scopedKey([offerId, start])
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key])
      const { rows: [prior] } = await client.query(`
        SELECT request_digest,response FROM runtime.idempotency_keys WHERE workspace_id=$1 AND idempotency_key=$2
      `, [workspaceId, key])
      if (prior) {
        if (prior.request_digest !== fingerprint) throw conflict()
        return prior.response
      }
      const booking = await result(client, 'SELECT platform.booking_hold($1,$2,$3::jsonb,0) AS result', [actor, offerId, {
        startsAt: start, idempotencyKey: key,
      }])
      await client.query(`
        INSERT INTO runtime.idempotency_keys(workspace_id,idempotency_key,request_digest,response_digest,response)
        VALUES($1,$2,$3,$4,$5)
      `, [workspaceId, key, fingerprint, scopedKey(booking), booking])
      return booking
    })
  }

  function customerBooking(actor, bookingId) {
    return run(async client => {
      await customer(client, actor)
      await bookingInProject(client, bookingId)
      const booking = await result(client, 'SELECT platform.my_booking($1,$2) AS result', [actor, bookingId])
      if (!booking) throw missing()
      return booking
    })
  }

  function cancel(actor, bookingId) {
    return run(async client => {
      await customer(client, actor)
      await bookingInProject(client, bookingId)
      return result(client, "SELECT platform.booking_cancel($1,$2,'customer') AS result", [actor, bookingId])
    })
  }

  function reschedule(actor, bookingId, startsAt) {
    return run(async client => {
      await customer(client, actor)
      await bookingInProject(client, bookingId)
      return result(client, "SELECT platform.booking_reschedule($1,$2,'customer',$3) AS result", [actor, bookingId, instant(startsAt)])
    })
  }

  function records(actor, bookingId = null, limit = 50) {
    if (bookingId !== null) requiredId(bookingId)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid()
    return run(async client => {
      const workspaceId = await operator(client, actor)
      const { rows } = await client.query(`
        SELECT booking_id AS id, offer_id AS "offerId", starts_at AS "startsAt", ends_at AS "endsAt", status, outcome
        FROM platform.bookings WHERE workspace_id=$1 AND project_id=$2 AND status IN ('confirmed','cancelled')
          AND ($3::uuid IS NULL OR booking_id=$3)
        ORDER BY starts_at,booking_id LIMIT $4
      `, [workspaceId, projectId, bookingId, limit])
      return rows
    })
  }

  function recordOutcome(actor, bookingId, outcome) {
    if (!['attended', 'no_show', 'host_issue'].includes(outcome)) throw invalid()
    return run(async client => {
      await operator(client, actor)
      await bookingInProject(client, bookingId)
      return result(client, 'SELECT platform.booking_set_outcome($1,$2,$3) AS result', [actor, bookingId, outcome])
    })
  }

  return { projectId, saveOffer, slots, reserve, customerBooking, cancel, reschedule, records, recordOutcome }
}
